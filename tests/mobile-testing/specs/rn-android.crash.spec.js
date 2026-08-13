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

      // 3. UI — the crashed session is viewable in the dashboard. Only when this OpenObserve serves
      // its web UI (a minimal from-source binary may not); the P0 data assertions above always run.
      const dash = new RumDashboardPage(page);
      if (await dash.dashboardServed()) {
        await dash.login();
        await dash.openSession(sessionId);
        await dash.expectSessionViewable();
      } else {
        test.info().annotations.push({
          type: 'ui-skipped',
          description: 'OpenObserve web UI not served — crash-ingest asserted, viewable check skipped',
        });
      }
    },
  );

  // Known bug o2-enterprise#2289 — the Error Tracking tab can't display errors
  // (placeholder query + HTTP 429). Skipped until fixed.
  test.fixme(
    'crash is inspectable in the Error Tracking tab (o2-enterprise#2289)',
    { tag: ['@mobile', '@rn-android', '@crash', '@known-bug'] },
    async () => {},
  );
});
