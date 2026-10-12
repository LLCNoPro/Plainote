import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { VaultService } from '../src/electron/vault.ts';

async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'plainote-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, '笔记库');
  await mkdir(root);
  const recovery = path.join(base, 'recovery');
  return { base, root, vault: await VaultService.open(root, recovery) };
}

test('扫描中文目录的 Markdown，忽略配置、非笔记和符号链接', async t => {
  const { base, root, vault } = await fixture(t);
  await mkdir(path.join(root, '项目'));
  await mkdir(path.join(root, '.obsidian'));
  await writeFile(path.join(root, '项目', '周会.md'), '# 周会');
  await writeFile(path.join(root, '大写.MD'), '# 笔记');
  await writeFile(path.join(root, '附件.png'), 'image');
  await writeFile(path.join(root, '.obsidian', '配置.md'), 'settings');
  await writeFile(path.join(base, 'outside.md'), 'outside');
  await symlink(path.join(base, 'outside.md'), path.join(root, 'linked.md'));
  assert.deepEqual((await vault.scan()).map(f => f.path).sort(), ['大写.MD', '项目/周会.md'].sort());
});

test('读取原文保留 YAML、未知语法、BOM 与 CRLF', async t => {
  const { root, vault } = await fixture(t);
  const content = '\ufeff---\r\naliases: [工作]\r\n---\r\n# 周会\r\n![[图.png]]\r\n```custom\r\nunknown\r\n```\r\n';
  await writeFile(path.join(root, '原文.md'), content);
  const note = await vault.read('原文.md');
  assert.equal(note.content, content);
  assert.equal(note.revision.length, 64);
});

test('按已读取版本可靠保存并返回新版本', async t => {
  const { root, vault } = await fixture(t);
  await writeFile(path.join(root, '笔记.md'), 'before');
  const note = await vault.read('笔记.md');
  const saved = await vault.save('笔记.md', 'after\r\n', note.revision);
  assert.equal(await readFile(path.join(root, '笔记.md'), 'utf8'), 'after\r\n');
  assert.notEqual(saved.revision, note.revision);
  assert.deepEqual((await readdir(root)).filter(f => f.includes('.tmp')), []);
});

test('磁盘内容已被外部修改时不覆盖，并保留待保存恢复内容', async t => {
  const { root, vault } = await fixture(t);
  await writeFile(path.join(root, '笔记.md'), 'initial');
  const initial = await vault.read('笔记.md');
  await writeFile(path.join(root, '笔记.md'), 'external');
  await assert.rejects(vault.save('笔记.md', 'my edit', initial.revision), { code: 'CONFLICT' });
  assert.equal(await readFile(path.join(root, '笔记.md'), 'utf8'), 'external');
  assert.equal((await vault.getRecovery('笔记.md'))?.content, 'my edit');
});

test('同一文件并发保存不能用过期版本覆盖新内容', async t => {
  const { root, vault } = await fixture(t);
  await writeFile(path.join(root, '笔记.md'), 'initial');
  const note = await vault.read('笔记.md');
  const results = await Promise.allSettled([
    vault.save('笔记.md', 'first', note.revision),
    vault.save('笔记.md', 'stale', note.revision),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(await readFile(path.join(root, '笔记.md'), 'utf8'), 'first');
});

test('拒绝路径越界、绝对路径和库中的外部符号链接', async t => {
  const { base, root, vault } = await fixture(t);
  await writeFile(path.join(base, 'outside.md'), 'outside');
  await symlink(base, path.join(root, 'escape'));
  for (const p of ['../outside.md', path.join(base, 'outside.md'), 'escape/outside.md']) {
    await assert.rejects(vault.read(p), { code: 'INVALID_PATH' });
  }
  assert.equal(await readFile(path.join(base, 'outside.md'), 'utf8'), 'outside');
});

test('新建使用独占写入，不覆盖同名笔记', async t => {
  const { root, vault } = await fixture(t);
  await vault.create('会议.md', '# 会议\n');
  await assert.rejects(vault.create('会议.md', 'overwrite'), { code: 'EXISTS' });
  assert.equal(await readFile(path.join(root, '会议.md'), 'utf8'), '# 会议\n');
});

test('新建父目录必须存在，不能通过符号链接写到库外', async t => {
  const { base, root, vault } = await fixture(t);
  await symlink(base, path.join(root, 'escape'));
  await assert.rejects(vault.create('escape/new.md', '# 不应写入'), { code: 'INVALID_PATH' });
  assert.equal((await readdir(base)).includes('new.md'), false);
});
test('原笔记被删除后仍能列出恢复内容，不依赖原路径存在', async t => {
  const { root, vault } = await fixture(t);
  await writeFile(path.join(root, 'deleted.md'), 'old');
  const note = await vault.read('deleted.md');
  await vault.stageRecovery('deleted.md', 'unsaved work', note.revision);
  await rm(path.join(root, 'deleted.md'));
  const recovered = await vault.listRecovery();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].content, 'unsaved work');
  assert.equal(recovered[0].path, 'deleted.md');
});

test('创建中文嵌套目录，空目录可扫描，重名不覆盖', async t => {
  const {vault,root} = await fixture(t);
  await vault.createDirectory('项目/会议');
  assert.deepEqual(await vault.directories(), ['项目','项目/会议']);
  assert.deepEqual(await readdir(path.join(root,'项目','会议')), []);
  await assert.rejects(vault.createDirectory('项目/会议'), {code:'EXISTS'});
  await vault.create('项目/会议/周会.md','# 周会');
  assert.equal((await vault.scan())[0].path,'项目/会议/周会.md');
});
test('创建目录拒绝越界和符号链接，不扫描隐藏目录', async t => {
  const {vault,root,base} = await fixture(t);
  await mkdir(path.join(root,'.hidden'));
  await mkdir(path.join(base,'outside'));
  await symlink(path.join(base,'outside'),path.join(root,'linked'));
  for (const name of ['../escape','/absolute','.hidden/new','linked/new']) await assert.rejects(vault.createDirectory(name),{code:'INVALID_PATH'});
  assert.deepEqual(await vault.directories(),[]);
  assert.deepEqual(await readdir(path.join(base,'outside')),[]);
});
test('删除笔记按版本检查并通过可恢复的移动操作完成', async t => {
  const {vault,root,base} = await fixture(t);
  await writeFile(path.join(root,'笔记.md'),'original');
  const snapshot = await vault.read('笔记.md');
  await vault.stageRecovery('笔记.md','backup',snapshot.revision);
  const {rename} = await import('node:fs/promises');
  const target = path.join(base,'trashed.md');
  await vault.trash('笔记.md',snapshot.revision,file=>rename(file,target));
  assert.equal(await readFile(target,'utf8'),'original');
  assert.deepEqual(await vault.scan(),[]);
  assert.equal((await vault.getRecovery('笔记.md'))?.content,'backup');
});
test('外部修改和回收站错误不会丢掉原笔记', async t => {
  const {vault,root} = await fixture(t);
  await writeFile(path.join(root,'笔记.md'),'original');
  const snapshot = await vault.read('笔记.md');
  await writeFile(path.join(root,'笔记.md'),'external');
  let moved = false;
  await assert.rejects(vault.trash('笔记.md',snapshot.revision,async()=>{moved=true;}),{code:'CONFLICT'});
  assert.equal(moved,false);
  const latest = await vault.read('笔记.md');
  await assert.rejects(vault.trash('笔记.md',latest.revision,async()=>{throw new Error('trash failed');}),/trash failed/);
  assert.equal(await readFile(path.join(root,'笔记.md'),'utf8'),'external');
});

test('删除已经落盘的同内容恢复副本时清理记录', async t => {
  const {vault,root,base} = await fixture(t);
  await writeFile(path.join(root,'笔记.md'),'same');
  const note = await vault.read('笔记.md');
  await vault.stageRecovery('笔记.md','same',note.revision);
  const {rename} = await import('node:fs/promises');
  await vault.trash('笔记.md',note.revision,file=>rename(file,path.join(base,'trashed.md')));
  assert.equal(await vault.getRecovery('笔记.md'),null);
});
