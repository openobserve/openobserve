// Reusable per-capability RUM checks, parametrized by platform (service, flows, device).
// This is what keeps the four mobile tracks at CAPABILITY PARITY without copy-pasting the
// same assertion into four spec files: each platform's spec is a thin call into these factories.
//
// Layer split, same as the rest of the suite:
//   DRIVE  → runFlow(...) taps through the app       (utils/maestro.js)
//   API    → search/pollUntil against _rumdata        (utils/ooClient.js)
//   UI     → RumDashboardPage                          (pages/rumDashboardPage.js)
const { execSync } = require('child_process');
const fs = require('fs');
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

        // env/version are NOT carried on every RUM event type (e.g. some vitals/long-tasks/resources
        // leave them null), so requiring them on EVERY row false-fails once the fuller suite has run.
        // Assert instead that no row is MIS-tagged and at least one row carries the expected value —
        // a wrong value on any row still fails, but a legitimately-absent one does not.
        expect(rows.length, 'data ingested for the service').toBeGreaterThan(0);
        expect(rows.every((r) => r.service === service), 'every row tagged with the service').toBe(true);
        expect(rows.some((r) => r.env === env), `at least one row tagged env=${env}`).toBe(true);
        expect(rows.every((r) => r.env == null || r.env === env), `no row carries a wrong env`).toBe(true);
        expect(rows.some((r) => !!r.version), 'at least one row carries an app version').toBe(true);
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
// requireReplay (default true): the replay MUST render or the test FAILS — so an Android replay
// regression can't hide. iOS specs pass requireReplay:false because the mobile replay is not always
// rendered for iOS in CI (observed); there it skips-with-reason instead of a false fail. Scoping the
// skip this way keeps enforcement on the platforms where the replay does render.
function maskingSuite({ name, tags, service, pii, flows, device = '', requireReplay = true }) {
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
        await dash.ensureServedOrSkip(test);
        await dash.login();
        await dash.openSession(sessionId);
        // POSITIVE CONTROL: only assert "no PII" if the replay actually rendered — otherwise a
        // not-rendered player has zero text nodes and the check would pass vacuously.
        const rendered = await dash.replayRendered();
        if (requireReplay) {
          // Android: the replay renders, so a non-render is a real regression → FAIL.
          expect(rendered, 'session replay must render before masking can be verified').toBe(true);
        } else {
          // iOS: the replay is not always rendered in CI → skip-with-reason rather than false-fail.
          test.skip(!rendered, 'session replay did not render (no playback bar) — cannot verify masking');
        }
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
        // Assert continuity on the NEWEST session only (this test's bg/fg drive, ordered _timestamp
        // DESC). Filtering by service+window alone would let a leftover session from an earlier spec
        // (e.g. interactions.yaml also records viewA→viewB in one session) either add a 2nd session
        // (false failure) or satisfy the check while the real bg/fg split went undetected (false pass).
        // The newest session with BOTH views is the drive's own; a split shows as the newest session
        // missing viewA → never satisfied → red.
        const newestSpansBoth = (r) => {
          if (!r.length) return false;
          const newest = r[0].session_id;
          const nr = r.filter((x) => x.session_id === newest);
          return nr.some(hasA) && nr.some(hasB);
        };
        const rows = await pollUntil(
          () =>
            search(
              `SELECT session_id, view_name, _timestamp FROM ${cfg.RUM_STREAM} ` +
                `WHERE service='${service}' AND type='view' ORDER BY _timestamp DESC`,
              start,
            ),
          newestSpansBoth,
          { tries: 24, delayMs: 5000 },
        );

        expect(
          newestSpansBoth(rows),
          `the newest session spans ${viewA} (pre-bg) and ${viewB} (post-fg)`,
        ).toBe(true);
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

        // POSITIVE CONTROL: prove the scan actually read a real APK before trusting a zero result —
        // otherwise a failed/empty pull, a broken `unzip`, or missing `strings` all yield "" (the pass
        // condition) and this negative test can never fail. `pull()` uses stdio:'ignore', so verify here.
        expect(fs.existsSync(tmp) && fs.statSync(tmp).size > 0, 'pulled APK is non-empty').toBe(true);
        const markerHits = Number(
          execSync(`unzip -p "${tmp}" | strings | grep -icE 'openobserve' || true`).toString().trim(),
        );
        expect(markerHits, 'APK scan is readable (the openobserve SDK string is present)').toBeGreaterThan(0);

        const hits = execSync(
          `unzip -p "${tmp}" | strings | ` +
            `grep -ioE 'datadoghq\\.(com|eu)|datad0g\\.com|ddog-gov\\.com|browser-intake-datadoghq' | sort -u || true`,
        )
          .toString()
          .trim();

        expect(hits, `no Datadog hosts must be present (found: "${hits}")`).toBe('');
      },
    );
  });
}

/** Security (negative): the installed iOS .app bundle must contain zero Datadog intake hosts. */
function noPhoneHomeIosSuite({ name, tags, appId, device }) {
  test.describe(name, () => {
    test(
      'the installed app contains zero Datadog hosts',
      { tag: [...tags, '@security', '@no-phone-home', '@negative', '@P0'] },
      async () => {
        const appPath = execSync(`xcrun simctl get_app_container ${device || 'booted'} ${appId} app`)
          .toString()
          .trim();
        expect(appPath, 'app is installed').toContain('.app');

        // POSITIVE CONTROL: the bundle is readable and carries the OpenObserve SDK, so a zero result
        // below means "no Datadog hosts", not "the scan read nothing".
        // -print0 | xargs -0: .app bundles can contain paths with spaces, which plain xargs would
        // split into bogus args (a false failure).
        const marker = Number(
          execSync(
            `find "${appPath}" -type f -print0 2>/dev/null | xargs -0 strings 2>/dev/null | grep -icE 'openobserve' || true`,
          )
            .toString()
            .trim(),
        );
        expect(marker, 'app scan is readable (openobserve strings present)').toBeGreaterThan(0);

        const hits = execSync(
          `find "${appPath}" -type f -print0 2>/dev/null | xargs -0 strings 2>/dev/null | ` +
            `grep -ioE 'datadoghq\\.(com|eu)|datad0g\\.com|ddog-gov\\.com|browser-intake-datadoghq' | sort -u || true`,
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
  noPhoneHomeIosSuite,
};
