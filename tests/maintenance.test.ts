import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { VaultService } from '../src/electron/vault.ts';
import { relocateWithReferences, resolveImages, resolveTarget } from '../src/electron/maintenance.ts';

async function fixture(t: { after: (cb: () => Promise<void>) => void }) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'plainote-maint-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, '笔记库');
  await mkdir(root);
  return { base, root, vault: await VaultService.open(root, path.join(base, 'recovery')) };
}

test('重命名笔记时更新其它笔记中的双链与嵌入引用', async t => {
  const { vault } = await fixture(t);
  await vault.create('旧名.md', '# 旧名');
  await vault.create('引用.md', '见 [[旧名]] 和 ![[旧名]]');
  const outcome = await relocateWithReferences(vault, '旧名.md', '新名.md');
  assert.equal(outcome.rewritten, 1);
  assert.equal((await vault.read('引用.md')).content, '见 [[新名]] 和 ![[新名]]');
  assert.deepEqual((await vault.scan()).map(f => f.path).sort(), ['引用.md', '新名.md']);
  assert.equal(outcome.unchanged.length, 0);
  assert.equal(outcome.failed.length, 0);
});

test('移动笔记后自身相对图片引用重算', async t => {
  const { vault, root } = await fixture(t);
  await vault.createDirectory('b');
  await vault.create('a.md', '![图](img.png)');
  await writeFile(path.join(root, 'img.png'), 'img');
  const outcome = await relocateWithReferences(vault, 'a.md', 'b/a.md');
  assert.equal(outcome.rewritten, 1);
  assert.equal((await vault.read('b/a.md')).content, '![图](../img.png)');
});

test('目录移动后指向子树附件的引用跟随更新', async t => {
  const { vault, root } = await fixture(t);
  await vault.createDirectory('项目');
  await vault.create('项目/周会.md', '# 周会');
  await writeFile(path.join(root, '项目', '图.png'), 'img');
  await vault.create('来源.md', '见 [[项目/周会]] 与 ![[项目/图.png]]');
  const outcome = await relocateWithReferences(vault, '项目', '归档');
  assert.equal(outcome.rewritten, 1);
  assert.equal((await vault.read('来源.md')).content, '见 [[归档/周会]] 与 ![[归档/图.png]]');
  assert.deepEqual((await vault.scan()).map(f => f.path).sort(), ['归档/周会.md', '来源.md']);
});

test('移动到重名目标被拒绝', async t => {
  const { vault } = await fixture(t);
  await vault.createDirectory('目标');
  await vault.create('a.md', '# a');
  await vault.create('目标/a.md', '# b');
  await assert.rejects(relocateWithReferences(vault, 'a.md', '目标/a.md'), { code: 'EXISTS' });
});

test('解析图片返回本地 URL、外部与缺失状态', async t => {
  const { vault, root } = await fixture(t);
  await writeFile(path.join(root, '图 片.png'), 'img');
  await vault.create('笔记.md', '![a](图%20片.png)\n\n![[图 片.png]]\n\n![x](https://example.com/a.png)\n\n![m](缺失.png)');
  const result = await resolveImages(vault, '笔记.md', (await vault.read('笔记.md')).content);
  assert.equal(result.length, 4);
  assert.equal(result[0].status, 'ok');
  assert.equal(result[0].url, 'plainote-file://v/' + encodeURIComponent('图 片.png'));
  assert.equal(result[1].status, 'ok');
  assert.equal(result[2].status, 'external');
  assert.equal(result[2].url, 'https://example.com/a.png');
  assert.equal(result[3].status, 'missing');
});

test('resolveTarget 区分笔记/附件/外部/缺失', async t => {
  const { vault, root } = await fixture(t);
  await vault.createDirectory('其它');
  await vault.create('其它/笔记.md', '# x');
  await writeFile(path.join(root, '其它', '图.png'), 'img');
  assert.deepEqual(await resolveTarget(vault, '某.md', '其它/笔记.md'), { status: 'note', path: '其它/笔记.md' });
  assert.deepEqual(await resolveTarget(vault, '某.md', '其它/图.png'), { status: 'attachment', path: '其它/图.png' });
  assert.deepEqual(await resolveTarget(vault, '某.md', 'https://x.com'), { status: 'external' });
  assert.deepEqual(await resolveTarget(vault, '某.md', '缺失.md'), { status: 'missing' });
});
