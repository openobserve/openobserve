const { userIdentitySuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

userIdentitySuite({
  name: 'RN iOS · User identity (setUser)',
  tags: ['@mobile', '@rn-ios'],
  service: cfg.RN_SERVICE,
  userEmail: 'alex.morgan@example.com',
  flows: ['ios-react-native/network.yaml'],
  device: cfg.IOS_SIM_UDID,
});
