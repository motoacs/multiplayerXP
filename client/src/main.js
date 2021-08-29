const fs = require('fs').promises;
const dgram = require('dgram');
let sender;

const OUTPUT_PATH = 'D:\\Games\\SteamLibrary\\steamapps\\common\\X-Plane 11\\Output\\';
const CSV_FILENAME = /LTExportFD - 20\d\d-\d\d-\d\d \d\d\.\d\d\.\d\d.csv/;
let latestFilePath = '';

let csvLastModified = 0;

// initialize
async function initialize() {
  const dir = await fs.readdir(OUTPUT_PATH);
  console.log(dir);

  const csvFilesArr = dir.filter((fileName) => fileName.match(CSV_FILENAME));
  console.log(csvFilesArr);
  latestFilePath = `${OUTPUT_PATH}${csvFilesArr.pop()}`;


  sender = dgram.createSocket({
    type: 'udp4',
    reuseAddr: true,
    sendBufferSize: 1024,
  });


  main();
  setInterval(main, 2500);
}


async function main() {
  let ret = await scan();
  if (ret === null) return;

  let csvArr = ret.split('\r\n');
  // csvArr = csvArr.reverse();
  let processing = true;

  do {
    const line = csvArr.pop();
    if (line.length > 0 && !line.startsWith('{')) {
      log(`sending: ${line}`);
      sendToLiveTraffic(line);
      processing = false;
    }
  }
  while (processing);
}


function scan() {
  return new Promise(async (resolve, reject) => {
    const stat = await fs.stat(latestFilePath);
    // console.log(stat.mtime.getTime());

    // 最後に読み取ってから編集されていなかったら
    if (stat.mtime.getTime() === csvLastModified) {
      log('csv no updated');
      resolve(null);
      return;
    }
    csvLastModified = stat.mtime.getTime();

    const file = await fs.readFile(latestFilePath, { encoding: 'utf8' });
    log(`csv updated!`);
    // log(`csv modified!\n${file}`);
    resolve(file);
  });
}


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
// utils
// ============================

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