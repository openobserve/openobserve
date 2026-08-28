const { userIdentitySuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

// SampleApplication.kt calls OpenObserve.setUserInfo(id="native-001", email="alex.morgan@…").
userIdentitySuite({
  name: 'Android-native · User identity (setUserInfo)',
  tags: ['@mobile', '@android-native'],
  service: cfg.NATIVE_ANDROID_SERVICE,
  userEmail: 'alex.morgan@example.com',
  flows: ['android-native/interactions.yaml'],
});
