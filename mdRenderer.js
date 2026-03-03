// markdown 渲染器：DOM -> Markdown

// ----------------------------
// KaTeX 无损：annotation -> TeX
// ----------------------------
export function nodeToMarkdown(node) {
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
    case "h4": return "#### " + children(node) + "\n\n";

    case "p": return children(node).trim() + "\n\n";

    case "strong":
    case "b": return "**" + children(node) + "**";

    case "del":
    case "s":
    case "strike":
    return "~~" + children(node) + "~~";

    case "a": {
    const href = node.getAttribute("href") || "";
    const text = children(node).trim();

    if (!href) return text;

    // 如果文本本身就是链接，避免重复
    if (text === href) {
        return `<${href}>`;
    }

    return `[${text}](${href})`;
    }

    case "em":
    case "i": return "*" + children(node) + "*";

    case "blockquote": {
    let content = children(node).trim();

    // 删除尾部空行
    content = content.replace(/\n+$/, "");

    // 给整块添加前缀
    content = content.replace(/^/gm, "> ");

    return content + "\n\n";
    }

    case "ul": return list(node, "- ", 0);
    case "ol": return list(node, "1. ", 0);

    case "li": return children(node) + "\n";

    case "table": return tableToMarkdown(node);

    case "hr": return "\n---\n\n";
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
    let checkboxPrefix = "";
    const checkbox = li.querySelector("input[type='checkbox']");

    if (checkbox) {
    checkboxPrefix = checkbox.checked ? "[x] " : "[ ] ";
    }

    // 构造内容时跳过 input
    let content = "";
    li.childNodes.forEach(child => {
    const tag = child.tagName?.toLowerCase();

    if (tag === "input") return; // 不重复输出

    if (tag !== "ul" && tag !== "ol") {
        content += nodeToMarkdown(child);
    }
    });

    md += indent + p + checkboxPrefix + content.trim() + "\n";

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
    const aligns = Array.from(cells).map(cell => getColumnAlign(cell));
    const sep = aligns.map(a => {
        if (a === "left") return ":---";
        if (a === "center") return ":---:";
        if (a === "right") return "---:";
        return "---";
    });
    md += "| " + sep.join(" | ") + " |\n";
    }
});

return md + "\n";
}

function getColumnAlign(cell) {
// 1️ align 属性
const attr = cell.getAttribute("align");
if (attr) {
    return attr.toLowerCase();
}

// 2️ style 内联
const style = cell.style?.textAlign;
if (style) {
    return style.toLowerCase();
}

// 3️ 读取 computed style（更保险）
const computed = window.getComputedStyle(cell).textAlign;
if (computed) {
    if (computed === "left") return "left";
    if (computed === "center") return "center";
    if (computed === "right") return "right";
}

return null;
}