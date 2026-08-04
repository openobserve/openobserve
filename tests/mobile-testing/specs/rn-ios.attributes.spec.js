const { attributesSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

attributesSuite({
  name: 'RN iOS · Attributes / tagging',
  tags: ['@mobile', '@rn-ios'],
  service: cfg.RN_SERVICE,
  env: cfg.RN_ENV,
  flows: ['ios-react-native/network.yaml'],
  device: cfg.IOS_SIM_UDID,
});
