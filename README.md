# Page Translator

A small Chrome extension (Manifest V3) that translates the current page into a target language on demand, using Chrome's **built-in Translator API**. No API keys, no external service, no cost.

## Features

- Pick a target language in the popup (English by default; also DE, FR, ES, IT, PT, NL, PL, RU, JA, ZH, KO).
- Click **Translate** → visible text on the page is translated in place.
- Click **Restore** → original text comes back.
- Skips `<script>`, `<style>`, `<code>`, `<pre>`, inputs, hidden elements, etc.
- All processing happens on-device in Chrome.

## Requirements

- **Chrome 138+** (Canary, Dev, or Beta).
- On Stable Chrome, enable `chrome://flags/#translation-api` and restart the browser.

## Install (unpacked, local use)

1. Open `chrome://extensions/`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select this `page-translator/` folder.
4. The extension icon appears in the toolbar. Pin it for easy access.

## Use

1. Navigate to any page (e.g. `https://de.wikipedia.org/wiki/Browser-Extension`).
2. Click the extension icon.
3. Pick a target language.
4. Click **Translate** — text is replaced with translations.
5. Click **Restore** — original text is brought back.

> **Note:** Restore only works if the page hasn't been reloaded since translation. A page reload drops the in-memory original map; the popup will tell you "Page was reloaded — nothing to restore."

## Permissions used

- `activeTab`, `scripting`, `storage` — to talk to the active tab and remember your language choice.
- `<all_urls>` (host permission) — so the content script can run on whichever page you're on.

## Architecture

```
manifest.json          MV3 config
popup/                 UI: language picker + buttons + status
content/content.js     DOM walking, text replacement, restore map
lib/translate.js       Translator API wrapper (caching, batching, errors)
icons/                 Toolbar + store icons
```

The popup only does UI + messaging. The content script does DOM work. The Translator API is wrapped in `lib/translate.js` so the rest of the code stays clean.

## Verifying

- Run `node --check popup/popup.js content/content.js lib/translate.js` — must exit 0.
- Run `node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"` — must exit 0.
- Manually: load unpacked, translate a Wikipedia page, then restore.

## Limitations

- No live re-translation of dynamically inserted content (no MutationObserver — by design, YAGNI).
- `<iframe>` content is not translated.
- No per-site settings, no glossary, no model selection.
- Translator API is still experimental; API shape may change.
