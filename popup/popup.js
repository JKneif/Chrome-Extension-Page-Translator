// popup/popup.js
// UI only. No translation logic. Reads/writes chrome.storage.session for the
// last selected target language, and sends messages to the content script
// of the active tab.

const $ = (sel) => document.querySelector(sel);

const els = {
  lang: $("#target-lang"),
  translate: $("#translate-btn"),
  restore: $("#restore-btn"),
  status: $("#status"),
  banner: $("#banner"),
};

const DEFAULT_LANG = "en";

function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.className = `status ${kind}`;
}

function showBanner(html) {
  els.banner.innerHTML = html;
  els.banner.hidden = false;
}

function hideBanner() {
  els.banner.hidden = true;
  els.banner.textContent = "";
}

function setBusy(busy) {
  els.translate.disabled = busy;
  els.restore.disabled = busy;
  els.lang.disabled = busy;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContent(message) {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    return { ok: false, error: "NO_TAB" };
  }
  if (!tab.url || /^chrome:|^about:|^edge:/.test(tab.url)) {
    return { ok: false, error: "RESTRICTED_URL" };
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (e) {
    // Content script not injected (e.g. service-worker-only pages, file://)
    return { ok: false, error: "NO_CONTENT_SCRIPT", detail: String(e) };
  }
}

async function init() {
  // Load last selected language
  const stored = await chrome.storage.session.get("targetLang");
  els.lang.value = stored.targetLang || DEFAULT_LANG;

  // Probe content script + API availability
  const probe = await sendToContent({ type: "PING" });
  if (!probe || !probe.ok) {
    setStatus("Inactive on this page.", "idle");
    els.translate.disabled = true;
    els.restore.disabled = true;
    if (probe && probe.error === "RESTRICTED_URL") {
      showBanner("This page type cannot be translated (chrome://, about:, etc.).");
    } else {
      showBanner("Content script did not load on this page. Try reloading the tab.");
    }
    return;
  }
  if (!probe.apiAvailable) {
    setStatus("Translator API not available.", "error");
    els.translate.disabled = true;
    showBanner(
      'Chrome\'s built-in Translator API is not available. ' +
      '<a href="chrome://flags/#translation-api" target="_blank">Enable the flag</a> ' +
      'or use Chrome 138+ (Canary/Dev/Beta).'
    );
    return;
  }

  hideBanner();
  setStatus("Ready.", "idle");
}

async function onTranslate() {
  const targetLang = els.lang.value;
  await chrome.storage.session.set({ targetLang });
  setBusy(true);
  setStatus("Translating…", "idle");
  hideBanner();
  const res = await sendToContent({ type: "TRANSLATE", targetLang });
  setBusy(false);
  if (!res || !res.ok) {
    setStatus(`Error: ${res && res.error ? res.error : "unknown"}`, "error");
    return;
  }
  if (res.translated === 0) {
    setStatus(res.message || "Nothing to translate.", "idle");
    return;
  }
  const tail = res.failures ? ` (${res.failures} failed)` : "";
  setStatus(`Translated ${res.translated} node(s)${tail}.`, "success");
}

async function onRestore() {
  setBusy(true);
  setStatus("Restoring…", "idle");
  const res = await sendToContent({ type: "RESTORE" });
  setBusy(false);
  if (!res || !res.ok) {
    setStatus(`Error: ${res && res.error ? res.error : "unknown"}`, "error");
    return;
  }
  if (res.restored === 0) {
    setStatus(res.message || "Nothing to restore.", "idle");
  } else {
    setStatus(`Restored ${res.restored} node(s).`, "success");
  }
}

els.translate.addEventListener("click", onTranslate);
els.restore.addEventListener("click", onRestore);
els.lang.addEventListener("change", () => {
  chrome.storage.session.set({ targetLang: els.lang.value });
});

document.addEventListener("DOMContentLoaded", init);
