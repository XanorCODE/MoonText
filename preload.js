const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moon', {
  init: () => ipcRenderer.invoke('init'),
  on: cb => ipcRenderer.on('msg', (_, data) => cb(data)),
  control: cmd => ipcRenderer.invoke('control', cmd),
  setSettings: patch => ipcRenderer.invoke('settings', patch),
  library: () => ipcRenderer.invoke('library'),
  lyricsGet: x => ipcRenderer.invoke('lyrics:get', x),
  lyricsSave: x => ipcRenderer.invoke('lyrics:save', x),
  lyricsReset: x => ipcRenderer.invoke('lyrics:reset', x),
  pillReady: () => ipcRenderer.send('pill:ready'),
  openLink: key => ipcRenderer.invoke('open-link', key),
  copy: text => ipcRenderer.invoke('copy', text),
  reportProblem: () => ipcRenderer.invoke('diag:report'),
  openStream: () => ipcRenderer.invoke('stream:open'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
});
