import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { Editor } from './Editor.tsx';
import { Icon } from './icons.tsx';
import { SaveSession } from '../shared/save-session.ts';
import { CloseAttempt } from '../shared/close-attempt.ts';
import { flushSessions } from '../shared/flush-sessions.ts';
import { extractHeadings } from './preview.ts';
import type { NoteFile, NoteSnapshot, PlainoteBridge, RecoverySnapshot, VaultInfo } from '../shared/types.ts';

declare global { interface Window { plainote?: PlainoteBridge } }
type ModalState = { type: 'quick' } | { type: 'settings' } | { type: 'create'; content: string; suggested: string; original?: string; recoveryPath?: string } | { type: 'conflict'; notePath: string; disk: NoteSnapshot } | { type: 'recovery'; notePath: string; recovery: RecoverySnapshot } | { type: 'recoveries' };
const isSaving = (session: SaveSession) => session.status === 'saving';
const nameOf = (p: string) => p.split('/').at(-1)!.replace(/\.md$/i, '');

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} onCancel={close} aria-label={title} onClick={event => { if (event.target === ref.current) { const box = ref.current!.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(); } }}>
    <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={close}><Icon name="close" /></button></div><div className="dialog-body">{children}</div>
  </dialog>;
}
function FileTree({ files, active, open }: { files: NoteFile[]; active: string; open: (p: string) => void }) {
  const render = (prefix: string, depth: number): React.ReactNode => {
    const children = files.filter(f => f.path.startsWith(prefix));
    const directories = [...new Set(children.map(f => f.path.slice(prefix.length).split('/')).filter(parts => parts.length > 1).map(parts => parts[0]))];
    return <>{directories.map(directory => <details key={directory} open><summary style={{ paddingLeft: 8 + depth * 15 }}><Icon name="chevron" /><Icon name="folder" /><span>{directory}</span></summary>{render(prefix + directory + '/', depth + 1)}</details>)}{children.filter(f => !f.path.slice(prefix.length).includes('/')).map(file => <button key={file.path} className={'file-row' + (active === file.path ? ' selected' : '')} style={{ paddingLeft: 9 + depth * 15 }} title={file.path} aria-current={active === file.path ? 'page' : undefined} onClick={() => open(file.path)}><Icon name="file" /><span>{file.name}</span></button>)}</>;
  };
  return render('', 0);
}

export function App() {
  const bridge = window.plainote;
  const [vault, setVault] = useState<VaultInfo | null>(null), [files, setFiles] = useState<NoteFile[]>([]), [active, setActive] = useState('');
  const [busy, setBusy] = useState(true), [message, setMessage] = useState(''), [source, setSource] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('plainote-theme') || 'light');
  const [left, setLeft] = useState(true), [right, setRight] = useState(() => innerWidth > 1050), [query, setQuery] = useState('');
  const [modal, setModal] = useState<ModalState | null>(null), [quick, setQuick] = useState(''), [quickIndex, setQuickIndex] = useState(0);
  const [filename, setFilename] = useState(''), [formError, setFormError] = useState(''), [creating, setCreating] = useState(false);
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('plainote-font-size')) || 16);
  const [recoveries, setRecoveries] = useState<RecoverySnapshot[]>([]);
  const [, setVersion] = useState(0);
  const sessions = useRef(new Map<string, SaveSession>()), timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const activeRef = useRef(''), generation = useRef(0), editor = useRef<EditorView | null>(null), mounted = useRef(true);
  const transition = useRef(false), selectionRequest = useRef(0);
  const closeAttempt = useRef(new CloseAttempt()), pendingCreate = useRef<Promise<void> | null>(null);
  const pendingOpens = useRef(new Map<string, ReturnType<PlainoteBridge['read']>>());
  const refresh = useCallback(() => { if (mounted.current) setVersion(v => v + 1); }, []);
  const activeSession = sessions.current.get(active);
  const command = bridge?.platform === 'darwin' ? '⌘' : 'Ctrl';
  const select = (p: string) => { activeRef.current = p; setActive(p); };
  const explain = (text: string) => { setMessage(text); };
  const refreshFiles = async () => {
    if (!bridge) return;
    const token = generation.current, result = await bridge.scan();
    if (token === generation.current && result.ok) setFiles(result.value);
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
    const token = generation.current;
    let pending = pendingOpens.current.get(p);
    if (!pending) { pending = bridge.read(p); pendingOpens.current.set(p, pending); }
    const result = await pending;
    if (pendingOpens.current.get(p) === pending) pendingOpens.current.delete(p);
    if (token !== generation.current) return;
    if (!result.ok) { explain(result.error.message); return; }
    if (!sessions.current.has(p)) addSession(result.value);
    if (request !== selectionRequest.current) return;
    select(p); setMessage('');
    const recovery = await bridge.getRecovery(p);
    if (token !== generation.current) return;
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
    selectionRequest.current++; pendingOpens.current.clear();
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear(); sessions.current.clear(); select('');
    setVault(info); setFiles(info.files); setQuery(''); setMessage(''); setModal(null);
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
    if (transition.current) return;
    if (!vault) { explain('请先打开一个笔记文件夹。'); return; }
    const directory = active.includes('/') ? active.slice(0, active.lastIndexOf('/') + 1) : '';
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
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('plainote-theme', theme); }, [theme]);
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
      if (closeAttempt.current.cancel(requestId)) { transition.current = false; setBusy(false); }
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
      if (!session || checking || isSaving(session) || document.hidden) return;
      checking = true;
      const token = generation.current, expected = session.revision;
      try {
        const disk = await bridge.read(session.path);
        if (token !== generation.current || session.revision !== expected || isSaving(session)) return;
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
      <aside className="sidebar" aria-label="笔记目录"><button className="vault-button" disabled={busy || !bridge} onClick={() => void chooseVault()} title={vault?.root || '打开笔记文件夹'}><span className="brand-mark"><Icon name="book" /></span><span><strong>{vault?.name || '打开笔记库'}</strong><small>{vault ? '本地笔记' : '选择一个文件夹'}</small></span><Icon name="chevrons" /></button><label className="search-field"><Icon name="search" /><input aria-label="查找笔记名称" placeholder="查找笔记名称" value={query} onChange={event => setQuery(event.target.value)} /></label><button className="new-note" disabled={!vault || busy} onClick={() => openCreate()}><Icon name="plus" />新建笔记<kbd>{command} N</kbd></button><div className="section-label">文件 <button className="icon-button" title="刷新目录" aria-label="刷新目录" disabled={!vault} onClick={() => void refreshFiles()}><Icon name="refresh" /></button></div><div className="files-pane">{busy ? <p className="empty-label">正在打开笔记库…</p> : query ? <>{filtered.map(file => <button key={file.path} className={'file-row' + (active === file.path ? ' selected' : '')} onClick={() => void openNote(file.path)} title={file.path}><Icon name="file" /><span>{file.name}</span></button>)}{!filtered.length && <p className="empty-label">没有匹配的笔记，试试其他名称。</p>}</> : <FileTree files={files} active={active} open={p => void openNote(p)} />}{vault && !files.length && !busy && <p className="empty-label">这里还没有 Markdown 笔记。<br />新建一篇，开始记录。</p>}</div>{recoveries.length > 0 && <button className="recovery-button" onClick={() => setModal({ type: 'recoveries' })}>恢复未保存内容 ({recoveries.length})</button>}<footer className="sidebar-footer"><button className="icon-button" aria-label="设置" title="设置" onClick={() => setModal({ type: 'settings' })}><Icon name="settings" /></button><button className="theme-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} />{theme === 'dark' ? '浅色模式' : '深色模式'}</button></footer></aside>
      <main className="editor-area"><div className="tabs" role="tablist" aria-label="已打开笔记">{[...sessions.current.values()].map(session => <div key={session.path} className={'tab' + (active === session.path ? ' active' : '')}><button className="tab-select" role="tab" aria-selected={active === session.path} title={session.path} onClick={() => select(session.path)}><Icon name={session.status === 'error' || session.status === 'conflict' ? 'warning' : 'file'} /><span>{nameOf(session.path)}</span>{session.content !== session.savedContent && <span className="dirty-dot" aria-label="未保存" />}</button><button className="tab-close" aria-label={'关闭 ' + nameOf(session.path)} onClick={() => void closeTab(session.path)}><Icon name="close" /></button></div>)}{vault && <button className="tab-add" aria-label="新建笔记" onClick={() => openCreate()}><Icon name="plus" /></button>}</div>
        {activeSession ? <><div className="editor-toolbar"><div className="breadcrumb" title={active}>{active.split('/').map((part, i) => <span key={i}>{i > 0 && <Icon name="chevron" />}{part.replace(/\.md$/i, '')}</span>)}</div><button className="mode-button" aria-pressed={source} onClick={() => setSource(!source)}><Icon name="code" />{source ? '即时预览' : '源码'}</button></div>{(activeSession.error || message) && <div className={'notice' + (activeSession.error ? ' error' : '')} role="status"><Icon name="warning" /><p>{activeSession.error?.message || message}</p>{activeSession.status === 'conflict' ? <button onClick={() => void compare()}>比较版本</button> : activeSession.error ? <button onClick={() => void activeSession.flush()}>重试保存</button> : <button aria-label="关闭提示" onClick={() => setMessage('')}><Icon name="close" /></button>}{activeSession.error && <button onClick={() => openCreate(activeSession.content, activeSession.path)}>另存为副本</button>}</div>}<div className="note-meta"><span>{vault?.name}</span><span>Markdown</span></div><Editor path={active} content={activeSession.content} source={source} readOnly={busy} onChange={edit} onReady={view => { editor.current = view; }} /></> : <section className="welcome"><span className="welcome-mark"><Icon name="book" /></span><h1>{vault ? '从一篇笔记开始。' : '让笔记回到你手中。'}</h1><p>{vault ? '新建笔记，或从左侧目录打开已有内容。' : '打开本地文件夹，继续使用你的 Markdown 笔记。'}</p><button className="primary-button" disabled={busy || !bridge} onClick={() => vault ? openCreate() : void chooseVault()}>{busy ? '正在加载…' : vault ? '新建笔记' : '打开笔记文件夹'}</button><small>{bridge ? '笔记直接保存在本地，无需导入转换。' : '请通过 npm run dev 启动桌面应用以访问本地文件。'}</small>{message && <p className="welcome-error" role="status">{message}</p>}</section>}</main>
      <aside className="inspector" aria-label="笔记大纲"><div className="inspector-heading">大纲</div><nav className="outline" aria-label="当前笔记大纲">{headings.map((heading, index) => <button key={index} style={{ paddingLeft: 11 + Math.min(heading.level - 1, 3) * 10 }} onClick={() => { const view = editor.current; if (view && heading.line <= view.state.doc.lines) { const line = view.state.doc.line(heading.line); view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start' }) }); view.focus(); } }}>{heading.text}</button>)}{!headings.length && <p className="empty-label">添加标题后，可以在这里浏览笔记结构。</p>}</nav><p className="inspector-tip">正文直接使用 Markdown。<br />需要精确编辑时，可切换源码模式。</p></aside>
    </div>
    <footer className="statusbar"><span className={'save-status' + (activeSession?.error ? ' failed' : '')}><Icon name={activeSession?.error ? 'warning' : 'check'} />{activeSession ? statuses[activeSession.status] : '本地笔记'}{dirty.length > 1 && ` · ${dirty.length} 篇待保存`}</span><span className="vault-path" title={vault?.root}>{vault?.root}</span><div><span>{activeSession ? `${activeSession.content.replace(/\s/g, '').length} 字` : `${files.length} 篇笔记`}</span>{activeSession && <button onClick={() => setSource(!source)}>{source ? '源码模式' : '即时预览'}</button>}</div></footer>
    {modal && <Modal title={modal.type === 'quick' ? '快速打开笔记' : modal.type === 'settings' ? '设置' : modal.type === 'create' ? '新建笔记' : modal.type === 'conflict' ? '这篇笔记有两个版本' : modal.type === 'recoveries' ? '恢复未保存内容' : '发现未保存的恢复内容'} close={closeModal}><fieldset className="modal-controls" disabled={busy}>
      {modal.type === 'quick' && <><input className="quick-input" autoFocus aria-label="快速打开笔记" placeholder="输入笔记名称或路径…" value={quick} onChange={event => { setQuick(event.target.value); setQuickIndex(0); }} onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) event.preventDefault(); if (event.key === 'ArrowDown') setQuickIndex(Math.min(selectedQuick + 1, quickMatches.length - 1)); if (event.key === 'ArrowUp') setQuickIndex(Math.max(0, selectedQuick - 1)); if (event.key === 'Enter' && quickMatches[selectedQuick]) { void openNote(quickMatches[selectedQuick].path); setModal(null); } }} /><div className="quick-results">{quickMatches.map((file, i) => <button key={file.path} className={'quick-row' + (i === selectedQuick ? ' current' : '')} onClick={() => { void openNote(file.path); setModal(null); }}><Icon name="file" /><span>{file.name}<small>{file.path}</small></span></button>)}{!quickMatches.length && <p className="empty-label">没有匹配的笔记。</p>}</div><p className="dialog-copy">方向键选择，回车打开，Esc 关闭。</p></>}
      {modal.type === 'settings' && <><p className="dialog-copy">调整适合自己的阅读与工作环境。</p><div className="setting-row"><div><strong>外观</strong><small>沿用暖白、墨色与青绿色的层级。</small></div><div className="segmented"><button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>浅色</button><button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>深色</button></div></div><div className="setting-row"><div><strong>正文字号</strong><small>{fontSize} px</small></div><input aria-label="正文字号" type="range" min="14" max="22" value={fontSize} onChange={event => setFontSize(Number(event.target.value))} /></div><div className="setting-row"><div><strong>当前笔记库</strong><small className="settings-path">{vault?.root || '还未打开'}</small></div></div></>}
      {modal.type === 'create' && <form onSubmit={event => void create(event)}><p className="dialog-copy">文件将保存在当前笔记库中。可以指定已有目录中的相对路径。</p><label className="form-label">笔记名称<input autoFocus value={filename} onChange={event => setFilename(event.target.value)} aria-label="笔记名称" placeholder="未命名笔记.md" disabled={creating} /></label>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-buttons"><button type="button" className="secondary-button" disabled={creating} onClick={closeModal}>取消</button><button className="primary-button" disabled={creating}>{creating ? '正在创建…' : '创建笔记'}</button></div></form>}
      {modal.type === 'conflict' && <><p className="dialog-copy">外部修改与当前编辑都需要保留。另存为副本会保留你的内容，并重新载入原文件的磁盘版本。</p><div className="conflict-versions"><section><strong>当前编辑内容</strong><pre>{sessions.current.get(modal.notePath)?.content}</pre></section><section><strong>磁盘上的内容</strong><pre>{modal.disk.content}</pre></section></div><div className="dialog-buttons"><button className="secondary-button" onClick={() => void useDisk(modal.notePath, modal.disk)}>使用磁盘版本</button><button className="primary-button" onClick={() => openCreate(sessions.current.get(modal.notePath)!.content, modal.notePath)}>保留我的内容为副本</button></div></>}
      {modal.type === 'recoveries' && <><p className="dialog-copy">这些编辑尚未保存。即使原笔记已经被删除，也可以把恢复内容保存为新笔记。</p>{recoveries.map(recovery => <button className="quick-row" key={recovery.path} onClick={() => { if (files.some(file => file.path === recovery.path)) { void openNote(recovery.path).then(() => setModal({ type: 'recovery', notePath: recovery.path, recovery })); } else openCreate(recovery.content, undefined, recovery.path); }}><Icon name="file" /><span>{nameOf(recovery.path)}<small>{recovery.path}</small></span></button>)}</>}
      {modal.type === 'recovery' && <><p className="dialog-copy">上次编辑的内容尚未保存到这篇笔记。你可以恢复编辑，或保留磁盘上的版本。</p><pre className="recovery-preview">{modal.recovery.content}</pre><div className="dialog-buttons"><button className="secondary-button" onClick={() => { if (transition.current) return; void bridge!.clearRecovery(modal.notePath); setModal(null); }}>保留磁盘版本</button><button className="primary-button" onClick={() => { if (transition.current) return; const session = sessions.current.get(modal.notePath)!; session.edit(modal.recovery.content); if (modal.recovery.baseRevision !== session.revision) { session.status = 'conflict'; session.error = { code: 'CONFLICT', message: '恢复内容与磁盘版本存在差异，请比较后选择保留方式。' }; refresh(); } else schedule(session); select(modal.notePath); setModal(null); }}>恢复编辑</button></div></>}
    </fieldset></Modal>}
  </div>;
}
