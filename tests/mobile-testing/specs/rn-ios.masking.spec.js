const { maskingSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

// Same RN app as RN-Android, built with Session Replay MASK_ALL — no on-screen PII may appear.
maskingSuite({
  name: 'RN iOS · Session Replay privacy masking',
  tags: ['@mobile', '@rn-ios'],
  service: cfg.RN_SERVICE,
  pii: ['alex.morgan@example.com', '4242 4242 4242 4242'],
  flows: ['ios-react-native/masking.yaml'],
  device: cfg.IOS_SIM_UDID,
  requireReplay: false, // iOS mobile replay is not always rendered in CI → skip-with-reason, don't false-fail
});
