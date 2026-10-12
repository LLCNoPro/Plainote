import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveSession } from '../src/shared/save-session.ts';
import type { NoteSnapshot, Result } from '../src/shared/types.ts';
const initial: NoteSnapshot = { path: '笔记.md', content: 'old', revision: 'r1', modified: 0 };
test('保存期间继续输入，随后保存最新内容而非把它误标为已保存', async () => {
  let disk = 'old', revision = 'r1', release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  let first = true;
  const session = new SaveSession(initial, async (_path, content, expected) => {
    if (first) { first = false; started(); await gate; }
    assert.equal(expected, revision);
    disk = content; revision += '+';
    return { ok: true, value: { ...initial, content, revision } };
  });
  session.edit('first');
  const saving = session.flush();
  await firstStarted;
  session.edit('latest');
  const whileSaving = session.status;
  release();
  assert.equal(await saving, true);
  assert.equal(disk, 'latest');
  assert.equal(session.savedContent, session.content);
  assert.equal(session.status, 'saved');
  assert.equal(whileSaving, 'saving');
});
test('保存失败保留输入内容和原版本，允许明确重试', async () => {
  let failure = true;
  const session = new SaveSession(initial, async (_p, content, revision): Promise<Result<NoteSnapshot>> => failure ? { ok: false, error: { code: 'IO', message: 'no permission' } } : { ok: true, value: { ...initial, content, revision: revision + '+' } });
  session.edit('my edit');
  assert.equal(await session.flush(), false);
  assert.equal(session.content, 'my edit');
  assert.equal(session.revision, 'r1');
  assert.equal(session.status, 'error');
  failure = false;
  assert.equal(await session.flush(), true);
  assert.equal(session.savedContent, 'my edit');
});
test('冲突后不自动覆盖，显式载入磁盘版本才能解除冲突', async () => {
  let attempts = 0;
  const session = new SaveSession(initial, async () => { attempts++; return { ok: false, error: { code: 'CONFLICT', message: 'external edit' } }; });
  session.edit('my edit');
  assert.equal(await session.flush(), false);
  assert.equal(session.status, 'conflict');
  session.edit('more editing');
  assert.equal(await session.flush(), false);
  assert.equal(attempts, 1);
  assert.equal(session.content, 'more editing');
  session.acceptDisk({ ...initial, content: 'external', revision: 'r2' });
  assert.equal(session.content, 'external');
  assert.equal(session.status, 'saved');
});
