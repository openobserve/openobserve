const { logsSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

logsSuite({
  name: 'Android-native · Logs upload (multi-event batch)',
  tags: ['@mobile', '@android-native'],
  service: cfg.NATIVE_ANDROID_SERVICE,
  flows: ['android-native/logs.yaml'],
});
