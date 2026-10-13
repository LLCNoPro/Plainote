# 素记 Plainote

本地 Markdown 工作笔记桌面应用。采用 Electron、React、TypeScript 和 CodeMirror 6，沿用温润素雅、文稿居中的已确认设计。

打开本地文件夹即可读写真实 `.md` 文件，不需要导入或账号。

## 开发与运行

需要 Node.js 22.12+ 与 npm；首次安装会联网下载 Electron。

```sh
npm ci            # 安装依赖
npm run dev       # 开发模式运行
# 或运行构建后的版本：
npm run build     # 构建
npm start         # 运行构建版
```

逐条说明：

| 命令 | 作用 |
|---|---|
| `npm ci` | 按 `package-lock.json` 精确安装依赖。首次安装、CI 环境推荐用它，比 `npm install` 更快更可复现。 |
| `npm run dev` | 开发模式：启动 Vite 开发服务器 + Electron 窗口，源码改动会热更新，适合边改边看。 |
| `npm run build` | 完整构建：①类型检查 `tsc --noEmit`；②把主进程编译到 `dist-electron/`（`build:electron`）；③用 Vite 把渲染层打包到 `dist-renderer/`。 |
| `npm start` | 运行**构建后**的版本（需先执行 `npm run build`）。 |

点击「打开笔记文件夹」选择已有 Markdown 目录，下次启动会重新打开最近目录。原型仍可在 `prototype/index.html` 独立查看。

## 验证（测试）

```sh
npm run typecheck   # 类型检查
npm test            # 单元测试
npm run test:desktop  # 桌面保存/冲突/恢复回归
npm run test:markdown # Markdown 预览桌面验证
npm run test:files    # 文件管理桌面验证
npm run test:reading  # 阅读模式桌面验证
```

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | 渲染层 + 主进程的 TypeScript 类型检查（不改动任何产物）。 |
| `npm test` | 单元测试：文件服务、保存/冲突、原文编辑、AI 检索打分与流式解析等。 |
| `npm run test:desktop` | Electron 集成测试：真实 Markdown 读写、保存、冲突、取消退出、异常退出恢复。 |
| `npm run test:markdown` | 代码块/表格/链接/引用等即时预览的桌面验证。 |
| `npm run test:files` | 新建目录、删除笔记、回收站等文件管理桌面验证。 |
| `npm run test:reading` | 阅读模式的只读、待办勾选、模式切换桌面验证。 |

桌面测试需要图形桌面环境，使用临时笔记库与独立应用数据目录，不会写入项目中的 `testdata/`；运行前应先 `npm run build`。

## 打包

```sh
npm run package   # 当前平台应用目录（未打包成安装包）
npm run dist      # 当前平台安装包
npm run dist:win  # Windows 安装包 + 免安装 ZIP
```

| 命令 | 作用 |
|---|---|
| `npm run package` | `npm run build` 后用 `electron-builder --dir` 生成**当前平台的应用目录**（如 `release/mac-arm64/素记.app`），不打包成安装包，用于快速本地验证。 |
| `npm run dist` | 生成**当前平台的安装包**（macOS 为 dmg）。 |
| `npm run dist:win` | 交叉构建 **Windows x64** 的 NSIS 安装包 + 免安装 ZIP（`--publish never` 不发布）。 |

输出在 `release/`：macOS 为 `素记-<版本>-<架构>.dmg`，Windows 为 `Plainote-<版本>-Setup-x64.exe` 与 `Plainote-<版本>-Windows-x64.zip`。ZIP 必须完整解压后运行其中的 `素记.exe`。

> 当前产物未签名：macOS 首次打开需「右键 → 打开」绕过，Windows 会触发 SmartScreen 提示。正式分发需配置代码签名与（macOS）公证。

## GitHub Actions 自动发布

推送 `v*` 标签会触发 `.github/workflows/release.yml`：自动构建 macOS arm64/x64 dmg 与 Windows 安装包/绿色版，并创建 GitHub Release 附上全部产物（版本号自动取 tag）。

```sh
git tag v0.1.0
git push origin v0.1.0
```

## 已实现

- Markdown 目录（含空目录）、多标签、名称与路径筛选、快速打开、新建笔记与嵌套目录、**笔记/目录重命名**。
- 删除笔记前确认并保存当前编辑，移入系统回收站；外部修改或保存失败时阻止删除。
- 即时预览：标题、强调、行内代码、待办勾选、代码块与语言高亮、多行引用、列表、分隔线、普通链接文本、GFM 表格；即时预览/源码/阅读三模式、撤销重做、大纲跳转。阅读模式禁止修改正文，但允许选择文本与勾选待办。
- 自动保存、保存前写恢复副本、保存失败保留编辑内容。
- 外部修改检查、版本冲突比较和另存副本；冲突不会自动覆盖磁盘版本。
- 重启后恢复未保存内容；原笔记已删除时可恢复为新文件。
- 原文中的 BOM、未编辑部分的换行、YAML 与未知 Markdown 语法保留。
- 浅色/深色主题 + **8 种主题色**（青绿/砖红/靛蓝/琥珀/玫瑰/松绿/黛紫/墨蓝）、正文字号、侧栏收起、右侧面板拖动调宽、系统窗口操作。
- **导出 DOCX**：用 Pandoc 把当前笔记导出为 Word 文档，可在设置里配置 pandoc 路径。
- **AI 对话侧边栏**：见下节。

Mac 使用 ⌘，Windows 使用 Ctrl：`O` 打开笔记库、`P` 快速打开、`N` 新建、`S` 保存、`,` 打开设置。编辑器内的查找针对当前文稿。

## AI 对话

右侧「AI 对话」面板把整个笔记库当作一个项目来回答：

- 对接 **DeepSeek**（Anthropic 兼容接口），在「设置 → AI」配置 API 地址 / Key / 模型（默认 `https://api.deepseek.com/anthropic`、`deepseek-chat`）。
- 每次提问自动检索整个笔记库，取最相关笔记全文作为上下文；`AGENT.md` 作为项目概览始终注入；回答参考笔记时在末尾标注相对路径来源（如 `来源：周会.md`）。
- 快捷指令：总结 / 续写 / 润色 / 翻译；助手回复按 Markdown 渲染，可一键「插入到笔记」。
- 首次提问若 `AGENT.md` 不存在会自动生成；`/restore` 或「整理索引」可重新生成。`AGENT.md` 不出现在文件树中。
- 输入框 Enter 发送、Shift+Enter 换行；未配置 Key 时会自动弹出设置提示。

## 当前范围

图片嵌入、Obsidian 双链导航、反向链接安排在后续阶段（现有图片与双链语法会保留原样）。专用的全文搜索界面尚未实现（文件名筛选已支持，内容检索由 AI 对话承担）。数学公式、Mermaid 与 HTML 渲染尚未实现。单篇文件上限 20 MB，隐藏目录与符号链接不作为笔记扫描。

恢复副本存放在 Electron 用户数据目录 `recovery/` 中，按笔记库隔离；正常保存后清理对应副本。

macOS 已执行真实桌面验证；Windows 已提供构建配置，尚未在 Windows 环境验证。当前版本没有签名、自动更新或同步。

## 项目文件

- `src/electron/`：本地文件服务、有限 IPC、AI/Pandoc 集成、窗口与菜单。
- `src/renderer/`：桌面界面、CodeMirror 编辑器、AI 面板与主题。
- `src/shared/`：保存会话、恢复与原文编辑逻辑、共享类型。
- `tests/`：文件服务、编辑保存、AI 检索与桌面集成验证。
- `.github/workflows/`：标签触发的多平台自动发布。
- `PRODUCT.md`、`DESIGN.md`、`docs/plans/`：产品决策、设计规范与阶段计划。
