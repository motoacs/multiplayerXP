const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openDir: async () => await ipcRenderer.invoke('open-dir'),
  readJson : async () => await ipcRenderer.invoke('read-json'),
  writeJson: async (dataTxt) => await ipcRenderer.invoke('write-json', dataTxt),
  start: (settingTxt) => ipcRenderer.invoke('start', settingTxt),
  stop : () => ipcRenderer.invoke('stop'),
  openAccount: (settingTxt) => ipcRenderer.invoke('open-account', settingTxt),
  getSetting: () => ipcRenderer.invoke('get-settings'),
  manipulateAccount: (mode, settingTxt) => ipcRenderer.invoke('manipulate-account', mode, settingTxt),
  on       : (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(...args)),
});
