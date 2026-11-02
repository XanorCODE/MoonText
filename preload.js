const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moon', {
  init: () => ipcRenderer.invoke('init'),
  on: cb => ipcRenderer.on('msg', (_, data) => cb(data)),
  control: cmd => ipcRenderer.invoke('control', cmd),
  setSettings: patch => ipcRenderer.invoke('settings', patch),
  library: () => ipcRenderer.invoke('library'),
  pillReady: () => ipcRenderer.send('pill:ready'),
  openLink: key => ipcRenderer.invoke('open-link', key),
  copy: text => ipcRenderer.invoke('copy', text),
  openStream: () => ipcRenderer.invoke('stream:open'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
});
