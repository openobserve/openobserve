const { userIdentitySuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

userIdentitySuite({
  name: 'RN Android · User identity (setUser)',
  tags: ['@mobile', '@rn-android'],
  service: cfg.RN_SERVICE,
  userEmail: 'alex.morgan@example.com',
  flows: ['react-native/network.yaml'],
});
