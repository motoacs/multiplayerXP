const fs = require('fs').promises;
const dgram = require('dgram');
const { WebSocket } = require('ws');
const crypto = require('crypto');
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SETTING_JSON_PATH = './data/setting.json';
const CSV_FILENAME = /LTExportFD - 20\d\d-\d\d-\d\d \d\d\.\d\d\.\d\d.csv/;

// setting.json
let setting;
// dgram socket
let sender;

// websocket client
let ws;
let ping;
let stopPing = true;
let wsRetry = 0;
let wsToken = '';
let wsPassword = '';
let wsSalt = '';
let wsKey = '';
let pingIntervalId;

// path to latest csv file
let latestFilePath = '';
// csv file's last modified time(unix)
let csvLastModified = 0;


// initialize
async function initialize() {
  // get setting.json
  setting = await getJSON(SETTING_JSON_PATH);

  // ls
  const dir = await fs.readdir(setting.outputPath);
  console.log(dir);
  // filtering csv files
  const csvFilesArr = dir.filter((fileName) => fileName.match(CSV_FILENAME));
  console.log(csvFilesArr);
  // latest
  latestFilePath = `${setting.outputPath}${csvFilesArr.pop()}`;


  // create udpsocket
  sender = dgram.createSocket({
    type: 'udp4',
    reuseAddr: true,
    sendBufferSize: 1024,
  });


  // create WebSocket connection
  ws = new WebSocket(setting.server);
  // set WebSocket event handler
  // open
  ws.on('open', onWSConnected);
  // message
  ws.on('message', onWSMsgReceived);
  // close
  ws.on('close', onWSDisconnected);
  // error
  ws.on('error', onWSDisconnected);

  // WebSocket connection keep alive
  pingIntervalId = setInterval(() => {
    pingStart = Date.now();
    if (!stopPing) ws.ping();
  }, 10000);
  ws.on('pong', () => log(`WebSocket: ping ${Date.now() - pingStart}`));


  // start main process
  main();
  setInterval(main, 2500);
}


//                        d8b
//                        Y8P
//
// 88888b.d88b.   8888b.  888 88888b.
// 888 "888 "88b     "88b 888 888 "88b
// 888  888  888 .d888888 888 888  888
// 888  888  888 888  888 888 888  888
// 888  888  888 "Y888888 888 888  888
async function main() {
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
      log(`sending: ${line}`);
      sendToServer(line);
      // for debug
      // sendToLiveTraffic(line);
      complete = true;
    }
  }
  while (!complete);
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
  const encryptData = encrypt(`update-pos;${wsToken};${msg}`);
  // console.log(encryptData);
  ws.send(encryptData);

  log(`WebSocket: Send: ${msg}`);
}


/**
 * sendToLiveTraffic - Sending data to LiveTraffic on X-Plane
 * @param  {string} msg
 */
function sendToLiveTraffic(msg) {
  sender.send(msg, 49003, (ret) => {
      if (ret === null) log('sent');
      else log(ret);
  });
}



// init
initialize();


// ============================
// WebSocket Event Handler
// ============================

function onWSConnected() {
  log('WebSocket: connected');
  log('WebSocket: waiting for authentication process');
  stopPing = false;
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
    log(`WebSocket: [Receive] ${msg}`);
    msg = msg.split(';');
    log('WebSocket: start authentication');
    const answer = crypto.createHash('sha256').update(`${setting.id}${msg[1]}${setting.id}${setting.id}`).digest('hex');
    ws.send(`auth-request;${answer}`);
    log(`WebSocket: [Send] auth-request;${msg}`);
  }

  else if (msg.startsWith('auth-success;')) {
    log(`WebSocket: [Receive] ${msg}`);
    log('WebSocket: authentication succeeded!');
    msg = msg.split(';');
    wsToken = msg[1];
    wsPassword = crypto.createHash('sha256').update(`${setting.id}${setting.id}${wsToken}${wsToken}`).digest('hex');
    wsSalt = crypto.createHash('sha256').update(`${wsToken}${setting.id}${wsToken}${setting.id}`).digest('hex');
    wsKey = crypto.scryptSync(wsPassword, wsSalt, 32);
  }

  // encrypt data
  else {
    msg = decrypt(msg);

    // validation
    try {
      if (msg === '') throw new Error('dectypt error');

      msg = msg.split(';');
      if (msg[0] !== 'update-pos') throw new Error('invalid command');
      else if (typeof msg[1] !== 'string' && msg[1].length === 0) throw new Error('invalid posdata');
    }
    catch (e) {
      log(`WebSocket: ERROR: ${e}`);
      return;
    }

    // Receive multiplayer's positions
    log(`WebSocket: [Receive] ${msg.join(';')}`);
    sendToLiveTraffic(msg[1]);
  }

  wsRetry = 0;

}

function onWSDisconnected(code, reason) {
  log(`WebSocket: ERROR: connection closed: code=${code} reason=${decoder.decode(reason)}`);
  ws.terminate();
  ws = null;
  stopPing = true;

  // retry after 5s
  setTimeout(() => {
    if (wsRetry < 5) {
      clearInterval(pingIntervalId);
      ws = new WebSocket(setting.server);
      ws.on('open', onWSConnected);
      ws.on('message', onWSMsgReceived);
      ws.on('close', onWSDisconnected);
      ws.on('error', onWSDisconnected);
      // WebSocket connection keep alive
      pingIntervalId = setInterval(() => {
        pingStart = Date.now();
        if (!stopPing) ws.ping();
      }, 10000);
      ws.on('pong', () => log(`WebSocket: ping ${Date.now() - pingStart}`));
    }
    else log('WebSocket: ERROR: reopen limit reached');
    wsRetry += 1;
  }, 5000);
}


// ============================
// utilities
// ============================

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
    // console.log(e);
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

function getJSON(path) {
  return new Promise(async (resolve, reject) => {
    let json;
    try {
      json = await fs.readFile(path);
    }
    catch (e) {
      log(`getJSON: ERROR: ${e}`);
      reject(e);
      return;
    }

    try {
      json = JSON.parse(json);
    }
    catch (e) {
      log(`getJSON: ERROR: ${e}`);
      reject(e);
      return;
    }

    resolve(json);
  });
}
