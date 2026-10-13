const { contextBridge, ipcRenderer } = require('electron');
const invoke = (name, ...args) => ipcRenderer.invoke('plainote:' + name, ...args);
const subscribe = (name, callback) => {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on('plainote:' + name, listener);
  return () => ipcRenderer.removeListener('plainote:' + name, listener);
};
contextBridge.exposeInMainWorld('plainote', {
  platform: process.platform,
  chooseVault: () => invoke('choose-vault'),
  currentVault: () => invoke('current-vault'),
  directories: () => invoke('directories'),
  createDirectory: path => invoke('create-directory', path),
  rename: (path, newPath) => invoke('rename', path, newPath),
  exportDocx: (content, sourcePath, pandocPath) => invoke('export-docx', content, sourcePath, pandocPath),
  aiGetConfig: () => invoke('ai-get-config'),
  aiSetConfig: config => invoke('ai-set-config', config),
  aiSearch: query => invoke('ai-search', query),
  aiChat: (messages, context) => invoke('ai-chat', messages, context),
  aiIndex: () => invoke('ai-index'),
  aiCancel: sessionId => invoke('ai-cancel', sessionId),
  onAiToken: callback => subscribe('ai-token', callback),
  onAiDone: callback => subscribe('ai-done', callback),
  onAiError: callback => subscribe('ai-error', callback),
  trash: (path, revision) => invoke('trash', path, revision),
  scan: () => invoke('scan'), read: path => invoke('read', path),
  save: (path, content, revision) => invoke('save', path, content, revision),
  create: (path, content) => invoke('create', path, content),
  stageRecovery: (path, content, revision) => invoke('stage-recovery', path, content, revision),
  getRecovery: path => invoke('get-recovery', path), clearRecovery: path => invoke('clear-recovery', path),
  recoveries: () => invoke('recoveries'),
  onCloseRequested: callback => subscribe('close-requested', callback),
  onVaultRequested: callback => subscribe('vault-requested', callback),
  onCloseCanceled: callback => subscribe('close-canceled', callback),
  finishClose: (requestId, ready) => ipcRenderer.send('plainote:finish-close', requestId, ready),
  minimize: () => ipcRenderer.send('plainote:minimize'),
  toggleMaximize: () => ipcRenderer.send('plainote:maximize'),
  closeWindow: () => ipcRenderer.send('plainote:close'),
});
