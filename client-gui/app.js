
const {
  fs,
  dgram,
  WebSocket,
  crypto,
  openDir,
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
      settingJson: {
        id: '',
        pass: '',
        server: '',
        callsign: '',
        xplaneDir: '',
      },

      // main settings
      tempSettingData: {
        id: '',
        pass: '',
        server: '',
        callsign: '',
        xplaneDir: '',
      },

      // notification
      notification: {
        text: '',
        type: '',
        timeoutId: null,
      },

      // setting modal
      settingModalShow: false,

      // info area
      tab: 0,

      // app status
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

      const x = this.settingJson.xplaneDir;
      if (x == null || typeof x !== 'string' || x.length < 10) this.settingModalShow = true;
      else this.tempSettingData.xplaneDir = x;

      this.tempSettingData.id = this.settingJson.id;
      this.tempSettingData.pass = this.settingJson.pass;
      this.tempSettingData.server = this.settingJson.server;
      this.tempSettingData.callsign = this.settingJson.callsign;
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

      async onOpenDirClicked() {
        this.tempSettingData.xplaneDir = await openDir();
      },

      onSettingsOkClicked() {
        this.settingJson.xplaneDir = this.tempSettingData.xplaneDir;
        this.settingModalShow = false;
      },

      onSettingsCancelClicked() {
        this.tempSettingData.xplaneDir = this.settingJson.xplaneDir;
        this.settingModalShow = false;
      },

      notice(text = '', type = '', duration = 0) {
        if (this.notification.timeoutId !== null) clearTimeout(this.notification.timeoutId);

        this.notification.text = text;
        this.notification.type = type;

        if (duration) this.notification.timeoutId = setTimeout(this.closeNotification.bind(this), duration);
      },

      onCloseNotificationClicked() {
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
