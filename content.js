(() => {
  // ----------------------------
  // 0) 配置对象
  // ----------------------------
  const exportOptions = {
    removeHr: true
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
  // 3) KaTeX 无损：annotation -> TeX
  // ----------------------------
 function nodeToMarkdown(node) {
    if (!node) return "";

    // 文本节点
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();

    // =========================
    // 1) 代码块（最高优先级）
    // =========================
    if (tag === "pre") {
      const lang = detectCodeLanguage(node);
      const content = extractCodeBlockText(node);

      const fence = content.includes("```") ? "~~~" : "```";
      const langSuffix = lang ? lang : "";

      return `\n${fence}${langSuffix}\n${rstripNewlines(content)}\n${fence}\n\n`;
    }

    // 行内 code（避免重复：pre 里由 pre 处理）
    if (tag === "code") {
      if (node.parentElement?.tagName?.toLowerCase() === "pre") return "";
      return "`" + (node.textContent || "") + "`";
    }

    // =========================
    // 2) 公式（放在 code 之后）
    // =========================
    if (node.classList?.contains("katex-display")) {
      const tex = extractLatex(node);
      if (tex) return `\n$$\n${tex}\n$$\n\n`;
    }
    if (node.classList?.contains("katex")) {
      const tex = extractLatex(node);
      if (tex) return `$${tex}$`;
    }

    // =========================
    // 3) 常规标签
    // =========================
    switch (tag) {
      case "h1": return "# " + children(node) + "\n\n";
      case "h2": return "## " + children(node) + "\n\n";
      case "h3": return "### " + children(node) + "\n\n";

      case "p": return children(node).trim() + "\n\n";

      case "strong":
      case "b": return "**" + children(node) + "**";

      case "em":
      case "i": return "*" + children(node) + "*";

      case "blockquote":
        return children(node)
          .split("\n")
          .map(line => (line ? "> " + line : ""))
          .join("\n") + "\n\n";

      case "ul": return list(node, "- ", 0);
      case "ol": return list(node, "1. ", 0);

      case "li": return children(node) + "\n";

      case "table": return tableToMarkdown(node);

      case "hr": 
        if (exportOptions.removeHr) return "";
        return "\n---\n\n";
      case "br": return "\n";

      default: return children(node);
    }
  }

  // ---------- helpers: code block ----------

  // 语言优先级：code.language-* -> 标题栏 div(“JavaScript/JSON/Markdown”) -> ""
  function detectCodeLanguage(pre) {
    // 1) 老结构：<code class="language-js">
    const code = pre.querySelector("code");
    const cls = code?.className || "";
    const m = cls.match(/language-([\w-]+)/i);
    if (m) return normalizeLang(m[1]);

    // 2) 新结构：标题栏 div 显示语言（如 JavaScript/JSON/Markdown）
    // 你给的就是这种：div.text-sm.font-medium ... 文本=语言名
    const header = pre.querySelector("div.text-sm.font-medium");
    const label = header?.textContent?.trim();
    if (label) return normalizeLang(label);

    return "";
  }

  function normalizeLang(x) {
    const s = String(x || "").trim().toLowerCase();

    // 常见映射（你也可以继续加）
    const map = {
      "javascript": "javascript",
      "js": "javascript",
      "typescript": "typescript",
      "ts": "typescript",
      "python": "python",
      "json": "json",
      "markdown": "markdown",
      "md": "markdown",
      "latex": "latex",
      "tex": "latex",
      "bash": "bash",
      "shell": "bash",
      "sh": "bash",
      "html": "html",
      "css": "css",
      "yaml": "yaml",
      "yml": "yaml"
    };

    return map[s] || s.replace(/\s+/g, "");
  }

  // 从 CodeMirror 的 cm-content 里抽文本，并把 <br> 还原成 \n
  function extractCodeBlockText(pre) {
    // 新版：#code-block-viewer .cm-content 里是 <span>...</span><br>...
    const cm = pre.querySelector("#code-block-viewer .cm-content");
    if (cm) return extractTextPreserveBR(cm);

    // 旧版：pre > code 直接 textContent 还有换行
    const code = pre.querySelector("code");
    if (code) return code.textContent || "";

    // 兜底：pre.innerText（注意它可能包含“复制”等文字；一般不会，因为那些在 header 里）
    return pre.innerText || pre.textContent || "";
  }

  // 关键：保留 <br> 为换行；span/text 节点正常拼
  function extractTextPreserveBR(root) {
    let out = "";
    const walk = (n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.nodeValue || "";
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;

      const t = n.tagName.toLowerCase();
      if (t === "br") {
        out += "\n";
        return;
      }
      n.childNodes.forEach(walk);
    };
    root.childNodes.forEach(walk);
    return out;
  }

  function rstripNewlines(s) {
    return String(s || "").replace(/\n+$/g, "");
  }

  // ---------- helpers: existing ----------
  function extractLatex(node) {
    const ann = node.querySelector("annotation[encoding='application/x-tex']");
    if (!ann) return null;
    return ann.textContent.replace(/\u00A0/g, " ").trim();
  }

  function children(node) {
    let md = "";
    node.childNodes.forEach(child => (md += nodeToMarkdown(child)));
    return md;
  }
  function list(node, prefix, depth) {
    let md = "";
    let index = 1;

    // 只遍历直接 li 子元素
    const items = Array.from(node.children)
      .filter(el => el.tagName?.toLowerCase() === "li");

    items.forEach(li => {
      const indent = "  ".repeat(depth);
      const p = prefix === "1. " ? `${index++}. ` : prefix;

      // 先拿当前 li 的“非列表子节点”
      let content = "";
      li.childNodes.forEach(child => {
        const tag = child.tagName?.toLowerCase();
        if (tag !== "ul" && tag !== "ol") {
          content += nodeToMarkdown(child);
        }
      });

      md += indent + p + content.trim() + "\n";

      // 再处理嵌套列表
      li.childNodes.forEach(child => {
        const tag = child.tagName?.toLowerCase();
        if (tag === "ul") {
          md += list(child, "- ", depth + 1);
        }
        if (tag === "ol") {
          md += list(child, "1. ", depth + 1);
        }
      });
    });

    return md + "\n";
  }

  function tableToMarkdown(table) {
    let md = "\n";
    const rows = table.querySelectorAll("tr");

    rows.forEach((row, i) => {
      const cells = row.querySelectorAll("th, td");

      const rowText = Array.from(cells)
        .map(c => children(c).trim())
        .join(" | ");

      md += "| " + rowText + " |\n";

      if (i === 0) {
        md += "| " + Array(cells.length).fill("---").join(" | ") + " |\n";
      }
    });

    return md + "\n";
  }

  // ----------------------------
  // 4) 导出本条：clone -> 替换公式 -> innerText
  // ----------------------------
  function exportOneMessage(msg) {
    const root = findContentRoot(msg);
    const clone = root.cloneNode(true);

    // 删除导出按钮等
    clone.querySelectorAll(".export-btn").forEach(el => el.remove());

    return nodeToMarkdown(clone).trim() + "\n";
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
})();