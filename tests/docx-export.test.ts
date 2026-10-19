import test from 'node:test';
import assert from 'node:assert/strict';

import { replaceMermaidBlocks as replace } from '../src/electron/docx-export.ts';
test('仅替换 Mermaid CodeBlock，保留引用/列表结构与普通代码', async () => {
  const ordinary = { t: 'CodeBlock', c: [['', ['js'], []], 'console.log(1)'] };
  const document = { blocks: [{ t: 'BlockQuote', c: [{ t: 'CodeBlock', c: [['', ['mermaid'], []], 'flowchart LR\nA-->B'] }] }, ordinary] };
  const sources: string[] = [];
  await replace(document, async (source: string, index: number) => { sources.push(source); return { path: `diagram-${index}.png`, width: 1200, height: 600 }; });
  assert.deepEqual(sources, ['flowchart LR\nA-->B']);
  assert.equal(document.blocks[0].t, 'BlockQuote');
  const figure = document.blocks[0].c[0];
  assert.equal(figure.t, 'Div');
  assert.deepEqual(figure.c[0], ['', [], [['custom-style','Figure']]]);
  const image = figure.c[1][0];
  assert.equal(image.t, 'Para');
  assert.equal(image.c[0].t, 'Image');
  assert.equal(image.c[0].c[2][0], 'diagram-1.png');
  assert.ok(Number(image.c[0].c[0][2][0][1].replace('in', '')) <= 5.1);
  assert.deepEqual(document.blocks[1], ordinary);
});
test('嵌套列表中的宽图预留层级缩进空间', async () => {
  const code = { t: 'CodeBlock', c: [['', ['mermaid'], []], 'flowchart LR'] };
  const doc = { blocks: [{ t: 'BlockQuote', c: [{ t: 'BulletList', c: [[code]] }] }] };
  await replace(doc, async () => ({ path: 'wide.png', width: 6000, height: 200 }));
  const figure = doc.blocks[0].c[0].c[0][0];
  const attrs = Object.fromEntries(figure.c[1][0].c[0].c[0][2]);
  assert.ok(parseFloat(attrs.width) <= 4.5);
});
test('图表错误包含序号，并停止后续转换', async () => {
  const diagram = () => ({ t: 'CodeBlock', c: [['', ['mermaid'], []], 'invalid'] });
  let calls = 0;
  await assert.rejects(replace({ blocks: [diagram(), diagram()] }, async () => { calls++; throw new Error('syntax error'); }), /第 1 个 Mermaid 图表.*syntax error/s);
  assert.equal(calls, 1);
});
test('较高图表按页面高度缩放，非代码文本中的 mermaid 保留', async () => {
  const text = { t: 'Str', c: 'mermaid' };
  const doc = { blocks: [{ t: 'Para', c: [text] }, { t: 'CodeBlock', c: [['', ['mermaid'], []], 'stateDiagram-v2'] }] };
  await replace(doc, async () => ({ path: 'tall.png', width: 1000, height: 10000 }));
  const attrs = Object.fromEntries(doc.blocks[1].c[1][0].c[0].c[0][2]);
  assert.equal(attrs.height, '8.5000in');
  assert.deepEqual(doc.blocks[0], { t: 'Para', c: [text] });
});

test('Pandoc 超时后等待子进程退出再允许清理', async () => {
  const { runPandoc } = await import('../src/electron/docx-export.ts');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const directory = await mkdtemp(path.join(tmpdir(),'plainote-pandoc-timeout-'));
  const pidFile = path.join(directory,'pid');
  try {
    await assert.rejects(runPandoc(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`], 500), /Pandoc 转换超时/);
    const pid = Number(await readFile(pidFile,'utf8'));
    assert.throws(() => process.kill(pid,0), { code: 'ESRCH' });
  } finally { await rm(directory,{recursive:true,force:true}); }
});
