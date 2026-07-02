/**
 * RUM CDN Instrumentation — End-to-End Data Flow
 *
 * Proves the full RUM pipeline using the REAL browser SDK (not synthetic POSTs):
 *   1. Create / read a RUM token from the token API (mirrors the Ingestion UI).
 *   2. Serve the existing `examples/cdn-rum-sample` app, templated with that
 *      token, loading the LIVE CDN bundles from browsersdk.openobserve.ai.
 *      The bundle version tracks the latest release published in the
 *      browser-sdk README (fallback: RUM_SDK_VERSION env, then the version
 *      pinned in the sample HTML) — see utils/rum-sdk-version.js.
 *   3. Load it in a real browser, drive deterministic interactions, and let the
 *      SDK emit genuine beacons.
 *   4. Verify data flow in THREE layers:
 *        Layer 0 — browser: beacons fired to /rum/v1/{org}/{rum,logs,replay};
 *                  lazy recorder + profiler chunks load from the CDN with 2xx
 *        Layer A — API:     rows land in _rumdata / _rumlog / _sessionreplay
 *        Layer B — UI:      the data surfaces on the RUM Error Tracking page
 *
 * Prerequisites:
 *   - OpenObserve ENTERPRISE build on ZO_BASE_URL (default http://localhost:5080)
 *   - RUM enabled; outbound access to https://browsersdk.openobserve.ai (live CDN)
 *   - The instance must accept cross-origin RUM ingestion from the fixture origin
 *
 * Design notes:
 *   - Uses a unique `service` per run so parallel/repeat runs never cross-assert.
 *   - describe.serial: one run generates data (Test A) and later tests verify it.
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { startFixtureServer } = require('../../fixtures/rum/serve.js');
const { getOrCreateRumToken } = require('../utils/rum-token-api.js');
const { resolveCdnSdkVersion } = require('../utils/rum-sdk-version.js');
const { waitForStreamRows } = require('../utils/rum-stream-verify.js');
const { driveRumSampleInteractions } = require('../utils/rum-traffic.js');

const ORG = process.env.ORGNAME || 'default';
const BASE = process.env.ZO_BASE_URL || 'http://localhost:5080';
// site = ingestion host WITHOUT protocol / trailing slash; insecure for http://
const SITE = BASE.replace(/^https?:\/\//, '').replace(/\/$/, '');
const INSECURE = BASE.startsWith('http://');

// Shared across the serial flow.
const RUN_ID = Date.now();
const SERVICE = `e2e-rum-cdn-${RUN_ID}`;
let server;
let rumToken;
// Resolved in beforeAll: latest release from the browser-sdk README, else the
// RUM_SDK_VERSION env var, else null (version pinned in the sample HTML).
let sdkVersion = null;
// Beacon tallies captured during generation (Layer 0).
const beacons = { rum: 0, logs: 0, replay: 0 };
// CDN sub-resources (main bundles + lazy recorder/profiler chunks) observed
// during generation, and any that failed to load.
const cdnAssets = [];
const cdnFailures = [];
// SDK session generated in Layer 0 — used to verify the replay recording.
let sessionId = null;

test.describe('RUM CDN Data Flow', { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    rumToken = await getOrCreateRumToken(page);
    sdkVersion = await resolveCdnSdkVersion(page);
    await page.close();
    expect(rumToken, 'RUM token should be available').toBeTruthy();

    server = await startFixtureServer({
      clientToken: rumToken,
      org: ORG,
      site: SITE,
      insecureHTTP: INSECURE,
      service: SERVICE,
      env: 'e2e',
      version: '1.0.0',
      applicationId: `e2e-rum-app-${RUN_ID}`,
      sdkVersion,
    });
    testLogger.info('RUM fixture server started', {
      url: server.url,
      service: SERVICE,
      sdkVersion: sdkVersion || 'pinned in sample HTML',
    });
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  // ==========================================================================
  // Layer 0 — the SDK actually fires beacons from a real browser
  // ==========================================================================
  test('generates real SDK beacons from the CDN-instrumented app', {
    tag: ['@rum', '@cdn', '@dataflow', '@P0'],
  }, async ({ context }) => {
    const app = await context.newPage();

    // Capture ingestion beacons before any navigation. Categorise by endpoint.
    // NOTE: this counts request INITIATIONS, not deliveries — in-flight fetches
    // can be net::ERR_ABORTED by the flush navigation, and when the instance
    // sends no CORS headers for this origin the browser hides responses even
    // for delivered beacons. Delivery is therefore verified against the
    // streams below, BEFORE the app closes (closing kills the SDK's retries).
    app.on('request', (req) => {
      const url = req.url();
      if (!url.includes(`/rum/v1/${ORG}/`)) return;
      if (url.includes('/replay')) beacons.replay += 1;
      else if (url.includes('/logs')) beacons.logs += 1;
      else if (url.includes('/rum')) beacons.rum += 1;
    });

    // Track every CDN asset the SDK pulls at runtime. Session replay and
    // profiling are lazy webpack chunks (chunks/{recorder,profiler}-<hash>-
    // openobserve-rum.js) downloaded AFTER init — a missing/broken chunk
    // silently kills recording, so each one must be observed with a 2xx.
    app.on('response', (res) => {
      if (!res.url().includes('browsersdk.openobserve.ai')) return;
      cdnAssets.push({ url: res.url(), status: res.status() });
    });
    app.on('requestfailed', (req) => {
      if (!req.url().includes('browsersdk.openobserve.ai')) return;
      const error = (req.failure() || {}).errorText;
      // ERR_ABORTED = cancelled by page lifecycle (navigation/close), not an
      // asset problem. Genuinely missing files complete with a 4xx/5xx status
      // and are caught by the all-2xx assertion on cdnAssets below.
      if (error === 'net::ERR_ABORTED') return;
      cdnFailures.push({ url: req.url(), error });
    });

    // Load the fixture and wait for the live CDN bundle to arrive. When an
    // explicit SDK version was requested, a missing bundle (CDN 403s unknown
    // versions) must fail loudly instead of degrading into a beacon timeout.
    await app.goto(server.url, { waitUntil: 'domcontentloaded' });
    const bundleRes = await app
      .waitForResponse(
        (r) => r.url().includes('browsersdk.openobserve.ai') && r.url().includes('openobserve-rum'),
        { timeout: 30000 },
      )
      .catch(() => null);
    if (!bundleRes) testLogger.warn('CDN rum bundle response not observed');
    if (sdkVersion) {
      expect(bundleRes, `CDN bundle response for requested version ${sdkVersion}`).toBeTruthy();
      expect(bundleRes.url(), 'bundle URL carries the requested version').toContain(`/${sdkVersion}/`);
      expect(bundleRes.status(), `CDN served version ${sdkVersion} (is it released?)`).toBe(200);
    }
    // Let onReady() init + session replay start.
    await app.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // The recorder chunk must arrive before interactions are worth recording:
    // the fixture force-starts session replay, so its download is mandatory.
    // The profiler chunk is mandatory too (the fixture sets
    // profilingSampleRate: 100). Poll — both are lazy-loaded after init.
    const chunkLoaded = (name) =>
      cdnAssets.find((a) => a.url.includes(`/chunks/${name}-`) && a.status >= 200 && a.status < 300);
    await expect
      .poll(() => Boolean(chunkLoaded('recorder')), { timeout: 20000, intervals: [1000, 2000] })
      .toBe(true);
    await expect
      .poll(() => Boolean(chunkLoaded('profiler')), { timeout: 20000, intervals: [1000, 2000] })
      .toBe(true);

    // Deterministic signal generation + flush (shared with the NPM path).
    await driveRumSampleInteractions(app);
    // Give beacons time to leave the browser.
    await expect
      .poll(() => beacons.rum + beacons.logs, { timeout: 20000, intervals: [1000, 2000, 3000] })
      .toBeGreaterThan(0);

    // Hold the app open until rows are actually queryable in BOTH streams —
    // the SDK (still live on the fixture pages) retries aborted batches.
    const dataRows = await waitForStreamRows(app, {
      sql: `SELECT * FROM "_rumdata" WHERE service = '${SERVICE}'`,
      minRows: 1,
      timeoutMs: 60000,
    });
    const logRows = await waitForStreamRows(app, {
      sql: `SELECT * FROM "_rumlog" WHERE service = '${SERVICE}'`,
      minRows: 1,
      timeoutMs: 30000,
    });

    await app.close();

    sessionId = dataRows[0]?.session_id || null;
    testLogger.info('Beacon tallies', beacons);
    testLogger.info('CDN assets loaded', { assets: cdnAssets.map((a) => `${a.status} ${a.url}`) });
    expect(beacons.rum, '_rumdata beacons fired').toBeGreaterThan(0);
    expect(beacons.logs, '_rumlog beacons fired').toBeGreaterThan(0);
    expect(dataRows.length, `_rumdata delivery confirmed for ${SERVICE}`).toBeGreaterThan(0);
    expect(logRows.length, `_rumlog delivery confirmed for ${SERVICE}`).toBeGreaterThan(0);
    expect(sessionId, 'generated RUM events should carry a session_id').toBeTruthy();
    // Every completed CDN download must be 2xx (a 403 here means a bundle or
    // chunk referenced by the release is not actually published), and no
    // request may fail for a non-lifecycle reason (DNS, CORS, CSP, timeout).
    const badAssets = cdnAssets.filter((a) => a.status < 200 || a.status >= 300);
    expect(badAssets, 'all CDN assets must download with 2xx').toEqual([]);
    expect(cdnFailures, 'no CDN asset request may fail').toEqual([]);
  });

  // ==========================================================================
  // Layer A — data lands in the streams (source of truth)
  // ==========================================================================
  test('_rumdata stream receives events for this run', {
    tag: ['@rum', '@cdn', '@dataflow', '@P0'],
  }, async ({ page }) => {
    const hits = await waitForStreamRows(page, {
      sql: `SELECT * FROM "_rumdata" WHERE service = '${SERVICE}'`,
      minRows: 1,
      timeoutMs: 45000,
    });

    expect(hits.length, `_rumdata should contain rows for ${SERVICE}`).toBeGreaterThan(0);
  });

  test('_rumlog stream receives forwarded logs for this run', {
    tag: ['@rum', '@cdn', '@dataflow', '@P1'],
  }, async ({ page }) => {
    const hits = await waitForStreamRows(page, {
      sql: `SELECT * FROM "_rumlog" WHERE service = '${SERVICE}'`,
      minRows: 1,
      timeoutMs: 45000,
    });

    expect(hits.length, `_rumlog should contain rows for ${SERVICE}`).toBeGreaterThan(0);
  });

  test('_sessionreplay stream receives recording segments for this run', {
    tag: ['@rum', '@cdn', '@dataflow', '@P0'],
  }, async ({ page }) => {
    // sessionId was captured from this run's _rumdata rows in Layer 0.
    // _sessionreplay has no service column, so the session id is the only
    // way to scope the query to this run.
    expect(sessionId, 'session_id captured during generation').toBeTruthy();

    const hits = await waitForStreamRows(page, {
      sql: `SELECT * FROM "_sessionreplay" WHERE session_id = '${sessionId}'`,
      minRows: 1,
      timeoutMs: 45000,
    });

    expect(hits.length, `_sessionreplay should contain segments for session ${sessionId}`)
      .toBeGreaterThan(0);
  });

  // ==========================================================================
  // Layer B — the ingested data is visible on the RUM UI
  // ==========================================================================
  test('RUM Error Tracking page renders ingested errors', {
    tag: ['@rum', '@cdn', '@dataflow', '@ui', '@P1'],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await page.goto(`${BASE}/web/rum/errors?org_identifier=${ORG}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    await pm.rumPage.expectErrorTrackingPageLoaded();
    await pm.rumPage.openDateTimePicker();
    await pm.rumPage.selectPastOneHour();
    await pm.rumPage.clickRunQuery();
    await pm.rumPage.waitForQueryExecution();

    await pm.rumPage.expectErrorTableVisible();
    expect(await pm.rumPage.hasErrorRows(), 'error table should show at least one row').toBe(true);
  });
});
