# 常用 Markdown 即时预览补齐

用户反馈常用语法未完整支持，明确指出三反引号代码块。沿用已批准的 Obsidian 式即时预览与源码切换：无需更换界面或保存格式。

根因：previewRanges 明确跳过 FencedCode/CodeBlock，未为其提供块级样式；普通引用只处理首行，列表/分隔线/链接/GFM 表格缺少预览。现有解析器能识别这些语法，复用语法树比新增一套全文 HTML 渲染更符合现有直接编辑体验，也避免两个编辑视图不同步。

实现：代码块逐行背景、等宽文字与语言标签，配置官方 codeLanguages 高亮；编辑代码块时显示原围栏。引用逐行背景，列表标记、分隔线与普通链接呈现。GFM 表格通过安全 DOM 表格展示，点击或键盘进入时恢复整表源码；禁止解释 HTML。保留 YAML、未识别语法与附件原文。

验证：先补失败的语法树测试，再实现；实际 Electron 验证源码/预览切换、代码输入落盘、语言高亮、表格点击编辑与撤销，以及既有保存/恢复回归。范围不包含图片附件、Obsidian 扩展、数学公式、Mermaid 或完整 HTML。

## 完成与验收

实现完成。31 项单元测试、正式构建、9 项真实 Electron Markdown 集成验证通过；原有 14 项桌面保存/冲突/恢复回归通过。验证使用临时笔记库，未写用户笔记。补齐了空单元格保位、引用内表格上下文，以及已聚焦编辑器重新进入预览时的焦点同步；代码复核未发现必须修复的问题。

Impeccable finish verdict：ship。普通延伸核对保留 incumbent DESIGN.md 与 sidecar。新增代码语义颜色浅/深：keyword #795178/#d6b3d6，string #356b59/#a0c6b3，number #886020/#dfc38d；代码块复用 sidebar 背景、6px 圆角，14px 等宽字、1.65 行高、11px muted 标签。表格复用 line 与 sidebar，正文大小、完整单元格细边框、hover 轮廓；引用直角，列表标记 muted，链接下划线。检测器无主要问题，存在 incumbent 字号/圆角 advisory。主布局与配色未替换。

截图与集成报告：.impeccable/review/markdown/。当前已经打开的构建版窗口需要退出后重新执行 npm start 才能加载更新。
