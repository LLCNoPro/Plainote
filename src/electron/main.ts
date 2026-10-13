import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { VaultService, VaultError } from './vault.ts';
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
