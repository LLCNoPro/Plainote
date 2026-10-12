# 主窗口原型

目标：prototype/index.html。模式：Operate。用户已确认暖白、墨色、少量青绿色与文稿居中的布局，保留这些约束；本轮制作独立 HTML/CSS/JavaScript 界面原型，不锁定正式应用技术栈。

## Direction contract

THESIS：正文是主窗口的重心，工作目录始终可辨，导航与辅助信息围绕写作展开。

OWN-WORLD：暖白正文、稍深的暖灰侧栏、墨色文字、青绿交互；系统中文无衬线；轻分隔线、低圆角控件，正文充足留白，导航适度紧凑。

STORY：用户定位项目、打开会议笔记、编辑工作内容，按需搜索与关联；明确显示示例资料，按钮提供实际的原型交互。

FIRST VIEWPORT：全窗三栏，约 238 像素目录和 242 像素辅助栏，中央标题与正文阅读区；标签页在编辑区顶部，路径与源码切换在下一行；全窗底部保存状态。新建与搜索位于左栏，完整笔记内容是视觉重点。

FORM：用户指定的文稿居中布局；延续已评审草案，用户的具体构图与配色优先于随机方向选择。Impeccable 引擎此前未完成下载，无 concept-seed key；不将该手动路径宣称为完成自动方向流程。

FINISH：unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 原型范围

包含浅色与深色、全文搜索、快速打开、示例笔记切换、正文编辑、任务勾选、源码查看、新建模板、首次使用、设置、保存失败与外部修改冲突。所有数据为示例，仅当前页面内存交互；不读写用户笔记、不实现正式 Markdown 引擎。支持收起侧栏与键盘操作。使用自绘一致线条 SVG 图标，无外部网络依赖与位图资产。

检查：主窗口浅色与深色、窄桌面、搜索弹窗与异常状态；键盘焦点和对比度。截图保存到 .impeccable/review/。完成后通过独立评审记录设计规范。
