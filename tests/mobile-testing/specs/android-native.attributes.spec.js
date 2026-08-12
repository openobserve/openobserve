const { attributesSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

attributesSuite({
  name: 'Android-native · Attributes / tagging',
  tags: ['@mobile', '@android-native'],
  service: cfg.NATIVE_ANDROID_SERVICE,
  env: cfg.RN_ENV,
  flows: ['android-native/interactions.yaml'],
});
