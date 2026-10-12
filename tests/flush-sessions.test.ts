import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveSession } from '../src/shared/save-session.ts';
import { flushSessions } from '../src/shared/flush-sessions.ts';
test('关闭前等待正在进行的保存，即使用户已撤销回原文', async () => {
  let disk = 'old', started!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  const session = new SaveSession({ path: 'note.md', content: 'old', revision: 'r1', modified: 0 }, async (p, content, revision) => {
    if (first) { first = false; started(); await gate; }
    disk = content; return { ok: true, value: { path: p, content, revision: revision + '+', modified: 1 } };
  });
  session.edit('first'); const saving = session.flush(); await began; session.edit('old');
  let finished = false;
  const closing = flushSessions([session], async () => ({ ok: true, value: undefined })).then(result => { finished = true; return result; });
  await new Promise(resolve => setImmediate(resolve)); const prematurelyClosed = finished;
  release(); await saving; assert.equal(await closing, true);
  assert.equal(prematurelyClosed, false);
  assert.equal(disk, 'old');
});
test('恢复副本写入失败时不能允许关闭，并保留编辑内容', async () => {
  const session = new SaveSession({ path: 'note.md', content: 'old', revision: 'r1', modified: 0 }, async () => { throw new Error('must not write without recovery'); });
  session.edit('valuable edit');
  assert.equal(await flushSessions([session], async () => ({ ok: false, error: { code: 'IO', message: 'no storage' } })), false);
  assert.equal(session.content, 'valuable edit');
});
