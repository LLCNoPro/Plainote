export type EditorMode = 'live' | 'source' | 'read';
export function editorPermissions(mode: EditorMode, locked: boolean) {
  const readOnly = locked || mode === 'read';
  return { readOnly, editable: !readOnly, tasksEditable: !locked };
}
