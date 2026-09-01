const { maskingSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

// openobserve#13942 RESOLVED. Root cause was config on our side: the app double-pathed the replay
// endpoint (`customEndpoint + '/replay'`). The native SDK appends the replay path itself, and on iOS
// the malformed URL threw during init and cascaded to kill the WHOLE SDK — 0 telemetry AND 0 replay.
// Fixed in App.tsx (pass the RUM base only) + SDK bumped to 0.1.2. Validated locally on the simulator:
// RN-iOS telemetry (19 events) + session replay (7 segments) both land, so this P0 now passes.
maskingSuite({
  name: 'RN iOS · Session Replay privacy masking',
  tags: ['@mobile', '@rn-ios'],
  service: cfg.RN_SERVICE,
  pii: ['alex.morgan@example.com', '4242 4242 4242 4242'],
  flows: ['ios-react-native/masking.yaml'],
  device: cfg.IOS_SIM_UDID,
});
