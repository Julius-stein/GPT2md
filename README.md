# GPT to Markdown (Modular Refactor Stage)

##  项目状态

当前处于 **模块化重构阶段（Architecture Refactor Stage）**。

插件功能：

- [x] 为每条 ChatGPT assistant 消息添加「导出 Markdown」按钮

- [x] 支持 Markdown 导出（含代码块、公式、表格、列表、删除线、引用等）
- [x] 支持简洁模式（去 emoji、裁剪尾部建议内容）
- [ ] 正在进行架构升级，为 Notion 集成做准备
- [ ] 尚未接入 Notion API
- [ ] 尚未实现 background 通信

#  当前架构（阶段 1）

```代码
DOM (ChatGPT 页面)
   ↓
content.js (调度层)
   ↓
markdownRenderer.js (Markdown 渲染层)
```

##  当前目录结构

```代码
extension/
  manifest.json
  content.js
  markdownRenderer.js   ← 已拆分（结构层）
  popup.html
```

#  架构设计原则

本插件正在从：

> 单文件脚本

升级为：

> 模块化多后端渲染引擎

核心理念：

```代码
DOM
  ↓
结构遍历
  ↓
多后端渲染器
    ├── Markdown
    └── Notion Block (计划中)
```
