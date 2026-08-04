const { bgFgSuite } = require('../utils/rumChecks');
const { runFlow } = require('../utils/maestro');
const { keyevent, startActivity } = require('../utils/adb');
const cfg = require('../utils/config');

bgFgSuite({
  name: 'RN Android · Background/foreground continuity',
  tags: ['@mobile', '@rn-android'],
  service: cfg.RN_SERVICE,
  viewA: 'Details', // recorded before backgrounding
  viewB: 'Checkout', // recorded after foregrounding
  // Android background/foreground via adb: HOME to background, `am start` to resume the SAME
  // process (it does not force-stop), so the session must continue.
  drive: async () => {
    runFlow('react-native/bg-fg-before.yaml');
    keyevent('KEYCODE_HOME');
    await new Promise((r) => setTimeout(r, 3000));
    startActivity(`${cfg.RN_ANDROID_APP_ID}/.MainActivity`);
    await new Promise((r) => setTimeout(r, 2000));
    runFlow('react-native/bg-fg-after.yaml');
  },
});
