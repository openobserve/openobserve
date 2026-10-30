const { coreRumSuite } = require('../utils/coreRumSpec');
const cfg = require('../utils/config');

coreRumSuite({
  name: 'Android-native · core RUM',
  tags: ['@mobile', '@android-native'],
  flows: ['android-native/interactions.yaml', 'android-native/crash.yaml'],
  service: cfg.NATIVE_ANDROID_SERVICE,
  expectedSource: 'android',
  viewSubstring: 'MainActivity',
});
