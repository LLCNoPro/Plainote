import type { EditorState } from '@codemirror/state';
import { EditorState as State, StateEffect, StateField, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { normalizeDocument } from '../shared/raw-document.ts';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { Range } from '@codemirror/state';
export interface PreviewRange { kind: 'line' | 'hide' | 'mark' | 'task' | 'code-label' | 'rule' | 'bullet' | 'table'; from: number; to: number; className?: string; text?: string }
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
    if (node.name === 'Image') return false;
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
      result.push({ kind: 'mark', from: node.from, to: node.to, className: 'lp-link' });
      if (!active(node.from, node.to)) for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (['LinkMark', 'LinkLabel', 'URL', 'LinkTitle'].includes(child.name)) result.push({ kind: 'hide', from: child.from, to: child.to });
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
  constructor(checked: boolean, position: number) { super(); this.checked = checked; this.position = position; }
  eq(other: TaskWidget) { return other.checked === this.checked && other.position === this.position; }
  toDOM(view: EditorView) {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = this.checked;
    input.className = 'cm-task-checkbox'; input.setAttribute('aria-label', '切换待办完成状态');
    input.addEventListener('change', () => view.dispatch({ changes: { from: this.position + 1, to: this.position + 2, insert: input.checked ? 'x' : ' ' } }));
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
      else if (range.kind === 'mark') decorations.push(Decoration.mark({ class: range.className }).range(range.from, range.to));
      else if (range.kind === 'task') decorations.push(Decoration.replace({ widget: new TaskWidget(/x/i.test(view.state.doc.sliceString(range.from, range.to)), range.from) }).range(range.from, range.to));
      else if (range.kind !== 'table') decorations.push(Decoration.replace({ widget: new LabelWidget(range.kind, range.text || '') }).range(range.from, range.to));
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
function cellSource(root: SyntaxNode, state: EditorState, rowIndex: number, column: number) {
  const row = tableRows(root)[rowIndex];
  if (!row) return '';
  const bound = tableCellBounds(row, state)[column];
  return bound ? state.doc.sliceString(bound.from, bound.to) : '';
}
function paintCell(element: HTMLElement, root: SyntaxNode, state: EditorState, rowIndex: number, column: number) {
  element.replaceChildren();
  const row = tableRows(root)[rowIndex], cell = row && tableCells(row, state)[column];
  element.dataset.row = String(rowIndex); element.dataset.column = String(index);
        element.title = '点击编辑单元格';
        if (cell) renderInline(element, cell, state);
}
class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number, readonly root: SyntaxNode, readonly state: EditorState) { super(); }
  eq(other: TableWidget) { return other.source === this.source && other.from === this.from; }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div'); wrap.className = 'lp-table-preview';
    const table = document.createElement('table'); table.setAttribute('aria-label', 'Markdown 表格，点击单元格编辑');
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
        element.title = '点击编辑单元格';
        if (cell) renderInline(element, cell, state);
        tr.append(element);
      }
      (row.name === 'TableHeader' ? header : body).append(tr); rowIndex++;
    }
    table.append(header, body); wrap.append(table);
    wrap.addEventListener('mousedown', event => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('.lp-cell-editor')) return;
      const cell = (event.target as HTMLElement).closest<HTMLElement>('td,th');
      if (!cell || view.state.readOnly) return;
      event.preventDefault(); openCellEditor(wrap, cell, view);
    });
    return wrap;
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    const input = dom.querySelector<HTMLInputElement>('.lp-cell-editor');
    if (!input || input !== dom.ownerDocument.activeElement || dom.dataset.tableFrom !== String(this.from)) return false;
    // Keep the native text field and its selection/IME session alive across document updates.
    for (const cell of dom.querySelectorAll<HTMLElement>('td,th')) {
      const row = Number(cell.dataset.row), column = Number(cell.dataset.column);
      if (cell.contains(input)) {
        const content = cellSource(this.root, view.state, row, column);
        if (input.value !== content && !input.dataset.composing) {
          const start = input.selectionStart ?? 0, end = input.selectionEnd ?? start;
          input.value = content; input.setSelectionRange(Math.min(start, content.length), Math.min(end, content.length));
        }
      } else paintCell(cell, this.root, view.state, row, column);
    }
    return true;
  }
  ignoreEvent() { return true; }
}
function openCellEditor(wrap: HTMLElement, cell: HTMLElement, view: EditorView) {
  if (cell.querySelector('.lp-cell-editor') || view.state.readOnly) return;
  const tableFrom = () => Number(wrap.dataset.tableFrom);
  const rowIndex = Number(cell.dataset.row), column = Number(cell.dataset.column);
  const root = findTable(view.state, tableFrom()); if (!root) return;
  const input = document.createElement('input'); input.type = 'text'; input.className = 'lp-cell-editor';
  input.setAttribute('aria-label', `编辑单元格：第${rowIndex + 1}行，第${column + 1}列`);
  input.value = cellSource(root, view.state, rowIndex, column); input.spellcheck = false;
  input.addEventListener('compositionstart', () => { input.dataset.composing = 'true'; });
  input.addEventListener('compositionend', () => { delete input.dataset.composing; saveInput(); });
  const saveInput = () => {
    if (view.state.readOnly) return;
    const change = tableCellChange(view.state, tableFrom(), rowIndex, column, input.value);
    if (change && view.state.doc.sliceString(change.from, change.to) !== change.insert) view.dispatch({ changes: change, annotations: Transaction.userEvent.of('input.type') });
  };
  input.addEventListener('input', saveInput);
  input.addEventListener('blur', () => {
    const current = findTable(view.state, tableFrom());
    if (current) paintCell(cell, current, view.state, rowIndex, column);
    view.dispatch({ annotations: isolateHistory.of('after') });
  });
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Tab') {
      event.preventDefault();
      const cells = Array.from(wrap.querySelectorAll<HTMLElement>('td,th')), index = cells.indexOf(cell);
      const next = cells[index + (event.shiftKey ? -1 : 1)];
      if (next) { input.blur(); openCellEditor(wrap, next, view); return; }
    } else if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    input.blur();
    const current = findTable(view.state, tableFrom());
    if (current) view.dispatch({ selection: { anchor: Math.min(current.to + 1, view.state.doc.length) }, annotations: isolateHistory.of('after') });
    view.focus();
  });
  cell.replaceChildren(input); input.focus(); input.select();
  view.dispatch({ effects: previewFocus.of(false), annotations: isolateHistory.of('before') });
}
const previewFocus = StateEffect.define<boolean>();
const blockPreview = StateField.define<{ focused: boolean; decorations: DecorationSet }>({
  create(state) { return { focused: false, decorations: tableDecorations(state, false) }; },
  update(value, transaction) {
    let focused = value.focused;
    for (const effect of transaction.effects) if (effect.is(previewFocus)) focused = effect.value;
    if (transaction.docChanged || transaction.selection || focused !== value.focused) return { focused, decorations: tableDecorations(transaction.state, focused) };
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
function tableDecorations(state: EditorState, focused: boolean) {
  const active = new Set<number>();
  if (focused) for (const selection of state.selection.ranges) for (let line = state.doc.lineAt(selection.from).number; line <= state.doc.lineAt(selection.to).number; line++) active.add(line);
  return Decoration.set(previewRanges(state, active).filter(range => range.kind === 'table').map(range => Decoration.replace({ block: true, widget: new TableWidget(state.doc.sliceString(range.from, range.to), range.from, findTable(state, range.from), state) }).range(range.from, range.to)), true);
}
export const livePreview = [blockPreview, inlinePreview, EditorView.domEventHandlers({
  focus: (_event, view) => { view.dispatch({ effects: previewFocus.of(true) }); },
  blur: (_event, view) => { view.dispatch({ effects: previewFocus.of(false) }); },
})];
export function tableCellChange(state: EditorState, tableFrom: number, rowIndex: number, column: number, value: string): {from:number;to:number;insert:string} | null {
  const root = findTable(state, tableFrom), row = root && tableRows(root)[rowIndex];
  if (!row || column < 0) return null;
  // A cell is one Markdown line; escape new pipes so typing cannot change the column structure.
  const insert = value.replace(/[\r\n]+/g, ' ').replace(/(\\*)\|/g, (match, slashes: string) => slashes.length % 2 ? match : slashes + '\\|');
  const bounds = tableCellBounds(row, state), bound = bounds[column];
  if (bound) return { from: bound.from, to: bound.to, insert };
  const leading = state.doc.sliceString(row.from, row.to).trim().endsWith('|') ? '' : ' |';
  return { from: row.to, to: row.to, insert: leading + '  |'.repeat(column - bounds.length) + ' ' + insert + ' |' };
}

