import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { fileCompletionSource, filePathsFacet, noteAssetsFacet } from '../src/renderer/preview.ts';

const state = (doc: string, paths: string[], notePath = '笔记.md') => EditorState.create({ doc, extensions: [markdown(), filePathsFacet.of(paths), noteAssetsFacet.of({ notePath, images: new Map() })] });

test('双链目标位置补全笔记与附件路径', () => {
  const s = state('[[', ['项目/周会.md', '图.png', '说明.txt']);
  const result = fileCompletionSource({ state: s, pos: 2 } as never);
  assert.ok(result);
  assert.deepEqual(result.options.map(o => o.apply).sort(), ['项目/周会', '图.png', '说明.txt'].sort());
});

test('Markdown 链接目标位置按笔记相对路径补全', () => {
  const s = state('[x](', ['子/周会.md', '图.png']);
  const result = fileCompletionSource({ state: s, pos: 4 } as never);
  assert.ok(result);
  assert.deepEqual(result.options.map(o => o.apply).sort(), ['子/周会.md', '图.png'].sort());
});

test('非目标位置不触发补全', () => {
  const s = state('普通正文 [[x]] 之外', ['a.md']);
  assert.equal(fileCompletionSource({ state: s, pos: 4 } as never), null);
});
