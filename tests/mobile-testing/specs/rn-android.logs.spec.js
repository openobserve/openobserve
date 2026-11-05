const { logsSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

logsSuite({
  name: 'RN Android · Logs upload (multi-event batch)',
  tags: ['@mobile', '@rn-android'],
  service: cfg.RN_SERVICE,
  flows: ['react-native/logs.yaml'],
});
