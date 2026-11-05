const { logsSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

logsSuite({
  name: 'iOS-native · Logs upload (multi-event batch)',
  tags: ['@mobile', '@ios-native'],
  service: cfg.NATIVE_IOS_SERVICE,
  flows: ['ios-native/logs.yaml'],
  device: cfg.IOS_SIM_UDID,
});
