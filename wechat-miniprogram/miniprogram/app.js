const config = require('./utils/config');

App({
  globalData: {
    cloudReady: false
  },

  onLaunch() {
    if (!wx.cloud) {
      return;
    }

    const cloudOptions = { traceUser: true };
    if (config.cloudEnv) {
      cloudOptions.env = config.cloudEnv;
    }

    try {
      wx.cloud.init(cloudOptions);
      this.globalData.cloudReady = true;
    } catch (error) {
      console.warn('Cloud init failed:', error);
    }
  }
});
