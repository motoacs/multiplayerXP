
const {
  openDir,
  readJson,
  writeJson,
  start,
  stop,
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
      this.log('created: Vue.js instance created');
      this.log('created: loading setting.json');
      await this.loadConfig();

      // open setting modal if "X-Plane 11" dir invalid
      const x = this.settingJson.xplaneDir;
      if (x == null || typeof x !== 'string' || x.length < 10) {
        this.log(`created: open setting modal: xplaneDir = ${this.settingJson.xplaneDir}`);
        this.settingModalShow = true;
      }
    },

    methods: {
      start() {
        this.connected = true;
        this.notice('Connected!', 'success', 8000);
        this.log('start: connect');
      },

      stop() {
        this.connected = false;
        this.notice('Disconnected', '', 8000);
        this.log('stop: disconnect');
      },

      async loadConfig() {
        const ret = await readJson();

        if (ret == null) {
          this.log('loadConfig: cannot load setting.json');
          writeJson(JSON.stringify(this.settingJson, undefined, 2))
          this.log('loadConfig: setting.json created by default data');
        }
        else {
          this.settingJson = ret;
          this.tempSettingData.id = (this.settingJson.id != null) ? this.settingJson.id : '';
          this.tempSettingData.pass = (this.settingJson.pass != null) ? this.settingJson.pass : '';
          this.tempSettingData.server = (this.settingJson.server != null) ? this.settingJson.server : '';
          this.tempSettingData.callsign = (this.settingJson.callsign != null) ? this.settingJson.callsign : '';
          this.tempSettingData.xplaneDir = (this.settingJson.xplaneDir != null) ? this.settingJson.xplaneDir : '';
          this.log('loadConfig: setting.json loaded');
        }

        return Promise.resolve();
      },

      async saveConfig() {
        this.settingJson = this.tempSettingData;
        const ret = await writeJson(JSON.stringify(this.settingJson, undefined, 2));
        console.log(ret);
        if (ret) {
          this.notice('Saved', 'success', 8000);
          this.log('saveConfig: config saved');
        }
        else {console.log(120);
          this.notice('Error: failed to save settings to "setting.json"', 'warning', 15000);
          this.log('saveConfig: Error: failed write setting.json');
        }
      },

      setTab(index) {
        this.tab = index;
      },

      async onOpenDirClicked() {
        this.log('onOpenDirClicked: open directory dialog');
        this.tempSettingData.xplaneDir = await openDir();
        this.log(`onOpenDirClicked: ret = ${this.tempSettingData.xplaneDir}`);
      },

      async onSettingsOkClicked() {
        this.settingJson.xplaneDir = this.tempSettingData.xplaneDir;
        const ret = await writeJson(JSON.stringify(this.settingJson, undefined, 2));
        if (ret) {
          this.notice('Saved', 'success', 8000);
          this.log('onSettingsOkClicked: config saved');
          this.settingModalShow = false;
        }
        else {
          this.notice('Error: failed to save settings to "setting.json"', 'warning', 15000);
          this.log('onSettingsOkClicked: Error: failed write setting.json');
        }
      },

      onSettingsCancelClicked() {
        this.log('onSettingsCancelClicked: undo changes');
        this.tempSettingData.xplaneDir = this.settingJson.xplaneDir;
        this.settingModalShow = false;
      },

      notice(text = '', type = '', duration = 0) {
        if (this.notification.timeoutId !== null) clearTimeout(this.notification.timeoutId);

        this.notification.text = text;
        this.notification.type = type;

        if (duration) this.notification.timeoutId = setTimeout(this.onCloseNotificationClicked.bind(this), duration);
      },

      onCloseNotificationClicked() {
        this.notification.text = '';
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
