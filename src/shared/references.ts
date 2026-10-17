// 引用定位与改写（纯字符串处理，不依赖文件系统，可被主进程、渲染层与单元测试共用）。
// 覆盖：普通 Markdown 链接/图片 `[..](..)`、`![..](..)`，Obsidian 双链/嵌入 `[[..]]`、`![[..]]`。
// 约定：只替换目标路径子串，保留其余原文（BOM、换行、YAML、未知语法、显示名、锚点、块后缀）。

export type ReferenceKind = 'image' | 'link' | 'embed' | 'wikilink';

export interface Reference {
  kind: ReferenceKind;
  /** 整个语法的起止（含 `![`、`(`、`]]` 等）。 */
  start: number;
  end: number;
  /** 目标路径本身（不含显示名、锚点、块后缀、链接标题）。 */
  target: string;
  /** 目标路径子串在原内容中的位置，改写时仅替换此区间。 */
  pathStart: number;
  pathEnd: number;
  display?: string;
  anchor?: string;
  block?: string;
}

/** 拆分双链内容：`路径#锚点^块|显示名`。 */
export function splitWikilink(inner: string): { target: string; display?: string; anchor?: string; block?: string } {
  let rest = inner;
  let display: string | undefined;
  const pipe = rest.indexOf('|');
  if (pipe !== -1) { display = rest.slice(pipe + 1); rest = rest.slice(0, pipe); }
  let anchor: string | undefined;
  let block: string | undefined;
  const hash = rest.indexOf('#');
  const caret = rest.indexOf('^');
  const first = [hash, caret].filter(i => i !== -1).sort((a, b) => a - b)[0];
  if (first !== undefined) {
    const marker = rest[first];
    const suffix = rest.slice(first + 1);
    if (marker === '#') anchor = suffix; else block = suffix;
    rest = rest.slice(0, first);
  }
  return { target: rest, display, anchor, block };
}

const isExternal = (target: string) => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || target.startsWith('//') || target.startsWith('#') || target.startsWith('/') || looksLikeExternalUrl(target);

const EXTERNAL_TLD = /\.(com|cn|net|org|io|co|me|info|biz|app|dev|xyz|top|site|online|store|shop|tech|ai|gov|edu|cc|tv|live|news|club|vip|wang|fun|cloud|wiki|blog|icu|link|work|life|world|plus)$/i;
// 判断是否形如裸域名（www. 开头，或带常见顶级域），用于把 www.baidu.com 之类的目标识别为外部链接。
export function looksLikeExternalUrl(target: string): boolean {
  if (target.startsWith('/')) return false;
  const bare = target.split(/[?#/]/)[0];
  return /^www\./i.test(bare) || EXTERNAL_TLD.test(bare);
}

function dirOf(p: string): string { const i = p.lastIndexOf('/'); return i === -1 ? '' : p.slice(0, i); }

// 归一化 POSIX 相对路径，解析 `.`/`..`；越出根目录时返回 null。
function normalizePosix(p: string): string | null {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (parts.length) parts.pop(); else return null; }
    else parts.push(seg);
  }
  return parts.join('/');
}

// 从 fromDir（目录，'' 表示库根）到 toRel（库内相对文件路径）的相对链接。
export function relativeLink(fromDir: string, toRel: string): string {
  const from = fromDir ? fromDir.split('/') : [];
  const to = toRel.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill('..'), ...to.slice(i)].join('/');
}

// 生成 Markdown 链接中的目标：仅转义会破坏 URL 的字符（空格、括号等），保留中文可读。
export function encodeMarkdownUrl(path: string): string {
  return path.split('/').map(seg => seg.replace(/[\s()<>\\]/g, ch => encodeURIComponent(ch))).join('/');
}
function safeDecode(target: string): string {
  try { return decodeURIComponent(target); } catch { return target; }
}

// —— 扫描 ——

function forEachLine(content: string, cb: (start: number, text: string) => void) {
  let start = 0, i = 0;
  const len = content.length;
  while (i < len) {
    const ch = content[i];
    if (ch === '\n' || ch === '\r') { cb(start, content.slice(start, i)); i++; if (ch === '\r' && content[i] === '\n') i++; start = i; }
    else i++;
  }
  if (start < len) cb(start, content.slice(start, len));
}

function countRun(text: string, from: number, char: string): number {
  let i = from; while (i < text.length && text[i] === char) i++; return i - from;
}
function findClosingRun(text: string, from: number, char: string, runLen: number): number {
  let i = from; const n = text.length;
  while (i < n) {
    if (text[i] === char) {
      let j = i; while (j < n && text[j] === char) j++;
      if (j - i === runLen) return j;
      i = j;
    } else i++;
  }
  return -1;
}

// 找到 `]` 对应的配对 `[` 之后的下一个 `]`，尊重反斜杠转义。返回相对下标（不含）。
function findClosingBracket(text: string, from: number): number {
  let i = from; const n = text.length; let depth = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth <= 0) return i; }
    i++;
  }
  return -1;
}

function parseMarkdownLink(text: string, base: number, start: number, isImage: boolean): Reference | null {
  const openBracket = start + (isImage ? 1 : 0);
  const closeBracket = findClosingBracket(text, openBracket + 1);
  if (closeBracket === -1 || text[closeBracket + 1] !== '(') return null;
  const openParen = closeBracket + 1;
  // 找到配对的 `)`，支持目标中的嵌套括号与转义。
  let i = openParen + 1, depth = 1; const n = text.length;
  while (i < n && depth > 0) {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    i++;
  }
  if (depth !== 0) return null;
  const closeParen = i - 1;
  const inside = text.slice(openParen + 1, closeParen);
  // 目标 URL 到首个未转义空白为止，其后为可选标题。
  let urlEnd = 0; const m = inside.length;
  while (urlEnd < m) {
    const ch = inside[urlEnd];
    if (ch === '\\') { urlEnd += 2; continue; }
    if (/\s/.test(ch)) break;
    urlEnd++;
  }
  const target = inside.slice(0, urlEnd).replace(/\\(.)/g, '$1');
  const pathStart = base + openParen + 1;
  const pathEnd = pathStart + urlEnd;
  return { kind: isImage ? 'image' : 'link', start: base + start, end: base + closeParen + 1, target, pathStart, pathEnd };
}

function parseWikilink(text: string, base: number, start: number, isEmbed: boolean): Reference | null {
  const open = start + (isEmbed ? 3 : 2); // 越过 `![[` 或 `[[`
  let i = open; const n = text.length;
  while (i < n - 1) {
    if (text[i] === ']' && text[i + 1] === ']' && (i === open || text[i - 1] !== '\\')) {
      const inner = text.slice(open, i);
      if (inner.trim() === '') return null;
      const parts = splitWikilink(inner);
      const pathStart = base + open;
      const pathEnd = pathStart + parts.target.length;
      return { kind: isEmbed ? 'embed' : 'wikilink', start: base + start, end: base + i + 2, target: parts.target, pathStart, pathEnd, display: parts.display, anchor: parts.anchor, block: parts.block };
    }
    i++;
  }
  return null;
}

function scanLine(text: string, base: number, out: Reference[]) {
  let i = 0; const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '`') {
      const run = countRun(text, i, '`');
      const close = findClosingRun(text, i + run, '`', run);
      if (close !== -1) { i = close; continue; }
      i += run; continue;
    }
    if (ch === '!' && text[i + 1] === '[') {
      if (text[i + 2] === '[') { const r = parseWikilink(text, base, i, true); if (r) { out.push(r); i = r.end - base; continue; } }
      else { const r = parseMarkdownLink(text, base, i, true); if (r) { out.push(r); i = r.end - base; continue; } }
    }
    if (ch === '[') {
      if (text[i + 1] === '[') { const r = parseWikilink(text, base, i, false); if (r) { out.push(r); i = r.end - base; continue; } }
      else { const r = parseMarkdownLink(text, base, i, false); if (r) { out.push(r); i = r.end - base; continue; } }
    }
    i++;
  }
}

/** 定位全部链接/图片/双链/嵌入引用，跳过围栏/缩进代码块、HTML 块与行内代码。 */
export function findReferences(content: string): Reference[] {
  const refs: Reference[] = [];
  let inFence = false, fenceChar = '', fenceLen = 0;
  forEachLine(content, (start, text) => {
    if (inFence) {
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(text);
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) inFence = false;
      return;
    }
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(text);
    if (open) {
      const ch = open[1][0];
      const rest = text.slice(open[0].length);
      if (!(ch === '`' && rest.includes('`'))) { inFence = true; fenceChar = ch; fenceLen = open[1].length; return; }
    }
    if (/^\s{4}/.test(text) || /^\t/.test(text)) return; // 缩进代码
    if (/^\s*</.test(text)) return; // HTML 块（近似）
    scanLine(text, start, refs);
  });
  return refs;
}

// —— 解析与改写 ——

export interface VaultIndex {
  /** 精确的库内相对路径是否存在（含扩展名）。 */
  has(relPath: string): boolean;
  /** 返回以 relPath 为去扩展名前缀的匹配（如 `note` → `note.md`，`img` → `img.png`）。 */
  match(relPath: string): string[];
  /** 按去扩展名文件名在库内唯一匹配（如 `周会` → `项目/周会.md`）。 */
  matchName(name: string): string[];
}

export type ResolvedRef = { status: 'ok'; path: string } | { status: 'external' | 'missing' | 'ambiguous' };

export function resolveReference(ref: Reference, sourceNotePath: string, index: VaultIndex): ResolvedRef {
  if (ref.kind === 'image' || ref.kind === 'link') {
    if (isExternal(ref.target)) return { status: 'external' };
    const decoded = safeDecode(ref.target);
    const base = dirOf(sourceNotePath);
    const normalized = normalizePosix(base ? base + '/' + decoded : decoded);
    if (normalized === null) return { status: 'external' };
    if (index.has(normalized)) return { status: 'ok', path: normalized };
    const matches = index.match(normalized);
    if (matches.length === 1) return { status: 'ok', path: matches[0] };
    if (matches.length > 1) return { status: 'ambiguous' };
    return { status: 'missing' };
  }
  const target = ref.target;
  if (target.includes('/')) {
    if (index.has(target)) return { status: 'ok', path: target };
    const matches = index.match(target);
    if (matches.length === 1) return { status: 'ok', path: matches[0] };
    if (matches.length > 1) return { status: 'ambiguous' };
    return { status: 'missing' };
  }
  const matches = index.matchName(target);
  if (matches.length === 1) return { status: 'ok', path: matches[0] };
  if (matches.length > 1) return { status: 'ambiguous' };
  return { status: 'missing' };
}

function wikilinkTarget(oldTarget: string, newPath: string): string {
  const display = /\.md$/i.test(newPath) ? newPath.replace(/\.md$/i, '') : newPath;
  return oldTarget.includes('/') ? display : display.split('/').at(-1)!;
}

export interface MoveSpec { from: string; to: string }
export interface UnchangedRef { ref: Reference; reason: 'external' | 'missing' | 'ambiguous' | 'unaffected' }
export interface RewriteResult { content: string; changed: number; unchanged: UnchangedRef[] }

// 依据移动映射重写一篇笔记中的引用。sourceNewPath 为该笔记移动后的路径（未移动则为 null）。
export function rewriteNote(content: string, sourceNotePath: string, sourceNewPath: string | null, moves: MoveSpec[], index: VaultIndex): RewriteResult {
  const refs = findReferences(content);
  const moveMap = new Map(moves.map(m => [m.from, m.to]));
  const oldDir = dirOf(sourceNotePath);
  const newDir = sourceNewPath != null ? dirOf(sourceNewPath) : oldDir;
  const edits: { start: number; end: number; insert: string }[] = [];
  const unchanged: UnchangedRef[] = [];
  for (const ref of refs) {
    const res = resolveReference(ref, sourceNotePath, index);
    if (res.status !== 'ok') { unchanged.push({ ref, reason: res.status }); continue; }
    const oldPath = res.path;
    const moved = moveMap.get(oldPath);
    let newTarget: string | null = null;
    if (ref.kind === 'image' || ref.kind === 'link') {
      if (moved != null) newTarget = encodeMarkdownUrl(relativeLink(newDir, moved));
      else if (sourceNewPath != null && newDir !== oldDir) newTarget = encodeMarkdownUrl(relativeLink(newDir, oldPath));
    } else if (moved != null) {
      newTarget = wikilinkTarget(ref.target, moved);
    }
    if (newTarget == null || newTarget === ref.target) { if (newTarget == null) unchanged.push({ ref, reason: 'unaffected' }); continue; }
    edits.push({ start: ref.pathStart, end: ref.pathEnd, insert: newTarget });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = content;
  for (const e of edits) out = out.slice(0, e.start) + e.insert + out.slice(e.end);
  return { content: out, changed: edits.length, unchanged };
}
