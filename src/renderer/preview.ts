import type { EditorState } from '@codemirror/state';
import { EditorState as State, StateEffect, StateField, Facet } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { normalizeDocument } from '../shared/raw-document.ts';
import { findReferences, relativeLink, encodeMarkdownUrl, looksLikeExternalUrl } from '../shared/references.ts';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { Range } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import type { Completion, CompletionResult } from '@codemirror/autocomplete';
import type { PlainoteBridge, ResolvedImage } from '../shared/types.ts';

declare global { interface Window { plainote?: PlainoteBridge } }

export const taskTogglePermission = Facet.define<boolean, boolean>({ combine: values => values.length ? values.at(-1)! : false });
export interface NoteAssets { notePath: string; images: Map<string, ResolvedImage>; openNote?: (path: string) => void; previewAttachment?: (path: string) => void }
export const noteAssetsFacet = Facet.define<NoteAssets | null, NoteAssets | null>({ combine: values => values.length ? values.at(-1)! : null });
export function noteAssetsExt(assets: NoteAssets | null) { return noteAssetsFacet.of(assets); }

export const filePathsFacet = Facet.define<string[], string[]>({ combine: values => values.length ? values.at(-1)! : [] });
export function filePathsExt(paths: string[]) { return filePathsFacet.of(paths); }

const isNotePath = (p: string) => /\.md$/i.test(p);

// 在链接/图片/双链目标位置输入时，从笔记库文件列表补全路径。
export function fileCompletionSource(context: CompletionContext): CompletionResult | null {
  const paths = context.state.facet(filePathsFacet);
  if (!paths.length) return null;
  const pos = context.pos;
  const line = context.state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);

  const wiki = before.match(/\[\[([^\[\]\n]*)$/);
  if (wiki) {
    const partial = wiki[1];
    const q = partial.toLowerCase();
    const options: Completion[] = paths.filter(p => p.toLowerCase().includes(q)).map(p => ({
      label: isNotePath(p) ? p.replace(/\.md$/i, '') : p,
      detail: p,
      type: isNotePath(p) ? 'class' : 'file',
      apply: isNotePath(p) ? p.replace(/\.md$/i, '') : p,
    })).slice(0, 60);
    return { from: pos - partial.length, options, validFor: /^[^\[\]\n]*$/ };
  }

  const link = before.match(/(?:!\[[^\]]*\]|\[[^\]]*\])\(([^)\n]*)$/);
  if (link) {
    const partial = link[1];
    const q = partial.toLowerCase();
    const notePath = context.state.facet(noteAssetsFacet)?.notePath ?? '';
    const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
    const options: Completion[] = paths.filter(p => { const base = p.split('/').at(-1)!; return base.toLowerCase().includes(q) || p.toLowerCase().includes(q); }).map(p => ({
      label: p.split('/').at(-1)!,
      detail: p,
      type: isNotePath(p) ? 'class' : 'file',
      apply: encodeMarkdownUrl(relativeLink(noteDir, p)),
    })).slice(0, 60);
    return { from: pos - partial.length, options, validFor: /^[^)\n]*$/ };
  }
  return null;
}

export interface PreviewRange { kind: 'line' | 'hide' | 'mark' | 'task' | 'code-label' | 'rule' | 'bullet' | 'table' | 'image'; from: number; to: number; className?: string; text?: string; target?: string; attributes?: Record<string, string> }
export function extractHeadings(raw: string): { text: string; level: number; line: number }[] {
  const state = State.create({ doc: normalizeDocument(raw), extensions: [markdown({ base: markdownLanguage })] });
  return previewRanges(state, new Set()).filter(r => r.kind === 'line' && r.className?.startsWith('lp-heading-')).map(r => {
    const line = state.doc.lineAt(r.from);
    return { text: line.text.replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, ''), level: Number(r.className!.at(-1)), line: line.number };
  });
}
export function previewRanges(state: EditorState, activeLines: Set<number>): PreviewRange[] {
  const result: PreviewRange[] = [];
  const frontmatter = state.doc.sliceString(0, Math.min(state.doc.length, 100000)).match(/^---\n[\s\S]*?\n---(?:\n|$)/)?.[0].length ?? 0;
  const active = (from: number, to: number) => {
    if (state.readOnly) return false;
    for (const line of activeLines) { const range = state.doc.line(line); if (range.from <= to && range.to >= from) return true; }
    return false;
  };
  syntaxTree(state).iterate({ enter(node) {
    if (node.name === 'Document') return;
    if (node.from < frontmatter || node.name === 'HTMLBlock') return false;
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
      const first = state.doc.lineAt(node.from).number, last = state.doc.lineAt(node.to).number;
      for (let number = first; number <= last; number++) {
        const line = state.doc.line(number);
        result.push({ kind: 'line', from: line.from, to: line.from, className: 'lp-codeblock' + (number === first ? ' lp-code-start' : '') + (number === last ? ' lp-code-end' : '') });
      }
      if (node.name === 'FencedCode' && !active(node.from, node.to)) {
        const line = state.doc.line(first);
        const info = node.node.getChild('CodeInfo');
        result.push({ kind: 'code-label', from: node.from, to: line.to, text: info ? state.doc.sliceString(info.from, info.to).trim() : '纯文本' });
        const marks = node.node.getChildren('CodeMark');
        if (marks.length > 1) result.push({ kind: 'hide', from: marks.at(-1)!.from, to: marks.at(-1)!.to });
      }
      return false;
    }
    if (node.name === 'Table') {
      if (!active(node.from, node.to)) { result.push({ kind: 'table', from: node.from, to: node.to }); return false; }
      // The active table remains completely editable, including inline delimiters.
      return false;
    }
    if (node.name === 'Image') {
      const url = node.node.getChild('URL');
      if (!url) return false; // 无 URL 的图片引用（如 ![[...]] 被解析为 Image）交给双链嵌入扫描处理
      const label = node.node.getChild('LinkLabel');
      if (!active(node.from, node.to)) result.push({ kind: 'image', from: node.from, to: node.to, target: state.doc.sliceString(url.from, url.to), text: label ? state.doc.sliceString(label.from, label.to) : '' });
      return false;
    }
    const heading = node.name.match(/^(?:ATX|Setext)Heading(\d)$/);
    if (heading) result.push({ kind: 'line', from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.from).from, className: 'lp-heading-' + heading[1] });
    if (node.name === 'Blockquote') {
      for (let number = state.doc.lineAt(node.from).number; number <= state.doc.lineAt(node.to).number; number++) {
        const line = state.doc.line(number);
        if (!result.some(r => r.kind === 'line' && r.from === line.from && r.className === 'lp-quote')) result.push({ kind: 'line', from: line.from, to: line.from, className: 'lp-quote' });
      }
    }
    if (node.name === 'ListItem') result.push({ kind: 'line', from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.from).from, className: 'lp-list' });
    if (node.name === 'Link') {
      const marks = node.node.getChildren('LinkMark'); // 依次为 [ ] ( )
      const openParen = marks.length >= 3 ? marks[2] : null;
      const urls = node.node.getChildren('URL');
      const destUrl = openParen ? urls.find(u => u.from > openParen.from) : urls[0];
      const target = destUrl ? state.doc.sliceString(destUrl.from, destUrl.to) : '';
      const labelEmpty = marks.length >= 2 && state.doc.sliceString(marks[0].to, marks[1].from).trim() === '';
      result.push({ kind: 'mark', from: node.from, to: node.to, className: 'lp-link', attributes: { 'data-url': target } });
      if (!active(node.from, node.to)) for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (child.name === 'LinkMark' || child.name === 'LinkTitle') { result.push({ kind: 'hide', from: child.from, to: child.to }); continue; }
        if (child.name === 'URL') {
          const isDest = openParen != null && child.from > openParen.from;
          if (isDest && !labelEmpty) result.push({ kind: 'hide', from: child.from, to: child.to });
        }
      }
    }
    if (node.name === 'HorizontalRule' && !active(node.from, node.to)) { result.push({ kind: 'rule', from: node.from, to: node.to }); return false; }
    if (node.name === 'ListMark') {
      if (/^[-+*]$/.test(state.doc.sliceString(node.from, node.to))) {
        if (!active(node.from, node.to)) result.push({ kind: 'bullet', from: node.from, to: node.to });
      } else result.push({ kind: 'mark', from: node.from, to: node.to, className: 'lp-list-marker' });
    }
    const emphasis: Record<string, string> = { StrongEmphasis: 'lp-strong', Emphasis: 'lp-emphasis', Strikethrough: 'lp-strike', InlineCode: 'lp-code' };
    if (emphasis[node.name]) result.push({ kind: 'mark', from: node.from, to: node.to, className: emphasis[node.name] });
    if (active(node.from, node.to)) return;
    if (['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark', 'QuoteMark'].includes(node.name)) {
      let end = node.to;
      if (['HeaderMark', 'QuoteMark'].includes(node.name) && state.doc.sliceString(end, end + 1) === ' ') end++;
      result.push({ kind: 'hide', from: node.from, to: end });
    }
    if (node.name === 'TaskMarker') result.push({ kind: 'task', from: node.from, to: node.to });
  } });
  return result;
}
class TaskWidget extends WidgetType {
  checked: boolean; position: number;
  constructor(checked: boolean, position: number, readonly taskLocked: boolean) { super(); this.checked = checked; this.position = position; }
  eq(other: TaskWidget) { return other.checked === this.checked && other.position === this.position && other.taskLocked === this.taskLocked; }
  toDOM(view: EditorView) {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = this.checked;
    input.disabled = this.taskLocked;
    input.className = 'cm-task-checkbox'; input.setAttribute('aria-label', '切换待办完成状态');
    input.addEventListener('change', () => { if (!view.state.facet(taskTogglePermission)) { input.checked = this.checked; return; } view.dispatch({ changes: { from: this.position + 1, to: this.position + 2, insert: input.checked ? 'x' : ' ' } }); });
    return input;
  }
  ignoreEvent() { return true; }
}
const inlinePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate) { if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged || update.transactions.length) this.decorations = this.build(update.view); }
  build(view: EditorView): DecorationSet {
    const active = new Set<number>();
    if (view.hasFocus || view.composing) for (const range of view.state.selection.ranges) {
      const first = view.state.doc.lineAt(range.from).number, last = view.state.doc.lineAt(range.to).number;
      for (let line = first; line <= last; line++) active.add(line);
    }
    const decorations: Range<Decoration>[] = [];
    for (const range of previewRanges(view.state, active)) {
      if (range.kind === 'line') decorations.push(Decoration.line({ class: range.className }).range(range.from));
      else if (range.kind === 'hide') decorations.push(Decoration.replace({}).range(range.from, range.to));
      else if (range.kind === 'mark') decorations.push(Decoration.mark({ class: range.className, attributes: range.attributes }).range(range.from, range.to));
      else if (range.kind === 'task') decorations.push(Decoration.replace({ widget: new TaskWidget(/x/i.test(view.state.doc.sliceString(range.from, range.to)), range.from, !view.state.facet(taskTogglePermission)) }).range(range.from, range.to));
      else if (range.kind !== 'table' && range.kind !== 'image') decorations.push(Decoration.replace({ widget: new LabelWidget(range.kind, range.text || '') }).range(range.from, range.to));
    }
    return Decoration.set(decorations, true);
  }
}, { decorations: plugin => plugin.decorations });

class LabelWidget extends WidgetType {
  constructor(readonly kind: string, readonly text: string) { super(); }
  eq(other: LabelWidget) { return this.kind === other.kind && this.text === other.text; }
  toDOM() {
    const span = document.createElement('span'); span.className = 'lp-' + this.kind;
    if (this.kind === 'code-label') span.textContent = this.text;
    else if (this.kind === 'rule') span.setAttribute('role', 'separator');
    else span.setAttribute('aria-hidden', 'true');
    return span;
  }
}
function renderInline(parent: HTMLElement, node: SyntaxNode, state: EditorState) {
  const classes: Record<string, string> = { StrongEmphasis: 'lp-strong', Emphasis: 'lp-emphasis', Strikethrough: 'lp-strike', InlineCode: 'lp-code', Link: 'lp-link' };
  const marks = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'LinkLabel', 'URL', 'LinkTitle']);
  let cursor = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from > cursor) parent.append(document.createTextNode(state.doc.sliceString(cursor, child.from)));
    if (!marks.has(child.name)) {
      if (classes[child.name]) { const span = document.createElement('span'); span.className = classes[child.name]; renderInline(span, child, state); parent.append(span); }
      else parent.append(document.createTextNode(state.doc.sliceString(child.from + (child.name === 'Escape' ? 1 : 0), child.to)));
    }
    cursor = child.to;
  }
  if (cursor < node.to) parent.append(document.createTextNode(state.doc.sliceString(cursor, node.to)));
}
function tableCellBounds(row: SyntaxNode, state: EditorState) {
  const cells = row.getChildren('TableCell'), delimiters = row.getChildren('TableDelimiter');
  const bounds: [number, number][] = []; let from = row.from;
  for (const delimiter of delimiters) { bounds.push([from, delimiter.from]); from = delimiter.to; }
  bounds.push([from, row.to]);
  const text = state.doc.sliceString(row.from, row.to).trim();
  if (text.startsWith('|')) bounds.shift();
  if (text.endsWith('|')) bounds.pop();
  return bounds.map(([start, end]) => {
    const cell = cells.find(cell => cell.from >= start && cell.to <= end) || null;
    const empty = Math.min(start + 1, end);
    return { from: cell?.from ?? empty, to: cell?.to ?? empty, cell };
  });
}
export function tableCells(row: SyntaxNode, state: EditorState): (SyntaxNode | null)[] { return tableCellBounds(row, state).map(bound => bound.cell); }
const tableRows = (root: SyntaxNode) => { const rows: SyntaxNode[] = []; for (let row = root.firstChild; row; row = row.nextSibling) if (row.name === 'TableHeader' || row.name === 'TableRow') rows.push(row); return rows; };
export function tableCellPosition(state: EditorState, tableFrom: number, rowIndex: number, column: number): { from: number; to: number } | null {
  const root = findTable(state, tableFrom);
  const row = root && tableRows(root)[rowIndex];
  if (!row || column < 0) return null;
  const bound = tableCellBounds(row, state)[column];
  return bound ? { from: bound.cell?.from ?? bound.from, to: bound.cell?.to ?? bound.to } : null;
}
class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number, readonly root: SyntaxNode, readonly state: EditorState) { super(); }
  eq(other: TableWidget) { return other.source === this.source && other.from === this.from; }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div'); wrap.className = 'lp-table-preview';
    const table = document.createElement('table'); table.setAttribute('aria-label', 'Markdown 表格，点击进入编辑');
    wrap.dataset.tableFrom = String(this.from);
    const { state, root } = this;
    const divider = root.getChild('TableDelimiter')!;
    const alignment = state.doc.sliceString(divider.from, divider.to).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
    const header = document.createElement('thead'), body = document.createElement('tbody');
    let rowIndex = 0;
    for (let row = root.firstChild; row; row = row.nextSibling) {
      if (row.name !== 'TableHeader' && row.name !== 'TableRow') continue;
      const tr = document.createElement('tr');
      const cells = tableCells(row, state), columns = alignment.length;
      for (let index = 0; index < columns; index++) {
        const cell = cells[index];
        const element = document.createElement(row.name === 'TableHeader' ? 'th' : 'td');
        const align = alignment[index] || '';
        element.style.textAlign = align.startsWith(':') && align.endsWith(':') ? 'center' : align.endsWith(':') ? 'right' : 'left';
        element.dataset.row = String(rowIndex); element.dataset.column = String(index);
        element.title = '点击进入编辑';
        if (cell) renderInline(element, cell, state);
        tr.append(element);
      }
      (row.name === 'TableHeader' ? header : body).append(tr); rowIndex++;
    }
    table.append(header, body); wrap.append(table);
    wrap.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      const cell = (event.target as HTMLElement).closest<HTMLElement>('td,th');
      if (!cell || view.state.readOnly) return;
      const position = tableCellPosition(view.state, this.from, Number(cell.dataset.row), Number(cell.dataset.column));
      if (!position) return;
      event.preventDefault();
      view.focus();
      view.dispatch({ effects: previewFocus.of(true), selection: { anchor: position.from }, scrollIntoView: true });
    });
    return wrap;
  }
  ignoreEvent() { return true; }
}
const previewFocus = StateEffect.define<boolean>();
const blockPreview = StateField.define<{ focused: boolean; decorations: DecorationSet }>({
  create(state) { return { focused: false, decorations: blockDecorations(state, false) }; },
  update(value, transaction) {
    let focused = value.focused;
    for (const effect of transaction.effects) if (effect.is(previewFocus)) focused = effect.value;
    if (transaction.docChanged || transaction.selection || focused !== value.focused || transaction.startState.readOnly !== transaction.state.readOnly || transaction.startState.facet(noteAssetsFacet) !== transaction.state.facet(noteAssetsFacet)) return { focused, decorations: blockDecorations(transaction.state, focused) };
    return value;
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
});
function findTable(state: EditorState, from: number): SyntaxNode {
  let found: SyntaxNode | null = null;
  syntaxTree(state).iterate({ from, to: from, enter(node) { if (node.name === 'Table' && node.from === from) { found = node.node; return false; } } });
  return found!;
}
export function syncPreviewFocus(view: EditorView) {
  const value = view.state.field(blockPreview, false);
  if (value && value.focused !== view.hasFocus) view.dispatch({ effects: previewFocus.of(view.hasFocus) });
}
function blockDecorations(state: EditorState, focused: boolean) {
  const active = new Set<number>();
  if (focused) for (const selection of state.selection.ranges) for (let line = state.doc.lineAt(selection.from).number; line <= state.doc.lineAt(selection.to).number; line++) active.add(line);
  const assets = state.facet(noteAssetsFacet);
  const decorations: Range<Decoration>[] = [];
  for (const range of previewRanges(state, active)) {
    if (range.kind === 'table') decorations.push(Decoration.replace({ block: true, widget: new TableWidget(state.doc.sliceString(range.from, range.to), range.from, findTable(state, range.from), state) }).range(range.from, range.to));
    else if (range.kind === 'image') decorations.push(Decoration.replace({ block: true, widget: new ImageWidget('image', range.target || '', range.text || '', assets) }).range(range.from, range.to));
  }
  for (const ref of findReferences(state.doc.toString())) {
    if (ref.kind !== 'embed') continue;
    if (active.has(state.doc.lineAt(ref.start).number)) continue;
    const resolved = assets?.images.get('embed:' + ref.target);
    if (resolved?.status === 'not-image') continue; // 非图片嵌入（笔记）保留原文
    decorations.push(Decoration.replace({ block: true, widget: new ImageWidget('embed', ref.target, '', assets) }).range(ref.start, ref.end));
  }
  return Decoration.set(decorations, true);
}
let lightbox: HTMLElement | null = null;
function onLightboxKey(event: KeyboardEvent) { if (event.key === 'Escape') closeLightbox(); }
function openLightbox(src: string, alt: string) {
  closeLightbox();
  lightbox = document.createElement('div');
  lightbox.className = 'lp-lightbox';
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-label', alt || '图片');
  const img = document.createElement('img');
  img.src = src; img.alt = alt;
  lightbox.append(img);
  lightbox.addEventListener('click', closeLightbox);
  window.addEventListener('keydown', onLightboxKey);
  document.body.append(lightbox);
}
function closeLightbox() { if (lightbox) { lightbox.remove(); lightbox = null; window.removeEventListener('keydown', onLightboxKey); } }

const fileKind = (name: string): 'image' | 'pdf' | 'video' | 'audio' | 'other' => {
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name)) return 'image';
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.(mp4|webm|ogv|mov|m4v)$/i.test(name)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(name)) return 'audio';
  return 'other';
};

class ImageWidget extends WidgetType {
  constructor(readonly kind: 'image' | 'embed', readonly target: string, readonly alt: string, readonly assets: NoteAssets | null) { super(); }
  eq(other: ImageWidget) { return other.kind === this.kind && other.target === this.target && other.alt === this.alt && other.assets === this.assets; }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'lp-image-preview';
    const resolved = this.assets?.images.get(this.kind + ':' + this.target);
    const url = resolved?.status === 'ok' || resolved?.status === 'external' ? resolved.url : undefined;
    if (url) {
      const type = fileKind(this.target);
      if (type === 'image') {
        const img = document.createElement('img');
        img.src = url; img.alt = this.alt; img.loading = 'lazy';
        img.addEventListener('error', () => { wrap.classList.add('lp-image-missing'); wrap.replaceChildren(this.placeholder('图片不存在或无法读取')); });
        img.addEventListener('click', () => openLightbox(url, this.alt));
        wrap.append(img);
        return wrap;
      }
      if (type === 'pdf') {
        const frame = document.createElement('iframe');
        frame.src = url; frame.className = 'lp-embed-frame'; frame.title = this.alt || this.target;
        wrap.classList.add('lp-embed');
        wrap.append(frame);
        return wrap;
      }
      if (type === 'video') {
        const video = document.createElement('video');
        video.src = url; video.controls = true; video.className = 'lp-embed-media';
        wrap.classList.add('lp-embed');
        wrap.append(video);
        return wrap;
      }
      if (type === 'audio') {
        const audio = document.createElement('audio');
        audio.src = url; audio.controls = true; audio.className = 'lp-embed-audio';
        wrap.classList.add('lp-embed');
        wrap.append(audio);
        return wrap;
      }
      wrap.classList.add('lp-image-missing');
      wrap.append(this.placeholder('此类型不支持内联预览'));
      return wrap;
    }
    wrap.classList.add('lp-image-missing');
    wrap.append(this.placeholder(resolved ? (resolved.status === 'ambiguous' ? '无法确定文件路径' : resolved.status === 'external' ? '不支持的外部文件' : '文件不存在或无法读取') : '加载…'));
    return wrap;
  }
  placeholder(text: string): HTMLElement {
    const box = document.createElement('span');
    box.className = 'lp-image-missing-box';
    box.textContent = text;
    box.title = this.target;
    return box;
  }
  ignoreEvent() { return true; }
}

export const livePreview = [blockPreview, inlinePreview, EditorView.domEventHandlers({
  focus: (_event, view) => { view.dispatch({ effects: previewFocus.of(true) }); },
  blur: (_event, view) => { view.dispatch({ effects: previewFocus.of(false) }); },
  click: (event, view) => {
    const link = (event.target as HTMLElement).closest<HTMLElement>('.lp-link');
    if (!link) return false;
    const url = link.dataset.url;
    if (!url) return false;
    if (/^(https?:|mailto:)/.test(url)) { void window.plainote?.openExternal(url); return true; }
    if (looksLikeExternalUrl(url)) { void window.plainote?.openExternal('https://' + url); return true; }
    const assets = view.state.facet(noteAssetsFacet);
    const notePath = assets?.notePath ?? '';
    void window.plainote?.resolveTarget(url, notePath).then(result => {
      if (!result.ok) return;
      const { status, path } = result.value;
      if (status === 'note' && path) assets?.openNote?.(path);
      else if (status === 'attachment' && path) assets?.previewAttachment?.(path);
    });
    return true;
  },
})];

