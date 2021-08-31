const fs = require('fs').promises;
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const encoder = new TextEncoder();
const decoder = new TextDecoder();


const SETTING_JSON_PATH = '../data/setting.json';

let setting;
let wss;
let logs = [];

async function initialize() {
  // get setting.json
  setting = await getJSON(SETTING_JSON_PATH);
  if (setting == null) {
    log('initialize: ERROR: invalid setting.json');
    return;
  }

  try {
    setInterval(saveLogs, setting.logSaveInterval * 1000);
  }
  catch (e) {
    log('initialize: ERROR: invalid setting.json');
    return;
  }

  // create server instance
  try {
    wss = new WebSocketServer({
      port          : Number(setting.port),
      clientTracking: true,
    });
  }
  catch (e) {
    log(`initialize: ERROR: create WebSocket server failed: ${JSON.stringify(e)}`);
    await saveLogs();
    return;
  }

  // connection created
  wss.on('connection', (ws, requestHeader) => {
    const ip = requestHeader.socket.remoteAddress;
    let id = '';
    let token = '';
    let correctAnswers = [];
    let authTimer = null;

    // deny ip check
    if (setting.deny.includes(ip)) {
      log(`WebSocket: deny ip: [${ip}]`);
      ws.close();
      ws.terminate();
    }

    log(`WebSocket: new client connected: [${ip}]`);


    // =============================
    // authentication process
    // =============================
    let challengeHash = crypto.createHash('sha256').update(String(Math.random())).digest('hex');
    // correct answers
    setting.users.forEach((user) => {
      correctAnswers.push(crypto.createHash('sha256').update(`${user}${challengeHash}`).digest('hex'));
    });

    // challenge
    log(`WebSocket: start authentication: [${ip}] challenge=${challengeHash}`);
    ws.send(`auth-required;${challengeHash}`);
    challengeHash = null;

    // timeout
    authTimer = setTimeout(() => {
      if (token.length !== 64) {
        log(`WebSocket: ERROR: authentication timeout: [${ip}]`);
        ws.close();
        ws.terminate();
      }
    }, 2000);


    // message listener
    ws.on('message', (msg) => {
      let msgArr;

      try {
        // validation
        msg = String(msg);
        if (msg == null || msg.length === 0) return;
        if (msg !== 'auth-request' && token.length === 64 && !msg.includes(token)) return;
        msgArr = msg.split(';');
      }
      catch (e) {
        return;
      }


      switch (msgArr[0]) {
        // authentication
        case 'auth-request':
          const idx = correctAnswers.indexOf(msgArr[1]);
          // ok
          if (idx >= 0) {
            correctAnswers = null;
            id = setting.users[idx];
            token = crypto.createHash('sha256').update(String(Math.random())).digest('hex');
            clearTimeout(authTimer);

            log(`WebSocket: authentication succeed: [${ip}] user=${id} token=${token}`);
            ws.send(`token;${token}`);
          }

          // ng
          else {
            correctAnswers = null;
            clearTimeout(authTimer);

            log(`WebSocket: authentication failed: [${ip}] ${msg}`);
            ws.close();
            ws.terminate();
          }
          break;


        // update aircraft position
        case 'update-pos':
          if (msgArr[2] !== token) {
            log(`WebSocket: update-pos: forbiden: [${ip}] ${id}: ${msg}`);
            ws.close();
            ws.terminate();
            break;
          }

          log(`WebSocket: update-pos: ${id}: ${msg}`);
          // broadcast posdata excluding itself
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(`update-pos;${msgArr[1]}`);
            }
          });

          break;

        default:
          log(`WebSocket: ERROR: invalid request: [${ip}] ${id}: ${msg}`);
      }
    });

    // connection keep alive (returns pong automatically)
    ws.on('ping', () => log(`WebSocket: ping: ${id}`));

    ws.on('close', (code, reason) => {
      log(`WebSocket: connection closed: [${ip}] ${id} token=${token} code=${code} reason=${decoder.decode(reason)}`);
      ws.terminate();
    })
    ws.on('error', (e) => {
      log(`WebSocket: ERROR: connection error: ${JSON.stringify(e)}: [${ip}] ${id} token=${token}`);
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
  const line = `[${ds}] ${logTxt}`;
  console.log(line);
  logs.push(line)
}

// 定期的にログを保存
function saveLogs() {
  return new Promise(async (resolve) => {
    if (logs.length === 0) {
      resolve();
      return;
    }

    const d = new Date();
    const ds = [
      d.getFullYear(), // YYYY
      `0${d.getMonth() + 1}`.slice(-2), // MM
      `0${d.getDate()}`.slice(-2), // DD
    ].join('-'); // YYYY-MM-DD

    const copy = logs.slice(0);
    logs = [];

    await fs.writeFile(
      `${setting.logDir}${ds}.log`,
      copy.join('\r\n') + '\r\n',
      { flag: 'a' } // append
    )
    .catch((e) => log(`saveLogs: ERROR: ${JSON.stringify(e)}`));

    resolve();
  });
}


function getJSON(path) {
  return new Promise(async (resolve, reject) => {
    let json;
    try {
      json = await fs.readFile(path);
      json = JSON.parse(json);
    }
    catch (e) {
      log(`getJSON: ERROR: ${JSON.stringify(e)}`);
      resolve();
      return;
    }
    resolve(json);
  });
}
