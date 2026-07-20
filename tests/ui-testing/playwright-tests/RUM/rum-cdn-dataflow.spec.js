/**
 * RUM CDN Instrumentation — End-to-End Data Flow
 *
 * Proves the full RUM pipeline using the REAL browser SDK (not synthetic POSTs):
 *   1. Create / read a RUM token from the token API (mirrors the Ingestion UI).
 *   2. Serve the committed `fixtures/rum/cdn-sample` app, templated with that
 *      token, loading the CDN bundles from browsersdk.openobserve.ai. Version
 *      resolution is BEST-EFFORT (utils/rum-sdk-version.js): candidates are
 *      probed against the CDN and anything unavailable falls back to the
 *      version pinned in the committed sample HTML — a CDN publishing gap
 *      must never fail this suite.
 *   3. Load it in a real browser, drive deterministic interactions, and let the
 *      SDK emit genuine beacons.
 *   4. Verify data flow in THREE layers:
 *        Layer 0 — browser: beacons fired to /rum/v1/{org}/{rum,logs,replay}
 *        Layer A — API:     rows land in _rumdata / _rumlog / _sessionreplay
 *        Layer B — UI:      the data surfaces on the RUM Error Tracking page
 *
 * CDN asset health (lazy recorder/profiler chunks) is OBSERVED and logged, but
 * only failures in OUR pipeline fail the suite: if the live CDN does not serve
 * the recorder chunk (a provisioning issue outside this repo), the session
 * replay assertions are skipped with a warning instead of failing the run.
 *
 * Prerequisites:
 *   - OpenObserve build on ZO_BASE_URL (default http://localhost:5080); the
 *     RUM ingest/token/search routes are part of the standard (OSS) router.
 *   - RUM enabled; outbound access to https://browsersdk.openobserve.ai
 *   - The instance must accept cross-origin RUM ingestion from the fixture origin
 *
 * Data cleanup: rows are written to the shared _rumdata/_rumlog/_sessionreplay
 * streams. OpenObserve exposes NO predicate-scoped delete — the only
 * stream-data delete API removes an entire hour-aligned time window
 * regardless of `service` — so this run's rows cannot be deleted individually
 * or in-place (a per-spec delete would also race a concurrently-running
 * dataflow spec on the same instance). Instead: every row is namespaced with
 * a unique per-run `service` so reruns never cross-assert, stream retention
 * ages rows out, and a long-lived test instance can bound accumulation with
 * the opt-in `ZO_RUM_PURGE_STREAM_DATA=true` old-data purge that runs once in
 * global teardown (see utils/global-teardown.js + purgeOldRumStreamData).
 */

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { startFixtureServer } = require('../../fixtures/rum/serve.js');
const { getOrCreateRumToken } = require('../utils/rum-token-api.js');
const { resolveCdnSdkVersion } = require('../utils/rum-sdk-version.js');
const { waitForStreamRows } = require('../utils/rum-stream-verify.js');
const {
  driveRumSampleInteractions,
  attachBeaconCounter,
  attachCdnAssetTracker,
  waitForRumSdkReady,
} = require('../utils/rum-traffic.js');

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
let sdkVersion = null;
// Beacon tallies captured during generation (Layer 0).
let beacons = { rum: 0, logs: 0, replay: 0 };
// SDK session generated in Layer 0 — used to verify the replay recording.
let sessionId = null;
// False when the live CDN never delivered the lazy recorder chunk — session
// replay cannot record without it, and that is a CDN provisioning issue, not
// an OpenObserve regression, so replay assertions are skipped (with warnings).
let replayCapable = false;

test.describe('RUM CDN Data Flow', () => {
  // SERIAL IS REQUIRED: one fixture server + one generation pass (the first
  // test) feed module state (SERVICE data, beacons, sessionId, replayCapable)
  // that every later test asserts against. With fullyParallel workers each
  // test would re-run beforeAll in its own process and see none of that state.
  // Skipping the verification tests when generation failed is also the
  // correct outcome — they can only time out at that point.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

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
    // The fixture server is the only local resource to release; see the
    // header comment for why the ingested stream rows cannot be deleted.
    if (server) await server.close();
  });

  // ==========================================================================
  // Layer 0 — the SDK actually fires beacons from a real browser
  // ==========================================================================
  test('generates real SDK beacons from the CDN-instrumented app', {
    tag: ['@rum', '@rumCdnDataflow', '@dataflow', '@P0'],
  }, async ({ context }) => {
    const app = await context.newPage();

    // Wire the observers before any navigation (see rum-traffic.js for the
    // initiation-vs-delivery caveat — delivery is verified via the streams).
    beacons = attachBeaconCounter(app, ORG);
    const cdn = attachCdnAssetTracker(app);

    // Load the fixture and wait for the CDN rum bundle to arrive. The version
    // was pre-probed in rum-sdk-version.js, so a missing response here is
    // logged and tolerated — beacon/stream assertions below are the real gate.
    await app.goto(server.url, { waitUntil: 'domcontentloaded' });
    const bundleRes = await app
      .waitForResponse(
        (r) => r.url().includes('browsersdk.openobserve.ai') && r.url().includes('openobserve-rum'),
        { timeout: 30000 },
      )
      .catch(() => null);
    if (!bundleRes) {
      testLogger.warn('CDN rum bundle response not observed');
    } else if (sdkVersion) {
      expect(bundleRes.url(), 'bundle URL carries the resolved version').toContain(`/${sdkVersion}/`);
    }
    // Explicit SDK readiness — the real SDK objects replace the loader stubs.
    await waitForRumSdkReady(app);

    // The recorder chunk is what makes session replay record (the fixture
    // force-starts replay); the profiler chunk backs profilingSampleRate: 100.
    // Both are lazy CDN chunks the OpenObserve CDN has historically failed to
    // provision (403 on chunks/) — that is EXTERNAL to this repo, so a missing
    // chunk downgrades the replay assertions to a logged skip, never a failure.
    await expect
      .poll(() => cdn.chunkLoaded('recorder'), { timeout: 20000, intervals: [1000, 2000] })
      .toBe(true)
      .catch(() => {});
    await expect
      .poll(() => cdn.chunkLoaded('profiler'), { timeout: 20000, intervals: [1000, 2000] })
      .toBe(true)
      .catch(() => {});
    replayCapable = cdn.chunkLoaded('recorder');
    if (!replayCapable) {
      testLogger.warn('CDN recorder chunk unavailable — session replay assertions will be skipped', {
        failures: cdn.failures,
      });
    }

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
    testLogger.info('CDN assets loaded', { assets: cdn.assets.map((a) => `${a.status} ${a.url}`) });
    // CDN asset health is OBSERVED, not asserted — the live CDN is outside
    // this product's control and must not turn the suite red (it is however
    // the loudest early signal when a release is half-published, so log it).
    const badAssets = cdn.assets.filter((a) => a.status < 200 || a.status >= 300);
    if (badAssets.length || cdn.failures.length) {
      testLogger.warn('CDN served non-2xx / failed assets', { badAssets, failures: cdn.failures });
    }

    expect(beacons.rum, '_rumdata beacons fired').toBeGreaterThan(0);
    expect(beacons.logs, '_rumlog beacons fired').toBeGreaterThan(0);
    expect(dataRows.length, `_rumdata delivery confirmed for ${SERVICE}`).toBeGreaterThan(0);
    expect(logRows.length, `_rumlog delivery confirmed for ${SERVICE}`).toBeGreaterThan(0);
    expect(sessionId, 'generated RUM events should carry a session_id').toBeTruthy();
  });

  // ==========================================================================
  // Layer A — data lands in the streams (source of truth)
  // ==========================================================================
  test('_rumdata stream receives events for this run', {
    tag: ['@rum', '@rumCdnDataflow', '@dataflow', '@P0'],
  }, async ({ page }) => {
    const hits = await waitForStreamRows(page, {
      sql: `SELECT * FROM "_rumdata" WHERE service = '${SERVICE}'`,
      minRows: 1,
      timeoutMs: 45000,
    });

    expect(hits.length, `_rumdata should contain rows for ${SERVICE}`).toBeGreaterThan(0);
  });

  test('_rumlog stream receives forwarded logs for this run', {
    tag: ['@rum', '@rumCdnDataflow', '@dataflow', '@P1'],
  }, async ({ page }) => {
    const hits = await waitForStreamRows(page, {
      sql: `SELECT * FROM "_rumlog" WHERE service = '${SERVICE}'`,
      minRows: 1,
      timeoutMs: 45000,
    });

    expect(hits.length, `_rumlog should contain rows for ${SERVICE}`).toBeGreaterThan(0);
  });

  test('_sessionreplay stream receives recording segments for this run', {
    tag: ['@rum', '@rumCdnDataflow', '@dataflow', '@P0'],
  }, async ({ page }) => {
    // Replay recording needs the CDN's lazy recorder chunk; when the live CDN
    // failed to serve it this run, there is nothing OpenObserve could have
    // recorded — skip (with the warning already logged) instead of failing.
    test.skip(!replayCapable, 'CDN recorder chunk unavailable this run (external dependency)');

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
    tag: ['@rum', '@rumCdnDataflow', '@dataflow', '@ui', '@P1'],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await pm.rumPage.gotoErrorsList();
    await pm.rumPage.expectErrorTrackingPageLoaded();
    await pm.rumPage.openDateTimePicker();
    await pm.rumPage.selectPastOneHour();
    await pm.rumPage.clickRunQuery();
    await pm.rumPage.waitForQueryExecution();

    await pm.rumPage.expectErrorTableVisible();
    expect(await pm.rumPage.hasErrorRows(), 'error table should show at least one row').toBe(true);
  });
});
