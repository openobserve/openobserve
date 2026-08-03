const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');
const path = require('path');
const { runFlow } = require('../utils/maestro');
const { search, pollUntil } = require('../utils/ooClient');
const cfg = require('../utils/config');

const ANDROID_HOME =
  process.env.ANDROID_HOME || '/opt/homebrew/share/android-commandlinetools';
const ADB = path.join(ANDROID_HOME, 'platform-tools', 'adb');
const sh = (c) => execSync(c, { stdio: 'ignore' });

test.describe('RN Android · Background/foreground continuity', () => {
  test(
    'the session continues across a true background/foreground cycle',
    { tag: ['@mobile', '@rn-android', '@lifecycle', '@P1'] },
    async () => {
      const start = Date.now() - 30000;

      // Record a view, then background with HOME.
      runFlow('react-native/bg-fg-before.yaml');
      sh(`"${ADB}" shell input keyevent KEYCODE_HOME`);
      await new Promise((r) => setTimeout(r, 3000));

      // Foreground the SAME process (am start resumes; it does not force-stop),
      // then record another view.
      sh(`"${ADB}" shell am start -n ${cfg.RN_ANDROID_APP_ID}/.MainActivity`);
      await new Promise((r) => setTimeout(r, 2000));
      runFlow('react-native/bg-fg-after.yaml');

      // The pre-background and post-foreground views must share ONE session_id.
      const rows = await pollUntil(
        () =>
          search(
            `SELECT session_id, view_name FROM ${cfg.RUM_STREAM} ` +
              `WHERE service='${cfg.RN_SERVICE}' AND type='view' ` +
              `AND view_name IN ('Details','Checkout')`,
            start,
          ),
        (r) => {
          const names = new Set(r.map((x) => x.view_name));
          return names.has('Details') && names.has('Checkout');
        },
        { tries: 24, delayMs: 5000 },
      );

      expect(rows.length, 'both views recorded').toBeGreaterThan(0);
      const sessions = new Set(rows.map((r) => r.session_id));
      expect(sessions.size, 'Details (pre-bg) and Checkout (post-fg) are the same session').toBe(1);
    },
  );
});
