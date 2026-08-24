const { maskingSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

// SampleApplication enables Session Replay with TextAndInputPrivacy.MASK_ALL, so no on-screen text
// (incl. the Checkout email/card) may appear in the recorded replay.
maskingSuite({
  name: 'Android-native · Session Replay privacy masking',
  tags: ['@mobile', '@android-native'],
  service: cfg.NATIVE_ANDROID_SERVICE,
  pii: ['alex.morgan@example.com', '4242 4242 4242 4242'],
  flows: ['android-native/masking.yaml'],
});
