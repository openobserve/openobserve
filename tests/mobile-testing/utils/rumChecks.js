// Reusable per-capability RUM checks, parametrized by platform (service, flows, device).
// This is what keeps the four mobile tracks at CAPABILITY PARITY without copy-pasting the
// same assertion into four spec files: each platform's spec is a thin call into these factories.
//
// Layer split, same as the rest of the suite:
//   DRIVE  → runFlow(...) taps through the app       (utils/maestro.js)
//   API    → search/pollUntil against _rumdata        (utils/ooClient.js)
//   UI     → RumDashboardPage                          (pages/rumDashboardPage.js)
const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { runFlow } = require('./maestro');
const { apkPath, pull } = require('./adb');
const { search, pollUntil, q } = require('./ooClient');
const { RumDashboardPage } = require('../pages/rumDashboardPage');
const cfg = require('./config');

/** env / service / version tagging is present on the platform's events. */
function attributesSuite({ name, tags, service, env, flows, device = '' }) {
  test.describe(name, () => {
    test(
      'RUM data is tagged with env, service and version',
      { tag: [...tags, '@attributes', '@P1'] },
      async () => {
        const start = Date.now() - 30000;
        for (const f of flows) runFlow(f, { device });

        const rows = await pollUntil(
          () =>
            search(
              `SELECT env, service, version FROM ${cfg.RUM_STREAM} WHERE service='${service}'`,
              start,
            ),
          (r) => r.length > 0,
          { tries: 20, delayMs: 5000 },
        );

        expect(rows.length, 'data ingested for the service').toBeGreaterThan(0);
        expect(rows[0].service).toBe(service);
        expect(rows[0].env, `env should be ${env}`).toBe(env);
        expect(rows[0].version, 'app version tagged').toBeTruthy();
      },
    );
  });
}

/** Events are attributed to the user set via setUser/setUserInfo (usr_* fields, not "Unknown"). */
function userIdentitySuite({ name, tags, service, userEmail, flows, device = '' }) {
  test.describe(name, () => {
    test(
      'RUM events are attributed to the configured user',
      { tag: [...tags, '@user-identity', '@P1'] },
      async () => {
        const start = Date.now() - 30000;
        for (const f of flows) runFlow(f, { device });

        const rows = await pollUntil(
          () =>
            search(
              `SELECT usr_email, usr_id, usr_name FROM ${cfg.RUM_STREAM} WHERE service='${service}'`,
              start,
            ),
          (r) => r.some((x) => x.usr_email === userEmail),
          { tries: 20, delayMs: 5000 },
        );

        const withUser = rows.find((x) => x.usr_email === userEmail);
        expect(withUser, `events attributed to ${userEmail}`).toBeTruthy();
        expect(withUser.usr_email).toBe(userEmail);
      },
    );
  });
}

/**
 * Network / resource tracking — positive AND negative:
 *   positive: a successful fetch is captured as a resource carrying its URL;
 *   negative: a failing request (the app's 404) is captured with a >=400 status code.
 */
function networkSuite({ name, tags, service, urlSubstring, flows, device = '' }) {
  test.describe(name, () => {
    test.describe.configure({ mode: 'serial' });
    let resources = [];

    test.beforeAll(async () => {
      const start = Date.now() - 30000;
      for (const f of flows) runFlow(f, { device });
      // Poll until BOTH the success URL and a >=400 status have landed (they ingest
      // incrementally); falls through to whatever arrived if the error status never does.
      resources = await pollUntil(
        () =>
          search(
            `SELECT resource_url, resource_method, resource_status_code, type ` +
              `FROM ${cfg.RUM_STREAM} WHERE service='${service}' AND type='resource' ` +
              `ORDER BY _timestamp DESC`,
            start,
          ),
        (rows) =>
          rows.some((r) => (r.resource_url || '').includes(urlSubstring)) &&
          rows.some((r) => Number(r.resource_status_code) >= 400),
        { tries: 24, delayMs: 5000 },
      );
    });

    test(
      'a successful fetch is captured as a resource',
      { tag: [...tags, '@network', '@P1'] },
      async () => {
        expect(resources.length, 'at least one resource captured').toBeGreaterThan(0);
        expect(
          resources.map((r) => r.resource_url || '').some((u) => u.includes(urlSubstring)),
          'the app fetch was tracked as a resource',
        ).toBeTruthy();
      },
    );

    test(
      'a failing request captures its 4xx/5xx status (negative)',
      { tag: [...tags, '@network', '@negative', '@P1'] },
      async () => {
        const statuses = resources
          .map((r) => Number(r.resource_status_code))
          .filter((n) => !Number.isNaN(n));
        expect(
          statuses.some((s) => s >= 400),
          `a >=400 resource status was captured (saw: ${[...new Set(statuses)].join(', ') || 'none'})`,
        ).toBeTruthy();
      },
    );
  });
}

/** Session Replay privacy — no on-screen PII may leak into the replay DOM (MASK_ALL). */
function maskingSuite({ name, tags, service, pii, flows, device = '' }) {
  test.describe(name, () => {
    test(
      'PII is masked in the session replay (MASK_ALL)',
      { tag: [...tags, '@replay', '@masking', '@P1'] },
      async ({ page }) => {
        const start = Date.now() - 30000;
        for (const f of flows) runFlow(f, { device });

        const sessionId = await q.sessionForService(service, start, { tries: 20, delayMs: 5000 });
        expect(sessionId, 'a session was ingested for the masking flow').toBeTruthy();

        const dash = new RumDashboardPage(page);
        test.skip(!(await dash.dashboardServed()), 'OpenObserve web UI not served by this build');
        await dash.login();
        await dash.openSession(sessionId);
        await dash.expectNoPiiInReplay(pii);
      },
    );
  });
}

/**
 * Background/foreground continuity — a view recorded BEFORE backgrounding and one recorded AFTER
 * foregrounding must share ONE session_id (the session is not reset by the lifecycle cycle).
 * `drive(device)` performs the platform-specific background/foreground (adb on Android, a
 * self-contained Maestro flow with the Home key on iOS).
 */
function bgFgSuite({ name, tags, service, viewA, viewB, drive, device = '' }) {
  test.describe(name, () => {
    test(
      'the session continues across a background/foreground cycle',
      { tag: [...tags, '@lifecycle', '@P1'] },
      async () => {
        const start = Date.now() - 30000;
        await drive(device);

        // Match by substring — native view names are class-qualified (e.g. "MainActivity").
        const hasA = (r) => (r.view_name || '').includes(viewA);
        const hasB = (r) => (r.view_name || '').includes(viewB);
        const rows = await pollUntil(
          () =>
            search(
              `SELECT session_id, view_name FROM ${cfg.RUM_STREAM} ` +
                `WHERE service='${service}' AND type='view'`,
              start,
            ),
          (r) => r.some(hasA) && r.some(hasB),
          { tries: 24, delayMs: 5000 },
        );

        const matched = rows.filter((r) => hasA(r) || hasB(r));
        expect(matched.length, 'both views recorded').toBeGreaterThan(0);
        expect(
          new Set(matched.map((r) => r.session_id)).size,
          `${viewA} (pre-bg) and ${viewB} (post-fg) are the same session`,
        ).toBe(1);
      },
    );
  });
}

/** Security (negative): the installed Android APK must contain zero Datadog intake hosts. */
function noPhoneHomeAndroidSuite({ name, tags, appId }) {
  test.describe(name, () => {
    test(
      'the installed app contains zero Datadog hosts',
      { tag: [...tags, '@security', '@no-phone-home', '@negative', '@P0'] },
      async () => {
        const apk = apkPath(appId);
        expect(apk, 'app is installed').toContain('.apk');

        const tmp = path.join(os.tmpdir(), `nophonehome-${appId}.apk`);
        pull(apk, tmp);

        const hits = execSync(
          `unzip -p "${tmp}" | strings | ` +
            `grep -ioE 'datadoghq\\.(com|eu)|ddog-gov\\.com|browser-intake-datadoghq' | sort -u || true`,
        )
          .toString()
          .trim();

        expect(hits, `no Datadog hosts must be present (found: "${hits}")`).toBe('');
      },
    );
  });
}

module.exports = {
  attributesSuite,
  userIdentitySuite,
  networkSuite,
  maskingSuite,
  bgFgSuite,
  noPhoneHomeAndroidSuite,
};
