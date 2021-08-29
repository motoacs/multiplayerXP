const fs = require('fs').promises;
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const encoder = new TextEncoder();


const SETTING_JSON_PATH = './server/setting.json';

let setting;
let wss;
let connections = [];

async function initialize() {
  setting = await getJSON(SETTING_JSON_PATH);
  wss = new WebSocketServer({
    port: 8080,
  });

  // connection created
  wss.on('connection', (ws) => {
    let token;
    let hashList = [];

    // authentication process
    let challengeHashHex = crypto.createHash('sha256').update(String(Math.random())).digest('hex');
    setting.users.forEach((user) => {
      hashList.push(crypto.createHash('sha256').update(`${user}${challengeHashHex}`));
    });

    // challenge
    ws.send(`auth-required;${challengeHashHex}`);
    challengeHashHex = null;

    // message listener
    ws.on('message', (msg) => {
      msg = String(msg);
      log(msg);
      if (msg == null || msg.length === 0) return;
      const msgArr = msg.split(';');

      switch (msgArr[0]) {
        case 'auth-request':
          // ok
          if (hashList.includes(msgArr[1])) {
            hashList = null;
            token = crypto.createHash('sha256').update(String(Math.random())).digest('hex');
            ws.send(`token;${token}`);
          }

          // bad
          else {
            hashList = null;
            log(`WebSocket: 403 Forbidden: ${msgArr[1]}`);
            ws.close();
          }
          break;
        default:
          log(`WebSocket: ERROR: unknown command: ${msg}`);
      }
    });
  });
}




initialize();

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
