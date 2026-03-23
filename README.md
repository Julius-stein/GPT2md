# GPT to Markdown

将 ChatGPT 网页中的回答导出为 Markdown 的浏览器扩展。

## 当前能力

- 为每条 assistant 回复提供单条 Markdown 导出
- 批量导出入口放在 popup 中，不再在页面底部常驻悬浮
- 默认下载到浏览器 Downloads 目录
- 支持代码块、公式、表格、列表、删除线、引用等常见内容的 Markdown 转换
- 支持导出清洗选项：emoji、分隔线、尾部建议块

## 交互说明

### 1. 单条导出

- 鼠标移到 assistant 回复区域时，会出现一个 `Export` 按钮
- 点击后立即导出当前回复为 Markdown

### 2. 批量导出

批量模式从 popup 触发：

1. 打开扩展 popup
2. 点击 `Start Selecting`
3. 回到 ChatGPT 页面
4. 使用每条回复上的同一个 `Export` 按钮进行选择
5. 页面右下角会出现临时的 `Export Selected` 操作条
6. 点击它完成批量导出

页面底部不再出现固定批量工具条。

### 3. 保存目录

当前版本默认保存到浏览器 Downloads 目录。

## 项目结构

```text
GPT2md/
  Manifest.json
  background.js
  content.js
  mdRenderer.js
  popup.html
  popup.js
  popup.css
  README.md
```

## 架构说明

```text
ChatGPT DOM
  ↓
content.js
  - 注入轻量导出按钮
  - 接收 popup 的批量选择命令
  - 收集 assistant 回复
  - 调用 Markdown 渲染
  ↓
mdRenderer.js
  - DOM -> Markdown
  ↓
background.js
  - 调用 chrome.downloads.download 保存文件
```

## 设置项

popup 中支持以下设置：

- `Keep emojis`：保留 emoji
- `Keep dividers`：保留 Markdown 分隔线 `---`
- `Keep tail block`：保留最后一个分隔线之后的尾部建议内容

## 开发说明

### 加载扩展

1. 打开浏览器扩展管理页
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 指向当前项目目录

### 适用页面

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`
