const { coreRumSuite } = require('../utils/coreRumSpec');
const cfg = require('../utils/config');

coreRumSuite({
  name: 'iOS-native · core RUM',
  tags: ['@mobile', '@ios-native'],
  flows: ['ios-native/interactions.yaml', 'ios-native/crash.yaml'],
  service: cfg.NATIVE_IOS_SERVICE,
  expectedSource: 'ios',
  viewSubstring: 'MainViewController',
  device: cfg.IOS_SIM_UDID,
});
