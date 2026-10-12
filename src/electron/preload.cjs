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
