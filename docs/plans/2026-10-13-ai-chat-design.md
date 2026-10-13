# AI 对话框设计

为素记增加一个 AI 对话侧边栏：从笔记库检索内容做总结，并提供写作辅助，对接 DeepSeek。

## 需求（已与用户确认）

- **形态**：右侧边栏（对话面板）。
- **用途**：从现有笔记查询内容、总结，以及写作辅助。
- **上下文**：混合 —— 当前笔记 + 选中文本自动带入；「检索全库」手动补充相关笔记。
- **隐私**：本地 / 内网使用，内容无顾虑。
- **模型**：DeepSeek（Anthropic 兼容接口，`https://api.deepseek.com/anthropic`）。

## 架构方案（选 A：主进程调用 + IPC 流式）

- LLM 请求在 Electron 主进程发起（Node fetch，无 CORS），SSE 流式结果通过 IPC 推给渲染层；笔记检索同样在主进程完成。
- 理由：API Key 不进渲染层、无 CORS 问题、与现有 `ipcMain.handle` / `webContents.send` 架构一致。

## UI 设计

- 右侧「大纲」面板改为双 Tab：**大纲 | AI 对话**（不新增第三列）。
- AI Tab 内容：
  - 消息列表（用户 / 助手气泡，助手回复流式逐字显示）。
  - 上下文标签区：显示已带入的「当前笔记、选中文本、检索到的 N 篇笔记」，可逐条移除。
  - 输入框 + 发送按钮 + 「检索全库」按钮。
  - 快捷指令：总结当前笔记 / 续写 / 润色选中 / 翻译。
  - 每条助手回复带「插入到笔记」按钮（插入光标处或追加文末）。

## 上下文与检索

- **自动**：当前笔记（标题 + 正文）+ 编辑器选中文本。
- **手动检索**：主进程对全库做关键词 / 全文打分（v1 不做向量），返回最相关 Top-N，用户在上下文标签区勾选加入或移除。
- **组装**：系统提示（说明是笔记助手、可用 Markdown 回答）+ 上下文笔记 + 对话历史 + 用户消息。

## 数据流与 IPC

- 渲染层 `invoke('ai-chat', { messages, context, config })` → 主进程发起请求并立即返回会话 id。
- 主进程 → 渲染层 `webContents.send`：`ai-token`（增量文本）、`ai-done`、`ai-error`（流式三态）。
- `invoke('ai-search', query)`：全库检索，返回相关笔记列表。
- `invoke('ai-cancel', sessionId)`：中断进行中的请求。

## 配置（设置新增「AI」区块）

- API 地址（默认 `https://api.deepseek.com/anthropic`）、API Key、模型（`deepseek-chat` / `deepseek-reasoner`）。
- 存储于主进程 `preferences.json`（本地明文；后续可换 `safeStorage` 加密）。

## 范围

- **v1**：聊天、流式、混合上下文、全库关键词检索、快捷指令、插入回笔记、DeepSeek 配置。
- **后续**：向量检索、多轮工具调用、图片附件、API Key 加密存储。

## 验证思路

- 主进程单测（mock fetch）：DeepSeek 请求组装、SSE 流式解析、检索打分。
- 桌面集成：临时库验证 聊天 / 检索 / 上下文标签 / 插入回笔记 / 配置落盘。
