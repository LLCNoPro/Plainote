import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { VaultService, VaultError } from './vault.ts';
import { readAiConfig, saveAiConfig, searchNotes, streamChat } from './ai.ts';
import type { AiChatMessage, AiConfig, AiContext } from '../shared/ai.ts';
import type { Result, VaultInfo } from '../shared/types.ts';

const directory = path.dirname(fileURLToPath(import.meta.url));
const iconPath = path.join(directory, '..', '..', 'build', 'icon.png');
const windowIcon = existsSync(iconPath) ? { icon: iconPath } : {};
if (process.env.PLAINOTE_DATA_DIR) app.setPath('userData', process.env.PLAINOTE_DATA_DIR);
app.setName('素记');
let window: BrowserWindow | null = null, vault: VaultService | null = null;
let mayClose = false, closePending = false, closeTimer: ReturnType<typeof setTimeout> | undefined;
let quitRequested = false, closeAttempt = 0, closePromptOpen = false;
app.on('before-quit', () => { quitRequested = true; });
const userFile = () => path.join(app.getPath('userData'), 'preferences.json');
const recoveryDir = () => path.join(app.getPath('userData'), 'recovery');
async function vaultInfo(): Promise<VaultInfo | null> { return vault ? { root: vault.root, name: path.basename(vault.root), files: await vault.scan(), directories: await vault.directories() } : null; }
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
  const files = await next.scan(), directories = await next.directories();
  vault = next;
  // A preference write must not make a successfully opened vault appear to fail.
  await rememberVault().catch(() => {});
  return { root: next.root, name: path.basename(next.root), files, directories };
}
register('choose-vault', chooseVault);
register('current-vault', vaultInfo);
register('directories', () => requireVault().directories());
register('create-directory', (relative: string) => requireVault().createDirectory(relative));
register('rename', (relative: string, newRelative: string) => { if (typeof relative !== 'string' || typeof newRelative !== 'string') throw new VaultError('INVALID_PATH', '重命名路径无效。'); return requireVault().rename(relative, newRelative); });
register('trash', (relative: string, revision: string) => { contentArgs(relative, '', revision); return requireVault().trash(relative, revision, filename => shell.trashItem(filename)); });
register('scan', () => requireVault().scan());
register('read', (relative: string) => requireVault().read(relative));
register('save', (relative: string, content: string, revision: string) => { contentArgs(relative, content, revision); return requireVault().save(relative, content, revision); });
register('create', (relative: string, content: string) => { contentArgs(relative, content); return requireVault().create(relative, content); });
register('stage-recovery', (relative: string, content: string, revision: string) => { contentArgs(relative, content, revision); return requireVault().stageRecovery(relative, content, revision); });
register('get-recovery', (relative: string) => requireVault().getRecovery(relative));
register('recoveries', () => requireVault().listRecovery());
register('clear-recovery', (relative: string) => requireVault().clearRecovery(relative));

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
  try { await runPandoc(cmd, [temporary, '-o', result.filePath]); }
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
register('ai-chat', async (messages: AiChatMessage[], context: AiContext) => {
  if (!Array.isArray(messages) || typeof context !== 'object' || context === null) throw new VaultError('INVALID_PATH', '聊天参数无效。');
  const config = await readAiConfig(userFile());
  if (!config.apiKey) throw new VaultError('AI_NOT_CONFIGURED', '请先在设置中配置 AI API Key。');
  const query = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  const vault = requireVault();
  const files = (await vault.scan()).slice(0, 200);
  const notes = await Promise.all(files.map(async f => { const n = await vault.read(f.path); return { path: f.path, name: f.name, content: n.content }; }));
  const retrieved = searchNotes(query, notes, 6).map(h => ({ path: h.path, name: h.name, content: h.content }));
  const fullContext: AiContext = { ...context, retrieved: retrieved.length ? retrieved : undefined };
  const sessionId = randomUUID();
  const controller = new AbortController();
  aiSessions.set(sessionId, controller);
  void streamChat(config, messages, fullContext, text => window?.webContents.send('plainote:ai-token', sessionId, text), controller.signal)
    .then(() => { aiSessions.delete(sessionId); window?.webContents.send('plainote:ai-done', sessionId); })
    .catch(error => { aiSessions.delete(sessionId); window?.webContents.send('plainote:ai-error', sessionId, error instanceof VaultError ? error.message : 'AI 请求失败。'); });
  return sessionId;
});
register('ai-index', async () => {
  const config = await readAiConfig(userFile());
  if (!config.apiKey) throw new VaultError('AI_NOT_CONFIGURED', '请先在设置中配置 AI API Key。');
  const vault = requireVault();
  const files = (await vault.scan()).filter(f => f.path !== 'AGENT.md').slice(0, 200);
  const notes = await Promise.all(files.map(async f => { const n = await vault.read(f.path); return { path: f.path, name: f.name, content: n.content }; }));
  const sessionId = randomUUID();
  const controller = new AbortController();
  let full = '';
  void streamChat(config, [{ role: 'user', content: '请整理这个笔记库，生成一份项目概览（AGENT.md）：按主题归纳各笔记，说明每篇的内容摘要与相互关联。' }], { retrieved: notes }, text => { full += text; window?.webContents.send('plainote:ai-token', sessionId, text); }, controller.signal)
    .then(async () => {
      try {
        const exists = (await vault.scan()).some(f => f.path === 'AGENT.md');
        if (exists) { const cur = await vault.read('AGENT.md'); await vault.save('AGENT.md', full, cur.revision); }
        else await vault.create('AGENT.md', full);
      } catch { /* 索引写入失败不阻断流式结果 */ }
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
  if (process.platform === 'darwin' && existsSync(iconPath)) app.dock?.setIcon(iconPath);
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
