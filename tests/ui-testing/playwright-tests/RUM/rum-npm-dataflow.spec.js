/**
 * RUM NPM-Package Instrumentation — End-to-End Data Flow
 *
 * The NPM counterpart to rum-cdn-dataflow.spec.js. Same shared sample app and
 * same 3-layer verification, but the SDK is delivered via the published npm
 * packages (@openobserve/browser-rum + @openobserve/browser-logs) bundled by
 * esbuild — NOT the CDN script tags.
 *
 *   1. Build the fixture bundle (npm ci && npm run build) if not present.
 *   2. Serve the shared sample DOM with the bundled entry injected.
 *   3. Drive deterministic interactions; the SDK emits genuine beacons.
 *   4. Verify Layer 0 (beacons) / Layer A (_rumdata,_rumlog) / Layer B (RUM UI).
 *
 * Prerequisites:
 *   - OpenObserve ENTERPRISE build on ZO_BASE_URL (default http://localhost:5080)
 *   - Network access to the npm registry for the one-time bundle build
 *   - Cross-origin RUM ingestion allowed from the fixture origin
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { startNpmFixtureServer } = require('../../fixtures/rum/serve.js');
const { getOrCreateRumToken } = require('../utils/rum-token-api.js');
const { waitForStreamRows } = require('../utils/rum-stream-verify.js');
const { driveRumSampleInteractions } = require('../utils/rum-traffic.js');

const ORG = process.env.ORGNAME || 'default';
const BASE = process.env.ZO_BASE_URL || 'http://localhost:5080';
const SITE = BASE.replace(/^https?:\/\//, '').replace(/\/$/, '');
const INSECURE = BASE.startsWith('http://');

const NPM_APP_DIR = path.resolve(__dirname, '../../fixtures/rum/npm-app');
const BUNDLE_PATH = path.join(NPM_APP_DIR, 'dist', 'bundle.js');

const RUN_ID = Date.now();
const SERVICE = `e2e-rum-npm-${RUN_ID}`;
let server;
let rumToken;
const beacons = { rum: 0, logs: 0, replay: 0 };

/** Build the esbuild bundle once (installs deps if node_modules is missing). */
function ensureBundleBuilt() {
  if (fs.existsSync(BUNDLE_PATH)) return;
  if (!fs.existsSync(path.join(NPM_APP_DIR, 'node_modules'))) {
    testLogger.info('Installing npm fixture deps…');
    execSync('npm ci || npm install', { cwd: NPM_APP_DIR, stdio: 'inherit', timeout: 300000 });
  }
  testLogger.info('Building npm fixture bundle…');
  execSync('npm run build', { cwd: NPM_APP_DIR, stdio: 'inherit', timeout: 120000 });
}

test.describe('RUM NPM Data Flow', { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    ensureBundleBuilt();
    expect(fs.existsSync(BUNDLE_PATH), 'npm bundle should be built').toBe(true);

    const page = await browser.newPage();
    rumToken = await getOrCreateRumToken(page);
    await page.close();
    expect(rumToken, 'RUM token should be available').toBeTruthy();

    server = await startNpmFixtureServer({
      clientToken: rumToken,
      org: ORG,
      site: SITE,
      insecureHTTP: INSECURE,
      service: SERVICE,
      env: 'e2e',
      version: '1.0.0',
      applicationId: `e2e-rum-npm-app-${RUN_ID}`,
      bundlePath: BUNDLE_PATH,
    });
    testLogger.info('RUM npm fixture server started', { url: server.url, service: SERVICE });
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  test('generates real SDK beacons from the NPM-instrumented app', {
    tag: ['@rum', '@npm', '@dataflow', '@P0'],
  }, async ({ context }) => {
    const app = await context.newPage();

    app.on('request', (req) => {
      const url = req.url();
      if (!url.includes(`/rum/v1/${ORG}/`)) return;
      if (url.includes('/replay')) beacons.replay += 1;
      else if (url.includes('/logs')) beacons.logs += 1;
      else if (url.includes('/rum')) beacons.rum += 1;
    });

    await app.goto(server.url, { waitUntil: 'domcontentloaded' });
    // Wait for the bundled SDK entry (served locally) to load.
    await app
      .waitForResponse((r) => r.url().includes('/npm-bundle.js'), { timeout: 30000 })
      .catch(() => testLogger.warn('npm bundle response not observed'));
    await app.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Deterministic signal generation + flush (shared with the CDN path).
    await driveRumSampleInteractions(app);
    await expect
      .poll(() => beacons.rum + beacons.logs, { timeout: 20000, intervals: [1000, 2000, 3000] })
      .toBeGreaterThan(0);

    await app.close();

    testLogger.info('Beacon tallies', beacons);
    expect(beacons.rum, '_rumdata beacons fired').toBeGreaterThan(0);
    expect(beacons.logs, '_rumlog beacons fired').toBeGreaterThan(0);
  });

  test('_rumdata stream receives events for this run', {
    tag: ['@rum', '@npm', '@dataflow', '@P0'],
  }, async ({ page }) => {
    const hits = await waitForStreamRows(page, {
      sql: `SELECT * FROM "_rumdata" WHERE service = '${SERVICE}'`,
      minRows: 1,
      timeoutMs: 45000,
    });

    expect(hits.length, `_rumdata should contain rows for ${SERVICE}`).toBeGreaterThan(0);
  });

  test('_rumlog stream receives forwarded logs for this run', {
    tag: ['@rum', '@npm', '@dataflow', '@P1'],
  }, async ({ page }) => {
    const hits = await waitForStreamRows(page, {
      sql: `SELECT * FROM "_rumlog" WHERE service = '${SERVICE}'`,
      minRows: 1,
      timeoutMs: 45000,
    });

    expect(hits.length, `_rumlog should contain rows for ${SERVICE}`).toBeGreaterThan(0);
  });

  test('RUM Error Tracking page renders ingested errors', {
    tag: ['@rum', '@npm', '@dataflow', '@ui', '@P1'],
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
