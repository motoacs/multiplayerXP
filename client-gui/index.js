const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

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

