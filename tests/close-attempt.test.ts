import test from 'node:test';
import assert from 'node:assert/strict';
import { CloseAttempt } from '../src/shared/close-attempt.ts';
test('取消慢速退出后，迟到的保存结果不能再次关闭或锁住编辑器', () => {
  const attempt = new CloseAttempt();
  attempt.begin(1);
  assert.equal(attempt.cancel(1), true);
  assert.equal(attempt.isCurrent(1), false);
  attempt.begin(2);
  assert.equal(attempt.cancel(1), false);
  assert.equal(attempt.isCurrent(2), true);
  assert.equal(attempt.cancel(2), true);
});
