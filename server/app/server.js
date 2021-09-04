const fs = require('fs').promises;
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');
const encoder = new TextEncoder();
const decoder = new TextDecoder();


const SETTING_JSON_PATH = '../data/setting.json';

let setting;
let wss;
let logs = [];
let clients = [];


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
    let password = '';
    let salt = '';
    let key = '';
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
    let challengeHash = crypto.createHash('sha256').update(crypto.randomBytes(32).toString('base64')).digest('hex');
    // correct answers
    setting.users.forEach((user) => {
      correctAnswers.push(crypto.createHash('sha256').update(`${user}${challengeHash}${user}${user}`).digest('hex'));
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
      try {
        // validation
        msg = String(msg);
        if (msg == null || msg.length === 0) return;
      }
      catch (e) {
        return;
      }

      // authentication
      if (msg.startsWith('auth-request;')) {
        const idx = correctAnswers.indexOf(msg.split(';')[1]);
        // ok
        if (idx >= 0) {
          correctAnswers = null;
          id = setting.users[idx];
          token = crypto.createHash('sha256').update(crypto.randomBytes(32).toString('base64')).digest('hex');
          password = crypto.createHash('sha256').update(`${id}${id}${token}${token}`).digest('hex');
          salt = crypto.createHash('sha256').update(`${token}${id}${token}${id}`).digest('hex');
          key = crypto.scryptSync(password, salt, 32);

          clients.push({
            ws,
            id,
            encrypt: (msg) => {
              const iv = crypto.randomBytes(16);
              const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
              const data = Buffer.from(msg);
              let encryptData = cipher.update(data);
              encryptData = Buffer.concat([iv, encryptData, cipher.final()]).toString('base64');

              return encryptData;
            }
          });


          clearTimeout(authTimer);

          log(`WebSocket: authentication succeed: [${ip}] user=${id} token=${token}`);
          ws.send(`auth-success;${token}`);
        }

        // ng
        else {
          correctAnswers = null;
          clearTimeout(authTimer);

          log(`WebSocket: authentication failed: [${ip}] ${msg}`);
          ws.close();
          ws.terminate();
        }
      }

      // encrypted message
      else {
        msg = decrypt(msg);

        try {
          if (msg === '') throw new Error('invalid message');

          msg = msg.split(';');
          if (msg[0] !== 'update-pos') throw new Error('invalid command');
          else if (msg[1] !== token) throw new Error('invalid token');
          else if (!(msg[2].length > 0)) throw new Error('invalid posdata');
        }
        catch (e) {
          log(`WebSocket: ERROR: ${e}:  [${ip}] ${id}: ${msg}`);
          ws.close();
          ws.terminate();
          return;
        }

        // valid message
        log(`WebSocket: update-pos: ${id}: ${msg[2]}`);

        clients.forEach((client) => {
          const encryptData = client.encrypt(`update-pos;${msg[2]}`);
          if (client.ws !== ws && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(encryptData);
          }
        });

        // // encrypt message
        // const encryptData = encrypt(`update-pos;${msg[2]}`);

        // // broadcast posdata excluding itself
        // wss.clients.forEach((client) => {
        //   if (client !== ws && client.readyState === WebSocket.OPEN) {
        //     client.send(encryptData);
        //   }
        // });
      }
    });

    // connection keep alive (returns pong automatically)
    // ws.on('ping', () => log(`WebSocket: ping: ${id}`));

    ws.on('close', (code, reason) => {
      log(`WebSocket: connection closed: [${ip}] ${id} token=${token} code=${code} reason=${decoder.decode(reason)}`);
      ws.terminate();
    })
    ws.on('error', (e) => {
      log(`WebSocket: ERROR: connection error: ${JSON.stringify(e)}: [${ip}] ${id} token=${token}`);
    });


    // function encrypt(msg) {
    //   const iv = crypto.randomBytes(16);
    //   const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    //   const data = Buffer.from(msg);
    //   let encryptData = cipher.update(data);
    //   encryptData = Buffer.concat([iv, encryptData, cipher.final()]).toString('base64');

    //   return encryptData;
    // }

    function decrypt(encryptData, iv) {
      let msg;
      try {
        const buff = Buffer.from(encryptData, 'base64');
        const iv = buff.slice(0, 16);
        encryptData = buff.slice(16);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        const data = decipher.update(encryptData);
        msg = Buffer.concat([data, decipher.final()]).toString('utf8');
      }
      catch (e) {
        msg = '';
      }

      return msg;
    }
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
