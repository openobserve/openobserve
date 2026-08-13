const { test, expect } = require('@playwright/test');
const { runFlow } = require('../utils/maestro');
const { pollUntil, search } = require('../utils/ooClient');
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

      // 2. API — the crash event landed in _rumdata. Poll until the CRASH row specifically appears:
      // a handled/network error may ingest first, so returning on the first error row (minHits:1)
      // could see `crash === undefined` and false-fail this @P0.
      const isCrash = (e) => (e.error_message || '').includes('intentional uncaught crash');
      const errors = await pollUntil(
        () =>
          search(
            `SELECT session_id, error_message, error_is_crash, _timestamp FROM ${cfg.RUM_STREAM} ` +
              `WHERE service='${cfg.RN_SERVICE}' AND type='error' ORDER BY _timestamp DESC`,
            start,
          ),
        (rows) => rows.some(isCrash),
        { tries: 20, delayMs: 5000 },
      );
      const crash = errors.find(isCrash);
      expect(crash, 'crash event ingested to _rumdata').toBeTruthy();
      const sessionId = crash.session_id;

      // 3. UI — the crashed session is viewable in the dashboard. In CI the from-source build always
      // serves /web (fail hard if not); locally a minimal binary may not (skip). The P0 data
      // assertions above always run.
      const dash = new RumDashboardPage(page);
      await dash.ensureServedOrSkip(test);
      await dash.login();
      await dash.openSession(sessionId);
      await dash.expectSessionViewable();
    },
  );

  // Known bug o2-enterprise#2289 — the Error Tracking tab can't display errors (placeholder query +
  // HTTP 429). Skipped until fixed, but with a REAL body so removing `.fixme` runs an actual check
  // (not a green no-op): once fixed, the ingested crash must be listed in Error Tracking.
  test.fixme(
    'crash is inspectable in the Error Tracking tab (o2-enterprise#2289)',
    { tag: ['@mobile', '@rn-android', '@crash', '@known-bug'] },
    async ({ page }) => {
      const dash = new RumDashboardPage(page);
      await dash.ensureServedOrSkip(test);
      await dash.login();
      await dash.openErrorTracking();
      await dash.expectErrorListed('intentional uncaught crash');
    },
  );
});
