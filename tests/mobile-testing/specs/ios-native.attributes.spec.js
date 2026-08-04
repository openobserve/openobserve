const { attributesSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

attributesSuite({
  name: 'iOS-native · Attributes / tagging',
  tags: ['@mobile', '@ios-native'],
  service: cfg.NATIVE_IOS_SERVICE,
  env: 'testing',
  flows: ['ios-native/interactions.yaml'],
  device: cfg.IOS_SIM_UDID,
});
