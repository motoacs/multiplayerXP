const fs = require('fs').promises;
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');
const validator = require('validator');
const xss = require('xss');

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SETTING_JSON_PATH = '../data/setting.json';

let setting;
let wss;
let logs = [];
let clients = [];

Vue.prototype.$sanitize = filterXSS;

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
      port      : Number(setting.port),
      maxPayload: 1024,
      // clientTracking: true,
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
    // account manipulation
    const account = {
      rsa: {
        publicKey: '',
        privateKey: '',
      },
      clientHash: '',
      serverHash: '',
      checkHash: '',
    };
    let authTimer = null;

    // deny ip check
    if (setting.deny.includes(ip)) {
      log(`WebSocket: deny ip: [${ip}]`);
      ws.close();
      ws.terminate();
      ws = null;
    }

    log(`WebSocket: new client connected: [${ip}]`);


    // =============================
    // authentication process
    // =============================
    let { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 4096,
    });
    let pem = publicKey.export({type: 'pkcs1', format: 'pem'});

    // challenge
    log(`WebSocket: start authentication: [${ip}] publicKey=${pem}`);
    ws.send(`auth-required;${pem}`);
    pem = null;

    // timeout
    authTimer = setTimeout(() => {
      if (token.length !== 64) {
        log(`WebSocket: ERROR: authentication timeout: [${ip}]`);
        ws.close();
      }
    }, 5000);


    // message listener
    ws.on('message', (msg) => {
      // validation
      try {
        msg = String(msg);
        if (msg == null || msg.length === 0) return;
      }
      catch (e) {
        return;
      }

      // sanitize

      // authentication
      if (msg.startsWith('auth-request;')) {
        const encryptedPayload = msg.split(';')[1];
        let payload

        try {
          payload = crypto.privateDecrypt(
            {
              key :privateKey,
              padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
              oaepHash: "sha256",
            },
            Buffer.from(encryptedPayload, 'base64'),
          );
        }
        catch (e) {
          log(`WebSocket: authentication Error: decrypt failed`);
          ws.send('auth-result;400');
          ws.close();
        }
        log(`WebSocket: authentication: ${String(payload)}`)
        const [receivedId, receivedPass, aesPass, aesSalt] = String(payload).split(';');

        const user = setting.users.find((user) => user.id === receivedId);
        // id not found
        if (user == null) {
          log(`WebSocket: authentication failed: [${ip}] [404] ${receivedId} ${receivedPass}`);
          ws.send('auth-result;404');
          ws.close();
          clearTimeout(authTimer);
          return;
        }
        // incorrect password
        if (user.pass !== receivedPass) {
          log(`WebSocket: authentication failed: [${ip}] [403] ${receivedId} ${receivedPass}`);
          ws.send('auth-result;403');
          ws.close();
          clearTimeout(authTimer);
          return;
        }

        // success
        id = receivedId;
        key = crypto.scryptSync(aesPass, aesSalt, 32);

        clients.push({
          ws,
          id,
          encrypt: (msg) => {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
            let encryptData = cipher.update(Buffer.from(msg));
            encryptData = Buffer.concat([iv, encryptData, cipher.final()]).toString('base64');

            return encryptData;
          }
        });

        clearTimeout(authTimer);

        log(`WebSocket: authentication succeed: [${ip}] user=${id}`);
        ws.send('auth-result;200');
      }

      // account manipulation request
      else if (msg.startsWith('account-getkey')) {
        log('WebSocket: account-getkey');
        account.clientHash = msg.split(';')[1];
        account.rsa = crypto.generateKeyPairSync('rsa', {
          modulusLength: 2048,
        });
        account.serverHash = crypto.createHash('sha256').update(crypto.randomBytes(32).toString('base64')).digest('hex');
        account.checkHash = crypto.createHash('sha256').update(`${account.serverHash}${account.serverHash}${account.clientHash}${account.serverHash}`).digest('hex');

        // send RSA key and hash
        log(`WebSocket: account-getkey: account-key;${account.rsa.publicKey.export({type: 'pkcs1', format: 'pem'})};${account.serverHash}`);
        ws.send(`account-key;${account.rsa.publicKey.export({type: 'pkcs1', format: 'pem'})};${account.serverHash}`);
      }

      // create or delete account
      else if (msg.startsWith('account-create') || msg.startsWith('account-delete')) {
        log(`WebSocket: account-create: ${msg}`);
        const encryptedPayload = msg.split(';')[1];
        // decrypt payload data
        const payload = crypto.privateDecrypt(
          {
            key :account.rsa.privateKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: "sha256",
          },
          Buffer.from(encryptedPayload, 'base64'),
        );
        log(`WebSocket: account-create: ${payload}`);
        const [id, pass, checkHash] = String(payload).split(';');
        log(`WebSocket: account-create: ${id} ${pass} ${checkHash}`);

        // invalid check hash
        if (checkHash !== account.checkHash) {
          log('WebSocket: account-manipulation: ERROR: invalid checkHash');
          ws.send('account-result;401');
          ws.close();
        }

        // create account
        if (msg.startsWith('account-create')) {
          // conflict user name
          if (setting.users.some((user) => user.id === id)) {
            ws.send('account-result;409');
            ws.close();
          }
          else {
            setting.users.push({
              id,
              pass,
            });
            writeSettingJson();
            ws.send('account-result;200');
          }
        }

        // delete account
        else if (msg.startsWith('account-delete')) {
          // user not found
          if (!setting.users.some((user) => user.id === id)) {
            ws.send('account-result;404');
            ws.close();
            return;
          }

          // invalid password
          if (setting.users.find((user) => user.id === id).pass !== pass) {
            ws.send('account-result;403');
            ws.close();
            return;
          }

          // delete
          setting.users.splice(
            setting.users.findIndex((user) => user.id === id),
            1,
          );
          writeSettingJson();
          ws.send('account-result;200');
        }
      }

      // encrypted message
      else {
        msg = decrypt(msg);

        try {
          if (msg === '') throw new Error('invalid message');

          const msgArr = msg.split(';');
          if (msgArr[0] !== 'update-pos') throw new Error('invalid command');
          else if (msgArr[1] !== id) throw new Error('invalid id');
          else if (!(msgArr[2].length > 0)) throw new Error('invalid posdata');
        }
        catch (e) {
          log(`WebSocket: ERROR: ${e}:  [${ip}] ${msg}`);
          ws.close();
          return;
        }

        // valid message
        log(`WebSocket: ${msg}`);

        clients.forEach((client) => {
          if (client.id !== id && client.ws.readyState === WebSocket.OPEN) {
            const encryptData = client.encrypt(msg);
            client.ws.send(encryptData);
          }
        });
      }
    });


    ws.on('close', (code, reason) => {
      log(`WebSocket: connection closed: [${ip}] ${id} token=${token} code=${code} reason=${decoder.decode(reason)}`);
      ws.terminate();
    })
    ws.on('error', (e) => {
      log(`WebSocket: ERROR: connection error: ${JSON.stringify(e)}: [${ip}] ${id} token=${token}`);
    });


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
  return new Promise(async (resolve) => {
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

async function writeSettingJson() {
  try {
    await fs.writeFile(SETTING_JSON_PATH, JSON.stringify(setting, undefined, 2));
  }
  catch (e) {
    log(`writeJSON: ERROR: ${JSON.stringify(e)}`);
    return;
  }
  return;
}
