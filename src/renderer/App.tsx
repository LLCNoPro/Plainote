import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { Editor } from './Editor.tsx';
import { Icon } from './icons.tsx';
import { SaveSession } from '../shared/save-session.ts';
import { CloseAttempt } from '../shared/close-attempt.ts';
import { flushSessions } from '../shared/flush-sessions.ts';
import type { EditorMode } from '../shared/editor-mode.ts';
import { extractHeadings } from './preview.ts';
import { THEMES } from './themes.ts';
import type { NoteFile, NoteSnapshot, PlainoteBridge, RecoverySnapshot, VaultInfo } from '../shared/types.ts';

declare global { interface Window { plainote?: PlainoteBridge } }
type ModalState = { type: 'quick' } | { type: 'settings'; prompt?: string } | { type: 'create'; content: string; suggested: string; original?: string; recoveryPath?: string } | { type: 'conflict'; notePath: string; disk: NoteSnapshot } | { type: 'recovery'; notePath: string; recovery: RecoverySnapshot } | { type: 'recoveries' } | { type: 'directory' } | { type: 'delete'; notePath: string; revision: string; content: string } | { type: 'rename'; kind: 'file' | 'directory'; path: string };
const isSaving = (session: SaveSession) => session.status === 'saving';
const nameOf = (p: string) => p.split('/').at(-1)!.replace(/\.md$/i, '');

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} onCancel={close} aria-label={title} onClick={event => { if (event.target === ref.current) { const box = ref.current!.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(); } }}>
    <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={close}><Icon name="close" /></button></div><div className="dialog-body">{children}</div>
  </dialog>;
}
function FileRow({ file, active, depth = 0, open, remove, rename }: { file: NoteFile; active: string; depth?: number; open: (p: string) => void; remove: (p: string) => void; rename: (p: string) => void }) {
  return <div className="file-entry"><button className={'file-row' + (active === file.path ? ' selected' : '')} style={{ paddingLeft: 9 + depth * 15 }} title={file.path} aria-current={active === file.path ? 'page' : undefined} onClick={() => open(file.path)}><Icon name="file" /><span>{file.name}</span></button><button className="icon-button file-rename" aria-label={'重命名笔记 ' + file.path} title="重命名" onClick={() => rename(file.path)}><Icon name="pencil" /></button><button className="icon-button file-delete" aria-label={'删除笔记 ' + file.path} title="删除笔记" onClick={() => remove(file.path)}><Icon name="trash" /></button></div>;
}
function FileTree({ files, directories, selectedDirectory, active, open, remove, rename, chooseDirectory }: { files: NoteFile[]; directories: string[]; selectedDirectory: string; active: string; open: (p: string) => void; remove: (p: string) => void; rename: (kind: 'file' | 'directory', path: string) => void; chooseDirectory: (p: string) => void }) {
  const render = (prefix: string, depth: number): React.ReactNode => {
    const children = files.filter(f => f.path.startsWith(prefix));
    const dirs = [...new Set([...directories.filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length).split('/')[0]), ...children.map(f => f.path.slice(prefix.length).split('/')).filter(parts => parts.length > 1).map(parts => parts[0])])].filter(Boolean).sort((a,b) => a.localeCompare(b,'zh-CN'));
    return <>{dirs.map(directory => <details key={directory}><summary data-selected={selectedDirectory === prefix + directory} title={prefix + directory} style={{ paddingLeft: 8 + depth * 15 }} onClick={() => chooseDirectory(prefix + directory)}><Icon name="chevron" /><Icon name="folder" /><span>{directory}</span><button className="icon-button dir-rename" aria-label={'重命名目录 ' + (prefix + directory)} title="重命名" onClick={event => { event.preventDefault(); event.stopPropagation(); rename('directory', prefix + directory); }}><Icon name="pencil" /></button></summary>{render(prefix + directory + '/', depth + 1)}</details>)}{children.filter(f => !f.path.slice(prefix.length).includes('/')).map(file => <FileRow key={file.path} file={file} active={active} depth={depth} open={open} remove={remove} rename={p => rename('file', p)} />)}</>;
  };
  return render('', 0);
}

export function App() {
  const bridge = window.plainote;
  const [vault, setVault] = useState<VaultInfo | null>(null), [files, setFiles] = useState<NoteFile[]>([]), [active, setActive] = useState('');
  const [busy, setBusy] = useState(true), [message, setMessage] = useState(''), [mode, setMode] = useState<EditorMode>('live');
  const [theme, setTheme] = useState(() => localStorage.getItem('plainote-theme') || 'light');
  const [accent, setAccent] = useState(() => localStorage.getItem('plainote-accent') || 'teal');
  const [pandocPath, setPandocPath] = useState(() => localStorage.getItem('plainote-pandoc') || '');
  const [left, setLeft] = useState(true), [right, setRight] = useState(() => innerWidth > 1050), [query, setQuery] = useState('');
  const [modal, setModal] = useState<ModalState | null>(null), [quick, setQuick] = useState(''), [quickIndex, setQuickIndex] = useState(0);
  const [filename, setFilename] = useState(''), [formError, setFormError] = useState(''), [creating, setCreating] = useState(false);
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('plainote-font-size')) || 16);
  const [directories, setDirectories] = useState<string[]>([]), [selectedDirectory, setSelectedDirectory] = useState('');
  const [recoveries, setRecoveries] = useState<RecoverySnapshot[]>([]);
  const [, setVersion] = useState(0);
  const sessions = useRef(new Map<string, SaveSession>()), timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const activeRef = useRef(''), generation = useRef(0), editor = useRef<EditorView | null>(null), mounted = useRef(true);
  const transition = useRef(false), selectionRequest = useRef(0), mutationBusy = useRef(false);
  const closeAttempt = useRef(new CloseAttempt()), pendingCreate = useRef<Promise<void> | null>(null);
  const noteEpochs = useRef(new Map<string, number>());
  const pendingOpens = useRef(new Map<string, ReturnType<PlainoteBridge['read']>>());
  const refresh = useCallback(() => { if (mounted.current) setVersion(v => v + 1); }, []);
  const activeSession = sessions.current.get(active);
  const command = bridge?.platform === 'darwin' ? '⌘' : 'Ctrl';
  const select = (p: string) => { activeRef.current = p; setActive(p); if (p) setSelectedDirectory(p.includes('/') ? p.slice(0,p.lastIndexOf('/')) : ''); };
  const explain = (text: string) => { setMessage(text); };
  const refreshFiles = async () => {
    if (!bridge) return;
    const token = generation.current, result = await bridge.scan();
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
    if (!result.ok) { explain(result.error.message); return; }
    if (!sessions.current.has(p)) addSession(result.value);
    if (request !== selectionRequest.current) return;
    select(p); setMessage('');
    const recovery = await bridge.getRecovery(p);
    if (token !== generation.current || noteEpochs.current.get(p) !== epoch) return;
    if (recovery.ok && recovery.value && recovery.value.content !== result.value.content) setModal({ type: 'recovery', notePath: p, recovery: recovery.value });
  };
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
    if (info.files.length) await openNote(info.files[0].path);
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
      if (!await flushAll()) { explain('还有笔记未能保存，请先处理保存错误或保留副本，再切换笔记库。'); return; }
      const result = await bridge.chooseVault(); if (result.ok && result.value) await attachVault(result.value); else if (!result.ok) explain(result.error.message);
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
    if (!result.ok) { explain(result.error.message); return; }
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
      await refreshFiles(); refresh(); setModal(null); setMessage('');
    })().finally(() => { pendingCreate.current = null; mutationBusy.current = false; setCreating(false); });
  };
  const exportNote = async () => {
    if (!bridge || !activeSession || busy) return;
    const result = await bridge.exportDocx(activeSession.content, activeSession.path, pandocPath);
    if (!result.ok) {
      if (result.error.code === 'PANDOC_NOT_FOUND') setModal({ type: 'settings', prompt: '未找到 Pandoc，请在下方配置 pandoc 路径后再导出。' });
      else explain(result.error.message);
      return;
    }
    if (result.value) explain('已导出 Word 文档：' + result.value);
  };
  const compare = async () => {
    if (!bridge || !activeSession || transition.current) return;
    const result = await bridge.read(activeSession.path);
    if (result.ok) setModal({ type: 'conflict', notePath: activeSession.path, disk: result.value });
    else explain(result.error.message);
  };
  const useDisk = async (notePath: string, snapshot: NoteSnapshot) => {
    if (transition.current) return;
    clearTimeout(timers.current.get(notePath));
    sessions.current.get(notePath)?.acceptDisk(snapshot); await bridge!.clearRecovery(notePath); setModal(null);
  };
  const closeTab = async (p: string) => {
    const session = sessions.current.get(p); if (!session) return;
    clearTimeout(timers.current.get(p));
    if (!await session.flush()) { select(p); explain('这篇笔记还未保存。请重试，或把当前内容保留为副本。'); return; }
    sessions.current.delete(p);
    if (active === p) select(sessions.current.keys().next().value || ''); refresh();
  };
  useEffect(() => {
    mounted.current = true;
    void (async () => { if (bridge) { const result = await bridge.currentVault(); if (result.ok && result.value) await attachVault(result.value); else if (!result.ok) explain(result.error.message); } setBusy(false); })();
    return () => { mounted.current = false; for (const timer of timers.current.values()) clearTimeout(timer); };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('plainote-theme', theme);
    localStorage.setItem('plainote-accent', accent);
    const preset = THEMES.find(t => t.id === accent) || THEMES[0];
    const colors = theme === 'dark' ? preset.dark : preset.light;
    for (const [key, value] of Object.entries(colors)) document.documentElement.style.setProperty('--' + key, value);
  }, [theme, accent]);
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

  const headings = useMemo(() => extractHeadings(activeSession?.content || ''), [activeSession?.content]);
  const filtered = files.filter(file => (file.name + file.path).toLowerCase().includes(query.toLowerCase()));
  const quickMatches = files.filter(file => (file.name + file.path).toLowerCase().includes(quick.toLowerCase())).slice(0, 50);
  const selectedQuick = Math.min(quickIndex, Math.max(0, quickMatches.length - 1));
  const dirty = [...sessions.current.values()].filter(s => s.content !== s.savedContent);
  const statuses = { saved: '已保存', dirty: '未保存', saving: '正在保存', error: '保存失败', conflict: '版本冲突' };
  const closeModal = () => { if (!creating) setModal(null); };
  return <div className={'app' + (!left ? ' hide-left' : '') + (!right ? ' hide-right' : '') + (bridge?.platform === 'win32' ? ' windows' : '')} aria-busy={busy}>
    <header className="titlebar"><div className="traffic-space" /><span className="window-title">素记 <span>Plainote</span></span><div className="title-actions"><button className="icon-button" title="显示或隐藏目录" aria-label="显示或隐藏目录" aria-expanded={left} onClick={() => setLeft(!left)}><Icon name="panel-left" /></button><button className="icon-button" title="显示或隐藏大纲" aria-label="显示或隐藏大纲" aria-expanded={right} onClick={() => setRight(!right)}><Icon name="panel-right" /></button>{bridge?.platform === 'win32' && <div className="window-buttons"><button aria-label="最小化" onClick={() => bridge.minimize()}><Icon name="minimize" /></button><button aria-label="最大化或还原" onClick={() => bridge.toggleMaximize()}><Icon name="maximize" /></button><button aria-label="关闭窗口" onClick={() => bridge.closeWindow()}><Icon name="close" /></button></div>}</div></header>
    <div className="workspace" inert={busy}>
      <aside className="sidebar" aria-label="笔记目录"><button className="vault-button" disabled={busy || !bridge} onClick={() => void chooseVault()} title={vault?.root || '打开笔记文件夹'}><span className="brand-mark"><Icon name="book" /></span><span><strong>{vault?.name || '打开笔记库'}</strong><small>{vault ? '本地笔记' : '选择一个文件夹'}</small></span><Icon name="chevrons" /></button><label className="search-field"><Icon name="search" /><input aria-label="查找笔记名称" placeholder="查找笔记名称" value={query} onChange={event => setQuery(event.target.value)} /></label><button className="new-note" disabled={!vault || busy} onClick={() => openCreate()}><Icon name="plus" />新建笔记<kbd>{command} N</kbd></button><div className="section-label">文件 <span className="directory-tools"><button className="icon-button" aria-label="新建目录" title="新建目录" disabled={!vault || busy || creating} onClick={openDirectory}><Icon name="folder-plus" /></button><button className="icon-button" title="刷新目录" aria-label="刷新目录" disabled={!vault} onClick={() => void refreshFiles()}><Icon name="refresh" /></button></span></div><div className="files-pane">{busy ? <p className="empty-label">正在处理文件…</p> : query ? <>{filtered.map(file => <FileRow key={file.path} file={file} active={active} open={p => void openNote(p)} remove={p => void requestDelete(p)} rename={p => requestRename('file', p)} />)}{!filtered.length && <p className="empty-label">没有匹配的笔记，试试其他名称。</p>}</> : <FileTree files={files} directories={directories} selectedDirectory={selectedDirectory} active={active} open={p => void openNote(p)} remove={p => void requestDelete(p)} rename={requestRename} chooseDirectory={setSelectedDirectory} />}{vault && !files.length && !directories.length && !busy && <p className="empty-label">这里还没有 Markdown 笔记。<br />新建一篇，开始记录。</p>}</div>{recoveries.length > 0 && <button className="recovery-button" onClick={() => setModal({ type: 'recoveries' })}>恢复未保存内容 ({recoveries.length})</button>}<footer className="sidebar-footer"><button className="icon-button" aria-label="设置" title="设置" onClick={() => setModal({ type: 'settings' })}><Icon name="settings" /></button><button className="theme-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} />{theme === 'dark' ? '浅色模式' : '深色模式'}</button></footer></aside>
      <main className="editor-area"><div className="tabs" role="tablist" aria-label="已打开笔记">{[...sessions.current.values()].map(session => <div key={session.path} className={'tab' + (active === session.path ? ' active' : '')}><button className="tab-select" role="tab" aria-selected={active === session.path} title={session.path} onClick={() => select(session.path)}><Icon name={session.status === 'error' || session.status === 'conflict' ? 'warning' : 'file'} /><span>{nameOf(session.path)}</span>{session.content !== session.savedContent && <span className="dirty-dot" aria-label="未保存" />}</button><button className="tab-close" aria-label={'关闭 ' + nameOf(session.path)} onClick={() => void closeTab(session.path)}><Icon name="close" /></button></div>)}{vault && <button className="tab-add" aria-label="新建笔记" onClick={() => openCreate()}><Icon name="plus" /></button>}</div>
        {activeSession ? <><div className="editor-toolbar"><div className="breadcrumb" title={active}>{active.split('/').map((part, i) => <span key={i}>{i > 0 && <Icon name="chevron" />}{part.replace(/\.md$/i, '')}</span>)}</div><div className="editor-actions"><div className="editor-modes" role="group" aria-label="正文显示模式"><button className="mode-button" aria-pressed={mode === 'live'} onClick={() => setMode('live')}>即时预览</button><button className="mode-button" aria-pressed={mode === 'source'} onClick={() => setMode('source')}><Icon name="code" />源码</button><button className="mode-button" aria-pressed={mode === 'read'} onClick={() => setMode('read')}><Icon name="book" />阅读模式</button></div><button className="icon-button" aria-label="删除当前笔记" title="删除当前笔记" onClick={() => void requestDelete(active)}><Icon name="trash" /></button><button className="icon-button" aria-label="导出 DOCX" title="导出 DOCX" onClick={() => void exportNote()}><Icon name="export" /></button></div></div>{(activeSession.error || message) && <div className={'notice' + (activeSession.error ? ' error' : '')} role="status"><Icon name="warning" /><p>{activeSession.error?.message || message}</p>{activeSession.status === 'conflict' ? <button onClick={() => void compare()}>比较版本</button> : activeSession.error ? <button onClick={() => void activeSession.flush()}>重试保存</button> : <button aria-label="关闭提示" onClick={() => setMessage('')}><Icon name="close" /></button>}{activeSession.error && <button onClick={() => openCreate(activeSession.content, activeSession.path)}>另存为副本</button>}</div>}<Editor path={active} content={activeSession.content} mode={mode} readOnly={busy} onChange={edit} onReady={view => { editor.current = view; }} /></> : <section className="welcome"><span className="welcome-mark"><Icon name="book" /></span><h1>{vault ? '从一篇笔记开始。' : '让笔记回到你手中。'}</h1><p>{vault ? '新建笔记，或从左侧目录打开已有内容。' : '打开本地文件夹，继续使用你的 Markdown 笔记。'}</p><button className="primary-button" disabled={busy || !bridge} onClick={() => vault ? openCreate() : void chooseVault()}>{busy ? '正在加载…' : vault ? '新建笔记' : '打开笔记文件夹'}</button><small>{bridge ? '笔记直接保存在本地，无需导入转换。' : '请通过 npm run dev 启动桌面应用以访问本地文件。'}</small>{message && <p className="welcome-error" role="status">{message}</p>}</section>}</main>
      <aside className="inspector" aria-label="笔记大纲"><div className="inspector-heading">大纲</div><nav className="outline" aria-label="当前笔记大纲">{headings.map((heading, index) => <button key={index} style={{ paddingLeft: 11 + Math.min(heading.level - 1, 3) * 10 }} onClick={() => { const view = editor.current; if (view && heading.line <= view.state.doc.lines) { const line = view.state.doc.line(heading.line); view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start' }) }); view.focus(); } }}>{heading.text}</button>)}{!headings.length && <p className="empty-label">添加标题后，可以在这里浏览笔记结构。</p>}</nav><p className="inspector-tip">正文直接使用 Markdown。<br />需要精确编辑时，可切换源码模式。</p></aside>
    </div>
    <footer className="statusbar"><span className={'save-status' + (activeSession?.error ? ' failed' : '')}><Icon name={activeSession?.error ? 'warning' : 'check'} />{activeSession ? statuses[activeSession.status] : '本地笔记'}{dirty.length > 1 && ` · ${dirty.length} 篇待保存`}</span><span className="vault-path" title={vault?.root}>{vault?.root}</span><div><span>{activeSession ? `${activeSession.content.replace(/\s/g, '').length} 字` : `${files.length} 篇笔记`}</span>{activeSession && <span>{mode === 'source' ? '源码模式' : mode === 'read' ? '阅读模式 · 正文只读' : '即时预览'}</span>}</div></footer>
    {modal && <Modal title={modal.type === 'quick' ? '快速打开笔记' : modal.type === 'settings' ? '设置' : modal.type === 'create' ? '新建笔记' : modal.type === 'conflict' ? '这篇笔记有两个版本' : modal.type === 'directory' ? '新建目录' : modal.type === 'delete' ? '删除笔记' : modal.type === 'rename' ? (modal.kind === 'file' ? '重命名笔记' : '重命名目录') : modal.type === 'recoveries' ? '恢复未保存内容' : '发现未保存的恢复内容'} close={closeModal}><fieldset className="modal-controls" disabled={busy}>
      {modal.type === 'quick' && <><input className="quick-input" autoFocus aria-label="快速打开笔记" placeholder="输入笔记名称或路径…" value={quick} onChange={event => { setQuick(event.target.value); setQuickIndex(0); }} onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) event.preventDefault(); if (event.key === 'ArrowDown') setQuickIndex(Math.min(selectedQuick + 1, quickMatches.length - 1)); if (event.key === 'ArrowUp') setQuickIndex(Math.max(0, selectedQuick - 1)); if (event.key === 'Enter' && quickMatches[selectedQuick]) { void openNote(quickMatches[selectedQuick].path); setModal(null); } }} /><div className="quick-results">{quickMatches.map((file, i) => <button key={file.path} className={'quick-row' + (i === selectedQuick ? ' current' : '')} onClick={() => { void openNote(file.path); setModal(null); }}><Icon name="file" /><span>{file.name}<small>{file.path}</small></span></button>)}{!quickMatches.length && <p className="empty-label">没有匹配的笔记。</p>}</div><p className="dialog-copy">方向键选择，回车打开，Esc 关闭。</p></>}
      {modal.type === 'settings' && <><p className="dialog-copy">调整适合自己的阅读与工作环境。</p>{modal.prompt && <p className="form-error" role="alert">{modal.prompt}</p>}<div className="setting-row"><div><strong>外观</strong><small>暖白与墨色为底，深浅随环境切换。</small></div><div className="segmented"><button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>浅色</button><button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>深色</button></div></div><div className="setting-row"><div><strong>主题色</strong><small>选择界面的强调色。</small></div><div className="accent-swatches">{THEMES.map(a => <button key={a.id} className="accent-swatch" style={{ background: (theme === 'dark' ? a.dark : a.light).accent }} aria-pressed={accent === a.id} aria-label={'主题色 ' + a.name} title={a.name} onClick={() => setAccent(a.id)} />)}</div></div><div className="setting-row"><div><strong>Pandoc 路径</strong><small>导出 Word 文档使用，留空则用系统 PATH 中的 pandoc。</small></div><input className="pandoc-input" aria-label="Pandoc 路径" placeholder="pandoc 或 /usr/local/bin/pandoc" value={pandocPath} onChange={event => { const v = event.target.value; setPandocPath(v); localStorage.setItem('plainote-pandoc', v); }} /></div><div className="setting-row"><div><strong>正文字号</strong><small>{fontSize} px</small></div><input aria-label="正文字号" type="range" min="14" max="22" value={fontSize} onChange={event => setFontSize(Number(event.target.value))} /></div><div className="setting-row"><div><strong>当前笔记库</strong><small className="settings-path">{vault?.root || '还未打开'}</small></div></div></>}
      {modal.type === 'directory' && <form onSubmit={makeDirectory}><p className="dialog-copy">目录保存在当前笔记库中。使用 / 分隔可创建嵌套目录。</p><label className="form-label">目录名称<input autoFocus value={filename} onChange={event => setFilename(event.target.value)} aria-label="目录名称" disabled={creating} /></label>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-buttons"><button type="button" className="secondary-button" disabled={creating} onClick={closeModal}>取消</button><button className="primary-button" disabled={creating}>{creating ? '正在创建…' : '创建目录'}</button></div></form>}
      {modal.type === 'delete' && <><p className="dialog-copy">将先保存当前编辑，再把这篇笔记移到系统回收站。需要时可从回收站恢复。</p><p className="delete-path">{modal.notePath}</p>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-buttons"><button className="secondary-button" disabled={creating} onClick={closeModal}>取消</button><button className="danger-button" disabled={creating} onClick={deleteNote}>{creating ? '正在删除…' : '移到回收站'}</button></div></>}
      {modal.type === 'rename' && <form onSubmit={event => { event.preventDefault(); void renameWork(); }}><p className="dialog-copy">重命名后，目录中的笔记会跟随新路径。</p><label className="form-label">{modal.kind === 'file' ? '笔记名称' : '目录名称'}<input autoFocus value={filename} onChange={event => setFilename(event.target.value)} aria-label={modal.kind === 'file' ? '笔记名称' : '目录名称'} disabled={creating} /></label>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-buttons"><button type="button" className="secondary-button" disabled={creating} onClick={closeModal}>取消</button><button className="primary-button" disabled={creating}>{creating ? '正在重命名…' : '重命名'}</button></div></form>}
      {modal.type === 'create' && <form onSubmit={event => void create(event)}><p className="dialog-copy">文件将保存在当前笔记库中。可以指定已有目录中的相对路径。</p><label className="form-label">笔记名称<input autoFocus value={filename} onChange={event => setFilename(event.target.value)} aria-label="笔记名称" placeholder="未命名笔记.md" disabled={creating} /></label>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-buttons"><button type="button" className="secondary-button" disabled={creating} onClick={closeModal}>取消</button><button className="primary-button" disabled={creating}>{creating ? '正在创建…' : '创建笔记'}</button></div></form>}
      {modal.type === 'conflict' && <><p className="dialog-copy">外部修改与当前编辑都需要保留。另存为副本会保留你的内容，并重新载入原文件的磁盘版本。</p><div className="conflict-versions"><section><strong>当前编辑内容</strong><pre>{sessions.current.get(modal.notePath)?.content}</pre></section><section><strong>磁盘上的内容</strong><pre>{modal.disk.content}</pre></section></div><div className="dialog-buttons"><button className="secondary-button" onClick={() => void useDisk(modal.notePath, modal.disk)}>使用磁盘版本</button><button className="primary-button" onClick={() => openCreate(sessions.current.get(modal.notePath)!.content, modal.notePath)}>保留我的内容为副本</button></div></>}
      {modal.type === 'recoveries' && <><p className="dialog-copy">这些编辑尚未保存。即使原笔记已经被删除，也可以把恢复内容保存为新笔记。</p>{recoveries.map(recovery => <button className="quick-row" key={recovery.path} onClick={() => { if (files.some(file => file.path === recovery.path)) { void openNote(recovery.path).then(() => setModal({ type: 'recovery', notePath: recovery.path, recovery })); } else openCreate(recovery.content, undefined, recovery.path); }}><Icon name="file" /><span>{nameOf(recovery.path)}<small>{recovery.path}</small></span></button>)}</>}
      {modal.type === 'recovery' && <><p className="dialog-copy">上次编辑的内容尚未保存到这篇笔记。你可以恢复编辑，或保留磁盘上的版本。</p><pre className="recovery-preview">{modal.recovery.content}</pre><div className="dialog-buttons"><button className="secondary-button" onClick={() => { if (transition.current) return; void bridge!.clearRecovery(modal.notePath); setModal(null); }}>保留磁盘版本</button><button className="primary-button" onClick={() => { if (transition.current) return; const session = sessions.current.get(modal.notePath)!; session.edit(modal.recovery.content); if (modal.recovery.baseRevision !== session.revision) { session.status = 'conflict'; session.error = { code: 'CONFLICT', message: '恢复内容与磁盘版本存在差异，请比较后选择保留方式。' }; refresh(); } else schedule(session); select(modal.notePath); setModal(null); }}>恢复编辑</button></div></>}
    </fieldset></Modal>}
  </div>;
}
