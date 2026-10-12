import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, placeholder } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';
import { normalizeDocument, applyRawChanges } from '../shared/raw-document.ts';
import { livePreview, syncPreviewFocus } from './preview.ts';
import type { RawChange } from '../shared/raw-document.ts';

interface Props { path: string; content: string; source: boolean; readOnly: boolean; onChange: (content: string) => void; onReady: (view: EditorView | null) => void }
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
  const createState = (content: string) => EditorState.create({ doc: normalizeDocument(content), extensions: [
    history(), drawSelection(), highlightActiveLine(), highlightSelectionMatches(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    markdown({ base: markdownLanguage, codeLanguages: languages }), syntaxHighlighting(highlighting), EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown 笔记正文', spellcheck: 'false' }),
    placeholder('从这里开始记录…'), preview.current.of(callbacks.current.source ? [] : livePreview),
    editable.current.of([EditorState.readOnly.of(callbacks.current.readOnly), EditorView.editable.of(!callbacks.current.readOnly)]),
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
    view.dispatch({ effects: preview.current.reconfigure(props.source ? [] : livePreview) });
    syncPreviewFocus(view);
    view.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]) });
  }, [props.path, props.content]);
  useEffect(() => { const view = viewRef.current; if (view) { view.dispatch({ effects: preview.current.reconfigure(props.source ? [] : livePreview) }); syncPreviewFocus(view); } }, [props.source]);
  useEffect(() => { viewRef.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]) }); }, [props.readOnly]);
  return <div className={'markdown-editor' + (props.source ? ' source-mode' : '')} ref={host} />;
}
