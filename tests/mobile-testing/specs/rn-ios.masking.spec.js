const { maskingSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

// KNOWN BUG — openobserve#13942: on iOS the RN Session-Replay bridge posts segments to Datadog's
// `/api/v2/replay` instead of OpenObserve's `/replay`, so they are rejected (401) and ZERO segments
// reach `_sessionreplay` — session replay silently records nothing on RN iOS. This test still RUNS and
// is marked EXPECTED-TO-FAIL (test.fail) on the P0 upload assertion — it is NOT skipped: it reports as
// a known failure and the run goes RED (unexpected pass) the day the SDK is fixed, so this marker gets
// removed. (RN Android is unaffected — see rn-android.masking. Fix lives in openobserve-react-native-rum.)
maskingSuite({
  name: 'RN iOS · Session Replay privacy masking',
  tags: ['@mobile', '@rn-ios'],
  service: cfg.RN_SERVICE,
  pii: ['alex.morgan@example.com', '4242 4242 4242 4242'],
  flows: ['ios-react-native/masking.yaml'],
  device: cfg.IOS_SIM_UDID,
  knownReplayBug: 'openobserve#13942',
});
