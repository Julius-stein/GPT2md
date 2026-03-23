const DEFAULT_EXPORT_SETTINGS = {
  keepEmojis: false,
  keepHr: false,
  keepTail: false
};

const exportOptions = { ...DEFAULT_EXPORT_SETTINGS };
const selectionState = {
  active: false,
  selectedIds: new Set(),
  nextMessageId: 1
};

const DOWNLOAD_MESSAGE_TYPE = "DOWNLOAD_MARKDOWN_FILE";
const POPUP_COMMANDS = {
  GET_BATCH_STATE: "GET_BATCH_EXPORT_STATE",
  START_BATCH_SELECTION: "START_BATCH_SELECTION",
  STOP_BATCH_SELECTION: "STOP_BATCH_SELECTION",
  EXPORT_SELECTED_MESSAGES: "EXPORT_SELECTED_MESSAGES"
};
const EXPORT_BUTTON_TEXT = "Export";
const EXPORT_SELECTED_TEXT = "Export Selected";
const SELECT_TEXT = "Select";
const SELECTED_TEXT = "✓ Selected";
const OBSERVE_ROOT_MARGIN = "600px 0px";
const UI_SELECTOR = '[data-md-export-ui="1"]';

let toastTimer = null;

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

function generateTimestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function getConversationTitle() {
  const rawTitle = String(document.title || "")
    .replace(/\s*[-|]\s*ChatGPT\s*$/i, "")
    .trim();

  return rawTitle || "chatgpt";
}

function slugifyFilenamePart(input) {
  const slug = String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "chatgpt";
}

function generateFilename({ batch = false } = {}) {
  const prefix = slugifyFilenamePart(getConversationTitle());
  const stamp = generateTimestamp();
  const suffix = batch ? "-batch" : "";
  return `${prefix}${suffix}-${stamp}.md`;
}

function fallbackDownloadText(content, filename) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}

function requestMarkdownDownload(content, filename) {
  if (!chrome?.runtime?.sendMessage) {
    fallbackDownloadText(content, filename);
    return Promise.resolve({ ok: true, fallback: true });
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: DOWNLOAD_MESSAGE_TYPE,
        payload: { content, filename }
      },
      (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          fallbackDownloadText(content, filename);
          resolve({ ok: true, fallback: true });
          return;
        }

        resolve(response);
      }
    );
  });
}

function buildExportMessage(count, result) {
  const subject = count === 1 ? "Reply exported" : `${count} replies exported`;

  if (result?.destination === "folder") {
    return `${subject} to selected folder.`;
  }

  if (result?.destination === "downloads" || result?.fallback) {
    return `${subject} to Downloads.`;
  }

  return `${subject}.`;
}

function cloneMessageRoot(msg) {
  const root = findContentRoot(msg);
  if (!root) return null;

  const clone = root.cloneNode(true);
  clone.querySelectorAll(UI_SELECTOR).forEach((el) => el.remove());
  return clone;
}

function postProcessMarkdown(md, { trimTail = false } = {}) {
  let nextMarkdown = md;

  if (!exportOptions.keepEmojis) {
    nextMarkdown = normalizeNumberEmoji(nextMarkdown);
    nextMarkdown = removeEmojis(nextMarkdown);
  }

  if (trimTail && !exportOptions.keepTail) {
    nextMarkdown = trimAfterLastHr(nextMarkdown);
  }

  if (!exportOptions.keepHr) {
    nextMarkdown = nextMarkdown.replace(/^\s*---+\s*$/gm, "");
  }

  return normalizeMarkdown(nextMarkdown);
}

function normalizeNumberEmoji(text) {
  return text.replace(/((?:[0-9]\uFE0F?\u20E3)+)/g, (match) => {
    const digits = match.match(/[0-9]/g).join("");
    return `${digits}.`;
  });
}

function removeEmojis(text) {
  return text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");
}

function normalizeMarkdown(md) {
  let nextMarkdown = md;
  nextMarkdown = nextMarkdown.replace(/[ \t]+$/gm, "");
  nextMarkdown = nextMarkdown.replace(/\n{3,}/g, "\n\n");
  nextMarkdown = nextMarkdown.replace(/^\n+/, "");
  nextMarkdown = nextMarkdown.replace(/\n+$/, "\n");
  return nextMarkdown;
}

function trimAfterLastHr(md) {
  const hrRegex = /\n---+\n/g;
  const matches = [...md.matchAll(hrRegex)];

  if (matches.length === 0) return md;

  const lastMatch = matches[matches.length - 1];
  return md.slice(0, lastMatch.index).trim();
}

function exportOneMessage(msg) {
  const clone = cloneMessageRoot(msg);
  if (!clone) return "";
  return postProcessMarkdown(nodeToMarkdown(clone), { trimTail: true });
}

async function exportSelectedMessages() {
  const selectedMessages = getSelectedAssistantMessages();
  if (!selectedMessages.length) {
    showToast("Select at least one reply first.");
    return {
      ok: false,
      error: "Select at least one reply first.",
      state: getSelectionStateSnapshot()
    };
  }

  const parts = [
    `# ${getConversationTitle()}`,
    `> Exported from ChatGPT on ${new Date().toLocaleString()}`
  ];

  selectedMessages.forEach((msg, index) => {
    const md = exportOneMessage(msg);
    if (!md) return;

    parts.push(`## Reply ${index + 1}`);
    parts.push(md.trim());
  });

  const mergedMarkdown = normalizeMarkdown(parts.join("\n\n"));
  const result = await requestMarkdownDownload(mergedMarkdown, generateFilename({ batch: true }));
  setSelectionMode(false);
  showToast(buildExportMessage(selectedMessages.length, result));

  return {
    ok: true,
    count: selectedMessages.length,
    state: getSelectionStateSnapshot()
  };
}

function getMessageId(msg) {
  if (!msg.dataset.mdExportMessageId) {
    msg.dataset.mdExportMessageId = String(selectionState.nextMessageId++);
  }

  return msg.dataset.mdExportMessageId;
}

function getSelectedAssistantMessages() {
  return Array.from(findAssistantMessages()).filter((msg) =>
    selectionState.selectedIds.has(getMessageId(msg))
  );
}

function getSelectionStateSnapshot() {
  return {
    active: selectionState.active,
    count: selectionState.selectedIds.size
  };
}

function updateBatchActionBar() {
  const bar = ensureBatchActionBar();
  const count = selectionState.selectedIds.size;
  const exportBtn = bar.querySelector(".md-batch-action__export");

  bar.classList.toggle("is-visible", selectionState.active);
  exportBtn.disabled = count === 0;
  exportBtn.textContent = count > 0 ? `${EXPORT_SELECTED_TEXT} (${count})` : EXPORT_SELECTED_TEXT;
}

function ensureUiStyles() {
  if (document.getElementById("__md_export_styles")) return;

  const style = document.createElement("style");
  style.id = "__md_export_styles";
  style.textContent = `
    [data-message-author-role="assistant"] {
      position: relative;
      padding-bottom: 22px;
      margin-bottom: -22px;
    }

    [data-message-author-role="assistant"]::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 22px;
    }

    [data-message-author-role="assistant"] > .__md_export_mount {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
      opacity: 0;
      transform: translateY(6px);
      pointer-events: none;
      transition: opacity 140ms ease, transform 140ms ease;
    }

    [data-message-author-role="assistant"]:hover > .__md_export_mount,
    [data-message-author-role="assistant"] > .__md_export_mount.is-batch-active {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }

    [data-message-author-role="assistant"] > .__md_export_mount:hover {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }

    .md-export-btn {
      border: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: 999px;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.92);
      color: #24180f;
      font: 600 12px/1 "Segoe UI", "Microsoft YaHei", sans-serif;
      cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease;
    }

    .md-export-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
    }

    .md-export-btn.is-batch-mode {
      background: rgba(196, 106, 45, 0.12);
      color: #8a4719;
    }

    .md-export-btn.is-selected {
      background: rgba(196, 106, 45, 0.2);
      color: #6f370f;
    }

    .__md_export_toast {
      position: fixed;
      top: 18px;
      right: 18px;
      z-index: 99999;
      max-width: min(320px, calc(100vw - 32px));
      padding: 10px 14px;
      border: 1px solid rgba(15, 23, 42, 0.1);
      border-radius: 14px;
      background: rgba(255, 250, 242, 0.96);
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
      color: #23180f;
      font: 600 12px/1.4 "Segoe UI", "Microsoft YaHei", sans-serif;
      opacity: 0;
      pointer-events: none;
      transform: translateY(-6px);
      transition: opacity 160ms ease, transform 160ms ease;
    }

    .__md_export_toast.is-visible {
      opacity: 1;
      transform: translateY(0);
    }

    .__md_batch_action {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 99999;
      display: flex;
      gap: 8px;
      padding: 10px;
      border: 1px solid rgba(15, 23, 42, 0.1);
      border-radius: 999px;
      background: rgba(255, 250, 242, 0.96);
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px);
      transition: opacity 160ms ease, transform 160ms ease;
    }

    .__md_batch_action.is-visible {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }

    .__md_batch_action button {
      border: 0;
      border-radius: 999px;
      padding: 8px 12px;
      font: 600 12px/1 "Segoe UI", "Microsoft YaHei", sans-serif;
      cursor: pointer;
    }

    .__md_batch_action .md-batch-action__export {
      background: #c46a2d;
      color: #fff;
    }

    .__md_batch_action .md-batch-action__cancel {
      background: rgba(196, 106, 45, 0.12);
      color: #8a4719;
    }
  `;

  document.head.appendChild(style);
}

function ensureToast() {
  let toast = document.getElementById("__md_export_toast");
  if (toast) return toast;

  toast = document.createElement("div");
  toast.id = "__md_export_toast";
  toast.className = "__md_export_toast";
  toast.setAttribute("data-md-export-ui", "1");
  document.body.appendChild(toast);
  return toast;
}

function showToast(text) {
  const toast = ensureToast();
  toast.textContent = text;
  toast.classList.add("is-visible");

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 1800);
}

function ensureBatchActionBar() {
  let bar = document.getElementById("__md_batch_action");
  if (bar) return bar;

  bar = document.createElement("div");
  bar.id = "__md_batch_action";
  bar.className = "__md_batch_action";
  bar.setAttribute("data-md-export-ui", "1");

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "md-batch-action__export";
  exportBtn.textContent = EXPORT_SELECTED_TEXT;
  exportBtn.addEventListener("click", () => {
    exportSelectedMessages();
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "md-batch-action__cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    setSelectionMode(false);
    showToast("Selection cleared.");
  });

  bar.appendChild(exportBtn);
  bar.appendChild(cancelBtn);
  document.body.appendChild(bar);
  return bar;
}

function updateSelectionToggle(msg) {
  const mount = msg.querySelector(".__md_export_mount");
  const actionBtn = msg.querySelector(".md-export-btn");
  if (!mount || !actionBtn) return;

  const messageId = getMessageId(msg);
  const isSelected = selectionState.selectedIds.has(messageId);

  actionBtn.textContent = selectionState.active
    ? (isSelected ? SELECTED_TEXT : SELECT_TEXT)
    : EXPORT_BUTTON_TEXT;
  actionBtn.classList.toggle("is-batch-mode", selectionState.active);
  actionBtn.classList.toggle("is-selected", selectionState.active && isSelected);
  mount.classList.toggle("is-batch-active", selectionState.active);
}

function updateAllSelectionToggles() {
  findAssistantMessages().forEach((msg) => {
    ensureMessageControls(msg);
    updateSelectionToggle(msg);
  });
}

function setSelectionMode(nextActive) {
  selectionState.active = nextActive;

  if (!nextActive) {
    selectionState.selectedIds.clear();
  }

  updateAllSelectionToggles();
  updateBatchActionBar();
}

function ensureMessageControls(msg) {
  ensureUiStyles();

  const root = findContentRoot(msg);
  if (!root) return;

  let mount = msg.querySelector(".__md_export_mount");
  if (!mount) {
    mount = document.createElement("div");
    mount.className = "__md_export_mount";
    mount.setAttribute("data-md-export-ui", "1");
    msg.appendChild(mount);
  }

  let actionBtn = mount.querySelector(".md-export-btn");
  if (!actionBtn) {
    actionBtn = document.createElement("button");
    actionBtn.className = "md-export-btn";
    actionBtn.setAttribute("data-md-export-ui", "1");
    actionBtn.type = "button";
    actionBtn.title = "Export this reply as Markdown";

    actionBtn.addEventListener("click", (event) => {
      event.stopPropagation();

      if (!selectionState.active) {
        const md = exportOneMessage(msg);

        requestMarkdownDownload(md, generateFilename()).then((result) => {
          showToast(buildExportMessage(1, result));
        });
        return;
      }

      const messageId = getMessageId(msg);
      if (selectionState.selectedIds.has(messageId)) {
        selectionState.selectedIds.delete(messageId);
      } else {
        selectionState.selectedIds.add(messageId);
      }

      updateSelectionToggle(msg);
      updateBatchActionBar();
    });

    mount.appendChild(actionBtn);
  }

  msg.dataset.mdExportInjected = "1";
  updateSelectionToggle(msg);
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
      ensureMessageControls(msg);
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
        ensureMessageControls(msg);
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
  ensureUiStyles();
  ensureBatchActionBar();
  viewportObserver = initViewportObserver();
  scanExistingMessages();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (!mutation.addedNodes?.length) continue;

      mutation.addedNodes.forEach(queueMessagesInSubtree);

      const targetMsg = mutation.target?.closest?.('[data-message-author-role="assistant"]');
      if (targetMsg) queueAssistantMessage(targetMsg);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

if (chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message?.type) {
      case POPUP_COMMANDS.GET_BATCH_STATE:
        sendResponse({ ok: true, state: getSelectionStateSnapshot() });
        return false;

      case POPUP_COMMANDS.START_BATCH_SELECTION:
        setSelectionMode(true);
        showToast("Selection mode on. Use Export to select replies.");
        sendResponse({ ok: true, state: getSelectionStateSnapshot() });
        return false;

      case POPUP_COMMANDS.STOP_BATCH_SELECTION:
        setSelectionMode(false);
        showToast("Selection cleared.");
        sendResponse({ ok: true, state: getSelectionStateSnapshot() });
        return false;

      case POPUP_COMMANDS.EXPORT_SELECTED_MESSAGES:
        exportSelectedMessages().then(sendResponse);
        return true;

      default:
        return false;
    }
  });
}

if (document.body) init();
else window.addEventListener("DOMContentLoaded", init);
