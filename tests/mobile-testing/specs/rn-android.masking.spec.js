const { maskingSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

// The app is built with Session Replay textAndInputPrivacyLevel = MASK_ALL, so no on-screen
// text (incl. the Checkout email/card/password) may appear in the replay.
maskingSuite({
  name: 'RN Android · Session Replay privacy masking',
  tags: ['@mobile', '@rn-android'],
  service: cfg.RN_SERVICE,
  pii: ['alex.morgan@example.com', '4242 4242 4242 4242'],
  flows: ['react-native/masking.yaml'],
});
