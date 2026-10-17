import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readAttachmentConfig, saveAttachmentConfig, attachmentRelativeDir } from '../src/electron/attachments.ts';

test('附件配置默认值、按库保存与读取', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'plainote-att-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = path.join(dir, 'attachment-config.json');
  assert.deepEqual(await readAttachmentConfig(store, '/vault/one'), { mode: 'vault', dir: 'attachments' });
  await saveAttachmentConfig(store, '/vault/one', { mode: 'note', dir: 'assets' });
  assert.deepEqual(await readAttachmentConfig(store, '/vault/one'), { mode: 'note', dir: 'assets' });
  assert.deepEqual(await readAttachmentConfig(store, '/vault/two'), { mode: 'vault', dir: 'attachments' });
});

test('附件目录按模式解析，清理非法路径', async t => {
  assert.equal(attachmentRelativeDir({ mode: 'vault', dir: 'attachments' }, 'a/note.md'), 'attachments');
  assert.equal(attachmentRelativeDir({ mode: 'note', dir: '附件' }, 'a/note.md'), 'a/附件');
  assert.equal(attachmentRelativeDir({ mode: 'note', dir: '附件' }, 'note.md'), '附件');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'plainote-att2-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = path.join(dir, 'cfg.json');
  await saveAttachmentConfig(store, '/v', { mode: 'vault', dir: '../越界' });
  assert.deepEqual(await readAttachmentConfig(store, '/v'), { mode: 'vault', dir: '越界' });
});
