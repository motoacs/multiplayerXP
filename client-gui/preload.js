const { contextBridge, ipcRenderer } = require('electron');

const fs = require('fs').promises;
const dgram = require('dgram');
const { WebSocket } = require('ws');
const crypto = require('crypto');


contextBridge.exposeInMainWorld('api', {
  fs,
  dgram,
  WebSocket,
  crypto,
  openDir: async () => await ipcRenderer.invoke('open-dir'),
});
