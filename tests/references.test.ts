import test from 'node:test';
import assert from 'node:assert/strict';
import { findReferences, splitWikilink, relativeLink, encodeMarkdownUrl, looksLikeExternalUrl, resolveReference, rewriteNote, type VaultIndex } from '../src/shared/references.ts';

function index(files: string[]): VaultIndex {
  const set = new Set(files);
  const match = (rel: string) => files.filter(f => f === rel || f.startsWith(rel + '.')).sort();
  const matchName = (name: string) => files.filter(f => {
    const base = f.split('/').at(-1)!;
    return base === name || base.startsWith(name + '.');
  }).sort();
  return { has: rel => set.has(rel), match, matchName };
}

test('定位两种图片语法、普通链接、双链与嵌入', () => {
  const refs = findReferences('![图](附件/a.png)\n\n[文档](notes/文档.md "标题")\n\n[[目录/周会]]\n\n![[图.png]]\n\n[[周会|显示名]]');
  assert.deepEqual(refs.map(r => r.kind), ['image', 'link', 'wikilink', 'embed', 'wikilink']);
  assert.equal(refs[0].target, '附件/a.png');
  assert.equal(refs[1].target, 'notes/文档.md');
  assert.equal(refs[2].target, '目录/周会');
  assert.equal(refs[3].target, '图.png');
  assert.equal(refs[4].target, '周会');
  assert.equal(refs[4].display, '显示名');
});

test('拆分双链的锚点、块与显示名', () => {
  assert.deepEqual(splitWikilink('笔记#标题'), { target: '笔记', anchor: '标题', display: undefined, block: undefined });
  assert.deepEqual(splitWikilink('笔记^块'), { target: '笔记', block: '块', display: undefined, anchor: undefined });
  assert.deepEqual(splitWikilink('目录/笔记|显示'), { target: '目录/笔记', display: '显示', anchor: undefined, block: undefined });
  assert.deepEqual(splitWikilink('笔记#标题|显示'), { target: '笔记', anchor: '标题', display: '显示', block: undefined });
});

test('相对链接从目录到库内文件', () => {
  assert.equal(relativeLink('', 'a/img.png'), 'a/img.png');
  assert.equal(relativeLink('a', 'a/img.png'), 'img.png');
  assert.equal(relativeLink('a/b', 'a/img.png'), '../img.png');
  assert.equal(relativeLink('a', 'b/img.png'), '../b/img.png');
});

test('markdown 目标按笔记目录解析，外部链接不解析', () => {
  const idx = index(['项目/图.png', '项目/文档.md']);
  const src = '项目/周会.md';
  assert.deepEqual(resolveReference({ kind: 'image', target: '图.png', start: 0, end: 0, pathStart: 0, pathEnd: 0 }, src, idx), { status: 'ok', path: '项目/图.png' });
  assert.deepEqual(resolveReference({ kind: 'link', target: 'https://example.com', start: 0, end: 0, pathStart: 0, pathEnd: 0 }, src, idx), { status: 'external' });
  assert.deepEqual(resolveReference({ kind: 'image', target: '缺失.png', start: 0, end: 0, pathStart: 0, pathEnd: 0 }, src, idx), { status: 'missing' });
});

test('双链按库内唯一名解析，歧义与缺失分别报告', () => {
  const idx = index(['项目/周会.md', '其它/周会.md', '附件.png']);
  assert.deepEqual(resolveReference({ kind: 'wikilink', target: '附件', start: 0, end: 0, pathStart: 0, pathEnd: 0 }, '某.md', idx), { status: 'ok', path: '附件.png' });
  assert.deepEqual(resolveReference({ kind: 'wikilink', target: '周会', start: 0, end: 0, pathStart: 0, pathEnd: 0 }, '某.md', idx), { status: 'ambiguous' });
  assert.deepEqual(resolveReference({ kind: 'wikilink', target: '不存在', start: 0, end: 0, pathStart: 0, pathEnd: 0 }, '某.md', idx), { status: 'missing' });
});

test('重命名后外部双链引用被更新，保留显示名与锚点', () => {
  const idx = index(['旧名.md', '来源.md']);
  const content = '[[旧名|显示]]\n\n[[旧名#标题]]';
  const result = rewriteNote(content, '来源.md', null, [{ from: '旧名.md', to: '新名.md' }], idx);
  assert.equal(result.changed, 2);
  assert.equal(result.content, '[[新名|显示]]\n\n[[新名#标题]]');
  assert.deepEqual(result.unchanged, []);
});

test('代码块与行内代码中的示例不被改写', () => {
  const idx = index(['旧名.md', '来源.md']);
  const content = '```\n[[旧名]]\n```\n\n`[[旧名]]`\n\n正文 [[旧名]]';
  const result = rewriteNote(content, '来源.md', null, [{ from: '旧名.md', to: '新名.md' }], idx);
  assert.equal(result.changed, 1);
  assert.equal(result.content, '```\n[[旧名]]\n```\n\n`[[旧名]]`\n\n正文 [[新名]]');
});

test('移动笔记后自身相对图片路径重算，未移动的外部引用不动', () => {
  const idx = index(['a/note.md', 'a/img.png', 'b/other.md', 'other.md']);
  // 笔记从 a/note.md 移到 b/note.md，其自身相对图片引用需从 img.png 变成 ../a/img.png。
  const content = '![图](img.png)\n\n[其他](../other.md)';
  const result = rewriteNote(content, 'a/note.md', 'b/note.md', [{ from: 'a/note.md', to: 'b/note.md' }], idx);
  assert.equal(result.content, '![图](../a/img.png)\n\n[其他](../other.md)');
  assert.equal(result.changed, 1);
});

test('目录移动后指向子树内附件的引用随目标更新', () => {
  const idx = index(['项目/图.png', '项目/周会.md', '其它/来源.md']);
  const content = '![[项目/图.png]]\n\n[图](../项目/图.png)';
  const result = rewriteNote(content, '其它/来源.md', null, [{ from: '项目/图.png', to: '归档/图.png' }, { from: '项目/周会.md', to: '归档/周会.md' }], idx);
  assert.equal(result.content, '![[归档/图.png]]\n\n[图](../归档/图.png)');
  assert.equal(result.changed, 2);
});

test('改写保留 BOM 与 CRLF，歧义引用原样保留并报告', () => {
  const idx = index(['a/周会.md', 'b/周会.md', '来源.md']);
  const content = '﻿正文\r\n[[周会]]\r\n';
  const result = rewriteNote(content, '来源.md', null, [{ from: 'a/周会.md', to: 'a/例会.md' }], idx);
  assert.equal(result.changed, 0);
  assert.equal(result.content, content);
  assert.equal(result.unchanged.length, 1);
  assert.equal(result.unchanged[0].reason, 'ambiguous');
});

test('链接标题保留，仅替换目标 URL', () => {
  const idx = index(['旧.md', '来源.md']);
  const content = '[旧](旧.md "说明")';
  const result = rewriteNote(content, '来源.md', null, [{ from: '旧.md', to: '新.md' }], idx);
  assert.equal(result.content, '[旧](新.md "说明")');
});

test('双链去扩展名风格随原名保留（裸名保持裸名，带目录保持全路径）', () => {
  const idx = index(['项目/周会.md', '来源.md']);
  const bare = rewriteNote('[[周会]]', '来源.md', null, [{ from: '项目/周会.md', to: '项目/例会.md' }], idx);
  assert.equal(bare.content, '[[例会]]');
  const withDir = rewriteNote('[[项目/周会]]', '来源.md', null, [{ from: '项目/周会.md', to: '归档/例会.md' }], idx);
  assert.equal(withDir.content, '[[归档/例会]]');
});

test('markdown 目标中空格经百分号编码后正确解析，保留中文可读', () => {
  assert.equal(encodeMarkdownUrl('项目/图 片.png'), '项目/图%20片.png');
  const idx = index(['项目/图 片.png']);
  assert.deepEqual(resolveReference({ kind: 'image', target: '图%20片.png', start: 0, end: 0, pathStart: 0, pathEnd: 0 }, '项目/周会.md', idx), { status: 'ok', path: '项目/图 片.png' });
});

test('裸域名识别为外部链接，本地文件名不误判', () => {
  assert.equal(looksLikeExternalUrl('www.baidu.com'), true);
  assert.equal(looksLikeExternalUrl('baidu.com'), true);
  assert.equal(looksLikeExternalUrl('example.com/path'), true);
  assert.equal(looksLikeExternalUrl('report.pdf'), false);
  assert.equal(looksLikeExternalUrl('notes/report.md'), false);
  assert.equal(looksLikeExternalUrl('/绝对路径.md'), false);
  // 引用解析把裸域名归为 external 而非 missing
  assert.deepEqual(resolveReference({ kind: 'link', target: 'www.baidu.com', start: 0, end: 0, pathStart: 0, pathEnd: 0 }, '某.md', index([])), { status: 'external' });
});
