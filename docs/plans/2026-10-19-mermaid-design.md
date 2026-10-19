# Mermaid 正文预览

用户在改动量评估后要求实现，按已讨论范围支持笔记正文 Mermaid 代码块；不扩展 AI 回复、附件预览与 DOCX 导出。

沿用 CodeMirror 语法树和块级 Widget，不增加全文 HTML 视图。完整的 mermaid 围栏在非编辑状态渲染；点击或键盘激活恢复源码，阅读模式保持图表，未闭合围栏保留代码。相比全文 markdown-it 渲染，这种方式保留当前即时编辑交互；相比在线图片服务，本地依赖能离线使用且无需发送笔记内容。

Mermaid 动态导入并本地打包。渲染使用 strict 安全级别，以 SVG 图片隔离样式及可执行内容。串行执行初始化和渲染，按源码及深浅主题缓存最多 40 项；Widget 销毁或主题变化后忽略过期异步结果。完成加载后通知 CodeMirror 重测高度。失败展示中文提示、错误细节及源码。

界面沿用 sidebar、muted、accent、error 与现有 6px 圆角，宽图在块内滚动。设计文件保持原样。

验证计划：先补语法识别失败测试，再实现；运行单元测试、正式构建和独立临时笔记库 Electron 验证，涵盖流程图、时序图、错误恢复、编辑保存撤销、主题、模式切换、离线请求和内容保留。

## 验证结果

92 项单元测试、正式构建、9 项 Mermaid 桌面场景及原有 9 项 Markdown 桌面检查通过。Mermaid 桌面验证无页面异常和外部 HTTP 请求，使用临时笔记库。语法树测试包含反引号、波浪线、未闭合围栏、引用内图表、只读与原文标记保留；桌面覆盖方向键定位、宽图滚动、错误修复、编辑保存撤销、键盘激活及切换笔记。

验证中修复了 SVG 百分比尺寸导致的小图放大，以及块 Widget 外边距未被 CodeMirror 高度测量计入导致的源码点击偏移；图表固定自然尺寸，块间距使用 padding。阅读权限也参与 Widget 相等性判断，避免模式切换后无障碍角色过期。

独立代码与视觉复核的修复项已处理，设计文档复核确认本次为普通扩展，保留 DESIGN.md 和 sidecar。截图和报告位于 `.impeccable/review/mermaid/`；可使用 `npm run test:mermaid` 重现。未执行 Windows 实机验证，未打包或发布安装包。

## 状态图 HTML 换行兼容修复

用户提供的完整熔断器 `stateDiagram-v2` 原文位于 `tests/fixtures/mermaid-circuit-breaker.md`。Mermaid 能成功解析，但生成的 SVG 标签含 HTML `<br>`；原先通过 XML DOMParser 读取会出现 br/p 标签不匹配，把解析错误文档交给图片导致空白，未触发原有异常提示。

改为在不挂载的 template 中解析 Mermaid strict 模式输出，再用 XMLSerializer 输出合法 SVG/XML，保留 HTML 换行且不修改笔记原文。图片展示前等待 decode，解码失败也进入可编辑的错误提示。已验证原文在深浅模式显示完整状态图，92 项单元测试、正式构建与新增后的 10 项 Mermaid 桌面检查通过，无页面异常或外部 HTTP 请求。截图：`state-light.png`、`state-dark.png`。
