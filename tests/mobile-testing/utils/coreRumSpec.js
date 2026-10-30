// Reusable "core RUM" suite for one mobile platform. Drives the app (Maestro), asserts the
// telemetry landed (API), asserts the crashed session is viewable (UI), and documents the
// known Error-Tracking outage as a skipped test that flips green when it's fixed.
const { test, expect } = require('@playwright/test');
const { runFlow } = require('./maestro');
const { search, pollUntil } = require('./ooClient');
const { RumDashboardPage } = require('../pages/rumDashboardPage');
const cfg = require('./config');

function coreRumSuite({ name, tags, flows, service, expectedSource, viewSubstring, device = '' }) {
  test.describe.configure({ mode: 'serial' });
  test.describe(name, () => {
    let start;
    let sessionId;
    let crashMessage;

    test.beforeAll(() => {
      start = Date.now() - 30000;
      for (const f of flows) runFlow(f, { device });
    });

    test(
      'telemetry: views, actions, handled error and native crash land in _rumdata',
      { tag: [...tags, '@P0'] },
      async () => {
        // Poll until the crash (last event) lands, then assert the whole surface.
        const rows = await pollUntil(
          () =>
            search(
              `SELECT session_id, type, source, view_name, error_message, error_is_crash ` +
                `FROM ${cfg.RUM_STREAM} WHERE service='${service}' ORDER BY _timestamp DESC`,
              start,
            ),
          (r) => r.some((x) => x.error_is_crash === true),
          { tries: 24, delayMs: 5000 },
        );

        expect(rows.length, 'events ingested').toBeGreaterThan(0);
        expect([...new Set(rows.map((r) => r.source))], 'source tag').toContain(expectedSource);

        const views = [...new Set(rows.filter((r) => r.type === 'view').map((r) => r.view_name))];
        expect(
          views.some((v) => (v || '').includes(viewSubstring)),
          `a view containing "${viewSubstring}" was recorded`,
        ).toBeTruthy();

        expect(rows.some((r) => r.type === 'action'), 'an action was recorded').toBeTruthy();
        expect(
          rows.some(
            // !== true (not === false) so an SDK that emits null/undefined for a handled error's
            // is_crash still counts as "not a crash".
            (r) => (r.error_message || '').toLowerCase().includes('handled') && r.error_is_crash !== true,
          ),
          'handled error recorded (is_crash not true)',
        ).toBeTruthy();

        const crash = rows.find((r) => r.error_is_crash === true);
        expect(crash, 'native crash flagged is_crash=true').toBeTruthy();
        sessionId = crash.session_id;
        crashMessage = crash.error_message;
      },
    );

    test(
      'the crashed session is viewable in the dashboard',
      { tag: [...tags, '@ui'] },
      async ({ page }) => {
        test.skip(!sessionId, 'no session id from the telemetry test');
        const dash = new RumDashboardPage(page);
        await dash.ensureServedOrSkip(test);
        await dash.login();
        await dash.openSession(sessionId);
        await dash.expectSessionViewable();
      },
    );

    // Known bug o2-enterprise#2289 (cross-platform): Error Tracking can't display errors
    // (placeholder query + HTTP 429). Skipped until fixed — but a REAL body so removing `.fixme`
    // runs an actual assertion (not a green no-op): the ingested crash must appear in Error Tracking.
    test.fixme(
      'crash is inspectable in the Error Tracking tab (o2-enterprise#2289)',
      { tag: [...tags, '@known-bug'] },
      async ({ page }) => {
        test.skip(!crashMessage, 'no crash message from the telemetry test');
        const dash = new RumDashboardPage(page);
        await dash.ensureServedOrSkip(test);
        await dash.login();
        await dash.openErrorTracking();
        await dash.expectErrorListed(crashMessage);
      },
    );
  });
}

module.exports = { coreRumSuite };
