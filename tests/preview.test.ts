import test from 'node:test';
import assert from 'node:assert/strict';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { previewRanges, extractHeadings, tableCells, tableCellChange } from '../src/renderer/preview.ts';
const state = (doc: string) => EditorState.create({ doc, extensions: [markdown()] });
test('非当前行呈现标题与强调，光标所在行保留源码标记', () => {
  const s = state('# 周会\n\n**重点**');
  const all = previewRanges(s, new Set());
  assert.ok(all.some(r => r.kind === 'line' && r.className === 'lp-heading-1'));
  assert.ok(all.some(r => r.kind === 'hide' && r.from === 0 && r.to === 2));
  assert.ok(all.some(r => r.className === 'lp-strong'));
  const active = previewRanges(s, new Set([1]));
  assert.equal(active.some(r => r.kind === 'hide' && r.from === 0), false);
});
test('不把代码块中的标题与强调当成正文格式', () => {
  const s = state('```md\n# literal\n**literal**\n```');
  assert.equal(previewRanges(s, new Set()).some(r => r.kind === 'hide' && r.from >= 6 && r.to <= 29), false);
});
test('YAML 属性保持源码，不被当作正文标题或强调处理', () => {
  const s = state('---\nalias: **literal**\n---\n# 正文');
  const ranges = previewRanges(s, new Set());
  assert.equal(ranges.some(r => r.from < 25), false);
  assert.ok(ranges.some(r => r.className === 'lp-heading-1'));
});
test('大纲只提取正文标题，不包含代码块或属性中的伪标题', () => {
  assert.deepEqual(extractHeadings('---\nalias: **literal**\n---\n# Real\n\n```sh\n# wrong\n```').map(h => h.text), ['Real']);
});
test('反引号与波浪线代码块有完整背景和语言标签，编辑时显示围栏', () => {
  for (const fence of ['```', '~~~']) {
    const s = state(`${fence}js\nconst text = "**literal**";\n${fence}`);
    const all = previewRanges(s, new Set());
    assert.equal(all.filter(r => r.kind === 'line' && r.className?.includes('lp-codeblock')).length, 3);
    assert.ok(all.some(r => r.kind === 'code-label'));
    assert.equal(all.some(r => r.className === 'lp-strong'), false);
    assert.equal(previewRanges(s, new Set([2])).some(r => r.kind === 'code-label'), false);
  }
});
test('未闭合和缩进代码块保持可读，代码中的标记不被隐藏', () => {
  for (const doc of ['```unknown\n# literal\n**literal**', '    # literal\n    **literal**']) {
    const all = previewRanges(state(doc), new Set());
    assert.ok(all.some(r => r.className?.includes('lp-codeblock')));
    assert.equal(all.some(r => r.className === 'lp-heading-1' || r.className === 'lp-strong'), false);
  }
});
test('多行引用逐行呈现，并隐藏非编辑行的引用标记', () => {
  const s = state('> 第一行\n> **第二行**');
  const all = previewRanges(s, new Set());
  assert.equal(all.filter(r => r.className === 'lp-quote').length, 2);
  assert.ok(all.some(r => r.kind === 'hide' && r.from === 0 && r.to === 2));
  assert.equal(previewRanges(s, new Set([1])).some(r => r.kind === 'hide' && r.from === 0), false);
});
test('分隔线和列表使用可读预览，光标所在行显示源码', () => {
  const s = state('---\n\n- 内容\n\n1. 第一步');
  const all = previewRanges(s, new Set());
  assert.ok(all.some(r => r.kind === 'rule'));
  assert.ok(all.some(r => r.kind === 'bullet'));
  assert.ok(all.some(r => r.className === 'lp-list-marker'));
  assert.equal(previewRanges(s, new Set([1])).some(r => r.kind === 'rule'), false);
});
test('普通链接呈现文本，编辑时保留完整地址，不将图片误作链接', () => {
  const s = state('[文档](https://example.com)\n\n![图片](photo.png)');
  const all = previewRanges(s, new Set());
  assert.ok(all.some(r => r.className === 'lp-link'));
  assert.ok(all.some(r => r.kind === 'hide' && s.doc.sliceString(r.from, r.to).includes('https://example.com')));
  assert.equal(all.some(r => r.kind === 'hide' && r.from > 26), false);
  assert.equal(previewRanges(s, new Set([1])).some(r => r.kind === 'hide' && r.from < 26), false);
});
test('GFM 表格可预览，进入任何表格行后整表恢复源码', () => {
  const s = EditorState.create({ doc: '| 名称 | 状态 |\n| --- | :---: |\n| 素记 | **完成** |', extensions: [markdown({ base: markdownLanguage })] });
  assert.ok(previewRanges(s, new Set()).some(r => r.kind === 'table'));
  assert.equal(previewRanges(s, new Set([2])).some(r => r.kind === 'table'), false);
});
test('Setext 标题大纲不包含下划线标记', () => {
  assert.deepEqual(extractHeadings('标题\n===\n\n小标题\n---'), [{text:'标题',level:1,line:1},{text:'小标题',level:2,line:4}]);
});
test('表格空单元格不移动后续列，转义的竖线不产生新列', () => {
  const s = EditorState.create({ doc: '| A | B | C |\n| --- | --- | --- |\n|  | x\\|y |  |', extensions: [markdown({base:markdownLanguage})] });
  const row = syntaxTree(s).topNode.firstChild!.getChild('TableRow')!;
  const cells = tableCells(row, s);
  assert.equal(cells.length,3);
  assert.deepEqual(cells.map(cell => cell ? s.doc.sliceString(cell.from,cell.to) : ''), ['', 'x\\|y', '']);
});
test('单元格修改只替换目标文字，保留其它列与 Markdown 强调', () => {
  const s = EditorState.create({doc:'| A | B |\n| --- | --- |\n| 素记 | **完成** |',extensions:[markdown({base:markdownLanguage})]});
  const change = tableCellChange(s,0,1,0,'Plainote');
  assert.ok(change);
  assert.equal(s.update({changes:change!}).state.doc.toString(),'| A | B |\n| --- | --- |\n| Plainote | **完成** |');
});
test('空单元格可输入，竖线不会破坏表格结构', () => {
  const s = EditorState.create({doc:'| A | B |\n| --- | --- |\n|  | keep |',extensions:[markdown({base:markdownLanguage})]});
  const change = tableCellChange(s,0,1,0,'a|b');
  assert.ok(change);
  assert.equal(s.update({changes:change!}).state.doc.toString(),'| A | B |\n| --- | --- |\n| a\\|b | keep |');
});
test('引用内的缺列单元格可输入，并保留引用前缀', () => {
  const s = EditorState.create({doc:'> | A | B | C |\n> | --- | --- | --- |\n> | x |',extensions:[markdown({base:markdownLanguage})]});
  const change = tableCellChange(s,2,1,2,'last');
  assert.ok(change);
  assert.equal(s.update({changes:change!}).state.doc.toString(),'> | A | B | C |\n> | --- | --- | --- |\n> | x |  | last |');
});
