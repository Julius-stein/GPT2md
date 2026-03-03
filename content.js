// ----------------------------
// Export settings
// ----------------------------
const DEFAULT_EXPORT_SETTINGS = {
  keepEmojis: false,
  keepHr: false,
  keepTail: false
};

const exportOptions = { ...DEFAULT_EXPORT_SETTINGS };

function applyExportSettings(nextSettings = {}) {
  Object.assign(exportOptions, DEFAULT_EXPORT_SETTINGS, nextSettings);
}

function loadExportSettings() {
  if (!chrome?.storage?.sync) return Promise.resolve(exportOptions);

  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_EXPORT_SETTINGS, (result) => {
      applyExportSettings(result);
      resolve(exportOptions);
    });
  });
}

if (chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;

    const nextSettings = {};
    let hasRelevantChange = false;

    Object.keys(DEFAULT_EXPORT_SETTINGS).forEach((key) => {
      if (!changes[key]) return;
      nextSettings[key] = changes[key].newValue;
      hasRelevantChange = true;
    });

    if (hasRelevantChange) {
      applyExportSettings(nextSettings);
    }
  });
}

// ----------------------------
// Locate assistant messages
// ----------------------------
function findAssistantMessages() {
  return document.querySelectorAll('[data-message-author-role="assistant"]');
}

function isAssistantMessage(node) {
  return node?.matches?.('[data-message-author-role="assistant"]');
}

function findContentRoot(msg) {
  return (
    msg.querySelector(".markdown") ||
    msg.querySelector('[class*="prose"]') ||
    msg
  );
}

// ----------------------------
// Filename / download
// ----------------------------
function generateFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `chatgpt-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}.md`;
}

function downloadText(content) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = generateFilename();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

// ----------------------------
// Export one message
// ----------------------------
function exportOneMessage(msg) {
  const root = findContentRoot(msg);
  const clone = root.cloneNode(true);

  clone.querySelectorAll(".export-btn, .md-export-btn").forEach((el) => el.remove());

  let md = nodeToMarkdown(clone);

  if (!exportOptions.keepEmojis) {
    md = normalizeNumberEmoji(md);
    md = removeEmojis(md);
  }

  if (!exportOptions.keepTail) {
    md = trimAfterLastHr(md);
  }

  if (!exportOptions.keepHr) {
    md = md.replace(/^\s*---+\s*$/gm, "");
  }

  md = normalizeMarkdown(md);

  return md;
}

function normalizeNumberEmoji(text) {
  return text.replace(/((?:[0-9]\uFE0F?\u20E3)+)/g, (match) => {
    const digits = match.match(/[0-9]/g).join("");
    return digits + ".";
  });
}

function removeEmojis(text) {
  return text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");
}

function normalizeMarkdown(md) {
  md = md.replace(/[ \t]+$/gm, "");
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.replace(/^\n+/, "");
  md = md.replace(/\n+$/, "\n");

  return md;
}

function trimAfterLastHr(md) {
  const hrRegex = /\n---+\n/g;
  const matches = [...md.matchAll(hrRegex)];

  if (matches.length === 0) return md;

  const lastMatch = matches[matches.length - 1];
  return md.slice(0, lastMatch.index).trim();
}

// ----------------------------
// Button injection
// ----------------------------
const EXPORT_BUTTON_TEXT = "Export Markdown";
const OBSERVE_ROOT_MARGIN = "600px 0px";

function ensureExportButton(msg) {
  const root = findContentRoot(msg);
  if (!root) return;
  if (msg.dataset.mdExportInjected === "1") return;

  let mount = msg.querySelector(".__md_export_mount");
  if (!mount) {
    mount = document.createElement("div");
    mount.className = "__md_export_mount";
    mount.style.cssText = "margin-top:6px;";
    msg.appendChild(mount);
  }

  if (mount.querySelector(".md-export-btn")) {
    msg.dataset.mdExportInjected = "1";
    return;
  }

  const btn = document.createElement("button");
  btn.className = "md-export-btn";
  btn.textContent = EXPORT_BUTTON_TEXT;
  btn.style.cssText = `
    font-size: 12px;
    cursor: pointer;
    opacity: 0.85;
    background: transparent;
    border: 1px solid rgba(0,0,0,0.15);
    border-radius: 8px;
    padding: 4px 10px;
    line-height: 1;
  `;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const md = exportOneMessage(msg);
    downloadText(md);
  });

  mount.appendChild(btn);
  msg.dataset.mdExportInjected = "1";
}

const pendingMessages = new Set();
const observedMessages = new WeakSet();
let flushScheduled = false;
let viewportObserver = null;

function flushPendingMessages() {
  flushScheduled = false;

  pendingMessages.forEach((msg) => {
    pendingMessages.delete(msg);
    if (msg.dataset.mdExportInjected === "1") return;
    if (viewportObserver) {
      if (observedMessages.has(msg)) return;
      observedMessages.add(msg);
      viewportObserver.observe(msg);
    } else {
      ensureExportButton(msg);
    }
  });
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(flushPendingMessages);
}

function queueAssistantMessage(msg) {
  if (!msg || msg.dataset.mdExportInjected === "1") return;
  if (viewportObserver && observedMessages.has(msg)) return;
  pendingMessages.add(msg);
  scheduleFlush();
}

function queueMessagesInSubtree(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

  if (isAssistantMessage(node)) {
    queueAssistantMessage(node);
  }

  node
    .querySelectorAll?.('[data-message-author-role="assistant"]')
    .forEach(queueAssistantMessage);
}

function initViewportObserver() {
  if (!("IntersectionObserver" in window)) return null;

  return new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const msg = entry.target;
        viewportObserver.unobserve(msg);
        observedMessages.delete(msg);
        ensureExportButton(msg);
      });
    },
    {
      root: null,
      rootMargin: OBSERVE_ROOT_MARGIN
    }
  );
}

function scanExistingMessages() {
  findAssistantMessages().forEach(queueAssistantMessage);
}

async function init() {
  await loadExportSettings();
  viewportObserver = initViewportObserver();
  scanExistingMessages();

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (!m.addedNodes?.length) continue;

      m.addedNodes.forEach(queueMessagesInSubtree);

      const targetMsg = m.target?.closest?.('[data-message-author-role="assistant"]');
      if (targetMsg) queueAssistantMessage(targetMsg);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.body) init();
else window.addEventListener("DOMContentLoaded", init);
