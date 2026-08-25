const { maskingSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

// This test currently FAILS by design, until openobserve#13942 is fixed: on iOS the RN Session-Replay
// bridge posts segments to Datadog's `/api/v2/replay` instead of OpenObserve's `/replay`, so they are
// rejected (401) and ZERO segments reach `_sessionreplay` — session replay silently records nothing on
// RN iOS. The P0 upload assertion in maskingSuite therefore fails (0 segments) and will PASS on its own
// the moment the SDK is fixed. No skip / no expected-fail marker — a real red until it's fixed.
// (RN Android is unaffected — see rn-android.masking. The fix lives in openobserve-react-native-rum.)
maskingSuite({
  name: 'RN iOS · Session Replay privacy masking',
  tags: ['@mobile', '@rn-ios'],
  service: cfg.RN_SERVICE,
  pii: ['alex.morgan@example.com', '4242 4242 4242 4242'],
  flows: ['ios-react-native/masking.yaml'],
  device: cfg.IOS_SIM_UDID,
});
