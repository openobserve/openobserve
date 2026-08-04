const { noPhoneHomeAndroidSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

noPhoneHomeAndroidSuite({
  name: 'Android-native · Security (no-phone-home)',
  tags: ['@mobile', '@android-native'],
  appId: cfg.NATIVE_ANDROID_APP_ID,
});
