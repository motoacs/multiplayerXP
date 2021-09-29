
const {
  fs,
  dgram,
  WebSocket,
  crypto,
} = window.api;

const encoder = new TextEncoder();
const decoder = new TextDecoder();


let app;

function init() {
  app = new Vue({
    el: '#app',

    data: {
      logs: [],
      settingJsonPath: './setting.json',
      settingJson: {},
      notification: "this is vue"
    },

    async created() {
      this.settingJson = await this.getJSON(this.settingJsonPath);
    },

    methods: {
      getJSON(path) {
        return new Promise(async (resolve) => {
          let json;
          try {
            json = await fs.readFile(path, { encoding: 'utf8' });
            json = JSON.parse(json);
          }
          catch (e) {
            this.log(`getJSON: ERROR: ${e}`);
            resolve(null);
            return;
          }

          resolve(json);
        });
      },


      log(logTxt) {
        const d = new Date();
        const da = [
          `0${d.getHours()}`.slice(-2),
          `0${d.getMinutes()}`.slice(-2),
          `0${d.getSeconds()}`.slice(-2),
        ];
        // hh:mm:ss
        const ds = da.join(':');
        const line = `[${ds}] ${logTxt}`;
        this.logs.push(line);
        console.log(line);
      },
    },
  });
}

window.onload = init;
