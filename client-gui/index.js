const { setting } = require('cluster');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');

const path = require('path');
const fs = require('fs').promises;
const dgram = require('dgram');
const { WebSocket } = require('ws');
const crypto = require('crypto');
const encoder = new TextEncoder();
const decoder = new TextDecoder();


const SETTING_JSON_PATH = './setting.json';

// ============================
// Electron window control
// ============================

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('app.html');

  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});


// ============================
// IPC command handler
// ============================

ipcMain.handle('open-dir', async () => {
  return await dialog.showOpenDialog(mainWindow, {
    title: 'Select a "X-Plane 11" folder',
    properties: ['openDirectory']
  })
    .then(
      (ret) => {
        if (ret.canceled) return '';
        return ret.filePaths[0];
      },
      (err) => { return '' },
    );
});


// read setting.json
ipcMain.handle('read-json', async () => {
  return await fs.readFile(SETTING_JSON_PATH).then(
    (data) => {
      try {
        return JSON.parse(data);
      }
      catch (e) {
        return null;
      }
    },
    (err) => {
      console.log('index: read-json: error');
      console.log(err);
      return null;
    }
  )
});

// write setting.json
ipcMain.handle('write-json', async (evt, dataTxt) => {
  console.log(dataTxt);
  // let jsonTxt = JSON.stringify(data, undefined, 2);
  return await fs.writeFile(SETTING_JSON_PATH, dataTxt).then(
    (ret) => {
      return true;
    },
    (err) => {
      console.log('index: write-json: error');
      console.log(err);
      return false;
    }
  )
});

ipcMain.handle('start', () => {

});

ipcMain.handle('stop', () => {

});


function sendIpcMessage(channel, dataTxt) {
  if (mainWindow != null) {
    mainWindow.webContents.send(channel, dataTxt);
  }
}

