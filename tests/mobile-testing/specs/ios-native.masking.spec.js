const { maskingSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

// AppDelegate enables Session Replay with textAndInputPrivacyLevel .maskAll, so no on-screen text
// (incl. the Checkout email/card) may appear in the recorded replay.
maskingSuite({
  name: 'iOS-native · Session Replay privacy masking',
  tags: ['@mobile', '@ios-native'],
  service: cfg.NATIVE_IOS_SERVICE,
  pii: ['alex.morgan@example.com', '4242 4242 4242 4242'],
  flows: ['ios-native/masking.yaml'],
  device: cfg.IOS_SIM_UDID,
});
