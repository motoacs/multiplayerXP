const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openDir: async () => await ipcRenderer.invoke('open-dir'),
  readJson : async () => await ipcRenderer.invoke('read-json'),
  writeJson: async (dataTxt) => await ipcRenderer.invoke('write-json', dataTxt),
  start: (s, t, i) => ipcRenderer(s, t, i),
  stop : () => ipcRenderer.invoke(),
  on       : (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(...args)),
});
