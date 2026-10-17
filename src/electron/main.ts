import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { VaultService, VaultError } from './vault.ts';
import { readAiConfig, saveAiConfig, searchNotes, streamChat } from './ai.ts';
import { readAttachmentConfig, saveAttachmentConfig, attachmentRelativeDir } from './attachments.ts';
import { relocateWithReferences, resolveImages, resolveLinkTarget, resolveTarget } from './maintenance.ts';
import { relativeLink, encodeMarkdownUrl } from '../shared/references.ts';
import { INDEX_FILE } from '../shared/ai.ts';
import type { AiChatMessage, AiConfig, AiContext, AiNoteContext } from '../shared/ai.ts';
import type { AttachmentConfig, Result, VaultInfo } from '../shared/types.ts';

const directory = path.dirname(fileURLToPath(import.meta.url));
// 打包后 build/ 不会进入 app.asar：图标通过 electron-builder 的 extraResources 复制到 resources/，开发模式回退到项目 build/ 目录。
function resolveIcon(): string | null {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const packaged = path.join(process.resourcesPath, file);
  if (existsSync(packaged)) return packaged;
  const dev = path.join(directory, '..', '..', 'build', file);
  return existsSync(dev) ? dev : null;
}
// Pandoc 模板经 extraResources 复制到 resources/pandoc/，开发模式回退到项目 resources/pandoc/ 目录。
function resolveTemplate(name: string): string | null {
  const packaged = path.join(process.resourcesPath, 'pandoc', name);
  if (existsSync(packaged)) return packaged;
  const dev = path.join(directory, '..', '..', 'resources', 'pandoc', name);
  return existsSync(dev) ? dev : null;
}
const iconPath = resolveIcon();
const windowIcon = iconPath ? { icon: iconPath } : {};
protocol.registerSchemesAsPrivileged([{ scheme: 'plainote-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
if (process.env.PLAINOTE_DATA_DIR) app.setPath('userData', process.env.PLAINOTE_DATA_DIR);
app.setName('素记');
let window: BrowserWindow | null = null, vault: VaultService | null = null;
let mayClose = false, closePending = false, closeTimer: ReturnType<typeof setTimeout> | undefined;
let quitRequested = false, closeAttempt = 0, closePromptOpen = false;
app.on('before-quit', () => { quitRequested = true; });
const userFile = () => path.join(app.getPath('userData'), 'preferences.json');
const recoveryDir = () => path.join(app.getPath('userData'), 'recovery');
const attachmentStore = () => path.join(app.getPath('userData'), 'attachment-config.json');
function mimeFor(filename: string): string {
  const map: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac' };
  return map[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}
async function vaultInfo(): Promise<VaultInfo | null> { return vault ? { root: vault.root, name: path.basename(vault.root), files: await vault.scanEntries(), directories: await vault.directories() } : null; }
function requireVault(): VaultService { if (!vault) throw new VaultError('NO_VAULT', '请先打开一个笔记文件夹。'); return vault; }
function validateSender(event: { sender: Electron.WebContents; senderFrame?: Electron.WebFrameMain | null }) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new VaultError('INVALID_PATH', '不允许从其他页面访问笔记库。');
}
function contentArgs(relative: unknown, content: unknown, revision?: unknown) {
  if (typeof relative !== 'string' || typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 20 * 1024 * 1024 || (revision !== undefined && (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)))) throw new VaultError('INVALID_PATH', '笔记内容或版本信息无效。');
}
function register<T>(channel: string, handler: (...args: any[]) => Promise<T>) {
  ipcMain.handle('plainote:' + channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<Result<T>> => {
    try { validateSender(event); return { ok: true, value: await handler(...args) }; }
    catch (error) {
      const cause = error as NodeJS.ErrnoException;
      const code = error instanceof VaultError ? error.code : 'IO';
      const message = error instanceof VaultError ? error.message : cause.code === 'EACCES' || cause.code === 'EPERM' ? '没有写入权限。编辑内容仍保留，请检查文件夹权限或另存为。' : cause.code === 'ENOENT' ? '文件或目录已经不存在。' : '文件操作失败：' + cause.message;
      return { ok: false, error: { code, message } };
    }
  });
}
async function rememberVault() {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(userFile(), JSON.stringify({ recentVault: vault?.root }), 'utf8');
}
async function chooseVault(): Promise<VaultInfo | null> {
  const selection = await dialog.showOpenDialog(window!, { title: '打开笔记库', buttonLabel: '打开笔记库', properties: ['openDirectory'] });
  if (selection.canceled || !selection.filePaths[0]) return null;
  const next = await VaultService.open(selection.filePaths[0], recoveryDir());
  const files = await next.scanEntries(), directories = await next.directories();
  vault = next;
  // A preference write must not make a successfully opened vault appear to fail.
  await rememberVault().catch(() => {});
  return { root: next.root, name: path.basename(next.root), files, directories };
}
register('choose-vault', chooseVault);
register('current-vault', vaultInfo);
register('directories', () => requireVault().directories());
register('create-directory', (relative: string) => requireVault().createDirectory(relative));
register('rename', (relative: string, newRelative: string) => { if (typeof relative !== 'string' || typeof newRelative !== 'string') throw new VaultError('INVALID_PATH', '重命名路径无效。'); return relocateWithReferences(requireVault(), relative, newRelative); });
register('trash', (relative: string, revision: string) => { contentArgs(relative, '', revision); return requireVault().trash(relative, revision, filename => shell.trashItem(filename)); });
register('scan', () => requireVault().scan());
register('scan-entries', () => requireVault().scanEntries());
register('open-path', async (relative: unknown) => {
  if (typeof relative !== 'string') throw new VaultError('INVALID_PATH', '打开路径无效。');
  const absolute = await requireVault().resolveResource(relative);
  const result = await shell.openPath(absolute);
  if (result) throw new VaultError('IO', '无法打开附件：' + result);
});
register('read-text', async (relative: unknown) => {
  if (typeof relative !== 'string') throw new VaultError('INVALID_PATH', '读取路径无效。');
  const absolute = await requireVault().resolveResource(relative);
  const info = await stat(absolute);
  if (info.size > 2 * 1024 * 1024) throw new VaultError('TOO_LARGE', '附件超过 2 MB，无法在应用内预览文本。');
  return (await readFile(absolute)).toString('utf8');
});
register('read', (relative: string) => requireVault().read(relative));
register('save', (relative: string, content: string, revision: string) => { contentArgs(relative, content, revision); return requireVault().save(relative, content, revision); });
register('create', (relative: string, content: string) => { contentArgs(relative, content); return requireVault().create(relative, content); });
register('stage-recovery', (relative: string, content: string, revision: string) => { contentArgs(relative, content, revision); return requireVault().stageRecovery(relative, content, revision); });
register('get-recovery', (relative: string) => requireVault().getRecovery(relative));
register('recoveries', () => requireVault().listRecovery());
register('clear-recovery', (relative: string) => requireVault().clearRecovery(relative));
register('attachment-get-config', () => readAttachmentConfig(attachmentStore(), requireVault().root));
register('attachment-set-config', (config: AttachmentConfig) => { if (typeof config !== 'object' || config === null) throw new VaultError('INVALID_PATH', '附件配置无效。'); return saveAttachmentConfig(attachmentStore(), requireVault().root, config); });
register('import-attachment', async (filename: unknown, bytes: unknown, notePath: unknown) => {
  if (typeof filename !== 'string' || typeof notePath !== 'string' || !(bytes instanceof Uint8Array)) throw new VaultError('INVALID_PATH', '附件导入参数无效。');
  if (bytes.byteLength > 50 * 1024 * 1024) throw new VaultError('TOO_LARGE', '附件超过 50 MB，无法导入。');
  const vault = requireVault();
  const config = await readAttachmentConfig(attachmentStore(), vault.root);
  const relDir = attachmentRelativeDir(config, notePath);
  const name = await vault.writeAttachment(relDir, filename, Buffer.from(bytes));
  const vaultRel = relDir ? relDir + '/' + name : name;
  const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
  return { path: encodeMarkdownUrl(relativeLink(noteDir, vaultRel)) };
});
register('open-attachment', async (target: unknown, notePath: unknown) => {
  if (typeof target !== 'string' || typeof notePath !== 'string') throw new VaultError('INVALID_PATH', '打开附件参数无效。');
  const absolute = await resolveLinkTarget(requireVault(), notePath, target);
  if (!absolute) throw new VaultError('NOT_FOUND', '找不到要打开的附件。');
  const result = await shell.openPath(absolute);
  if (result) throw new VaultError('IO', '无法打开附件：' + result);
});
register('open-external', async (url: unknown) => {
  if (typeof url !== 'string' || !/^https?:/i.test(url)) throw new VaultError('INVALID_PATH', '仅允许打开 http(s) 链接。');
  await shell.openExternal(url);
});
register('resolve-target', async (target: unknown, notePath: unknown) => {
  if (typeof target !== 'string' || typeof notePath !== 'string') throw new VaultError('INVALID_PATH', '解析目标参数无效。');
  return resolveTarget(requireVault(), notePath, target);
});
register('resolve-images', async (notePath: unknown, content: unknown) => {
  if (typeof notePath !== 'string' || typeof content !== 'string') throw new VaultError('INVALID_PATH', '解析图片参数无效。');
  return resolveImages(requireVault(), notePath, content);
});
register('count-directory', (relative: string) => requireVault().countDirectory(relative));
register('move', async (relative: unknown, targetDir: unknown) => {
  if (typeof relative !== 'string' || typeof targetDir !== 'string') throw new VaultError('INVALID_PATH', '移动参数无效。');
  const base = relative.split('/').at(-1)!;
  const to = targetDir ? targetDir + '/' + base : base;
  return relocateWithReferences(requireVault(), relative, to);
});
register('trash-directory', (relative: string) => { if (typeof relative !== 'string') throw new VaultError('INVALID_PATH', '目录路径无效。'); return requireVault().trashDirectory(relative, filename => shell.trashItem(filename)); });

function runPandoc(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = '';
    proc.stderr.on('data', chunk => { stderr += chunk; });
    proc.on('error', error => reject(new VaultError('IO', '无法运行 Pandoc：' + error.message)));
    proc.on('close', code => { if (code === 0) resolve(); else reject(new VaultError('IO', 'Pandoc 转换失败：' + (stderr.trim() || '未知错误'))); });
  });
}
function pandocAvailable(cmd: string): Promise<boolean> {
  return new Promise(resolve => {
    let stdout = '';
    const proc = spawn(cmd, ['--version']);
    proc.stdout.on('data', chunk => { stdout += chunk; });
    proc.on('error', () => resolve(false));
    const timer = setTimeout(() => { proc.kill(); resolve(false); }, 8000);
    proc.on('close', code => { clearTimeout(timer); resolve(code === 0 && /pandoc/i.test(stdout)); });
  });
}
async function exportDocx(content: string, sourcePath: string, pandocPath: string): Promise<string | null> {
  const cmd = pandocPath.trim() || 'pandoc';
  if (!await pandocAvailable(cmd)) throw new VaultError('PANDOC_NOT_FOUND', '未找到 Pandoc，请在设置中配置 pandoc 路径。');
  const defaultName = (path.basename(sourcePath || '笔记') || '笔记').replace(/\.md$/i, '') + '.docx';
  const result = await dialog.showSaveDialog(window!, { title: '导出 DOCX', defaultPath: defaultName, filters: [{ name: 'Word 文档', extensions: ['docx'] }] });
  if (result.canceled || !result.filePath) return null;
  const temporary = path.join(tmpdir(), 'plainote-' + randomUUID() + '.md');
  await writeFile(temporary, content, 'utf8');
  const reference = resolveTemplate('reference.docx');
  const args = [temporary];
  if (reference) args.push('--reference-doc', reference);
  args.push('-o', result.filePath);
  try { await runPandoc(cmd, args); }
  finally { await rm(temporary, { force: true }); }
  return result.filePath;
}
register('export-docx', (content: string, sourcePath: string, pandocPath: string) => {
  if (typeof content !== 'string' || typeof sourcePath !== 'string' || typeof pandocPath !== 'string') throw new VaultError('INVALID_PATH', '导出参数无效。');
  return exportDocx(content, sourcePath, pandocPath);
});
register('ai-get-config', () => readAiConfig(userFile()));
register('ai-set-config', (config: AiConfig) => saveAiConfig(userFile(), config));
register('ai-search', async (query: string) => {
  if (typeof query !== 'string') throw new VaultError('INVALID_PATH', '检索参数无效。');
  const files = (await requireVault().scan()).slice(0, 200);
  const notes = await Promise.all(files.map(async file => { const note = await requireVault().read(file.path); return { path: file.path, name: file.name, content: note.content }; }));
  return searchNotes(query, notes);
});
const aiSessions = new Map<string, AbortController>();
function aiStatus(sessionId: string, message: string) { window?.webContents.send('plainote:ai-status', sessionId, message); }
async function readAllNotes(vault: VaultService): Promise<AiNoteContext[]> {
  const files = (await vault.scan()).slice(0, 200);
  return Promise.all(files.map(async f => { const n = await vault.read(f.path); return { path: f.path, name: f.name, content: n.content }; }));
}
async function readIndex(vault: VaultService): Promise<string | null> {
  try { return (await vault.read(INDEX_FILE)).content; }
  catch (error) { if (error instanceof VaultError && error.code === 'NOT_FOUND') return null; throw error; }
}
async function writeIndex(vault: VaultService, content: string): Promise<void> {
  try { const cur = await vault.read(INDEX_FILE); await vault.save(INDEX_FILE, content, cur.revision); }
  catch (error) { if (error instanceof VaultError && error.code === 'NOT_FOUND') await vault.create(INDEX_FILE, content); else throw error; }
}
const INDEX_PROMPT = '请整理这个笔记库，生成一份项目概览（AGENT.md）：按主题归纳各笔记，说明每篇的内容摘要与相互关联。';
async function ensureIndex(config: AiConfig, vault: VaultService, onGenerating?: () => void): Promise<string> {
  const existing = await readIndex(vault);
  if (existing !== null) return existing;
  onGenerating?.();
  let full = '';
  await streamChat(config, [{ role: 'user', content: INDEX_PROMPT }], { retrieved: await readAllNotes(vault) }, text => { full += text; }, new AbortController().signal);
  await writeIndex(vault, full);
  return full;
}
register('ai-chat', async (messages: AiChatMessage[], context: AiContext) => {
  if (!Array.isArray(messages) || typeof context !== 'object' || context === null) throw new VaultError('INVALID_PATH', '聊天参数无效。');
  const config = await readAiConfig(userFile());
  if (!config.apiKey) throw new VaultError('AI_NOT_CONFIGURED', '请先在设置中配置 AI API Key。');
  const vault = requireVault();
  const sessionId = randomUUID();
  const controller = new AbortController();
  aiSessions.set(sessionId, controller);
  void (async () => {
    try {
      const index = await ensureIndex(config, vault, () => aiStatus(sessionId, '首次使用：正在整理笔记库并生成 AGENT.md 概览，请稍候…'));
      const query = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
      const notes = await readAllNotes(vault);
      const retrieved = searchNotes(query, notes, 6).map(h => ({ path: h.path, name: h.name, content: h.content }));
      const fullContext: AiContext = { ...context, index, retrieved: retrieved.length ? retrieved : undefined };
      await streamChat(config, messages, fullContext, text => window?.webContents.send('plainote:ai-token', sessionId, text), controller.signal);
      aiSessions.delete(sessionId);
      window?.webContents.send('plainote:ai-done', sessionId);
    } catch (error) {
      aiSessions.delete(sessionId);
      window?.webContents.send('plainote:ai-error', sessionId, error instanceof VaultError ? error.message : 'AI 请求失败。');
    }
  })();
  return sessionId;
});
register('ai-index', async () => {
  const config = await readAiConfig(userFile());
  if (!config.apiKey) throw new VaultError('AI_NOT_CONFIGURED', '请先在设置中配置 AI API Key。');
  const vault = requireVault();
  const notes = await readAllNotes(vault);
  const sessionId = randomUUID();
  const controller = new AbortController();
  let full = '';
  void streamChat(config, [{ role: 'user', content: INDEX_PROMPT }], { retrieved: notes }, text => { full += text; window?.webContents.send('plainote:ai-token', sessionId, text); }, controller.signal)
    .then(async () => {
      try { await writeIndex(vault, full); } catch { /* 索引写入失败不阻断流式结果 */ }
      aiSessions.delete(sessionId);
      window?.webContents.send('plainote:ai-done', sessionId);
    })
    .catch(error => { aiSessions.delete(sessionId); window?.webContents.send('plainote:ai-error', sessionId, error instanceof VaultError ? error.message : 'AI 请求失败。'); });
  return sessionId;
});
register('ai-cancel', async (sessionId: string) => { aiSessions.get(sessionId)?.abort(); aiSessions.delete(sessionId); });

async function closeDecision(message: string, requestId: number) {
  if (!window || window.isDestroyed() || !closePending || requestId !== closeAttempt || closePromptOpen) return;
  closePromptOpen = true;
  const answer = await dialog.showMessageBox(window, { type: 'warning', title: '还有内容未保存', message, detail: '已记录的恢复内容保存在应用数据目录，下次打开对应笔记时可以恢复。', buttons: ['返回编辑', '退出并保留已记录内容'], defaultId: 0, cancelId: 0 });
  closePromptOpen = false;
  if (!window || window.isDestroyed() || !closePending || requestId !== closeAttempt) return;
  clearTimeout(closeTimer); closePending = false;
  if (answer.response === 1) { mayClose = true; quitRequested ? app.quit() : window.close(); }
  else { quitRequested = false; window.webContents.send('plainote:close-canceled', requestId); }
}
ipcMain.on('plainote:finish-close', (event, requestId: number, ready: boolean) => {
  try { validateSender(event); } catch { return; }
  if (!closePending || requestId !== closeAttempt || closePromptOpen) return;
  clearTimeout(closeTimer);
  if (ready === true) { mayClose = true; closePending = false; quitRequested ? app.quit() : window?.close(); }
  else void closeDecision('部分笔记未能保存，请返回编辑处理，或退出并保留已记录的恢复内容。', requestId);
});
for (const channel of ['minimize', 'maximize', 'close']) ipcMain.on('plainote:' + channel, event => {
  try { validateSender(event); } catch { return; }
  if (channel === 'minimize') window?.minimize();
  if (channel === 'maximize') window?.isMaximized() ? window.unmaximize() : window?.maximize();
  if (channel === 'close') window?.close();
});
function createWindow() {
  mayClose = false; closePending = false; closePromptOpen = false;
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 900, minHeight: 620, title: '素记 Plainote', backgroundColor: '#fcfaf6', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden', trafficLightPosition: { x: 16, y: 15 }, ...windowIcon, webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => { if (target !== window?.webContents.getURL()) event.preventDefault(); });
  if (process.env.PLAINOTE_DEV_URL) void window.loadURL(process.env.PLAINOTE_DEV_URL);
  else void window.loadFile(path.join(directory, '../../dist-renderer/index.html'));
  window.on('close', event => {
    if (mayClose) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    const requestId = ++closeAttempt;
    window?.webContents.send('plainote:close-requested', requestId);
    closeTimer = setTimeout(() => { void closeDecision('编辑器暂时没有响应，尚未确认所有内容已保存。', requestId); }, 10000);
  });
  window.on('closed', () => { clearTimeout(closeTimer); window = null; });
}
void app.whenReady().then(async () => {
  const explicit = process.argv.find(a => a.startsWith('--vault='))?.slice(8);
  let recent: string | undefined;
  try { recent = JSON.parse(await readFile(userFile(), 'utf8')).recentVault; } catch { /* First run. */ }
  if (explicit || recent) try { vault = await VaultService.open(explicit || recent!, recoveryDir()); } catch { /* Missing library returns to welcome. */ }
  const menu: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ label: '素记', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] } as Electron.MenuItemConstructorOptions] : []),
    { label: '文件', submenu: [{ label: '打开笔记库…', accelerator: 'CmdOrCtrl+O', click: () => window?.webContents.send('plainote:vault-requested') }, { type: 'separator' }, { role: 'close' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  protocol.handle('plainote-file', async request => {
    try {
      if (!vault) return new Response('未打开笔记库', { status: 404 });
      const url = new URL(request.url);
      if (url.hostname !== 'v') return new Response('无效资源', { status: 400 });
      const relative = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const absolute = await vault.resolveResource(relative);
      const data = await readFile(absolute);
      return new Response(data, { headers: { 'content-type': mimeFor(absolute), 'cache-control': 'no-store' } });
    } catch {
      return new Response('无法读取附件', { status: 404 });
    }
  });
  if (process.platform === 'darwin' && iconPath) app.dock?.setIcon(iconPath);
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
