import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocument, applyRawChanges } from '../src/shared/raw-document.ts';
test('编辑器显示移除 BOM 并统一逻辑换行，但原文件不被修改', () => {
  assert.equal(normalizeDocument('\ufeff# 标题\r\n正文\r\n'), '# 标题\n正文\n');
});
test('编辑一段正文不会重写原文中的混合换行和 BOM', () => {
  const raw = '\ufeff# 标题\r\nabc\n尾部\r\n';
  assert.equal(applyRawChanges(raw, [{ from: 5, to: 8, insert: '修改' }]), '\ufeff# 标题\r\n修改\n尾部\r\n');
});
test('插入多行内容沿用原换行方式，并保留未编辑行', () => {
  assert.equal(applyRawChanges('first\r\nlast', [{ from: 6, to: 6, insert: 'new\n' }]), 'first\r\nnew\r\nlast');
});
test('一次事务的多个修改使用原始位置，不影响后续偏移', () => {
  assert.equal(applyRawChanges('abc\r\ndef', [{ from: 0, to: 1, insert: '长内容' }, { from: 4, to: 7, insert: '末尾' }]), '长内容bc\r\n末尾');
});
