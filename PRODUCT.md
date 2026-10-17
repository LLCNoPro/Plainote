# 素记 Plainote

<!-- impeccable:product-schema 1 -->

## Platform

web

这里的 web 表示使用网页技术设计界面；产品交付目标是 macOS 与 Windows 桌面软件，不是在线笔记服务。遵循各系统的窗口、菜单与快捷键习惯。

## Stack

已采用 Electron、React、TypeScript 与 CodeMirror 6。桌面框架、本地笔记库、Markdown 编辑与可靠保存已实现，并扩展了阅读模式、文件管理、主题、AI 对话与 DOCX 导出。独立原型继续保留，正式应用沿用已认可界面。

## Users

用户以工作笔记为主要用途，整理会议记录、项目资料、工作日志和简单待办。

## Product Purpose

在本地 Markdown 文件上提供接近 Obsidian 的写作、浏览和检索体验。支持即时预览，同时可以切换源码模式。

## Operating Context

用户已有 Obsidian 笔记库，主要包含普通 Markdown、双向链接和图片。需要直接打开原有文件夹，无需导入转换。第一版按单台电脑使用规划。

## Capabilities and Constraints

- 第一版目标支持 macOS 与 Windows；macOS 已执行桌面回归，Windows 已有构建配置，交互仍待验证。
- 使用本地 Markdown 文件与附件，保留现有笔记结构和内容。
- 核心功能规划包含目录树、多标签、搜索、模板、图片、双向链接、大纲和反向链接。
- 自动保存、文件变更检测、冲突提示与恢复是可靠性要求。
- 第一版不开发内置同步、账户服务或插件兼容。
- 技术栈已确定；图片预览/导入/打开、附件位置设置、跨目录移动、目录删除、重命名/移动更新引用已实现；全文搜索、模板、双链补全与反向链接等仍未完成。2026-10-17 实测构建、79 项单测及 52 项 macOS 桌面检查通过，详细边界见 docs/plans/2026-10-17-progress-audit.md。

## Brand Commitments

中文名称为“素记”，英文名称为“Plainote”。用户指定使用 pbakaus/impeccable 辅助界面设计。用户已选择“温润素雅”：暖白、墨色、少量青绿色，适合长时间写作。主窗口已确认采用“文稿居中”：左侧目录、中间多标签正文、右侧可收起的大纲与反向链接。

## Evidence on Hand

- 产品与技术规划：docs/plans/2026-10-12-plainote-design.md；当前进度：docs/plans/2026-10-17-progress-audit.md。
- 已有正式桌面界面、独立原型和临时笔记库桌面验证截图；本次验证未使用用户真实笔记样本。
- 后续界面中的会议、项目和笔记文本只能作为明确标注的示例，不代表用户真实资料。

## Product Principles

- 正文与附件直接保存在本地，可独立于应用使用。
- 编辑流畅与文件可靠性优先。
- 兼容已有 Markdown 内容，保留无法解释的语法。
- 工作记录能够快速创建、整理和找回。
