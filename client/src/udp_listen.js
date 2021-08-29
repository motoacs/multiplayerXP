// UDP module
const dgram = require('dgram');

// UDP socket
const receiver = dgram.createSocket({
  type: 'udp4',
  reuseAddr: true,
  recvBufferSize: 1024,
});

receiver.on('listening', () => {
  const address = receiver.address();
  log(`socket listening ${address.address}:${address.port}`);
});

receiver.on('message', (msg, rinfo) => {
  if (!String(msg).startsWith('XGPSLiveTraffic')) return;

  log(`[${rinfo.address}:${rinfo.port}] ${msg}`);
});

receiver.on('error', (err) => {
  log(`UDP socket error: ${err.stack}`);
  receiver.close();
})

receiver.bind(49003);

// Console Output
function log(logTxt) {
  const d = new Date();
  const da = [];
  da.push(`0${d.getHours()}`.slice(-2));
  da.push(`0${d.getMinutes()}`.slice(-2));
  da.push(`0${d.getSeconds()}`.slice(-2));
  const ds = da.join(':');

  console.log(`[${ds}] ${logTxt}`);
}

// node --experimental-modules  main.js