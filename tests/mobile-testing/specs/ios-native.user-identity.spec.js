const { userIdentitySuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

// AppDelegate calls OpenObserve.setUserInfo(id="native-ios-001", email="alex.morgan@example.com").
userIdentitySuite({
  name: 'iOS-native · User identity (setUserInfo)',
  tags: ['@mobile', '@ios-native'],
  service: cfg.NATIVE_IOS_SERVICE,
  userEmail: 'alex.morgan@example.com',
  flows: ['ios-native/interactions.yaml'],
  device: cfg.IOS_SIM_UDID,
});
