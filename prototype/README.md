# 素记界面原型

在项目根目录运行 `python3 -m http.server 8765 --bind 127.0.0.1`，访问 http://127.0.0.1:8765/prototype/。

这是独立的桌面界面原型，使用示例资料。支持笔记切换、正文编辑、任务勾选、模板新建、全文搜索、快速打开、主题切换、字号和平台预览，以及首次使用、保存失败和冲突状态。

- 快速打开：macOS ⌘P，Windows Ctrl+P。
- 全文搜索：macOS ⌘Shift+F，Windows Ctrl+Shift+F。
- 新建笔记：macOS ⌘N，Windows Ctrl+N。
- 设置：macOS ⌘逗号，Windows Ctrl+逗号。
- 底部“演示状态”查看首次使用与异常处理。

数据仅保留在当前页面内存，刷新会恢复示例，不读写本地笔记。Markdown 源码转换为简化演示，不代表正式编辑器或完整 Obsidian 兼容。保存状态仅表示原型的内存交互。平台窗口控件是外观演示，不操作浏览器窗口。
