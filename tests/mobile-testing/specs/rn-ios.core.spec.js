const { coreRumSuite } = require('../utils/coreRumSpec');
const cfg = require('../utils/config');

// RN-iOS shares the o2-rum-tester service with RN-Android; the recent time window isolates
// this run (only the iOS simulator is driven here). Distinguish platforms by os/device, not source.
coreRumSuite({
  name: 'RN-iOS · core RUM',
  tags: ['@mobile', '@rn-ios'],
  flows: ['ios-react-native/interactions.yaml', 'ios-react-native/crash.yaml'],
  service: cfg.RN_SERVICE,
  expectedSource: 'react-native',
  viewSubstring: 'Home',
  device: cfg.IOS_SIM_UDID,
});
