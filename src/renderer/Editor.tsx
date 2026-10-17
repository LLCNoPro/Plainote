import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, placeholder } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';
import { normalizeDocument, applyRawChanges } from '../shared/raw-document.ts';
import { autocompletion } from '@codemirror/autocomplete';
import { livePreview, syncPreviewFocus, taskTogglePermission, noteAssetsExt, filePathsExt, fileCompletionSource, type NoteAssets } from './preview.ts';
import { editorPermissions } from '../shared/editor-mode.ts';
import type { EditorMode } from '../shared/editor-mode.ts';
import type { RawChange } from '../shared/raw-document.ts';

interface Props { path: string; content: string; mode: EditorMode; readOnly: boolean; noteAssets: NoteAssets | null; filePaths: string[]; onChange: (content: string) => void; onImportFiles: (files: File[], position: number) => void; onReady: (view: EditorView | null) => void }
function permissionExtensions(props: Props) {
  const permissions = editorPermissions(props.mode, props.readOnly);
  return [EditorState.readOnly.of(permissions.readOnly), EditorView.editable.of(permissions.editable), taskTogglePermission.of(permissions.tasksEditable)];
}
const highlighting = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '600' }, { tag: tags.strong, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' }, { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--muted)' }, { tag: tags.comment, color: 'var(--muted)' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--code-keyword)' },
  { tag: [tags.string, tags.regexp], color: 'var(--code-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--code-number)' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: 'var(--accent)' },
  { tag: tags.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
]);
export function Editor(props: Props) {
  const host = useRef<HTMLDivElement>(null), viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  const raw = useRef(''), currentPath = useRef('');
  const states = useRef(new Map<string, { state: EditorState; raw: string }>());
  const preview = useRef(new Compartment());
  const editable = useRef(new Compartment());
  const assets = useRef(new Compartment());
  const filePaths = useRef(new Compartment());
  const importFiles = (view: EditorView, files: File[] | null, position: number) => {
    if (!files?.length || view.state.readOnly) return;
    callbacks.current.onImportFiles(files, position);
  };
  const createState = (content: string) => EditorState.create({ doc: normalizeDocument(content), extensions: [
    history(), highlightActiveLine(), highlightSelectionMatches(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    markdown({ base: markdownLanguage, codeLanguages: languages }), syntaxHighlighting(highlighting), EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown 笔记正文', spellcheck: 'false', tabindex: '0' }),
    autocompletion({ override: [fileCompletionSource], activateOnTyping: true }),
    placeholder('从这里开始记录…'), preview.current.of(callbacks.current.mode === 'source' ? [] : livePreview),
    editable.current.of(permissionExtensions(callbacks.current)), assets.current.of(noteAssetsExt(callbacks.current.noteAssets)),
    filePaths.current.of(filePathsExt(callbacks.current.filePaths)),
    EditorView.domEventHandlers({
      paste: (event, view) => {
        const files = event.clipboardData?.files;
        if (files && files.length) { event.preventDefault(); importFiles(view, [...files], view.state.selection.main.from); return true; }
        return false;
      },
      drop: (event, view) => {
        const files = event.dataTransfer?.files;
        if (files && files.length) {
          event.preventDefault();
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from;
          importFiles(view, [...files], position);
          return true;
        }
        return false;
      },
    }),
    EditorView.updateListener.of(update => {
      if (!update.docChanged) return;
      const changes: RawChange[] = [];
      update.changes.iterChanges((from, to, _fromB, _toB, inserted) => changes.push({ from, to, insert: inserted.toString() }));
      raw.current = applyRawChanges(raw.current, changes);
      callbacks.current.onChange(raw.current);
    }),
  ] });
  useEffect(() => {
    const view = new EditorView({ state: createState(''), parent: host.current! });
    viewRef.current = view; callbacks.current.onReady(view);
    return () => { callbacks.current.onReady(null); view.destroy(); viewRef.current = null; };
  }, []);
  useEffect(() => {
    const view = viewRef.current; if (!view) return;
    if (currentPath.current === props.path && raw.current === props.content) return;
    if (currentPath.current) states.current.set(currentPath.current, { state: view.state, raw: raw.current });
    currentPath.current = props.path; raw.current = props.content;
    const cached = states.current.get(props.path);
    view.setState(cached && cached.raw === props.content ? cached.state : createState(props.content));
    view.dispatch({ effects: preview.current.reconfigure(props.mode === 'source' ? [] : livePreview) });
    syncPreviewFocus(view);
    view.dispatch({ effects: editable.current.reconfigure(permissionExtensions(props)) });
    view.dispatch({ effects: assets.current.reconfigure(noteAssetsExt(props.noteAssets)) });
    view.dispatch({ effects: filePaths.current.reconfigure(filePathsExt(props.filePaths)) });
  }, [props.path, props.content]);
  useEffect(() => { const view = viewRef.current; if (view) { view.dispatch({ effects: preview.current.reconfigure(props.mode === 'source' ? [] : livePreview) }); syncPreviewFocus(view); } }, [props.mode]);
  useEffect(() => { viewRef.current?.dispatch({ effects: editable.current.reconfigure(permissionExtensions(props)) }); }, [props.readOnly, props.mode]);
  useEffect(() => { viewRef.current?.dispatch({ effects: assets.current.reconfigure(noteAssetsExt(props.noteAssets)) }); }, [props.noteAssets]);
  useEffect(() => { viewRef.current?.dispatch({ effects: filePaths.current.reconfigure(filePathsExt(props.filePaths)) }); }, [props.filePaths]);
  return <div className={'markdown-editor' + (props.mode === 'source' ? ' source-mode' : props.mode === 'read' ? ' reading-mode' : '')} ref={host} />;
}
