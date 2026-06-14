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

  /**
   * Build a small text sample from <title> + first visible text nodes,
   * capped at ~500 chars, used as input to LanguageDetector.detect().
   * @returns {string}
   */
  function buildDetectionSample() {
    const parts = [];
    const title = (document.title || "").trim();
    if (title) parts.push(title);
    const nodes = collectTextNodes(document.body);
    for (const n of nodes) {
      const t = n.nodeValue.trim();
      if (!t) continue;
      parts.push(t);
      const combined = parts.join(" ");
      if (combined.length > 500) break;
    }
    return parts.join(" ").slice(0, 800);
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
    // source language first using the Language Detector API.
    let sourceLang = null;
    if (api.isLanguageDetectorAvailable()) {
      const sample = buildDetectionSample();
      sourceLang = await api.detectSourceLanguage(sample);
    }
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
