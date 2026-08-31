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
  // NOTE: the NATIVE iOS SDK uses OpenObserve's correct /replay endpoint, so this uploads + renders and
  // runs as a hard P0 (unlike RN iOS — see rn-ios.masking / openobserve#13942).
});
