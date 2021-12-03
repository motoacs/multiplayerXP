const {
  getSetting,
  manipulateAccount,
} = window.api;

let app;

Vue.prototype.$sanitize = filterXSS;

window.onload = () => {
  app = new Vue({
    el: '#app',

    data() {
      return {
        server: '',
        id: '',
        pass: '',
        inCreateProcess: false,
        inDeleteProcess: false,
        modalOpen: false,
        modalTitle: '',
        modalText: '',
      };
    },

    async mounted() {
      let setting = await getSetting();
      setting = JSON.parse(setting);
      this.server = setting.server;
      this.id = setting.id;
      this.pass = setting.pass;
    },

    methods: {
      async createAccount() {
        this.inCreateProcess = true;

        const ret = await manipulateAccount('create', JSON.stringify({
          server: this.server,
          id: this.id,
          pass: this.pass,
        }));
        console.log(`createAccount: Done: ${ret}`);

        this.inCreateProcess = false;
        if (ret === '200') {
          this.modalTitle = 'Success';
          this.modalText = `Account "${this.id}" has been created successfully.`;
        }
        else {
          this.modalTitle = 'Error';
          this.modalText = `Failed to create an account "${this.id}". `;
          if (ret === '400') this.modalText += 'Make sure your client is up to date.<br>[400]  Cipher Error';
          else if (ret === '401') this.modalText += 'Make sure your client is up to date.<br>[401]  Checksum Error';
          else if (ret === '409') this.modalText += 'Please use another ID.<br>[409]  Unavailable ID';
          else this.modalText += `Please check the server address, network connection and server status.<br>[${ret}]  Unknown Error`;
        }
        this.modalOpen = true;
      },

      async deleteAccount() {
        this.inDeleteProcess = true;

        const ret = await manipulateAccount('delete', JSON.stringify({
          server: this.server,
          id: this.id,
          pass: this.pass,
        }));
        console.log(`deleteAccount: Done: ${ret}`);

        this.inDeleteProcess = false;
        if (ret === '200') {
          this.modalTitle = 'Success';
          this.modalText = `Account "${this.id}" has been deleted successfully.`;
        }
        else {
          this.modalTitle = 'Error';
          this.modalText = `Failed to delete an account "${this.id}". `;
          if (ret === '400') this.modalText += 'Make sure your client is up to date.<br>[400]  Cipher Error';
          else if (ret === '401') this.modalText += 'Make sure your client is up to date.<br>[401]  Checksum Error';
          else if (ret === '403') this.modalText += 'Please enter the correct password.<br>Resetting the password is not possible. Please create a new account.<br>[403]  Incorrect password';
          else if (ret === '404') this.modalText += 'Please enter the correct ID.<br>[404]  Unknown ID';
          else this.modalText += `Please check the server address, network connection and server status.<br>[${ret}]  Unknown Error`;
        }
        this.modalOpen = true;
      },
    },
  });
};
