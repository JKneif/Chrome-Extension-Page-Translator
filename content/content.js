// content/content.js
// Runs in the page's isolated world. Walks the DOM, translates visible
// text nodes, keeps a WeakMap to restore originals on demand.

(function () {
  "use strict";

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME",
    "CODE", "PRE",
    "INPUT", "TEXTAREA", "SELECT", "OPTION", "BUTTON",
  ]);

  const BATCH_SIZE = 50;

  /** @type {WeakMap<Text, string>} */
  const originalByNode = new WeakMap();

  function isVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const cs = globalThis.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (cs.display === "contents") return true; // contents children inherit visibility from elsewhere
    return true;
  }

  function shouldSkipParent(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    return !isVisible(el);
  }

  // Soft cap for the detection sample. Larger than the translate-pipeline
  // cap because SPAs often have English chrome ("Agent Router", nav, etc.)
  // at the top and the actual page content (often non-Latin) further down.
  const DETECT_SAMPLE_MAX = 4000;

  /**
   * Check whether a string contains characters from non-Latin scripts
   * (CJK, Cyrillic, Arabic, Hebrew, etc.). Used to decide whether the
   * page's primary script is non-Latin even when most visible text is.
   *
   * @param {string} s
   * @returns {boolean}
   */
  function hasNonLatinScript(s) {
    // Unicode ranges covering CJK, Cyrillic, Greek, Arabic, Hebrew, Devanagari, Thai, etc.
    // Latin and Common punctuation/digits are excluded.
    return /[Ѐ-ӿͰ-Ͽ֐-׿؀-ۿऀ-ॿ฀-๿぀-ヿ㐀-䶿一-鿿가-힯]/.test(s);
  }

  /**
   * @returns {string|null} BCP-47 short code from <html lang="..."> if present and
   *   looks like a real language tag (not "" or "en" by default). Returns the
   *   primary subtag only (e.g. "zh" from "zh-Hans-CN").
   */
  function getHtmlLang() {
    const raw = document.documentElement && document.documentElement.lang;
    if (!raw) return null;
    const primary = raw.trim().toLowerCase().split(/[-_]/)[0];
    // Reject obviously bogus values.
    if (!primary || primary === "en" || primary.length < 2 || primary.length > 8) return null;
    return primary;
  }

  /**
   * Build a larger, DOM-wide text sample for language detection. We sample
   * up to DETECT_SAMPLE_MAX chars from <title> + visible text nodes anywhere
   * in the document, not just the first few — so a page with English chrome
   * at the top and Chinese content lower down still gets detected correctly.
   *
   * @returns {string}
   */
  function buildDetectionSample() {
    const parts = [];
    const title = (document.title || "").trim();
    if (title) parts.push(title);

    const nodes = collectTextNodes(document.body);
    for (const n of nodes) {
      // Use the raw nodeValue but still skip purely-whitespace nodes — they
      // add nothing for detection and bloat the sample.
      const raw = n.nodeValue;
      if (!raw || !raw.trim()) continue;
      parts.push(raw);
      const combined = parts.join(" ");
      if (combined.length > DETECT_SAMPLE_MAX) break;
    }
    return parts.join(" ").slice(0, DETECT_SAMPLE_MAX);
  }

  /**
   * Decide the page's source language. Runs the Chrome LanguageDetector on
   * the DOM-wide sample; if the detector is confident in Latin script only
   * (or detection fails / returns en) but <html lang="..."> names a different
   * language, trust the html attribute as a hint.
   *
   * @returns {Promise<string|null>} BCP-47 short code, or null if unknown.
   */
  async function resolveSourceLanguage() {
    const api = globalThis.__pt;
    if (!api || !api.isLanguageDetectorAvailable()) return null;

    const sample = buildDetectionSample();
    let detected = null;
    try {
      detected = await api.detectSourceLanguage(sample);
    } catch (e) {
      console.warn("[page-translator] language detection threw:", e);
    }

    // If the sample clearly contains non-Latin script, trust detection
    // (or null) — do NOT let html lang override real CJK content.
    const sampleHasNonLatin = hasNonLatinScript(sample);
    if (sampleHasNonLatin) {
      return detected;
    }

    // Sample looks Latin-only. If detection picked something non-English,
    // trust it. Otherwise, consider <html lang="..."> as a hint.
    if (detected && detected !== "en") {
      return detected;
    }
    const htmlLang = getHtmlLang();
    if (htmlLang && htmlLang !== "en") {
      return htmlLang;
    }
    return detected || htmlLang || null;
  }


  /**
   * Collect visible text nodes under `root`.
   * @param {Node} root
   * @returns {Text[]}
   */
  function collectTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) {
            return NodeFilter.FILTER_REJECT;
          }
          const parent = node.parentElement;
          if (shouldSkipParent(parent)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );
    let current = walker.nextNode();
    while (current) {
      nodes.push(current);
      current = walker.nextNode();
    }
    return nodes;
  }

  async function translateAll(targetLang) {
    const api = globalThis.__pt;
    if (!api || !api.isTranslatorAvailable()) {
      return { ok: false, error: "UNAVAILABLE" };
    }

    const nodes = collectTextNodes(document.body);
    if (nodes.length === 0) {
      return { ok: true, translated: 0, restored: 0, message: "Nothing to translate on this page." };
    }

    // The Translator API does not accept "auto" — we must detect the
    // source language first using the Language Detector API. We use a
    // DOM-wide sample (not just the first few nodes) and fall back to
    // <html lang="..."> when the visible text is mostly Latin.
    const sourceLang = await resolveSourceLanguage();
    if (!sourceLang) {
      return {
        ok: false,
        error: "DETECT_FAILED",
        detail:
          "Could not detect the page's source language. The Language Detector API may be unavailable, or the page has no usable text.",
      };
    }
    if (sourceLang === targetLang) {
      return {
        ok: true,
        translated: 0,
        failures: 0,
        message: `Page is already in ${targetLang}; nothing to translate.`,
      };
    }

    let translator;
    try {
      translator = await api.ensureTranslator({ source: sourceLang, target: targetLang });
    } catch (e) {
      console.error("[page-translator] ensureTranslator failed:", e);
      return { ok: false, error: "CREATE_FAILED", detail: String(e) };
    }

    let totalTranslated = 0;
    let totalFailures = 0;

    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
      const batch = nodes.slice(i, i + BATCH_SIZE);
      const texts = batch.map((n) => n.nodeValue);
      const { results, failures } = await api.translateBatch(translator, texts);
      for (let j = 0; j < batch.length; j++) {
        const node = batch[j];
        // Only store original the first time we touch a node.
        if (!originalByNode.has(node)) {
          originalByNode.set(node, texts[j]);
        }
        node.nodeValue = results[j];
        totalTranslated += 1;
      }
      totalFailures += failures;
    }

    return {
      ok: true,
      translated: totalTranslated,
      failures: totalFailures,
    };
  }

  function restoreAll() {
    // We can't iterate a WeakMap, so we re-collect and check membership.
    // Practical approach: collect candidates, restore if originalByNode has them.
    const nodes = collectTextNodes(document.body);
    let restored = 0;
    for (const node of nodes) {
      const orig = originalByNode.get(node);
      if (orig !== undefined) {
        node.nodeValue = orig;
        originalByNode.delete(node);
        restored += 1;
      }
    }
    if (restored === 0) {
      return { ok: true, restored: 0, message: "Page was reloaded — nothing to restore." };
    }
    return { ok: true, restored };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return false;

    if (msg.type === "TRANSLATE") {
      translateAll(msg.targetLang || "en")
        .then(sendResponse)
        .catch((e) => {
          console.error("[page-translator] translateAll crashed:", e);
          sendResponse({ ok: false, error: "CRASH", detail: String(e) });
        });
      return true; // async response
    }

    if (msg.type === "RESTORE") {
      Promise.resolve(restoreAll()).then(sendResponse);
      return false;
    }

    if (msg.type === "PING") {
      sendResponse({
        ok: true,
        apiAvailable: !!(globalThis.__pt && globalThis.__pt.isTranslatorAvailable()),
        detectorAvailable: !!(globalThis.__pt && globalThis.__pt.isLanguageDetectorAvailable()),
      });
      return false;
    }

    return false;
  });
})();
