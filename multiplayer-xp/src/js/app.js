
const {
  openDir,
  readJson,
  writeJson,
  openAccount,
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
      // player list
      players: [
        // {
        //   id      : 'Dummy',
        //   callsign: 'DMY012',
        //   longitude: '',
        //   latitude: '',
        //   aircraft: '',
        //   altitude: '',
        //   speed   : '',
        // }
      ],

      // app status
      started: false,
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

      // set IPC handler
      api.on('connected', this.onWSConnected.bind(this));
      api.on('disconnected', this.onWSDisconnected.bind(this));
      api.on('closed', this.onWSClosed.bind(this));
      api.on('auth-in-progress', this.onWSAuth.bind(this));
      api.on('auth-result', this.onWSAuthResult.bind(this));
      api.on('error', this.onWSError.bind(this));
      api.on('ws-send', this.onWSSend.bind(this));
      api.on('ws-recieve', this.onWSReceived.bind(this));
    },

    methods: {
      start() {
        // setting validation
        for (const prop in this.tempSettingData) {
          if (this.tempSettingData.hasOwnProperty(prop)) {
            this.tempSettingData[prop] = this.tempSettingData[prop].trim();
          }
        }
        const s = this.tempSettingData;

        if (!s.server.startsWith('ws://')) {
          this.notice('The server address must start with "ws://"', 'warning');
          return;
        }
        if (s.id.length < 1) {
          this.notice('ID is empty', 'warning');
          return;
        }
        if (s.pass.length < 1) {
          this.notice('Password is empty', 'warning');
          return;
        }
        if (s.callsign.length < 1) {
          this.notice('Callsign is empty', 'warning');
          return;
        }
        if (!s.xplaneDir.endsWith('X-Plane 11')) {
          this.notice('The "X-Plane 11" path is incorrect, please go to More Settings to set it', 'warning');
          return;
        }

        this.started = true;
        this.log('start: connecting...');
        window.api.start(JSON.stringify(this.tempSettingData));
      },

      stop() {
        this.log('stop: disconnecting...');
        window.api.stop();
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

      onOpenAccountClicked() {
        openAccount(JSON.stringify(this.tempSettingData));
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
          this.notice('Saved', 'success', 5000);
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

      // IPC handler
      onWSConnected() {
        this.log('onWSConnected: connected');
        this.log('onWSConnected: waiting for authentication process');
      },

      onWSDisconnected() {
        this.notice('Error: WebSocket connection disconnected. Reconnecting...', 'warning');
        this.log('onWSDisconnected: connection disconnected');
      },

      onWSClosed() {
        this.started = false;

        // this.notice('WebSocket connection closed', 'info', 30000);
        this.log('onWSClosed: connection closed');
      },

      onWSAuth() {
        this.log('onWSAuth: authentication in progress');
      },

      onWSAuthResult(code) {
        switch (code) {
          case '200':
            this.notice('Connected!', 'success', 8000);
            break;
          case '400':
            this.notice('Error: Cipher error', 'danger');
            break;
          case '403':
            this.notice('Error: Incorrect password', 'danger');
            break;
          case '404':
            this.notice('Error: Unknown ID', 'danger');
            break;
          default:

        }
        this.log(`onWSAuthResult: authentication: ${code}`);
      },

      onWSError(err) {
        this.notice(err, 'danger');
        this.log(`onWSError: ${err}`);
      },

      onWSSend(msg) {
        this.log(`onWSSend: WebSocket [Send] ${msg}`);
      },

      onWSReceived(msg) {
        this.log(`onWSReceived: WebSocket [Received] ${msg}`);
        const [cmd, playerId, posdata] = msg.split(';');
        const [
          aitfc,
          icao,
          latitude,
          longitude,
          altitude,
          verticalSpeed,
          airborneFlg,
          track,
          speed,
          callsign,
          aircraft,
          registry,
          dep,
          arr,
          time,
        ] = posdata.split(',');

        const idx = this.players.findIndex((data) => data.id === playerId);

        if (idx >= 0) {
          this.players[idx].latitude = latitude;
          this.players[idx].callsign = callsign;
          this.players[idx].longitude = longitude;
          this.players[idx].aircraft = aircraft;
          this.players[idx].speed = speed;
        }
        else {
          this.players.push({
            id: playerId,
            callsign,
            longitude,
            latitude,
            aircraft,
            speed,
          });
          this.players.sort((player) => player.id);
        }
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

  // navigation bar
  navbar = new Vue({
    el: '#navbar',

    data() {
      return {
        // navbar
        menuOpen: false,
        // modal
        modalAboutOpen: false,
      };
    },

    methods: {
      onOpenAccountClicked() {
        app.onOpenAccountClicked();
      },
    },
  });
}

window.onload = init;
