import { nodeToMarkdown } from "./markdownRenderer.js";
// ----------------------------
// 0) 配置对象
// ----------------------------
const exportOptions = {
  removeHr: true,  // 是否删除分割线
  simpleMode: true  // 简洁模式(删除 emoji，删除结尾建议部分)
};

// ----------------------------
// 1) 定位每条 assistant 消息
// ----------------------------
function findAssistantMessages() {
  return document.querySelectorAll('[data-message-author-role="assistant"]');
}

function findContentRoot(msg) {
  // 添加markdown 导出按钮
  return (
    msg.querySelector(".markdown") ||
    msg.querySelector('[class*="prose"]') ||
    msg
  );
}

// ----------------------------
// 2) 文件名 / 下载
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
// 4) 导出本条：clone -> 替换公式 -> innerText
// ----------------------------
function exportOneMessage(msg) {
  const root = findContentRoot(msg);
  const clone = root.cloneNode(true);

  // 删除导出按钮等
  clone.querySelectorAll(".export-btn").forEach(el => el.remove());

  const md = nodeToMarkdown(clone);

  // 简洁模式：删除 emoji
  if (exportOptions.simpleMode) {
    md = normalizeNumberEmoji(md); // 1️⃣ 数字 emoji 规范化（放在删除 emoji 前）
    md = removeEmojis(md);
  }

  // 尾部裁剪：删除最后的建议部分（最后一个分割线以下）
  if (exportOptions.simpleMode) {
    md = trimAfterLastHr(md); 
  }

  if (exportOptions.removeHr) {
    md = md.replace(/^\s*---+\s*$/gm, "");
  }

  md = normalizeMarkdown(md);

  return md;
}

function normalizeNumberEmoji(text) {
  return text.replace(
    /((?:[0-9]\uFE0F?\u20E3)+)/g,
    (match) => {
      // 提取其中所有数字
      const digits = match.match(/[0-9]/g).join("");
      return digits + ".";
    }
  );
}

function removeEmojis(text) {
  return text.replace(
    /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu,
    ""
  );
}

function normalizeMarkdown(md) {
// 1 去掉行尾多余空格
md = md.replace(/[ \t]+$/gm, "");

// 2️ 超过 2 个连续空行压缩为 2 个
md = md.replace(/\n{3,}/g, "\n\n");

// 3️ 文件开头空行删除
md = md.replace(/^\n+/, "");

// 4️ 文件结尾空行压缩为 1 个
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
// 5) 按钮注入
// ----------------------------
function ensureExportButton(msg) {
  if (msg.querySelector(".md-export-btn")) return;

  const root = findContentRoot(msg);
  if (!root) return;

  const btn = document.createElement("button");
  btn.className = "md-export-btn";
  btn.textContent = "导出 Markdown";
  btn.style.cssText = `
    margin-top: 6px;
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

  (root.parentElement || msg).appendChild(btn);
}

// ======= 稳定性等待：只有在 msg 内容 600ms 不变才注入按钮 =======
const STABLE_MS = 600;
const pendingTimers = new WeakMap();

function getStableMount(msg) {
  let mount = msg.querySelector(".__md_export_mount");
  if (!mount) {
    mount = document.createElement("div");
    mount.className = "__md_export_mount";
    mount.style.cssText = "margin-top:6px;";
    msg.appendChild(mount);
  }
  return mount;
}

// 监测内容变化的“指纹”（轻量：用 textContent 长度 + 子节点数）
function fingerprint(msg) {
  const root = findContentRoot(msg);
  const textLen = (root?.textContent || "").length;
  const nodeCount = root ? root.querySelectorAll("*").length : 0;
  return `${textLen}:${nodeCount}`;
}

function scheduleStableInject(msg) {
  // 已经注入过就不管
  if (msg.dataset.mdExportInjected === "1") return;

  // 如果已有计时器，先清
  const old = pendingTimers.get(msg);
  if (old) clearTimeout(old);

  const fp0 = fingerprint(msg);

  const t = setTimeout(() => {
    // 600ms 后再看一次指纹，没变才算稳定
    const fp1 = fingerprint(msg);
    if (fp0 !== fp1) {
      // 仍在变化：继续等
      scheduleStableInject(msg);
      return;
    }
    // 稳定了：注入（并打标）
    ensureExportButtonStable(msg);
  }, STABLE_MS);

  pendingTimers.set(msg, t);
}

function ensureExportButtonStable(msg) {
  if (msg.dataset.mdExportInjected === "1") return;

  const mount = getStableMount(msg);

  // mount 内去重
  if (mount.querySelector(".md-export-btn")) {
    msg.dataset.mdExportInjected = "1";
    return;
  }

  const btn = document.createElement("button");
  btn.className = "md-export-btn";
  btn.textContent = "导出 Markdown";
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

// ======= 扫描：只对“没打标”的 assistant message 做 stable inject =======
let scheduled = false;

function scan(initial = false) {
  const messages = findAssistantMessages();

  messages.forEach((msg) => {
    if (msg.dataset.mdExportInjected === "1") return;

    if (initial) {
      // 页面初始加载：立即注入（历史消息）
      ensureExportButtonStable(msg);
      return;
    }

    // 新增消息：走稳定判定
    scheduleStableInject(msg);
  });
}

function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scan();
    scheduled = false;
  });
}

function init() {
  // 页面加载完成时，先给历史消息插按钮
  scan(true);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length) {
        scheduleScan();
        break;
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
if (document.body) init();
else window.addEventListener("DOMContentLoaded", init);
