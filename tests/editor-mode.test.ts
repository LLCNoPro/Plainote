import test from 'node:test';
import assert from 'node:assert/strict';
import { editorPermissions } from '../src/shared/editor-mode.ts';
test('阅读模式禁止编辑，即时预览与源码模式允许编辑', () => {
  assert.deepEqual(editorPermissions('read',false),{readOnly:true,editable:false,tasksEditable:true});
  for (const mode of ['live','source'] as const) assert.deepEqual(editorPermissions(mode,false),{readOnly:false,editable:true,tasksEditable:true});
});
test('文件操作期间任何模式都保持只读', () => {
  for (const mode of ['live','source','read'] as const) assert.deepEqual(editorPermissions(mode,true),{readOnly:true,editable:false,tasksEditable:false});
});
