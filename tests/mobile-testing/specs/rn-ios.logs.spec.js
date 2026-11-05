const { logsSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

logsSuite({
  name: 'RN iOS · Logs upload (multi-event batch)',
  tags: ['@mobile', '@rn-ios'],
  service: cfg.RN_SERVICE,
  flows: ['ios-react-native/logs.yaml'],
  device: cfg.IOS_SIM_UDID,
});
