const { execSync } = require('child_process');
const { bgFgSuite } = require('../utils/rumChecks');
const { runFlow } = require('../utils/maestro');
const cfg = require('../utils/config');

// iOS background/foreground continuity. iOS has no adb, and Maestro's launchApp COLD-RESTARTS the app
// (→ a new RUM session), so we can't foreground with Maestro. Instead: a Maestro flow records
// MainViewController then backgrounds via the Home key; `simctl launch` re-activates the SAME process
// (no terminate → same session); a second Maestro flow then records DetailsViewController.
bgFgSuite({
  name: 'iOS-native · Background/foreground continuity',
  tags: ['@mobile', '@ios-native'],
  service: cfg.NATIVE_IOS_SERVICE,
  viewA: 'MainViewController', // recorded before backgrounding
  viewB: 'DetailsViewController', // recorded after foregrounding
  device: cfg.IOS_SIM_UDID,
  drive: async (device) => {
    runFlow('ios-native/bg-fg-before.yaml', { device });
    await new Promise((r) => setTimeout(r, 2000));
    // Foreground without terminating (Maestro launchApp would start a new session).
    execSync(`xcrun simctl launch ${device || 'booted'} ${cfg.NATIVE_IOS_APP_ID}`, { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 2000));
    runFlow('ios-native/bg-fg-after.yaml', { device });
  },
});
