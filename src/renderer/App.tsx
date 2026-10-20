import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { Editor } from './Editor.tsx';
import { Icon } from './icons.tsx';
import { SaveSession } from '../shared/save-session.ts';
import { CloseAttempt } from '../shared/close-attempt.ts';
import { flushSessions } from '../shared/flush-sessions.ts';
import type { EditorMode } from '../shared/editor-mode.ts';
import type { NoteAssets } from './preview.ts';
import { useOutline } from './useOutline.ts';
import { THEMES } from './themes.ts';
import { AiPanel } from './AiPanel.tsx';
import { AttachmentPreview } from './AttachmentPreview.tsx';
import type { AiConfig } from '../shared/ai.ts';
import type { AttachmentConfig, DirectoryCount, MaintenanceOutcome, NoteFile, NoteSnapshot, PlainoteBridge, RecoverySnapshot, ResolvedImage, VaultInfo } from '../shared/types.ts';

declare global { interface Window { plainote?: PlainoteBridge } }
type ModalState = { type: 'quick' } | { type: 'settings'; prompt?: string } | { type: 'create'; content: string; suggested: string; original?: string; recoveryPath?: string } | { type: 'conflict'; notePath: string; disk: NoteSnapshot } | { type: 'recovery'; notePath: string; recovery: RecoverySnapshot } | { type: 'recoveries' } | { type: 'directory' } | { type: 'delete'; notePath: string; revision: string; content: string } | { type: 'rename'; kind: 'file' | 'directory'; path: string } | { type: 'move'; kind: 'file' | 'directory'; path: string } | { type: 'delete-directory'; path: string; count: DirectoryCount };
const isSaving = (session: SaveSession) => session.status === 'saving';
const nameOf = (p: string) => p.split('/').at(-1)!.replace(/\.md$/i, '');
const basenameOf = (p: string) => p.split('/').at(-1)!;
const isImagePath = (p: string) => /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(p);

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} onCancel={close} aria-label={title} onClick={event => { if (event.target === ref.current) { const box = ref.current!.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(); } }}>
    <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={close}><Icon name="close" /></button></div><div className="dialog-body">{children}</div>
  </dialog>;
}
function FileRow({ file, active, depth = 0, open, remove, rename, move }: { file: NoteFile; active: string; depth?: number; open: (p: string) => void; remove: (p: string) => void; rename: (p: string) => void; move: (p: string) => void }) {
  const isNote = /\.md$/i.test(file.path);
  const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(file.path);
  return <div className="file-entry"><button className={'file-row' + (active === file.path ? ' selected' : '') + (isNote ? '' : ' attachment')} style={{ paddingLeft: 9 + depth * 15 }} title={file.path} aria-current={active === file.path ? 'page' : undefined} draggable onDragStart={event => { event.dataTransfer.setData('text/plain', file.path); event.dataTransfer.effectAllowed = 'move'; }} onClick={() => open(file.path)}><Icon name={isImage ? 'image' : 'file'} /><span>{file.name}</span></button>{isNote && <><button className="icon-button file-move" aria-label={'移动笔记 ' + file.path} title="移动到…" onClick={() => move(file.path)}><Icon name="move" /></button><button className="icon-button file-rename" aria-label={'重命名笔记 ' + file.path} title="重命名" onClick={() => rename(file.path)}><Icon name="pencil" /></button><button className="icon-button file-delete" aria-label={'删除笔记 ' + file.path} title="删除笔记" onClick={() => remove(file.path)}><Icon name="trash" /></button></>}</div>;
}
function FileTree({ files, directories, selectedDirectory, active, open, remove, rename, move, removeDirectory, drop, chooseDirectory }: { files: NoteFile[]; directories: string[]; selectedDirectory: string; active: string; open: (p: string) => void; remove: (p: string) => void; rename: (kind: 'file' | 'directory', path: string) => void; move: (kind: 'file' | 'directory', path: string) => void; removeDirectory: (p: string) => void; drop: (src: string, targetDir: string) => void; chooseDirectory: (p: string) => void }) {
  const render = (prefix: string, depth: number): React.ReactNode => {
    const children = files.filter(f => f.path.startsWith(prefix));
    const dirs = [...new Set([...directories.filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length).split('/')[0]), ...children.map(f => f.path.slice(prefix.length).split('/')).filter(parts => parts.length > 1).map(parts => parts[0])])].filter(Boolean).sort((a,b) => a.localeCompare(b,'zh-CN'));
    return <>{dirs.map(directory => <details key={directory}><summary data-selected={selectedDirectory === prefix + directory} title={prefix + directory} style={{ paddingLeft: 8 + depth * 15 }} draggable onDragStart={event => { event.dataTransfer.setData('text/plain', prefix + directory); event.dataTransfer.effectAllowed = 'move'; }} onDragOver={event => { if (event.dataTransfer.types.includes('text/plain')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={event => { event.preventDefault(); const src = event.dataTransfer.getData('text/plain'); if (src) drop(src, prefix + directory); }} onClick={() => chooseDirectory(prefix + directory)}><Icon name="chevron" /><Icon name="folder" /><span>{directory}</span><button className="icon-button dir-move" aria-label={'移动目录 ' + (prefix + directory)} title="移动到…" onClick={event => { event.preventDefault(); event.stopPropagation(); move('directory', prefix + directory); }}><Icon name="move" /></button><button className="icon-button dir-rename" aria-label={'重命名目录 ' + (prefix + directory)} title="重命名" onClick={event => { event.preventDefault(); event.stopPropagation(); rename('directory', prefix + directory); }}><Icon name="pencil" /></button><button className="icon-button dir-delete" aria-label={'删除目录 ' + (prefix + directory)} title="删除目录" onClick={event => { event.preventDefault(); event.stopPropagation(); removeDirectory(prefix + directory); }}><Icon name="trash" /></button></summary>{render(prefix + directory + '/', depth + 1)}</details>)}{children.filter(f => !f.path.slice(prefix.length).includes('/')).map(file => <FileRow key={file.path} file={file} active={active} depth={depth} open={open} remove={remove} rename={p => rename('file', p)} move={p => move('file', p)} />)}</>;
  };
  return render('', 0);
}

type PanelSide = 'left' | 'right';
const readPanelWidth = (side: PanelSide, fallback: number) => {
  const stored = Number(localStorage.getItem(`plainote-${side}-width`));
  return Number.isFinite(stored) && stored > 0 ? Math.max(220, Math.min(560, stored)) : fallback;
};

export function App() {
  const bridge = window.plainote;
  const [vault, setVault] = useState<VaultInfo | null>(null), [files, setFiles] = useState<NoteFile[]>([]), [active, setActive] = useState('');
  const [busy, setBusy] = useState(true), [message, setMessage] = useState(''), [messageKind, setMessageKind] = useState<'info' | 'error'>('info'), [mode, setMode] = useState<EditorMode>('live');
  const [theme, setTheme] = useState(() => localStorage.getItem('plainote-theme') || 'light');
  const [accent, setAccent] = useState(() => localStorage.getItem('plainote-accent') || 'teal');
  const [pandocPath, setPandocPath] = useState(() => localStorage.getItem('plainote-pandoc') || '');
  const [inspectorTab, setInspectorTab] = useState<'outline' | 'ai'>('outline');
  const [aiConfig, setAiConfig] = useState<AiConfig>({ baseUrl: 'https://api.deepseek.com/anthropic', apiKey: '', model: 'deepseek-chat', protocol: 'anthropic' });
  const [leftWidth, setLeftWidth] = useState(() => readPanelWidth('left', 238));
  const [rightWidth, setRightWidth] = useState(() => readPanelWidth('right', 280));
  const [resizing, setResizing] = useState<PanelSide | null>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const pendingInsert = useRef<string | null>(null);
  const [left, setLeft] = useState(true), [right, setRight] = useState(() => innerWidth > 1050), [query, setQuery] = useState('');
  const [modal, setModal] = useState<ModalState | null>(null), [quick, setQuick] = useState(''), [quickIndex, setQuickIndex] = useState(0);
  const [filename, setFilename] = useState(''), [formError, setFormError] = useState(''), [creating, setCreating] = useState(false);
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('plainote-font-size')) || 16);
  const [directories, setDirectories] = useState<string[]>([]), [selectedDirectory, setSelectedDirectory] = useState('');
  const [recoveries, setRecoveries] = useState<RecoverySnapshot[]>([]);
  const [attachmentConfig, setAttachmentConfig] = useState<AttachmentConfig>({ mode: 'vault', dir: 'attachments' });
  const [images, setImages] = useState<Map<string, ResolvedImage>>(new Map());
  const [moveTarget, setMoveTarget] = useState('');
  const [previewTabs, setPreviewTabs] = useState<string[]>([]);
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [, setVersion] = useState(0);
  const sessions = useRef(new Map<string, SaveSession>()), timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const activeRef = useRef(''), generation = useRef(0), editor = useRef<EditorView | null>(null), mounted = useRef(true);
  const transition = useRef(false), selectionRequest = useRef(0), mutationBusy = useRef(false);
  const closeAttempt = useRef(new CloseAttempt()), pendingCreate = useRef<Promise<void> | null>(null);
  const noteEpochs = useRef(new Map<string, number>());
  const pendingOpens = useRef(new Map<string, ReturnType<PlainoteBridge['read']>>());
  const imagesRequest = useRef(0);
  const refresh = useCallback(() => { if (mounted.current) setVersion(v => v + 1); }, []);
  const activeSession = sessions.current.get(active);
  const command = bridge?.platform === 'darwin' ? '⌘' : 'Ctrl';
  const select = (p: string) => { activeRef.current = p; setActive(p); setActivePreview(null); if (p) setSelectedDirectory(p.includes('/') ? p.slice(0,p.lastIndexOf('/')) : ''); };
  const explain = (text: string, kind: 'info' | 'error' = 'info') => { setMessage(text); setMessageKind(kind); };
  const refreshFiles = async () => {
    if (!bridge) return;
    const token = generation.current, result = await bridge.scanEntries();
    if (token === generation.current && result.ok) setFiles(result.value);
    const dirs = await bridge.directories();
    if (token === generation.current && dirs.ok) setDirectories(dirs.value);
    const backups = await bridge.recoveries();
    if (token === generation.current && backups.ok) setRecoveries(backups.value);
  };
  const addSession = (snapshot: NoteSnapshot) => {
    const session = new SaveSession(snapshot, (p, content, revision) => bridge!.save(p, content, revision), refresh);
    sessions.current.set(snapshot.path, session); refresh(); return session;
  };
  const schedule = (session: SaveSession) => {
    clearTimeout(timers.current.get(session.path));
    const token = generation.current;
    timers.current.set(session.path, setTimeout(async () => {
      if (token !== generation.current || !bridge) return;
      if (editor.current?.composing && session.path === activeRef.current) { schedule(session); return; }
      if (session.content !== session.savedContent) {
        const backup = await bridge.stageRecovery(session.path, session.content, session.revision);
        if (!backup.ok) { session.status = 'error'; session.error = backup.error; refresh(); return; }
        await session.flush();
      }
    }, 650));
  };
  const edit = (content: string) => { const session = sessions.current.get(activeRef.current); if (session) { session.edit(content); schedule(session); } };
  const openNote = async (p: string) => {
    if (!bridge) return;
    const request = ++selectionRequest.current;
    if (sessions.current.has(p)) { select(p); return; }
    const token = generation.current, epoch = noteEpochs.current.get(p);
    let pending = pendingOpens.current.get(p);
    if (!pending) { pending = bridge.read(p); pendingOpens.current.set(p, pending); }
    const result = await pending;
    if (pendingOpens.current.get(p) === pending) pendingOpens.current.delete(p);
    if (token !== generation.current || noteEpochs.current.get(p) !== epoch) return;
    if (!result.ok) { explain(result.error.message, 'error'); return; }
    if (!sessions.current.has(p)) addSession(result.value);
    if (request !== selectionRequest.current) return;
    select(p); setMessage('');
    void resolveImagesFor(p, result.value.content);
    const recovery = await bridge.getRecovery(p);
    if (token !== generation.current || noteEpochs.current.get(p) !== epoch) return;
    if (recovery.ok && recovery.value && recovery.value.content !== result.value.content) setModal({ type: 'recovery', notePath: p, recovery: recovery.value });
  };
  const openFile = (p: string) => { if (/\.md$/i.test(p)) void openNote(p); else previewAttachment(p); };
  const flushAll = async () => {
    if (!bridge) return true;
    for (const timer of timers.current.values()) clearTimeout(timer);
    const ready = await flushSessions(sessions.current.values(), session => bridge.stageRecovery(session.path, session.content, session.revision));
    refresh();
    return ready;
  };
  const attachVault = async (info: VaultInfo) => {
    generation.current++;
    selectionRequest.current++; pendingOpens.current.clear(); noteEpochs.current.clear(); setSelectedDirectory('');
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear(); sessions.current.clear(); select('');
    setVault(info); setFiles(info.files); setDirectories(info.directories); setQuery(''); setMessage(''); setModal(null);
    const cfg = await bridge!.attachmentGetConfig();
    if (cfg.ok) setAttachmentConfig(cfg.value);
    const firstNote = info.files.find(f => /\.md$/i.test(f.path));
    if (firstNote) await openNote(firstNote.path);
    const backups = await bridge!.recoveries();
    if (backups.ok) {
      setRecoveries(backups.value);
      if (backups.value.some(r => !info.files.some(file => file.path === r.path))) setModal({ type: 'recoveries' });
    }
  };
  const chooseVault = async () => {
    if (!bridge || busy || transition.current || pendingCreate.current) return;
    transition.current = true; setBusy(true);
    try {
      if (!await flushAll()) { explain('还有笔记未能保存，请先处理保存错误或保留副本，再切换笔记库。', 'error'); return; }
      const result = await bridge.chooseVault(); if (result.ok && result.value) await attachVault(result.value); else if (!result.ok) explain(result.error.message, 'error');
    } finally { transition.current = false; setBusy(false); }
  };
  const openCreate = (content = '', original?: string, recoveryPath?: string) => {
    if (transition.current || pendingCreate.current) return;
    if (!vault) { explain('请先打开一个笔记文件夹。'); return; }
    const directory = selectedDirectory ? selectedDirectory + '/' : '';
    const suggested = recoveryPath ? nameOf(recoveryPath) + '-恢复.md' : directory + (original ? nameOf(original) + '-副本.md' : '未命名笔记.md');
    setFilename(suggested); setFormError(''); setModal({ type: 'create', content, suggested, original, recoveryPath });
  };
  const createWork = async () => {
    if (!bridge || modal?.type !== 'create' || transition.current) return;
    const p = /\.md$/i.test(filename.trim()) ? filename.trim() : filename.trim() + '.md';
    if (!filename.trim()) { setFormError('请输入笔记名称。'); return; }
    setCreating(true);
    const result = await bridge.create(p, modal.content);
    if (!result.ok) { setFormError(result.error.message); setCreating(false); return; }
    if (modal.original) {
      const original = sessions.current.get(modal.original);
      clearTimeout(timers.current.get(modal.original));
      const disk = await bridge.read(modal.original);
      if (disk.ok) { original?.acceptDisk(disk.value); await bridge.clearRecovery(modal.original); }
      else sessions.current.delete(modal.original);
    }
    if (modal.recoveryPath) await bridge.clearRecovery(modal.recoveryPath);
    addSession(result.value); await refreshFiles(); select(p); setModal(null); setCreating(false); setMessage('');
  };
  const create = (event: React.FormEvent) => {
    event.preventDefault();
    if (transition.current || pendingCreate.current) return;
    pendingCreate.current = createWork().finally(() => { pendingCreate.current = null; setCreating(false); });
  };
  const openDirectory = () => {
    if (!vault || transition.current || pendingCreate.current) return;
    setFilename(selectedDirectory ? selectedDirectory + '/新建目录' : '新建目录'); setFormError(''); setModal({ type: 'directory' });
  };
  const makeDirectory = (event: React.FormEvent) => {
    event.preventDefault();
    if (!bridge || transition.current || pendingCreate.current) return;
    const p = filename.trim(); if (!p) { setFormError('请输入目录名称。'); return; }
    setCreating(true);
    pendingCreate.current = (async () => {
      const result = await bridge.createDirectory(p);
      if (!result.ok) { setFormError(result.error.message); return; }
      await refreshFiles(); setSelectedDirectory(p); setQuery(''); setModal(null);
    })().finally(() => { pendingCreate.current = null; setCreating(false); });
  };
  const requestDelete = async (p: string) => {
    if (!bridge || busy || transition.current || pendingCreate.current) return;
    const token = generation.current, session = sessions.current.get(p);
    const result = session ? { ok: true as const, value: { revision: session.revision, content: session.content } } : await bridge.read(p);
    if (token !== generation.current || transition.current || pendingCreate.current) return;
    if (!result.ok) { explain(result.error.message, 'error'); return; }
    setFormError(''); setModal({ type: 'delete', notePath: p, revision: result.value.revision, content: result.value.content });
  };
  const deleteNote = () => {
    if (!bridge || modal?.type !== 'delete' || transition.current || pendingCreate.current) return;
    const { notePath: p, revision, content } = modal;
    mutationBusy.current = true; setCreating(true); setBusy(true);
    noteEpochs.current.set(p, (noteEpochs.current.get(p) || 0) + 1); selectionRequest.current++;
    clearTimeout(timers.current.get(p));
    pendingCreate.current = (async () => {
      const session = sessions.current.get(p);
      if (session && session.revision !== revision && session.savedContent !== content) { setFormError('笔记内容已经变化，请取消并重新查看后再删除。'); return; }
      if (session && !await session.flush()) { setFormError('笔记未能保存。请先处理保存失败或版本冲突，再删除。'); return; }
      if (session && session.content !== content) { setFormError('笔记内容已经变化，请取消并重新查看后再删除。'); return; }
      const result = await bridge.trash(p, session?.revision || revision);
      if (!result.ok) { setFormError(result.error.message); return; }
      sessions.current.delete(p); pendingOpens.current.delete(p); timers.current.delete(p);
      if (activeRef.current === p) select(sessions.current.keys().next().value || '');
      await refreshFiles(); refresh(); setModal(null); setMessage('笔记已移到回收站。');
    })().finally(() => { pendingCreate.current = null; mutationBusy.current = false; setCreating(false); if (!transition.current) setBusy(false); });
  };
  const requestRename = (kind: 'file' | 'directory', path: string) => {
    if (!vault || busy || transition.current || pendingCreate.current) return;
    setFilename(kind === 'file' ? nameOf(path) : path.split('/').at(-1)!); setFormError(''); setModal({ type: 'rename', kind, path });
  };
  const renameWork = async () => {
    if (!bridge || modal?.type !== 'rename' || transition.current || pendingCreate.current) return;
    const { kind, path: oldPath } = modal;
    const name = filename.trim();
    if (!name) { setFormError('请输入新名称。'); return; }
    if (name.includes('/') || name.includes('\\')) { setFormError('名称不能包含 / 或 \\。'); return; }
    const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : '';
    const newPath = (parent ? parent + '/' : '') + name + (kind === 'file' && !/\.md$/i.test(name) ? '.md' : '');
    if (newPath === oldPath) { setModal(null); return; }
    const session = sessions.current.get(oldPath);
    if (kind === 'file' && session && !await session.flush()) { setFormError('笔记未能保存，请先处理保存失败或版本冲突。'); return; }
    mutationBusy.current = true; setCreating(true);
    pendingCreate.current = (async () => {
      const result = await bridge.rename(oldPath, newPath);
      if (!result.ok) { setFormError(result.error.message); return; }
      const isDir = kind === 'directory';
      for (const key of [...sessions.current.keys()]) {
        if (key !== oldPath && !(isDir && key.startsWith(oldPath + '/'))) continue;
        const s = sessions.current.get(key)!;
        const next = newPath + key.slice(oldPath.length);
        s.path = next;
        sessions.current.delete(key); sessions.current.set(next, s);
        const timer = timers.current.get(key); if (timer !== undefined) { timers.current.delete(key); timers.current.set(next, timer); }
        const epoch = noteEpochs.current.get(key); if (epoch !== undefined) { noteEpochs.current.delete(key); noteEpochs.current.set(next, epoch); }
        const pending = pendingOpens.current.get(key); if (pending !== undefined) { pendingOpens.current.delete(key); pendingOpens.current.set(next, pending); }
        if (activeRef.current === key) select(next);
      }
      await refreshFiles(); refresh(); setModal(null); reportOutcome(result.value);
    })().finally(() => { pendingCreate.current = null; mutationBusy.current = false; setCreating(false); });
  };
  const requestMove = (kind: 'file' | 'directory', path: string) => {
    if (!vault || busy || transition.current || pendingCreate.current) return;
    setMoveTarget(''); setFormError(''); setModal({ type: 'move', kind, path });
  };
  const moveWork = async () => {
    if (modal?.type !== 'move') return;
    const { kind, path } = modal;
    await performMove(kind, path, moveTarget, setFormError);
  };
  const performMove = async (kind: 'file' | 'directory', path: string, targetDir: string, onError: (msg: string) => void) => {
    if (!bridge || transition.current || pendingCreate.current) return false;
    if (kind === 'directory' && (targetDir === path || targetDir.startsWith(path + '/'))) { onError('不能移动到自身或其子目录。'); return false; }
    if (kind === 'file') { const sourceDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; if (targetDir === sourceDir) return false; }
    for (const [key, session] of sessions.current) {
      if (key === path || (kind === 'directory' && key.startsWith(path + '/'))) {
        if (!await session.flush()) { onError('有笔记未能保存，请先处理保存失败或版本冲突。'); return false; }
      }
    }
    mutationBusy.current = true; setCreating(true); setBusy(true);
    return new Promise<boolean>(resolve => {
      pendingCreate.current = (async () => {
        const result = await bridge.move(path, targetDir);
        if (!result.ok) { onError(result.error.message); resolve(false); return; }
        const { to } = result.value;
        const isDir = kind === 'directory';
        for (const key of [...sessions.current.keys()]) {
          if (key !== path && !(isDir && key.startsWith(path + '/'))) continue;
          const s = sessions.current.get(key)!;
          const next = to + key.slice(path.length);
          s.path = next;
          sessions.current.delete(key); sessions.current.set(next, s);
          const timer = timers.current.get(key); if (timer !== undefined) { timers.current.delete(key); timers.current.set(next, timer); }
          const epoch = noteEpochs.current.get(key); if (epoch !== undefined) { noteEpochs.current.delete(key); noteEpochs.current.set(next, epoch); }
          const pending = pendingOpens.current.get(key); if (pending !== undefined) { pendingOpens.current.delete(key); pendingOpens.current.set(next, pending); }
          if (activeRef.current === key) select(next);
        }
        await refreshFiles(); refresh(); setModal(null); reportOutcome(result.value);
        resolve(true);
      })().finally(() => { pendingCreate.current = null; mutationBusy.current = false; setCreating(false); if (!transition.current) setBusy(false); });
    });
  };
  const dropMove = (src: string, targetDir: string) => {
    const kind: 'file' | 'directory' = directories.includes(src) ? 'directory' : 'file';
    void performMove(kind, src, targetDir, msg => explain(msg, 'error'));
  };
  const requestDeleteDirectory = async (path: string) => {
    if (!bridge || busy || transition.current || pendingCreate.current) return;
    const result = await bridge.countDirectory(path);
    if (!result.ok) { explain(result.error.message, 'error'); return; }
    setFormError(''); setModal({ type: 'delete-directory', path, count: result.value });
  };
  const deleteDirectory = async () => {
    if (!bridge || modal?.type !== 'delete-directory' || transition.current || pendingCreate.current) return;
    const { path } = modal;
    for (const [key, session] of sessions.current) {
      if (key.startsWith(path + '/')) if (!await session.flush()) { setFormError('目录内有笔记未能保存，请先处理保存失败或版本冲突。'); return; }
    }
    mutationBusy.current = true; setCreating(true); setBusy(true);
    const token = generation.current;
    pendingCreate.current = (async () => {
      const result = await bridge.trashDirectory(path);
      if (token !== generation.current) return;
      if (!result.ok) { setFormError(result.error.message); return; }
      for (const key of [...sessions.current.keys()]) {
        if (!key.startsWith(path + '/')) continue;
        sessions.current.delete(key); timers.current.delete(key); pendingOpens.current.delete(key); noteEpochs.current.delete(key);
        if (activeRef.current === key) activeRef.current = '';
      }
      if (!activeRef.current) select(sessions.current.keys().next().value || '');
      await refreshFiles(); refresh(); setModal(null); setMessage('目录已移到回收站。');
    })().finally(() => { pendingCreate.current = null; mutationBusy.current = false; setCreating(false); if (!transition.current) setBusy(false); });
  };
  const exportNote = async () => {
    if (!bridge || !activeSession || busy) return;
    const result = await bridge.exportDocx(activeSession.content, activeSession.path, pandocPath);
    if (!result.ok) {
      if (result.error.code === 'PANDOC_NOT_FOUND') setModal({ type: 'settings', prompt: '未找到 Pandoc，请在下方配置 pandoc 路径后再导出。' });
      else explain(result.error.message, 'error');
      return;
    }
    if (result.value) explain('已导出 Word 文档：' + result.value);
  };
  const getSelection = () => { const view = editor.current; return view && !view.state.selection.main.empty ? view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to) : ''; };
  const applyInsert = (text: string) => { const view = editor.current; if (!view) return; view.dispatch({ changes: { from: view.state.selection.main.from, insert: text } }); view.focus(); };
  const applyInsertAt = (position: number, text: string) => { const view = editor.current; if (!view) return; const from = Math.max(0, Math.min(position, view.state.doc.length)); view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length } }); view.focus(); };
  const insertText = (text: string) => { if (mode === 'read') { pendingInsert.current = text; setMode('live'); } else applyInsert(text); };
  const resolveImagesFor = async (notePath: string, content: string) => {
    if (!bridge) return;
    const request = ++imagesRequest.current;
    const result = await bridge.resolveImages(notePath, content);
    if (request !== imagesRequest.current) return;
    if (!result.ok) { setImages(new Map()); return; }
    const map = new Map<string, ResolvedImage>();
    for (const img of result.value) map.set(img.kind + ':' + img.target, img);
    setImages(map);
  };
  const importFiles = async (files: File[], position: number) => {
    if (!bridge || !vault || !activeSession || transition.current) return;
    const notePath = activeRef.current;
    const token = generation.current, epoch = noteEpochs.current.get(notePath);
    let cursor = position;
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await bridge.importAttachment(file.name, bytes, notePath);
      if (token !== generation.current || noteEpochs.current.get(notePath) !== epoch) return;
      if (!result.ok) { explain(result.error.message, 'error'); return; }
      const label = file.name.replace(/[[\]]/g, '');
      const isImage = file.type.startsWith('image/') || isImagePath(file.name);
      const text = isImage ? `![${label}](${result.value.path})\n` : `[${label}](${result.value.path})\n`;
      applyInsertAt(cursor, text);
      cursor += text.length;
    }
  };
  const updateAttachment = (patch: Partial<AttachmentConfig>) => { const next = { ...attachmentConfig, ...patch }; setAttachmentConfig(next); void bridge?.attachmentSetConfig(next); };
  const reportOutcome = (outcome: MaintenanceOutcome) => {
    if (outcome.failed.length) { explain('操作完成，但有 ' + outcome.failed.length + ' 篇笔记的引用未能更新。', 'error'); return; }
    if (outcome.unchanged.length) explain(outcome.unchanged.length + ' 处引用无法解析，已保留原文。');
  };
  const updateAi = (patch: Partial<AiConfig>) => { const next = { ...aiConfig, ...patch }; setAiConfig(next); void bridge?.aiSetConfig(next); };
  const panelMaximum = (side: PanelSide) => Math.max(220, Math.min(560, innerWidth - (side === 'left' ? right ? rightWidth : 0 : left ? leftWidth : 0) - 360));
  const changePanelWidth = (side: PanelSide, width: number) => (side === 'left' ? setLeftWidth : setRightWidth)(Math.max(220, Math.min(panelMaximum(side), width)));
  const resizeWithKey = (side: PanelSide, event: React.KeyboardEvent) => {
    const width = side === 'left' ? leftWidth : rightWidth;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const delta = (event.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1);
    changePanelWidth(side, event.key === 'Home' ? 220 : event.key === 'End' ? panelMaximum(side) : width + delta);
  };
  const startResize = (side: PanelSide, event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeCleanup.current?.();
    const startX = event.clientX, startWidth = side === 'left' ? leftWidth : rightWidth;
    const previousCursor = document.body.style.cursor, previousSelection = document.body.style.userSelect;
    const onMove = (e: MouseEvent) => changePanelWidth(side, startWidth + (e.clientX - startX) * (side === 'left' ? 1 : -1));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); window.removeEventListener('blur', onUp);
      document.body.style.cursor = previousCursor; document.body.style.userSelect = previousSelection;
      resizeCleanup.current = null; setResizing(null);
    };
    resizeCleanup.current = onUp;
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp); window.addEventListener('blur', onUp);
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; setResizing(side);
  };
  useEffect(() => () => resizeCleanup.current?.(), []);
  useEffect(() => {
    const fitPanels = () => {
      if (left && right && leftWidth + rightWidth > innerWidth - 360) {
        const maximum = Math.max(220, (innerWidth - 360) / 2);
        setLeftWidth(width => Math.min(width, maximum)); setRightWidth(width => Math.min(width, maximum));
      }
    };
    fitPanels(); window.addEventListener('resize', fitPanels);
    return () => window.removeEventListener('resize', fitPanels);
  }, [left, right, leftWidth, rightWidth]);
  const compare = async () => {
    if (!bridge || !activeSession || transition.current) return;
    const result = await bridge.read(activeSession.path);
    if (result.ok) setModal({ type: 'conflict', notePath: activeSession.path, disk: result.value });
    else explain(result.error.message, 'error');
  };
  const useDisk = async (notePath: string, snapshot: NoteSnapshot) => {
    if (transition.current) return;
    clearTimeout(timers.current.get(notePath));
    sessions.current.get(notePath)?.acceptDisk(snapshot); await bridge!.clearRecovery(notePath); setModal(null);
  };
  const closeTab = async (p: string) => {
    const session = sessions.current.get(p); if (!session) return;
    clearTimeout(timers.current.get(p));
    if (!await session.flush()) { select(p); explain('这篇笔记还未保存。请重试，或把当前内容保留为副本。', 'error'); return; }
    sessions.current.delete(p);
    if (active === p) select(sessions.current.keys().next().value || ''); refresh();
  };
  useEffect(() => {
    mounted.current = true;
    void (async () => { if (bridge) { const result = await bridge.currentVault(); if (result.ok && result.value) await attachVault(result.value); else if (!result.ok) explain(result.error.message, 'error'); } setBusy(false); })();
    return () => { mounted.current = false; for (const timer of timers.current.values()) clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('plainote-theme', theme);
    localStorage.setItem('plainote-accent', accent);
    const preset = THEMES.find(t => t.id === accent) || THEMES[0];
    const colors = theme === 'dark' ? preset.dark : preset.light;
    for (const [key, value] of Object.entries(colors)) document.documentElement.style.setProperty('--' + key, value);
  }, [theme, accent]);
  useEffect(() => { if (bridge) void bridge.aiGetConfig().then(r => { if (r.ok) setAiConfig(r.value); }); }, [bridge]);
  useEffect(() => { document.documentElement.style.setProperty('--left-width', leftWidth + 'px'); localStorage.setItem('plainote-left-width', String(leftWidth)); }, [leftWidth]);
  useEffect(() => { document.documentElement.style.setProperty('--right-width', rightWidth + 'px'); localStorage.setItem('plainote-right-width', String(rightWidth)); }, [rightWidth]);
  useEffect(() => { if (mode !== 'read' && pendingInsert.current !== null) { const t = pendingInsert.current; pendingInsert.current = null; applyInsert(t); } }, [mode]);
  useEffect(() => {
    let previousWidth = innerWidth;
    const resize = () => { if (innerWidth <= 1050 && previousWidth > 1050) setRight(false); previousWidth = innerWidth; };
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => { document.documentElement.style.setProperty('--document-size', fontSize + 'px'); localStorage.setItem('plainote-font-size', String(fontSize)); }, [fontSize]);
  useEffect(() => {
    if (!bridge) return;
    const offClose = bridge.onCloseRequested(requestId => {
      if (transition.current) { bridge.finishClose(requestId, false); return; }
      closeAttempt.current.begin(requestId);
      transition.current = true; setBusy(true);
      void (async () => {
        await pendingCreate.current;
        if (!closeAttempt.current.isCurrent(requestId)) return;
        const ready = await flushAll();
        if (closeAttempt.current.isCurrent(requestId)) bridge.finishClose(requestId, ready);
      })();
    });
    const offCancel = bridge.onCloseCanceled(requestId => {
      if (closeAttempt.current.cancel(requestId)) { transition.current = false; setBusy(mutationBusy.current); }
    });
    const offVault = bridge.onVaultRequested(() => { void chooseVault(); });
    const keydown = (event: KeyboardEvent) => {
      const mod = bridge.platform === 'darwin' ? event.metaKey : event.ctrlKey;
      if (!mod || modal || busy || transition.current) return;
      if (event.key.toLowerCase() === 'p') { event.preventDefault(); setQuick(''); setQuickIndex(0); setModal({ type: 'quick' }); }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); openCreate(); }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); if (activeSession) void activeSession.flush(); }
      if (event.key === ',') { event.preventDefault(); setModal({ type: 'settings' }); }
    };
    document.addEventListener('keydown', keydown);
    return () => { offClose(); offCancel(); offVault(); document.removeEventListener('keydown', keydown); };
  });
  useEffect(() => {
    if (!bridge || !vault) return;
    let checking = false;
    const interval = setInterval(async () => {
      const session = sessions.current.get(activeRef.current);
      if (!session || mutationBusy.current || checking || isSaving(session) || document.hidden) return;
      checking = true;
      const token = generation.current, expected = session.revision;
      try {
        const disk = await bridge.read(session.path);
        if (token !== generation.current || mutationBusy.current || session.revision !== expected || isSaving(session)) return;
        if (disk.ok && disk.value.revision !== expected) {
          if (session.content === session.savedContent && session.status !== 'conflict') session.acceptDisk(disk.value);
          else { session.status = 'conflict'; session.error = { code: 'CONFLICT', message: '这篇笔记已被其他应用修改。请比较两个版本，或保留你的内容为副本。' }; refresh(); }
        }
        if (!disk.ok && session.status !== 'error') { session.status = 'error'; session.error = disk.error; refresh(); }
        await refreshFiles();
      } finally { checking = false; }
    }, 2500);
    return () => clearInterval(interval);
  }, [vault, bridge]);

  useEffect(() => { setImages(new Map()); imagesRequest.current++; }, [active]);
  useEffect(() => {
    if (!bridge || !vault || !activeSession) return;
    const path = active, content = activeSession.content;
    if (!path) return;
    const timer = setTimeout(() => void resolveImagesFor(path, content), 700);
    return () => clearTimeout(timer);
  }, [activeSession?.content, active, vault, bridge]);
  const openNoteRef = useRef(openNote);
  openNoteRef.current = openNote;
  const navigateToNote = useCallback((p: string) => { void openNoteRef.current(p); }, []);
  const previewAttachment = useCallback((p: string) => { setPreviewTabs(prev => prev.includes(p) ? prev : [...prev, p]); setActivePreview(p); }, []);
  const closePreview = (p: string) => {
    const idx = previewTabs.indexOf(p);
    const remaining = previewTabs.filter(x => x !== p);
    setPreviewTabs(remaining);
    if (activePreview === p) setActivePreview(remaining.length ? remaining[Math.min(idx, remaining.length - 1)] : null);
  };
  const noteAssets = useMemo<NoteAssets | null>(() => active ? { notePath: active, images, openNote: navigateToNote, previewAttachment } : null, [active, images, navigateToNote, previewAttachment]);
  const filePaths = useMemo(() => files.map(f => f.path), [files]);
  const { headings, loading: outlineLoading, error: outlineError } = useOutline(activePreview === null && activeSession ? activeSession.path : null, activeSession?.content || '');
  const filtered = files.filter(file => (file.name + file.path).toLowerCase().includes(query.toLowerCase()));
  const quickMatches = files.filter(file => (file.name + file.path).toLowerCase().includes(quick.toLowerCase())).slice(0, 50);
  const selectedQuick = Math.min(quickIndex, Math.max(0, quickMatches.length - 1));
  const dirty = [...sessions.current.values()].filter(s => s.content !== s.savedContent);
  const statuses = { saved: '已保存', dirty: '未保存', saving: '正在保存', error: '保存失败', conflict: '版本冲突' };
  const closeModal = () => { if (!creating) setModal(null); };
  return <div className={'app' + (!left ? ' hide-left' : '') + (!right ? ' hide-right' : '') + (bridge?.platform === 'win32' ? ' windows' : '')} aria-busy={busy}>
    <header className="titlebar"><div className="traffic-space" /><span className="window-title">素记 <span>Plainote</span></span><div className="title-actions"><button className="icon-button" title="显示或隐藏目录" aria-label="显示或隐藏目录" aria-expanded={left} onClick={() => setLeft(!left)}><Icon name="panel-left" /></button><button className="icon-button" title="显示或隐藏大纲" aria-label="显示或隐藏大纲" aria-expanded={right} onClick={() => setRight(!right)}><Icon name="panel-right" /></button>{bridge?.platform === 'win32' && <div className="window-buttons"><button aria-label="最小化" onClick={() => bridge.minimize()}><Icon name="minimize" /></button><button aria-label="最大化或还原" onClick={() => bridge.toggleMaximize()}><Icon name="maximize" /></button><button aria-label="关闭窗口" onClick={() => bridge.closeWindow()}><Icon name="close" /></button></div>}</div></header>
    <div className="workspace" inert={busy}>
      <aside id="note-sidebar" className="sidebar" aria-label="笔记目录"><div className={"resize-handle resize-handle-left" + (resizing === "left" ? " is-resizing" : "")} role="separator" aria-label="调整目录面板宽度" aria-orientation="vertical" aria-controls="note-sidebar" aria-valuemin={220} aria-valuemax={panelMaximum("left")} aria-valuenow={leftWidth} tabIndex={0} onMouseDown={event => startResize("left", event)} onKeyDown={event => resizeWithKey("left", event)} /><button className="vault-button" disabled={busy || !bridge} onClick={() => void chooseVault()} title={vault?.root || '打开笔记文件夹'}><span className="brand-mark"><Icon name="book" /></span><span><strong>{vault?.name || '打开笔记库'}</strong><small>{vault ? '本地笔记' : '选择一个文件夹'}</small></span><Icon name="chevrons" /></button><label className="search-field"><Icon name="search" /><input aria-label="查找笔记名称" placeholder="查找笔记名称" value={query} onChange={event => setQuery(event.target.value)} /></label><button className="new-note" disabled={!vault || busy} onClick={() => openCreate()}><Icon name="plus" />新建笔记<kbd>{command} N</kbd></button><div className="section-label">文件 <span className="directory-tools"><button className="icon-button" aria-label="新建目录" title="新建目录" disabled={!vault || busy || creating} onClick={openDirectory}><Icon name="folder-plus" /></button><button className="icon-button" title="刷新目录" aria-label="刷新目录" disabled={!vault} onClick={() => void refreshFiles()}><Icon name="refresh" /></button></span></div><div className="files-pane">{busy ? <p className="empty-label">正在处理文件…</p> : query ? <>{filtered.map(file => <FileRow key={file.path} file={file} active={active} open={openFile} remove={p => void requestDelete(p)} rename={p => requestRename('file', p)} move={p => requestMove('file', p)} />)}{!filtered.length && <p className="empty-label">没有匹配的笔记，试试其他名称。</p>}</> : <FileTree files={files} directories={directories} selectedDirectory={selectedDirectory} active={active} open={openFile} remove={p => void requestDelete(p)} rename={requestRename} move={requestMove} removeDirectory={p => void requestDeleteDirectory(p)} drop={dropMove} chooseDirectory={setSelectedDirectory} />}{vault && !files.length && !directories.length && !busy && <p className="empty-label">这里还没有 Markdown 笔记。<br />新建一篇，开始记录。</p>}</div>{recoveries.length > 0 && <button className="recovery-button" onClick={() => setModal({ type: 'recoveries' })}>恢复未保存内容 ({recoveries.length})</button>}<footer className="sidebar-footer"><button className="icon-button" aria-label="设置" title="设置" onClick={() => setModal({ type: 'settings' })}><Icon name="settings" /></button><button className="theme-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} />{theme === 'dark' ? '浅色模式' : '深色模式'}</button></footer></aside>
      <main className="editor-area"><div className="tabs" role="tablist" aria-label="已打开笔记">{[...sessions.current.values()].map(session => <div key={session.path} className={'tab' + (active === session.path && activePreview === null ? ' active' : '')}><button className="tab-select" role="tab" aria-selected={active === session.path && activePreview === null} title={session.path} onClick={() => select(session.path)}><Icon name={session.status === 'error' || session.status === 'conflict' ? 'warning' : 'file'} /><span>{nameOf(session.path)}</span>{session.content !== session.savedContent && <span className="dirty-dot" aria-label="未保存" />}</button><button className="tab-close" aria-label={'关闭 ' + nameOf(session.path)} onClick={() => void closeTab(session.path)}><Icon name="close" /></button></div>)}{previewTabs.map(p => <div key={'p:' + p} className={'tab preview-tab' + (activePreview === p ? ' active' : '')}><button className="tab-select" role="tab" aria-selected={activePreview === p} title={p} onClick={() => setActivePreview(p)}><Icon name={isImagePath(p) ? 'image' : 'file'} /><span>{basenameOf(p)}</span></button><button className="tab-close" aria-label={'关闭 ' + basenameOf(p)} onClick={() => closePreview(p)}><Icon name="close" /></button></div>)}{vault && <button className="tab-add" aria-label="新建笔记" onClick={() => openCreate()}><Icon name="plus" /></button>}</div>
        {activePreview != null ? <AttachmentPreview path={activePreview} onClose={() => closePreview(activePreview)} /> : activeSession ? <><div className="editor-toolbar"><div className="breadcrumb" title={active}>{active.split('/').map((part, i) => <span key={i}>{i > 0 && <Icon name="chevron" />}{part.replace(/\.md$/i, '')}</span>)}</div><div className="editor-actions"><div className="editor-modes" role="group" aria-label="正文显示模式"><button className="mode-button" aria-pressed={mode === 'live'} onClick={() => setMode('live')}>即时预览</button><button className="mode-button" aria-pressed={mode === 'source'} onClick={() => setMode('source')}><Icon name="code" />源码</button><button className="mode-button" aria-pressed={mode === 'read'} onClick={() => setMode('read')}><Icon name="book" />阅读模式</button></div><button className="icon-button" aria-label="删除当前笔记" title="删除当前笔记" onClick={() => void requestDelete(active)}><Icon name="trash" /></button><button className="icon-button" aria-label="导出 DOCX" title="导出 DOCX" onClick={() => void exportNote()}><Icon name="export" /></button></div></div>{(activeSession.error || message) && <div className={'notice' + (activeSession.error ? ' error' : '')} role="status"><Icon name={activeSession.error || messageKind === 'error' ? 'warning' : 'check'} /><p>{activeSession.error?.message || message}</p>{activeSession.status === 'conflict' ? <button onClick={() => void compare()}>比较版本</button> : activeSession.error ? <button onClick={() => void activeSession.flush()}>重试保存</button> : <button aria-label="关闭提示" onClick={() => setMessage('')}><Icon name="close" /></button>}{activeSession.error && <button onClick={() => openCreate(activeSession.content, activeSession.path)}>另存为副本</button>}</div>}<Editor path={active} content={activeSession.content} mode={mode} readOnly={busy} noteAssets={noteAssets} filePaths={filePaths} onChange={edit} onImportFiles={importFiles} onReady={view => { editor.current = view; }} /></> : <section className="welcome"><span className="welcome-mark"><Icon name="book" /></span><h1>{vault ? '从一篇笔记开始。' : '让笔记回到你手中。'}</h1><p>{vault ? '新建笔记，或从左侧目录打开已有内容。' : '打开本地文件夹，继续使用你的 Markdown 笔记。'}</p><button className="primary-button" disabled={busy || !bridge} onClick={() => vault ? openCreate() : void chooseVault()}>{busy ? '正在加载…' : vault ? '新建笔记' : '打开笔记文件夹'}</button><small>{bridge ? '笔记直接保存在本地，无需导入转换。' : '请通过 npm run dev 启动桌面应用以访问本地文件。'}</small>{message && <p className="welcome-error" role="status">{message}</p>}</section>}</main>
      <aside id="note-inspector" className="inspector" aria-label="笔记侧栏"><div className={"resize-handle" + (resizing === "right" ? " is-resizing" : "")} role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-controls="note-inspector" aria-valuemin={220} aria-valuemax={panelMaximum("right")} aria-valuenow={rightWidth} tabIndex={0} onMouseDown={event => startResize("right", event)} onKeyDown={event => resizeWithKey("right", event)} /><div className="inspector-tabs"><button className={'inspector-tab' + (inspectorTab === 'outline' ? ' active' : '')} aria-pressed={inspectorTab === 'outline'} onClick={() => setInspectorTab('outline')}>大纲</button><button className={'inspector-tab' + (inspectorTab === 'ai' ? ' active' : '')} aria-pressed={inspectorTab === 'ai'} onClick={() => setInspectorTab('ai')}>AI 对话</button></div>{inspectorTab === 'outline' ? <><nav className="outline" aria-label="当前笔记大纲">{headings.map((heading, index) => <button key={index} style={{ paddingLeft: 11 + Math.min(heading.level - 1, 3) * 10 }} onClick={() => { const view = editor.current; if (view && heading.line <= view.state.doc.lines) { const line = view.state.doc.line(heading.line); view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start' }) }); view.focus(); } }}>{heading.text}</button>)}{!headings.length && <p className="empty-label">{activePreview != null ? '正在预览附件。' : outlineLoading ? '正在生成大纲…' : outlineError || '添加标题后，可以在这里浏览笔记结构。'}</p>}</nav><p className="inspector-tip">正文直接使用 Markdown。<br />需要精确编辑时，可切换源码模式。</p></> : bridge ? <AiPanel bridge={bridge} note={activePreview != null ? null : activeSession ? { path: activeSession.path, name: nameOf(activeSession.path), content: activeSession.content } : null} getSelection={getSelection} onInsert={insertText} onConfigMissing={() => setModal({ type: 'settings', prompt: '请先配置 AI API Key，再使用 AI 对话。' })} /> : <p className="empty-label">AI 对话需要在桌面应用中运行。</p>}</aside>
    </div>
    <footer className="statusbar"><span className={'save-status' + (activeSession?.error ? ' failed' : '')}>{activePreview != null ? <><Icon name="file" />预览 · {basenameOf(activePreview)}</> : <><Icon name={activeSession?.error ? 'warning' : 'check'} />{activeSession ? statuses[activeSession.status] : '本地笔记'}{dirty.length > 1 && ` · ${dirty.length} 篇待保存`}</>}</span><span className="vault-path" title={vault?.root}>{vault?.root}</span><div>{activePreview != null ? <span>附件预览</span> : <><span>{activeSession ? `${activeSession.content.replace(/\s/g, '').length} 字` : `${files.length} 篇笔记`}</span>{activeSession && <span>{mode === 'source' ? '源码模式' : mode === 'read' ? '阅读模式 · 正文只读' : '即时预览'}</span>}</>}</div></footer>
    {modal && <Modal title={modal.type === 'quick' ? '快速打开笔记' : modal.type === 'settings' ? '设置' : modal.type === 'create' ? '新建笔记' : modal.type === 'conflict' ? '这篇笔记有两个版本' : modal.type === 'directory' ? '新建目录' : modal.type === 'delete' ? '删除笔记' : modal.type === 'rename' ? (modal.kind === 'file' ? '重命名笔记' : '重命名目录') : modal.type === 'move' ? (modal.kind === 'file' ? '移动笔记' : '移动目录') : modal.type === 'delete-directory' ? '删除目录' : modal.type === 'recoveries' ? '恢复未保存内容' : '发现未保存的恢复内容'} close={closeModal}><fieldset className="modal-controls" disabled={busy}>
      {modal.type === 'quick' && <><input className="quick-input" autoFocus aria-label="快速打开笔记" placeholder="输入笔记名称或路径…" value={quick} onChange={event => { setQuick(event.target.value); setQuickIndex(0); }} onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) event.preventDefault(); if (event.key === 'ArrowDown') setQuickIndex(Math.min(selectedQuick + 1, quickMatches.length - 1)); if (event.key === 'ArrowUp') setQuickIndex(Math.max(0, selectedQuick - 1)); if (event.key === 'Enter' && quickMatches[selectedQuick]) { openFile(quickMatches[selectedQuick].path); setModal(null); } }} /><div className="quick-results">{quickMatches.map((file, i) => <button key={file.path} className={'quick-row' + (i === selectedQuick ? ' current' : '')} onClick={() => { openFile(file.path); setModal(null); }}><Icon name="file" /><span>{file.name}<small>{file.path}</small></span></button>)}{!quickMatches.length && <p className="empty-label">没有匹配的笔记。</p>}</div><p className="dialog-copy">方向键选择，回车打开，Esc 关闭。</p></>}
      {modal.type === 'settings' && <><p className="dialog-copy">调整适合自己的阅读与工作环境。</p>{modal.prompt && <p className="form-error" role="alert">{modal.prompt}</p>}<div className="setting-row"><div><strong>外观</strong><small>暖白与墨色为底，深浅随环境切换。</small></div><div className="segmented"><button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>浅色</button><button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>深色</button></div></div><div className="setting-row"><div><strong>主题色</strong><small>选择界面的强调色。</small></div><div className="accent-swatches">{THEMES.map(a => <button key={a.id} className="accent-swatch" style={{ background: (theme === 'dark' ? a.dark : a.light).accent }} aria-pressed={accent === a.id} aria-label={'主题色 ' + a.name} title={a.name} onClick={() => setAccent(a.id)} />)}</div></div><div className="setting-row"><div><strong>Pandoc 路径</strong><small>导出 Word 文档使用，留空则用系统 PATH 中的 pandoc。</small></div><input className="pandoc-input" aria-label="Pandoc 路径" placeholder="pandoc 或 /usr/local/bin/pandoc" value={pandocPath} onChange={event => { const v = event.target.value; setPandocPath(v); localStorage.setItem('plainote-pandoc', v); }} /></div><div className="setting-row"><div><strong>接口协议</strong><small>Anthropic 兼容为 DeepSeek 官方接口；OpenAI 兼容用于内网 vLLM / 自建服务。</small></div><div className="segmented"><button aria-pressed={aiConfig.protocol === 'anthropic'} onClick={() => updateAi({ protocol: 'anthropic' })}>Anthropic 兼容</button><button aria-pressed={aiConfig.protocol === 'openai'} onClick={() => updateAi({ protocol: 'openai' })}>OpenAI 兼容</button></div></div><div className="setting-row"><div><strong>API 地址</strong><small>{aiConfig.protocol === 'openai' ? 'OpenAI 兼容地址需包含 /v1，如 http://10.x.x.x:9830/v1。' : 'Anthropic 兼容地址，默认 DeepSeek。'}</small></div><input className="pandoc-input" aria-label="AI API 地址" placeholder={aiConfig.protocol === 'openai' ? 'http://10.x.x.x:9830/v1' : 'https://api.deepseek.com/anthropic'} value={aiConfig.baseUrl} onChange={e => updateAi({ baseUrl: e.target.value })} /></div><div className="setting-row"><div><strong>API Key</strong><small>保存在本地。</small></div><input className="pandoc-input" type="password" aria-label="AI API Key" placeholder="sk-..." value={aiConfig.apiKey} onChange={e => updateAi({ apiKey: e.target.value })} /></div><div className="setting-row"><div><strong>模型</strong><small>如 deepseek-chat。</small></div><input className="pandoc-input" aria-label="AI 模型" placeholder="deepseek-chat" value={aiConfig.model} onChange={e => updateAi({ model: e.target.value })} /></div><div className="setting-row"><div><strong>正文字号</strong><small>{fontSize} px</small></div><input aria-label="正文字号" type="range" min="14" max="22" value={fontSize} onChange={event => setFontSize(Number(event.target.value))} /></div><div className="setting-row"><div><strong>附件位置</strong><small>新导入的图片保存到哪里，变更只影响新附件。</small></div><div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'flex-end' }}><div className="segmented"><button aria-pressed={attachmentConfig.mode === 'vault'} onClick={() => updateAttachment({ mode: 'vault' })}>统一目录</button><button aria-pressed={attachmentConfig.mode === 'note'} onClick={() => updateAttachment({ mode: 'note' })}>当前笔记旁</button></div><input className="pandoc-input" aria-label="附件目录" value={attachmentConfig.dir} onChange={e => updateAttachment({ dir: e.target.value })} placeholder="attachments" /></div></div><div className="setting-row"><div><strong>当前笔记库</strong><small className="settings-path">{vault?.root || '还未打开'}</small></div></div></>}
      {modal.type === 'directory' && <form onSubmit={makeDirectory}><p className="dialog-copy">目录保存在当前笔记库中。使用 / 分隔可创建嵌套目录。</p><label className="form-label">目录名称<input autoFocus value={filename} onChange={event => setFilename(event.target.value)} aria-label="目录名称" disabled={creating} /></label>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-buttons"><button type="button" className="secondary-button" disabled={creating} onClick={closeModal}>取消</button><button className="primary-button" disabled={creating}>{creating ? '正在创建…' : '创建目录'}</button></div></form>}
      {modal.type === 'delete' && <><p className="dialog-copy">将先保存当前编辑，再把这篇笔记移到系统回收站。需要时可从回收站恢复。</p><p className="delete-path">{modal.notePath}</p>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-buttons"><button className="secondary-button" disabled={creating} onClick={closeModal}>取消</button><button className="danger-button" disabled={creating} onClick={deleteNote}>{creating ? '正在删除…' : '移到回收站'}</button></div></>}
      {modal.type === 'rename' && <form onSubmit={event => { event.preventDefault(); void renameWork(); }}><p className="dialog-copy">重命名后，目录中的笔记会跟随新路径。</p><label className="form-label">{modal.kind === 'file' ? '笔记名称' : '目录名称'}<input autoFocus value={filename} onChange={event => setFilename(event.target.value)} aria-label={modal.kind === 'file' ? '笔记名称' : '目录名称'} disabled={creating} /></label>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-buttons"><button type="button" className="secondary-button" disabled={creating} onClick={closeModal}>取消</button><button className="primary-button" disabled={creating}>{creating ? '正在重命名…' : '重命名'}</button></div></form>}
      {modal.type === 'move' && <><p className="dialog-copy">选择移动到笔记库内的目标目录。</p><p className="delete-path">{modal.path}</p><div className="move-dirs"><button className={'move-dir' + (moveTarget === '' ? ' current' : '')} onClick={() => setMoveTarget('')}><Icon name="home" /><span>库根目录</span></button>{directories.filter(d => d !== modal.path && !(modal.kind === 'directory' && d.startsWith(modal.path + '/'))).map(d => <button key={d} className={'move-dir' + (moveTarget === d ? ' current' : '')} onClick={() => setMoveTarget(d)}><Icon name="folder" /><span>{d}</span></button>)}{!directories.length && <p className="empty-label">还没有其它目录，可直接移动到库根目录。</p>}</div>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-buttons"><button className="secondary-button" disabled={creating} onClick={closeModal}>取消</button><button className="primary-button" disabled={creating} onClick={() => void moveWork()}>{creating ? '正在移动…' : '移动到此处'}</button></div></>}
      {modal.type === 'delete-directory' && <><p className="dialog-copy">整个目录及其内容将移入系统回收站，可从回收站恢复。其他笔记中指向其中内容的引用会保留原样。</p><p className="delete-path">{modal.path}</p><p className="dialog-copy">包含 {modal.count.notes} 篇笔记、{modal.count.attachments} 个附件。</p>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-buttons"><button className="secondary-button" disabled={creating} onClick={closeModal}>取消</button><button className="danger-button" disabled={creating} onClick={() => void deleteDirectory()}>{creating ? '正在删除…' : '移到回收站'}</button></div></>}
      {modal.type === 'create' && <form onSubmit={event => void create(event)}><p className="dialog-copy">文件将保存在当前笔记库中。可以指定已有目录中的相对路径。</p><label className="form-label">笔记名称<input autoFocus value={filename} onChange={event => setFilename(event.target.value)} aria-label="笔记名称" placeholder="未命名笔记.md" disabled={creating} /></label>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-buttons"><button type="button" className="secondary-button" disabled={creating} onClick={closeModal}>取消</button><button className="primary-button" disabled={creating}>{creating ? '正在创建…' : '创建笔记'}</button></div></form>}
      {modal.type === 'conflict' && <><p className="dialog-copy">外部修改与当前编辑都需要保留。另存为副本会保留你的内容，并重新载入原文件的磁盘版本。</p><div className="conflict-versions"><section><strong>当前编辑内容</strong><pre>{sessions.current.get(modal.notePath)?.content}</pre></section><section><strong>磁盘上的内容</strong><pre>{modal.disk.content}</pre></section></div><div className="dialog-buttons"><button className="secondary-button" onClick={() => void useDisk(modal.notePath, modal.disk)}>使用磁盘版本</button><button className="primary-button" onClick={() => openCreate(sessions.current.get(modal.notePath)!.content, modal.notePath)}>保留我的内容为副本</button></div></>}
      {modal.type === 'recoveries' && <><p className="dialog-copy">这些编辑尚未保存。即使原笔记已经被删除，也可以把恢复内容保存为新笔记。</p>{recoveries.map(recovery => <button className="quick-row" key={recovery.path} onClick={() => { if (files.some(file => file.path === recovery.path)) { void openNote(recovery.path).then(() => setModal({ type: 'recovery', notePath: recovery.path, recovery })); } else openCreate(recovery.content, undefined, recovery.path); }}><Icon name="file" /><span>{nameOf(recovery.path)}<small>{recovery.path}</small></span></button>)}</>}
      {modal.type === 'recovery' && <><p className="dialog-copy">上次编辑的内容尚未保存到这篇笔记。你可以恢复编辑，或保留磁盘上的版本。</p><pre className="recovery-preview">{modal.recovery.content}</pre><div className="dialog-buttons"><button className="secondary-button" onClick={() => { if (transition.current) return; void bridge!.clearRecovery(modal.notePath); setModal(null); }}>保留磁盘版本</button><button className="primary-button" onClick={() => { if (transition.current) return; const session = sessions.current.get(modal.notePath)!; session.edit(modal.recovery.content); if (modal.recovery.baseRevision !== session.revision) { session.status = 'conflict'; session.error = { code: 'CONFLICT', message: '恢复内容与磁盘版本存在差异，请比较后选择保留方式。' }; refresh(); } else schedule(session); select(modal.notePath); setModal(null); }}>恢复编辑</button></div></>}
    </fieldset></Modal>}
  </div>;
}
