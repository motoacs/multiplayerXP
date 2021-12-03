const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const dgram = require('dgram');
const { WebSocket } = require('ws');
const crypto = require('crypto');
const validator = require('validator');
const xss = require('xss');

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SETTING_JSON_PATH = './setting.json';
// const CSV_FILENAME = /LTExportFD - 20\d\d-\d\d-\d\d \d\d\.\d\d\.\d\d.csv/;
const CSV_FILENAME = /LTExportFD.csv/;

// rate which new csv file explore
const SCAN_DIR_RATE = 3;
let i;

// dgram socket
let sender;

// websocket client
let ws;
let ping;
// WebSocket session has been established
let wsSession = false;
let wsRetry = 0;
let wsPassword = '';
let wsSalt = '';
let wsKey = '';
let pingIntervalId;
let errorCount = 0;
let disconnecting = false;

// setting data from GUI
let setting = {};
// path to latest csv file
let latestFilePath = '';
// csv file's last modified time(unix)
let csvLastModified = 0;


let mainIntervalId = null;


// 8888888888 888                   888
// 888        888                   888
// 888        888                   888
// 8888888    888  .d88b.   .d8888b 888888 888d888 .d88b.  88888b.
// 888        888 d8P  Y8b d88P"    888    888P"  d88""88b 888 "88b
// 888        888 88888888 888      888    888    888  888 888  888
// 888        888 Y8b.     Y88b.    Y88b.  888    Y88..88P 888  888
// 8888888888 888  "Y8888   "Y8888P  "Y888 888     "Y88P"  888  888

// Electron window control
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
  mainWindow.loadFile('./src/html/app.html');

  // DevTools
  // mainWindow.webContents.openDevTools();

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


// 8888888 8888888b.   .d8888b.
//   888   888   Y88b d88P  Y88b
//   888   888    888 888    888
//   888   888   d88P 888
//   888   8888888P"  888
//   888   888        888    888
//   888   888        Y88b  d88P
// 8888888 888         "Y8888P"

// IPC command handlers
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
      log('index: read-json: error');
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
      log('index: write-json: error');
      console.log(err);
      return false;
    }
  )
});

// on start button clicked on gui
ipcMain.handle('start', (evt, newSettingTxt) => {
  // console.log("🚀 ~ file: index.js ~ line 147 ~ ipcMain.handle ~ newSettingTxt", newSettingTxt)
  setting = JSON.parse(newSettingTxt);
  // console.log("🚀 ~ file: index.js ~ line 144 ~ ipcMain.handle ~ setting", setting);

  log('start');
  initClient();
});

// on stop button clicked on gui
ipcMain.handle('stop', () => {
  log('stop');
  disconnecting = true;
  wsDisconnect('user');
  clearInterval(pingIntervalId);
  clearInterval(mainIntervalId);

});

// Open create/delete account window
ipcMain.handle('open-account', (evt, settingTxt) => {
  // console.log("🚀 ~ file: index.js ~ line 171 ~ ipcMain.handle ~ settingTxt", settingTxt)
  setting = JSON.parse(settingTxt);

  log('Open Account Window');
  let accountWindow = new BrowserWindow({
    width: 720,
    height: 480,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  accountWindow.setMenuBarVisibility(false);
  accountWindow.loadFile('./src/html/account.html');
  // DevTools
  // accountWindow.webContents.openDevTools();

  accountWindow.on('closed', () => {
    accountWindow = null;
  });
});

// return setting data to account window
ipcMain.handle('get-settings', () => {
  return Promise.resolve(JSON.stringify(setting));
});


// create / delete account
ipcMain.handle('manipulate-account', (evt, mode, settingTxt) => {
  return new Promise((resolve) => {
    let clientHash = crypto.createHash('sha256').update(crypto.randomBytes(32).toString('base64')).digest('hex');
    let serverHash, checkHash, rsaPubKey;

    setting = JSON.parse(settingTxt);

    // create WebSocket client
    ws = new WebSocket(setting.server);

    // connection open
    ws.on('open', () => {
      log('manipulate-account: WebSocket open: send key request');
      ws.send(`account-getkey;${clientHash}`);
    });

    // message received
    ws.on('message', (msg) => {
      log(`manipulate-account: [Recieve] ${String(msg).replace(/\n/g, '')}`);
      const msgArr = String(msg).split(';');

      // send request
      if (msgArr[0] === 'account-key') {
        rsaPubKey = msgArr[1];
        serverHash = msgArr[2];
        checkHash = crypto.createHash('sha256').update(`${serverHash}${serverHash}${clientHash}${serverHash}`).digest('hex');
        // hashing password
        const pwHash = crypto.createHash('sha256').update(setting.pass).digest('hex');
        // payload data
        const payload = `${setting.id};${pwHash};${checkHash}`;
        // encrypt with RSA
        const encryptedPayload = crypto.publicEncrypt(
          {
            key: rsaPubKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
          },
          Buffer.from(payload),
        ).toString('base64');

        const sendText = `account-${mode};${encryptedPayload}`;
        log(`manipulate-account: [Send] ${sendText}`);

        // send a request to the server
        ws.send(sendText);
      }

      // request result
      else if (msgArr[0] === 'account-result') {
        // resolve by server's response code
        resolve(msgArr[1]);
        ws.close();
      }
    });

    ws.on('error', () => {
      log('manipulate-account: ws error');
      ws.close();
      resolve('0');
    });
    ws.on('close', () => {
      log('manipulate-account: ws close');
      ws = null;
      resolve('0');
    });
  });

});



// send IPC Message to the Renderer Window
function sendIpcMessage(channel, dataTxt) {
  if (mainWindow != null) {
    mainWindow.webContents.send(channel, dataTxt);
  }
}


// d8b          d8b 888
// Y8P          Y8P 888
//                  888
// 888 88888b.  888 888888
// 888 888 "88b 888 888
// 888 888  888 888 888
// 888 888  888 888 Y88b.
// 888 888  888 888  "Y888

// initialize multiplayer client
async function initClient() {
  await updateLatestFilePath();
  disconnecting = false;

  // create UDP Socket
  sender = dgram.createSocket({
    type: 'udp4',
    reuseAddr: true,
    sendBufferSize: 1024,
  });

    // create WebSocket connection
  ws = new WebSocket(setting.server, {
    maxPayload: 1024
  });
  // set WebSocket event handler
  // open
  ws.on('open', onWSConnected);
  // message
  ws.on('message', onWSMsgReceived);
  // close
  ws.on('close', onWSDisconnected);
  // error
  ws.on('error', onWSError);
  // ping
  ws.on('pong', () => log(`WebSocket: ping ${Date.now() - pingStart}`));

  // start main process
  i = SCAN_DIR_RATE;
  main();
  mainIntervalId = setInterval(main, 2500);
}


//                        d8b
//                        Y8P

// 88888b.d88b.   8888b.  888 88888b.
// 888 "888 "88b     "88b 888 888 "88b
// 888  888  888 .d888888 888 888  888
// 888  888  888 888  888 888 888  888
// 888  888  888 "Y888888 888 888  888
async function main() {
  if (i >= SCAN_DIR_RATE) {
    i = 1;
    updateLatestFilePath();
  }
  else i += 1;

  // read csv file if updated
  let ret = await scan();
  if (ret === null) return;

  // csv to Array
  let csvArr = ret.split('\r\n');
  let complete = false;

  do {
    // last line
    let line = csvArr.pop();
    // if valid data
    if (line.length > 0 && !line.startsWith('{')) {
      line = line.replace(',USER,', `,${setting.callsign},`);
      log(`Main: sending: ${line}`);
      sendToServer(line);
      // for debug
      // sendToLiveTraffic(line);
      complete = true;
    }
  }
  while (!complete);
}


async function updateLatestFilePath() {
  // ls
  const dir = await fs.readdir(`${setting.xplaneDir}\\Output\\`);
  // console.log("🚀 ~ file: index.js ~ line 205 ~ updateLatestFilePath ~ dir", dir);

  // filtering csv files
  const csvFilesArr = dir.filter((fileName) => fileName.match(CSV_FILENAME));
  // console.log("🚀 ~ file: index.js ~ line 209 ~ updateLatestFilePath ~ csvFilesArr", csvFilesArr);
  // latest
  latestFilePath = `${setting.xplaneDir}\\Output\\${csvFilesArr.pop()}`;
  log(`updateLatestFilePath: ${latestFilePath}`);

  return Promise.resolve();
}


/**
 * scan - check for updates to the csv file and read the file if has been updated since last time
 * @returns Promise<string or null>
 */
 function scan() {
  return new Promise(async (resolve, reject) => {
    // check time of last modified
    const stat = await fs.stat(latestFilePath);

    // if it hasn't been updated since the last time
    if (stat.mtime.getTime() === csvLastModified) {
      log('csv no updated');
      resolve(null);
      return;
    }
    csvLastModified = stat.mtime.getTime();

    // read file
    const file = await fs.readFile(latestFilePath, { encoding: 'utf8' });
    log(`csv updated!`);
    resolve(file);
  });
}


function sendToServer(msg) {
  if (ws.readyState !== WebSocket.OPEN) {
    log(`Websocket: Error: WebSocket is not open`);
    return;
  }

  // encrypt
  const encryptData = encrypt(`update-pos;${setting.id};${msg}`);
  // console.log(encryptData);
  ws.send(encryptData);

  log(`WebSocket: [Send] ${msg}`);
  sendIpcMessage('ws-send', msg);
}


/**
 * sendToLiveTraffic - Send data to the LiveTraffic plugin on X-Plane
 * @param  {string} msg
 */
function sendToLiveTraffic(msg) {
  sender.send(msg, 49003, (ret) => {
      if (ret === null) log('sendToLiveTraffic: Send');
      else log(ret);
  });
}



// 888       888          888       .d8888b.                    888               888
// 888   o   888          888      d88P  Y88b                   888               888
// 888  d8b  888          888      Y88b.                        888               888
// 888 d888b 888  .d88b.  88888b.   "Y888b.    .d88b.   .d8888b 888  888  .d88b.  888888
// 888d88888b888 d8P  Y8b 888 "88b     "Y88b. d88""88b d88P"    888 .88P d8P  Y8b 888
// 88888P Y88888 88888888 888  888       "888 888  888 888      888888K  88888888 888
// 8888P   Y8888 Y8b.     888 d88P Y88b  d88P Y88..88P Y88b.    888 "88b Y8b.     Y88b.
// 888P     Y888  "Y8888  88888P"   "Y8888P"   "Y88P"   "Y8888P 888  888  "Y8888   "Y888

function wsDisconnect(reason) {
  if (ws != null) {
    try {
      ws.close(1, reason);
    }
    catch (e) {
      ws.terminate();
      sendIpcMessage('closed');
    }
    finally {
      ws = null;
      clearInterval(pingIntervalId);
      clearInterval(mainIntervalId);
    }
  }
}

function wsReconnect() {
  log('WebSocket: reconnecting...');
  // retry after 5s
  setTimeout(() => {
    if (wsRetry < 5) {
      clearInterval(pingIntervalId);
      clearInterval(mainIntervalId);
      initClient();
    }
    else {
      log('WebSocket: ERROR: reopen limit reached');
      sendIpcMessage('error', 'Connection Error: Disconnected');
    }
    wsRetry += 1;
  }, 5000);
}

// WebSocket Event Handlers
function onWSConnected() {
  log('WebSocket: connected');
  log('WebSocket: waiting for authentication process');

  // WebSocket connection keep alive
  pingIntervalId = setInterval(() => {
    pingStart = Date.now();
    ws.ping();
  }, 10000);
}


function onWSMsgReceived(msg) {
  // validation
  try {
    msg = String(msg);
    if (msg == null || msg.length === 0) return;
  }
  catch (e) {
    return;
  }

  // authentication
  if (msg.startsWith('auth-required;')) {
    log(`WebSocket: [Receive] ${msg.replace(/\n/g, '')}`);
    sendIpcMessage('auth-in-progress');

    msg = msg.split(';');
    log('WebSocket: start authentication');

    wsPassword = crypto.createHash('sha256').update(crypto.randomBytes(32).toString('base64')).digest('hex');
    wsSalt = crypto.createHash('sha256').update(crypto.randomBytes(32).toString('base64')).digest('hex');
    wsKey = crypto.scryptSync(wsPassword, wsSalt, 32);

    const payload = `${setting.id};${crypto.createHash('sha256').update(setting.pass).digest('hex')};${wsPassword};${wsSalt}`;
    log(`WebSocket: authentication payload: ${payload}`);
    const encryptedPayload =  crypto.publicEncrypt(
      {
        key: msg[1],
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(payload),
    ).toString('base64');

    log(`WebSocket: [Send] auth-request;${encryptedPayload}`);
    ws.send(`auth-request;${encryptedPayload}`);
  }

  else if (msg.startsWith('auth-result;')) {
    log(`WebSocket: [Receive] ${msg}`);
    msg = msg.split(';');
    sendIpcMessage('auth-result', msg[1]);

    // error
    if (msg[1] !== '200') {
      // disconnect
      disconnecting = true;
      wsDisconnect('atuh-error');
    }

    // OK
    else {
      wsSession = true;
    }
  }

  // encrypt data
  else {
    // log(`WebSocket: [Receive] msg=${msg}`);
    msg = decrypt(msg);
    let msgArr;
    // validation
    try {
      if (msg === '') throw new Error('dectypt error');

      msgArr = msg.split(';');
      // log(`WebSocket: msg=${msg}`);
      if (msgArr[0] !== 'update-pos') throw new Error('invalid command');
      else if (typeof msgArr[1] !== 'string' && msgArr[1].length === 0) throw new Error('invalid id');
      else if (typeof msgArr[2] !== 'string' && msgArr[2].length === 0) throw new Error('invalid data');
    }
    catch (e) {
      log(`WebSocket: message error: ${e}`);
      return;
    }

    // Receive multiplayer's positions
    log(`WebSocket: [Receive] ${msg.replace(/\n/g, '')}`);
    sendToLiveTraffic(msgArr[2]);
    sendIpcMessage('ws-recieve', msg);
  }

  wsRetry = 0;
}

function onWSDisconnected(code, reason) {
  log(`WebSocket: connection closed: code=${code} reason=${decoder.decode(reason)}`);
  ws = null;

  // unexpected disconnect
  if (!disconnecting) {
    log('WebSocket: unexpected disconnect');
    wsReconnect();
  }

  else sendIpcMessage('closed');
}

function onWSError(wsError) {
  log(`WebSocket: ERROR: connection error: ${wsError}`);
  sendIpcMessage('error', `Connection Error: ${wsError}`);

  errorCount += 1;
  if (errorCount > 10) {
    wsDisconnect('too-many-errors');
  }
}



//          888    d8b 888 d8b 888    d8b
//          888    Y8P 888 Y8P 888    Y8P
//          888        888     888
// 888  888 888888 888 888 888 888888 888  .d88b.  .d8888b
// 888  888 888    888 888 888 888    888 d8P  Y8b 88K
// 888  888 888    888 888 888 888    888 88888888 "Y8888b.
// Y88b 888 Y88b.  888 888 888 Y88b.  888 Y8b.          X88
//  "Y88888  "Y888 888 888 888  "Y888 888  "Y8888   88888P'

function encrypt(msg) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', wsKey, iv);
  const data = Buffer.from(msg);
  let encryptData = cipher.update(data);

  encryptData = Buffer.concat([iv, encryptData, cipher.final()]).toString('base64');

  return encryptData;
}

function decrypt(encryptData) {
  let msg;
  try {
    const buff = Buffer.from(encryptData, 'base64');
    const iv = buff.slice(0, 16);
    encryptData = buff.slice(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', wsKey, iv);
    const data = decipher.update(encryptData);
    msg = Buffer.concat([data, decipher.final()]).toString('utf8');
  }
  catch (e) {
    log(e);
    msg = '';
  }

  return msg;
}

// Console Output
function log(logTxt) {
  const d = new Date();
  const da = [
    `0${d.getHours()}`.slice(-2),
    `0${d.getMinutes()}`.slice(-2),
    `0${d.getSeconds()}`.slice(-2),
  ];
  // hh:mm:ss
  const ds = da.join(':');

  console.log(`[${ds}] ${logTxt}`);
}
