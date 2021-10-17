// UDP module
import dgram from 'dgram';

// Options
const CALLSIGN = 'RYR123';
const ICAO = '1234567';

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

  // log(`[${rinfo.address}:${rinfo.port}] ${msg}`);
  convert(String(msg));
});

receiver.on('error', (err) => {
  log(`UDP socket error: ${err.stack}`);
  receiver.close();
})

receiver.bind(49002);



const sender = dgram.createSocket({
  type: 'udp4',
  reuseAddr: true,
  sendBufferSize: 1024,
});



function convert(msg) {
  const arr = msg.split(',');
  const longitude = arr[1];
  const latitude  = arr[2];
  const altitudeInMeters = arr[3];
  const track     = arr[4];
  const gspeed    = arr[5];

  const outputArr = [
    'AITFC',
    ICAO,
    latitude,
    longitude,
    Math.round(altitudeInMeters * 3.28084), // altitude  m -> ft
    0, // Traffic vertical speed - float (ft/min)
    (gspeed * 1.94384 > 30 ? 1 : 0), // Airborne boolean flag - 1 or 0: 1=airborne; 0=surface
    Math.round(track),
    Math.round(gspeed * 1.94384), // Velocity knots - float
    CALLSIGN,
    'B737', // Aircraft
    'TEST', // Registry Number
    '', // Dep
    '', // Arr
    String(Date.now()).slice(0, -3), // UNIX time without msec
  ];
  const outputData = outputArr.join(',');

  log(outputData);
  sendToLiveTraffic(outputData);
}

let count = 0;

function sendToLiveTraffic(msg) {
  if (count < 3) {
    count += 1;
    return;
  }
  count = 0;
  sender.send(
    msg,
    49003,
    (ret) => console.log(ret),
  );
}

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