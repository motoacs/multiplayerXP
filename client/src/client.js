const fs = require('fs').promises;
const dgram = require('dgram');
const { WebSocket } = require('ws');
const crypto = require('crypto');
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SETTING_JSON_PATH = './data/setting.json';
const OUTPUT_PATH = 'D:/Games/SteamLibrary/steamapps/common/X-Plane 11/Output/';
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

// path to latest csv file
let latestFilePath = '';
// csv file's last modified time(unix)
let csvLastModified = 0;


// initialize
async function initialize() {
  // get setting.json
  setting = await getJSON(SETTING_JSON_PATH);

  // ls
  const dir = await fs.readdir(OUTPUT_PATH);
  console.log(dir);

  // filtering csv files
  const csvFilesArr = dir.filter((fileName) => fileName.match(CSV_FILENAME));
  console.log(csvFilesArr);
  // latest
  latestFilePath = `${OUTPUT_PATH}${csvFilesArr.pop()}`;

  // create udpsocket
  sender = dgram.createSocket({
    type: 'udp4',
    reuseAddr: true,
    sendBufferSize: 1024,
  });

  // create WebSocket connection
  ws = new WebSocket(setting.server);

  // ============================
  // WebSocket Event Handler
  // ============================

  // open
  ws.on('open', () => {
    log('WebSocket: connected');
    log('WebSocket: waiting for authentication process');
    stopPing = false;
  });


  // message
  ws.on('message', (msg) => {
    try {
      // validation
      msg = String(msg);
      if (msg == null || msg.length === 0) return;
    }
    catch (e) {
      return;
    }

    // authentication
    if (msg.startsWith('auth-required;')) {
      msg = msg.split(';');
      log(`WebSocket: ${msg}`);
      const answer = crypto.createHash('sha256').update(`${setting.id}${msg[1]}${setting.id}${setting.id}`).digest('hex');
      log(`WebSocket: auth-request;${answer}`)
      ws.send(`auth-request;${answer}`);
    }

    else if (msg.startsWith('auth-success;')) {
      msg = msg.split(';');
      log(`WebSocket: authentication succeed: token=${msg[1]}`);
      wsToken = msg[1];
      wsPassword = crypto.createHash('sha256').update(`${setting.id}${setting.id}${wsToken}${wsToken}`).digest('hex');
      wsSalt = crypto.createHash('sha256').update(`${wsToken}${setting.id}${wsToken}${setting.id}`).digest('hex');
      wsKey = crypto.scryptSync(wsPassword, wsSalt, 32);
    }

    // encrypt data
    else {
      msg = decrypt(msg);

      try {
        if (msg === '') throw new Error('invalid message');

        msg = msg.split(';');
        if (msg[0] !== 'update-pos') throw new Error('invalid command');
        else if (!(msg[1].length > 0)) throw new Error('invalid posdata');
      }
      catch (e) {
        log(`WebSocket: ERROR: ${e}`);
        return;
      }

      // recieve multiplayer's positions
      log(`WebSocket: ${msg.join(';')}`);
      sendToLiveTraffic(msg[1]);
    }
  });


  ws.on('close', (code, reason) => {
    log(`WebSocket: ERROR: connection closed: code=${code} reason=${decoder.decode(reason)}`);
    ws.terminate();
    stopPing = true;

    // retry after 5s
    setTimeout(() => {
      if (wsRetry < 5) ws = new WebSocket(setting.server);
      else log('WebSocket: ERROR: reopen limit reached');
      wsRetry += 1;
    }, 5000);
  });


  ws.on('error', (e) => {
    log(`WebSocket: ERROR: connection error: ${e}`);

    // retry after 5s
    setTimeout(() => {
      if (wsRetry < 5) ws = new WebSocket(setting.server);
      else log('WebSocket: ERROR: reconnection limit reached');
      wsRetry += 1;
    }, 5000);
  });


  // connection keep alive
  setInterval(() => {
    pingStart = Date.now();
    if (!stopPing) ws.ping();
  }, 10000);
  ws.on('pong', () => log(`WebSocket: ping ${Date.now() - pingStart}`));

  // start main process
  main();
  setInterval(main, 2500);
}


// main process
async function main() {
  // read csv file if updated
  let ret = await scan();
  if (ret === null) return;

  // csv to Array
  let csvArr = ret.split('\r\n');
  let complete = false;

  do {
    // last line
    const line = csvArr.pop();
    // if valid data
    if (line.length > 0 && !line.startsWith('{')) {
      line.replace(',USER,', `,${setting.callsign},`);
      log(`sending: ${line}`);
      setdToServer(line);
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


function setdToServer(msg) {
  if (ws.readyState !== WebSocket.OPEN) {
    log(`Websocket: update-pos: failed: WebSocket is not open`);
    return;
  }

  log(`WebSocket: update-pos;${wsToken};${msg}`);

  // encrypt
  const encryptData = encrypt(`update-pos;${wsToken};${msg}`);
  // console.log(encryptData);
  ws.send(encryptData);
}


/**
 * sendToLiveTraffic - Sending data to LiveTraffic on X-Plane
 * @param  {string} msg
 */
function sendToLiveTraffic(msg) {
  sender.send(
    msg,
    49003,
    (ret) => {
      if (ret === null) log('sent');
      else log(ret);
    },
  );
}



// init
initialize();


// ============================
// WebSocket function
// ============================
function sendMyPos(data) {

}



// ============================
// utils
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
    console.log(e);
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
