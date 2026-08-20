const { bgFgSuite } = require('../utils/rumChecks');
const { runFlow } = require('../utils/maestro');
const { keyevent, startActivity } = require('../utils/adb');
const cfg = require('../utils/config');

// Native Android background/foreground via adb: HOME to background, `am start` to resume the SAME
// process (it is not force-stopped), so the session must continue. MainActivity is recorded before
// backgrounding; navigating to Details after foregrounding records DetailsActivity in the same session.
bgFgSuite({
  name: 'Android-native · Background/foreground continuity',
  tags: ['@mobile', '@android-native'],
  service: cfg.NATIVE_ANDROID_SERVICE,
  viewA: 'MainActivity', // recorded before backgrounding
  viewB: 'DetailsActivity', // recorded after foregrounding
  drive: async () => {
    runFlow('android-native/bg-fg-before.yaml');
    keyevent('KEYCODE_HOME');
    await new Promise((r) => setTimeout(r, 3000));
    startActivity(`${cfg.NATIVE_ANDROID_APP_ID}/.MainActivity`);
    await new Promise((r) => setTimeout(r, 2000));
    runFlow('android-native/bg-fg-after.yaml');
  },
});
