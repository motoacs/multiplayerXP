const fs = require('fs').promises;
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const encoder = new TextEncoder();
const decoder = new TextDecoder();


const SETTING_JSON_PATH = './server/setting.json';

let setting;
let wss;
let connections = [];

async function initialize() {
  setting = await getJSON(SETTING_JSON_PATH);
  wss = new WebSocketServer({
    port          : 8080,
    clientTracking: true,
  });

  // connection created
  wss.on('connection', (ws) => {
    let token = '';
    let correctAnswers = [];

    connections.push(ws);


    // =============================
    // authentication process
    // =============================
    let challengeHashHex = crypto.createHash('sha256').update(String(Math.random())).digest('hex');
    // correct answers
    setting.users.forEach((user) => {
      correctAnswers.push(crypto.createHash('sha256').update(`${user}${challengeHashHex}`).digest('hex'));
    });

    // challenge
    ws.send(`auth-required;${challengeHashHex}`);
    challengeHashHex = null;
    // timeout
    setTimeout(() => {
      if (token.length !== 64) {
        log('WebSocket: Authentication timeout');
        ws.close();
        ws.terminate();
      }
    }, 3000);


    // message listener
    ws.on('message', (msg) => {
      msg = String(msg);
      // log(msg);

      // validation
      if (msg == null || msg.length === 0) return;

      const msgArr = msg.split(';');
      switch (msgArr[0]) {

        // authentication
        case 'auth-request':
          const idx = correctAnswers.indexOf(msgArr[1]);
          // ok
          if (idx >= 0) {
            correctAnswers = null;
            token = crypto.createHash('sha256').update(String(Math.random())).digest('hex');
            log(`WebSocket: authentication succeed: user=${setting.users[idx]} token=${token}`);
            ws.send(`token;${token}`);
          }

          // ng
          else {
            correctAnswers = null;
            log(`WebSocket: authentication failed: ${msg}`);
            ws.close();
            ws.terminate();
          }
          break;


        // update aircraft position
        case 'update-pos':
          if (msgArr[2] !== token) {
            log(`WebSocket: forbidden: ${msg}`);
            ws.close();
            ws.terminate();
            break;
          }

          // broadcast posdata excluding itself
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(`update-pos;${msgArr[1]}`);
            }
          });

          break;

        default:
          log(`WebSocket: ERROR: invalid request: ${msg}`);
      }
    });

    // connection keep alive (returns pong automatically)
    ws.on('ping', () => log('WebSocket: ping pong'));

    ws.on('close', (code, reason) => {
      log(`WebSocket: closed token=${token} code=${code} reason=${decoder.decode(reason)}`);
      ws.terminate();
    })
    ws.on('error', (e) => {
      log(`WebSocket: ERROR: connection error: ${e}: token=${token}`);
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
