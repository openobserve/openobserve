const { attributesSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

attributesSuite({
  name: 'RN Android · Attributes / tagging',
  tags: ['@mobile', '@rn-android'],
  service: cfg.RN_SERVICE,
  env: cfg.RN_ENV,
  flows: ['react-native/network.yaml'],
});
