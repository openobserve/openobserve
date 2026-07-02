/**
 * RUM CDN Instrumentation — End-to-End Data Flow
 *
 * Proves the full RUM pipeline using the REAL browser SDK (not synthetic POSTs):
 *   1. Create / read a RUM token from the token API (mirrors the Ingestion UI).
 *   2. Serve the existing `examples/cdn-rum-sample` app, templated with that
 *      token, loading the LIVE CDN bundles from browsersdk.openobserve.ai.
 *   3. Load it in a real browser, drive deterministic interactions, and let the
 *      SDK emit genuine beacons.
 *   4. Verify data flow in THREE layers:
 *        Layer 0 — browser: beacons fired to /rum/v1/{org}/{rum,logs,replay}
 *        Layer A — API:     rows land in _rumdata / _rumlog (search API)
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
// Beacon tallies captured during generation (Layer 0).
const beacons = { rum: 0, logs: 0, replay: 0 };

test.describe('RUM CDN Data Flow', { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    rumToken = await getOrCreateRumToken(page);
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
    });
    testLogger.info('RUM fixture server started', { url: server.url, service: SERVICE });
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
    app.on('request', (req) => {
      const url = req.url();
      if (!url.includes(`/rum/v1/${ORG}/`)) return;
      if (url.includes('/replay')) beacons.replay += 1;
      else if (url.includes('/logs')) beacons.logs += 1;
      else if (url.includes('/rum')) beacons.rum += 1;
    });

    // Load the fixture and wait for the live CDN bundle to arrive.
    await app.goto(server.url, { waitUntil: 'domcontentloaded' });
    await app
      .waitForResponse(
        (r) => r.url().includes('browsersdk.openobserve.ai') && r.url().includes('openobserve-rum'),
        { timeout: 30000 },
      )
      .catch(() => testLogger.warn('CDN rum bundle response not observed'));
    // Let onReady() init + session replay start.
    await app.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Deterministic signal generation + flush (shared with the NPM path).
    await driveRumSampleInteractions(app);
    // Give beacons time to leave the browser.
    await expect
      .poll(() => beacons.rum + beacons.logs, { timeout: 20000, intervals: [1000, 2000, 3000] })
      .toBeGreaterThan(0);

    await app.close();

    testLogger.info('Beacon tallies', beacons);
    expect(beacons.rum, '_rumdata beacons fired').toBeGreaterThan(0);
    expect(beacons.logs, '_rumlog beacons fired').toBeGreaterThan(0);
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
