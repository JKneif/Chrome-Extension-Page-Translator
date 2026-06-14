// lib/translate.js
// Wrapper around Chrome's built-in Translator API and Language Detector API.
// Exposed on globalThis.__pt so the content script can pick it up
// (MV3 content scripts run in the same isolated world as the lib script).

(function (global) {
  "use strict";

  /** @type {Map<string, Translator>} */
  const translatorCache = new Map();

  function isTranslatorAvailable() {
    return typeof global.Translator !== "undefined";
  }

  function isLanguageDetectorAvailable() {
    return typeof global.LanguageDetector !== "undefined";
  }

  function key(source, target) {
    return `${source}->${target}`;
  }

  /**
   * Detect the source language of a piece of text using Chrome's
   * LanguageDetector API. Returns a BCP-47 short code (e.g. "de", "fr"),
   * or null if detection is unavailable or fails.
   *
   * @param {string} sampleText
   * @returns {Promise<string | null>}
   */
  async function detectSourceLanguage(sampleText) {
    if (!isLanguageDetectorAvailable()) return null;
    if (!sampleText || !sampleText.trim()) return null;
    try {
      const detector = await global.LanguageDetector.create();
      const results = await detector.detect(sampleText);
      if (Array.isArray(results) && results.length > 0) {
        // Results are sorted by confidence descending. Pick the top hit.
        const top = results[0];
        if (top && top.detectedLanguage) return top.detectedLanguage;
      }
      return null;
    } catch (e) {
      console.warn("[page-translator] language detection failed:", e);
      return null;
    }
  }

  /**
   * Returns a Translator for the given language pair, creating it on first use.
   * Both source and target MUST be explicit BCP-47 short codes — Chrome's API
   * does not accept "auto" for sourceLanguage.
   *
   * @param {{source: string, target: string}} opts
   * @returns {Promise<Translator>}
   */
  async function ensureTranslator({ source, target }) {
    if (!isTranslatorAvailable()) {
      throw new Error("Chrome Translator API is not available");
    }
    if (!source || source === "auto") {
      throw new Error(
        "Translator.create requires an explicit source language (BCP-47 short code). " +
          'Call detectSourceLanguage() first; "auto" is not accepted.'
      );
    }
    const k = key(source, target);
    if (translatorCache.has(k)) return translatorCache.get(k);

    const translator = await global.Translator.create({
      sourceLanguage: source,
      targetLanguage: target,
    });
    translatorCache.set(k, translator);
    return translator;
  }

  /**
   * Translate a batch of strings. Order of the result matches the input.
   * Failed translations fall back to the original text so we never blank a node.
   * @param {Translator} translator
   * @param {string[]} texts
   * @returns {Promise<{results: string[], failures: number}>}
   */
  async function translateBatch(translator, texts) {
    const settled = await Promise.allSettled(
      texts.map((t) => translator.translate(t))
    );
    let failures = 0;
    const results = settled.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      failures += 1;
      console.warn("[page-translator] translate failed:", r.reason);
      return texts[i];
    });
    return { results, failures };
  }

  function clearCache() {
    translatorCache.clear();
  }

  global.__pt = {
    isTranslatorAvailable,
    isLanguageDetectorAvailable,
    detectSourceLanguage,
    ensureTranslator,
    translateBatch,
    clearCache,
  };
})(globalThis);
