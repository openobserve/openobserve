const { test, expect } = require('@playwright/test');
const { runFlow } = require('../utils/maestro');
const { q } = require('../utils/ooClient');
const { RumDashboardPage } = require('../pages/rumDashboardPage');
const cfg = require('../utils/config');

test.describe('RN Android · Crash reporting', () => {
  test(
    'native crash is ingested as a crash and the session is viewable',
    { tag: ['@mobile', '@rn-android', '@crash', '@P0'] },
    async ({ page }) => {
      const start = Date.now() - 30000;

      // 1. DRIVE — Maestro triggers the crash and relaunches to flush the report.
      runFlow('react-native/crash.yaml');

      // 2. API — the crash event landed in _rumdata.
      const errors = await q.errors(cfg.RN_SERVICE, start, { tries: 20, delayMs: 5000 });
      const crash = errors.find((e) =>
        (e.error_message || '').includes('intentional uncaught crash'),
      );
      expect(crash, 'crash event ingested to _rumdata').toBeTruthy();
      const sessionId = crash.session_id;

      // 3. UI — the crashed session is viewable in the dashboard.
      const dash = new RumDashboardPage(page);
      await dash.login();
      await dash.openSession(sessionId);
      await dash.expectSessionViewable(sessionId);
    },
  );

  // KNOWN BUG (o2-enterprise#2289): Error Tracking tab cannot display errors
  // (malformed default query + HTTP 429). test.fail keeps the suite green while
  // flagging the moment the bug is fixed (the test would then "unexpectedly pass").
  test(
    'crash is inspectable in the Error Tracking tab',
    { tag: ['@mobile', '@rn-android', '@crash', '@known-bug'] },
    async ({ page }) => {
      test.fail(true, 'Known bug o2-enterprise#2289 — Error Tracking tab errors out');
      const start = Date.now() - 30000;
      runFlow('react-native/crash.yaml');
      await q.errors(cfg.RN_SERVICE, start, { tries: 12, delayMs: 5000 });

      const dash = new RumDashboardPage(page);
      await dash.login();
      await dash.openErrorTracking();
      await expect(page.getByText('intentional uncaught crash')).toBeVisible({ timeout: 30000 });
    },
  );
});
