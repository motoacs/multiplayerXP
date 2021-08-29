const fs = require('fs').promises;
const dgram = require('dgram');
const { WebSocket } = require('ws');
const crypto = require('crypto');
const encoder = new TextEncoder();

// setting.json
let setting;
// dgram socket
let sender;
// websocket client
let ws;

const SETTING_JSON_PATH = './client/setting.json';
const OUTPUT_PATH = 'D:/Games/SteamLibrary/steamapps/common/X-Plane 11/Output/';
const CSV_FILENAME = /LTExportFD - 20\d\d-\d\d-\d\d \d\d\.\d\d\.\d\d.csv/;

let wsToken = '';
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
    log('WebSocket: wating authentication process');
  });


  // message
  ws.on('message', (msg) => {
    msg = String(msg);
    if (msg == null || msg.length === 0) return;
    log(msg);
    const msgArr = msg.split(';');

    switch (msgArr[0]) {
      // authentication
      case 'auth-required':
        const hashHex = crypto.createHash('sha256').update(`${setting.id}${msgArr[1]}`).digest('hex');
        ws.send(`auth-request;${hashHex}`);
        break;

      case 'token':
        log(`WebSocket: token=${msgArr[1]}`);
        wsToken = msgArr[1];
        break;

      default:
        log(`WebSocket: ERROR: unknown command: ${msgArr[0]}`);
    }
  });

  ws.on('close', () => {
    log('WebSocket: ERROR: connection disconected');
    // log('Websocket: connecting');
    // ws = new WebSocket(setting.server);
  });

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
      log(`sending: ${line}`);
      sendToLiveTraffic(line);
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
