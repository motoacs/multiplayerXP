
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
      notification: {
        text: '',
        type: '',
        timeoutId: null,
      },
      tab: 0,
      connected: false,
    },

    computed: {
      notificationClass() {
        if (this.notification.type !== '') return `is-${this.notification.type}`;
        return '';
      },

      logLines() {
        return this.logs.join('\n');
      },
    },

    async created() {
      this.log('Vue.js instance created');
      this.settingJson = await this.getJSON(this.settingJsonPath);
      this.log('setting.json loaded');
    },

    methods: {
      start() {
        this.connected = true;
        this.notice('Connected!', 'success', 8000);
        this.log('connect');
      },

      stop() {
        this.connected = false;
        this.notice('Disconnected', '', 8000);
        this.log('disconnect');
      },

      loadConfig() {

      },

      saveConfig() {
        this.notice('Saved', 'success', 8000);
        this.log('config saved');
      },

      setTab(index) {
        this.tab = index;
      },

      notice(text = '', type = '', duration = 0) {
        if (this.notification.timeoutId !== null) clearTimeout(this.notification.timeoutId);

        this.notification.text = text;
        this.notification.type = type;

        if (duration) this.notification.timeoutId = setTimeout(this.closeNotification.bind(this), duration);
      },

      closeNotification() {
        this.notification.text = '';
      },

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
        const text = `[${ds}] ${logTxt}`;

        if (this.logs.length > 20) this.logs.pop();
        this.logs.unshift(text);
        console.log(text);
      },
    },
  });
}

window.onload = init;
