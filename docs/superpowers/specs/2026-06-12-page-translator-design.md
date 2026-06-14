# Page Translator — Chrome Extension Design

**Date:** 2026-06-12
**Status:** Approved (auto-approval per user request: "Mach jetzt einfach das ganze Ding fertig")
**Target:** MV3 Chrome Extension, local use only, Chrome Built-in Translator API

## Purpose

A user-triggered Chrome extension that, on a single click in the popup, translates all visible text on the current page from its detected source language into a user-selected target language. A second click restores the original text. Runs entirely on-device via Chrome's built-in Translator API — no API keys, no external service, no cost.

## Constraints & Assumptions

- **Distribution:** Unpacked extension loaded via `chrome://extensions/` in developer mode. No Chrome Web Store publishing.
- **Engine:** Chrome Built-in Translator API (`globalThis.Translator`). Available in Chrome 138+ (Canary/Dev/Beta by default; Stable requires `chrome://flags/#translation-api`).
- **Source language:** Auto-detect (`sourceLanguage: "auto"`).
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
4. Text nodes grouped into batches of 50.
5. For each batch: `ensureTranslator({source: "auto", target})` (cached by key).
6. For each node: `translator.translate(text)` → assign to `node.textContent`.
7. Original text stored in a `WeakMap<TextNode, string>` scoped to the content script module.
8. Response `{ok: true, translated: N}` sent back to popup.

### Restore

1. User clicks **Restore**.
2. `popup.js` → `chrome.tabs.sendMessage(tabId, {type: "RESTORE"})`.
3. `content.js` iterates the WeakMap, restores `node.textContent`, clears the map.
4. Response `{ok: true, restored: N}`.

### Errors

- `Translator` undefined → popup renders red banner: *"Chrome Translator API is not available. Enable it in chrome://flags/#translation-api or use Chrome 138+ (Canary/Dev/Beta)."*
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

- `ensureTranslator({source, target}) → Promise<Translator>` — caches by `${source}->${target}`. Calls `Translator.create({source, target, monitor})` if missing.
- `translateBatch(translator, texts) → Promise<string[]>` — calls `translator.translate()` per text in parallel via `Promise.allSettled`. Order preserved; rejected entries become `texts[i]` (no-op fallback).
- `isTranslatorAvailable() → boolean` — checks `typeof Translator !== "undefined"`.

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
