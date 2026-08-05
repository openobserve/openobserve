const { attributesSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

attributesSuite({
  name: 'Android-native · Attributes / tagging',
  tags: ['@mobile', '@android-native'],
  service: cfg.NATIVE_ANDROID_SERVICE,
  env: 'testing',
  flows: ['android-native/interactions.yaml'],
});
