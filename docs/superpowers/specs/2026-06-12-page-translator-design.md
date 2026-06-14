# Page Translator — Chrome Extension Design

**Date:** 2026-06-12
**Status:** Approved (auto-approval per user request: "Mach jetzt einfach das ganze Ding fertig")
**Target:** MV3 Chrome Extension, local use only, Chrome Built-in Translator API

## Purpose

A user-triggered Chrome extension that, on a single click in the popup, translates all visible text on the current page from its detected source language into a user-selected target language. A second click restores the original text. Runs entirely on-device via Chrome's built-in Translator API — no API keys, no external service, no cost.

## Constraints & Assumptions

- **Distribution:** Unpacked extension loaded via `chrome://extensions/` in developer mode. No Chrome Web Store publishing.
- **Engine:** Chrome Built-in Translator API (`globalThis.Translator`) + Language Detector API (`globalThis.LanguageDetector`). Available in Chrome 138+ (Canary/Dev/Beta by default; Stable requires `chrome://flags/#translation-api` and `chrome://flags/#language-detection-api`).
- **Source language:** Detected at translate-time via `LanguageDetector.detect()` over `<title>` + first visible text nodes (~800 chars). Result is an explicit BCP-47 short code passed to `Translator.create()`. **"auto" is not accepted** by the Translator API and must be resolved first.
- **Target language:** User-selectable in popup, default `en`. Persisted in `chrome.storage.session`.
- **Scope:** Single page, no MutationObserver (best-effort, no live updates).
- **Permissions:** `activeTab`, `scripting`, `storage`, `host_permissions: ["<all_urls>"]`.
- **Service Worker:** None (YAGNI).
- **Restore guarantee:** Only within the same content-script lifetime. Page reload destroys the original text map.

## Architecture

```
popup/        UI: language picker, Translate/Restore buttons, status banner
content/      Content script: collects text nodes, calls lib/translate, restores
lib/          Translator API wrapper (batching, caching, error handling)
icons/        16/48/128 PNG
manifest.json MV3 config
```

### Module Boundaries

- `popup/popup.js` — UI only. Reads/writes storage, sends messages, renders status. No translation logic.
- `content/content.js` — DOM walking (TreeWalker), text replacement, original-node map, message dispatch. No direct Translator calls.
- `lib/translate.js` — Translator lifecycle (`createTranslator`, `getOrCreate`), batching, error normalization. No DOM access.

## Data Flow

### Translate

1. User opens popup, picks target language, clicks **Translate**.
2. `popup.js` → `chrome.tabs.sendMessage(tabId, {type: "TRANSLATE", targetLang})`.
3. `content.js` calls `collectTextNodes(document.body)` → `Array<{node, text}>`.
4. `content.js` builds a detection sample (`<title>` + first ~800 chars) and calls `api.detectSourceLanguage(sample)` → `sourceLang`.
5. If `sourceLang === targetLang`, respond with "Page is already in <target>".
6. Text nodes grouped into batches of 50.
7. For each batch: `ensureTranslator({source: sourceLang, target})` (cached by key).
8. For each node: `translator.translate(text)` → assign to `node.textContent`.
9. Original text stored in a `WeakMap<TextNode, string>` scoped to the content script module.
10. Response `{ok: true, translated: N, failures: M}` sent back to popup.

### Restore

1. User clicks **Restore**.
2. `popup.js` → `chrome.tabs.sendMessage(tabId, {type: "RESTORE"})`.
3. `content.js` iterates the WeakMap, restores `node.textContent`, clears the map.
4. Response `{ok: true, restored: N}`.

### Errors

- `Translator` undefined → popup renders red banner: *"Chrome Translator API is not available. Enable it in chrome://flags/#translation-api or use Chrome 138+ (Canary/Dev/Beta)."*
- `LanguageDetector` undefined → popup renders red banner: *"Chrome Language Detector API is not available. Enable it in chrome://flags/#language-detection-api."*
- Language detection returns `null` (e.g. empty page, detection failed) → popup: *"Could not detect the page's source language."*
- `Translator.create()` throws (e.g. unsupported language pair) → popup shows the error detail in the banner. Original page is untouched.
- `translator.translate()` rejects → log to console, leave node unchanged, continue batch. Popup status reflects `partial: M/N`.
- Zero text nodes → popup: *"Nothing to translate on this page."*
- Page reloaded → popup: *"Page was reloaded — nothing to restore."*

## DOM Collection Strategy

`TreeWalker(document.body, NodeFilter.SHOW_TEXT, {acceptNode})` with `FILTER_ACCEPT` only when:

- `node.nodeValue.trim().length > 0`
- parent element is not in `SKIP_TAGS`: `SCRIPT`, `STYLE`, `NOSCRIPT`, `IFRAME`, `CODE`, `PRE`, `INPUT`, `TEXTAREA`, `SELECT`, `OPTION`, `BUTTON`
- parent is visible: `getComputedStyle(parent).display !== "none"` and `visibility !== "hidden"`

Single pass, no MutationObserver.

## Translation API Wrapper Contract

`lib/translate.js` exports (as `globalThis.__pt` for content-script import; no ES modules in MV3 content scripts without bundler):

- `isTranslatorAvailable() → boolean` — checks `typeof Translator !== "undefined"`.
- `isLanguageDetectorAvailable() → boolean` — checks `typeof LanguageDetector !== "undefined"`.
- `detectSourceLanguage(text) → Promise<string | null>` — calls `LanguageDetector.create().detect(text)`, returns the top hit's `detectedLanguage` (BCP-47 short code) or `null` on failure/unavailability.
- `ensureTranslator({source, target}) → Promise<Translator>` — throws if `source` is missing or `"auto"`. Caches by `${source}->${target}`. Calls `Translator.create({sourceLanguage: source, targetLanguage: target})`.
- `translateBatch(translator, texts) → Promise<{results: string[], failures: number}>` — calls `translator.translate()` per text in parallel via `Promise.allSettled`. Order preserved; rejected entries become `texts[i]` (no-op fallback).

## Persistence

- `chrome.storage.session.targetLang` — last selected target language. Default `"en"`.
- No translation cache, no preferences beyond target language (YAGNI).

## UI

Popup is a small 280×220 box:

- Heading: "Page Translator"
- Dropdown: target language (en, de, fr, es, it, pt, nl, pl, ru, ja, zh, ko)
- Button "Translate" (primary, full width)
- Button "Restore" (secondary, full width)
- Status line: text + color (green = ok, red = error, gray = idle)
- Banner area: shown only on API-unavailable error

## Verification

1. `node --check` on all JS files → must exit 0.
2. `JSON.parse` on `manifest.json` → must succeed.
3. Manual smoke test (documented in README):
   - Load unpacked on `chrome://extensions/`.
   - Visit `https://de.wikipedia.org/wiki/Browser-Extension`.
   - Translate to English, then Restore.
   - Verify `<code>` blocks remain unchanged.
4. Edge cases to manually confirm:
   - Page with hidden elements (should not be translated).
   - Page with zero text (popup: "Nothing to translate…").
   - Stable Chrome without flag (popup shows banner).

## Out of Scope

- MutationObserver / live translation of dynamic content.
- Multi-page translation flows.
- Per-site settings, whitelists, blacklists.
- Translation of iframes (`<iframe>` is in SKIP_TAGS).
- Custom glossary or domain overrides.
- Authentication / API keys.
- Service worker / background page.
- Chrome Web Store submission.
