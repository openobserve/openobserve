const { noPhoneHomeAndroidSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

noPhoneHomeAndroidSuite({
  name: 'RN Android · Security (no-phone-home)',
  tags: ['@mobile', '@rn-android'],
  appId: cfg.RN_ANDROID_APP_ID,
});
