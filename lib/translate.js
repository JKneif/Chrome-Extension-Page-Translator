// lib/translate.js
// Wrapper around Chrome's built-in Translator API.
// Exposed on globalThis.__pt so the content script can pick it up
// (MV3 content scripts run in the same isolated world as the lib script).

(function (global) {
  "use strict";

  /** @type {Map<string, Translator>} */
  const cache = new Map();

  function isTranslatorAvailable() {
    return typeof global.Translator !== "undefined";
  }

  function key(source, target) {
    return `${source}->${target}`;
  }

  /**
   * Returns a Translator for the given language pair, creating it on first use.
   * @param {{source: string, target: string}} opts
   * @returns {Promise<Translator>}
   */
  async function ensureTranslator({ source, target }) {
    if (!isTranslatorAvailable()) {
      throw new Error("Chrome Translator API is not available");
    }
    const k = key(source, target);
    if (cache.has(k)) return cache.get(k);

    // Chrome Translator.create returns a Translator object.
    // We don't subscribe to monitor events to keep this minimal.
    const translator = await global.Translator.create({
      sourceLanguage: source,
      targetLanguage: target,
    });
    cache.set(k, translator);
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
    cache.clear();
  }

  global.__pt = {
    isTranslatorAvailable,
    ensureTranslator,
    translateBatch,
    clearCache,
  };
})(globalThis);
