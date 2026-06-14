# 🔥 Page Translator — The "Why Isn't This Built Into Chrome Already" Extension

> One click. Any page. Any language. **Zero tracking. Zero API keys. Zero cost.**

You land on a Chinese product page. A French legal doc. A Japanese GitHub README. A German Wikipedia article you actually need to *read*, not just skim.

**Click the icon. Pick a language. Done.**

No copy-paste into Google Translate. No weird `translate.google.com/translate?u=…` URL bar hijack. No "please sign up for DeepL Pro". No $20/month subscription. No text leaves your browser. Ever.

**This is what page translation should have been in 2014.**

---

## ⚡ What it does

- 🌐 **Translates the entire page** into one of 12 languages with a single click
- ↩️ **One-click restore** — original text comes back, byte-perfect
- 🎯 **Smart source detection** — figures out the page's language from the actual DOM, not the URL (`/de/` paths lie, mixed-language SPAs exist)
- 🚫 **Skips the noise** — `<code>`, `<pre>`, scripts, styles, hidden elements, and inputs are left alone. Your syntax-highlighted snippets stay syntax-highlighted.
- 🧠 **Runs 100% on-device** using Chrome's built-in Translator + Language Detector APIs. **Nothing is sent to any server. No telemetry. No "anonymous usage stats". No bullshit.**

---

## 🤔 Why not just use Google Translate's built-in page translation?

Glad you asked. Here's the thing:

| | **Page Translator** | Chrome's built-in | Google Translate URL trick |
|---|---|---|---|
| URL hijack | ❌ Never | ❌ Never | ✅ Every time |
| Sends page content to a server | ❌ Never | ✅ Yes | ✅ Yes |
| Works on SPAs (React, Vue, etc.) | ✅ Yes | 🟡 Sometimes | ❌ Breaks |
| Works offline (after first download) | ✅ Yes | ❌ No | ❌ No |
| Free | ✅ Yes | ✅ Yes | ✅ Yes |
| Open source | ✅ Yes | ❌ No | ❌ No |
| No account / no API key | ✅ Yes | ✅ Yes | ✅ Yes |
| Page reload breaks it | ✅ No (restore still works) | n/a | n/a |
| Respects `<code>` blocks | ✅ Yes | ❌ No | ❌ No |
| Respects hidden / offscreen elements | ✅ Yes | ❌ No | ❌ No |

The killer feature: **click → translated. Click again → original. No page reload. No URL bar nonsense. No "translate this page?" bar stealing screen real estate.**

---

## 📦 Install in 30 seconds

> **Requirement:** Chrome 138+ (Canary / Dev / Beta) — or Chrome Stable with two flags flipped.

### On Canary / Dev / Beta
Just works out of the box. The APIs are enabled by default.

### On Chrome Stable
1. Open `chrome://flags/#translation-api` → set to **Enabled**
2. Open `chrome://flags/#language-detection-api` → set to **Enabled**
3. Restart Chrome

### Install the extension
1. `chrome://extensions/` → toggle **Developer mode** (top right)
2. **Load unpacked** → select this folder
3. Pin the icon. Click it on any page. Mind = blown.

---

## 🛠️ How it works (for the curious)

```
┌─────────────┐  message   ┌──────────────┐   API call   ┌─────────────────┐
│   Popup UI  │ ─────────▶ │ Content      │ ───────────▶ │ Chrome's        │
│  (lang +    │            │ Script       │              │ Translator API  │
│   buttons)  │ ◀───────── │ (DOM walker) │ ◀─────────── │ (on-device)     │
└─────────────┘  result    └──────────────┘   result     └─────────────────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │ Language     │
                                   │ Detector API │
                                   │ (on-device)  │
                                   └──────────────┘
```

Three clean modules, **zero dependencies**, **zero network calls**:

- `popup/` — UI only. No translation logic. No business rules.
- `content/content.js` — DOM walking with `TreeWalker`. Smart filters. WeakMap-based restore.
- `lib/translate.js` — Wrapper around Chrome's APIs. Caching, batching, graceful failure.

Want to hack on it? The whole codebase is **< 300 lines of actual logic**. No build step. No bundler. No `node_modules` graveyard. Just open the folder in your editor.

---

## 🌍 Supported languages

| Code | Language | Code | Language |
|---|---|---|---|
| `en` | English | `pt` | Portuguese |
| `de` | German | `nl` | Dutch |
| `fr` | French | `pl` | Polish |
| `es` | Spanish | `ru` | Russian |
| `it` | Italian | `ja` | Japanese |
| | | `zh` | Chinese |
| | | `ko` | Korean |

(Driven by Chrome's Translator API language packs — grows over time as Chrome adds more.)

---

## 🤔 Why is this free? What's the catch?

**There is no catch.**

It runs on **Chrome's own built-in Translator and Language Detector APIs** — the same ones Google uses for its built-in page translation. We just expose them as a proper extension with a popup, a restore button, and code-aware filtering.

No backend. No API key you have to provision. No model you have to host. No rate limits to beg for more of.

**You are not the product.** Your reading habits stay on your machine.

---

## 🚧 What this is NOT

We're honest about limitations:

- ❌ **Doesn't translate `<iframe>` contents** — Chrome's API doesn't support cross-origin iframes without explicit per-frame opt-in.
- ❌ **Doesn't translate canvas/WebGL text** — that text isn't in the DOM to begin with.
- ❌ **Doesn't auto-translate lazy-loaded content** — when you click "Load more" and new content streams in, you'll need to click Translate again. (We deliberately don't use a `MutationObserver` to keep things fast and predictable.)
- ❌ **Requires Chrome 138+** — older Chrome versions don't have the APIs.
- ❌ **Source language detection isn't magic** — a page that's 99% English with a tiny CJK snippet might be detected as English. We use a DOM-wide sample + `<html lang>` hint, but detection is fundamentally a guess.

These are **API and design constraints**, not laziness. PRs welcome for any of them.

---

## 🧪 Development

```bash
# Clone
git clone https://github.com/JKneif/ChromeExtensionPageTranslator.git
cd ChromeExtensionPageTranslator

# Regenerate icons (requires sharp, used by scripts/build-icons.js)
npm install --no-save sharp
node scripts/build-icons.js

# Load in Chrome
# chrome://extensions/ → Developer mode → Load unpacked → this folder
```

### Project layout

```
page-translator/
├── manifest.json          # MV3 config
├── popup/                 # UI: language picker + buttons + status
├── content/               # DOM walking, text replacement, restore
├── lib/                   # Chrome API wrapper
├── icons/                 # SVG source + 16/48/128 PNG
├── scripts/               # Build helpers (icon regen)
└── docs/                  # Design spec
```

### Verifying

```bash
node --check popup/popup.js content/content.js lib/translate.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"
```

Both should exit 0. If they don't, you broke something.

---

## 📜 License

MIT. Use it, fork it, ship it as a paid product if you want (though we can't imagine why).

---

## ⭐ Why you should star this repo

Honestly?

- **It's the page translator Chrome should have shipped by default.** No URL bar hijack, no telemetry, no API keys.
- **It's < 300 lines of actual logic.** You can read the whole thing on a coffee break and know exactly what it does to your browser.
- **It's a reference implementation** of how to use Chrome's new on-device AI APIs. Fork it, learn from it, build the next thing.
- **It gets better with Chrome itself.** As Chrome adds languages and improves its on-device models, this extension gets better for free.

⭐ **If this saved you from copy-pasting one more paragraph into Google Translate, hit the star. That's it. That's the ask.**

---

<sub>Built with 🫶 on top of Chrome's built-in AI APIs. No external services. No tracking. No nonsense.</sub>
