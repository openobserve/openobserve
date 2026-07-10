/**
 * RUM NPM-Package Instrumentation — End-to-End Data Flow
 *
 * The NPM counterpart to rum-cdn-dataflow.spec.js. Same shared sample app and
 * same 3-layer verification, but the SDK is delivered via the published npm
 * packages (@openobserve/browser-rum + @openobserve/browser-logs) bundled by
 * esbuild — NOT the CDN script tags.
 *
 * HERMETIC BY DEFAULT: the fixture builds with `npm ci` from the exact
 * versions pinned in fixtures/rum/npm-app/package.json + package-lock.json,
 * so runs do not depend on the registry publishing anything new. Tracking the
 * registry `latest` is opt-in via RUM_SDK_TRACK_LATEST=true (see
 * utils/rum-sdk-version.js); RUM_SDK_VERSION pins an explicit version.
 *
 *   1. Build the fixture bundle (npm ci && npm run build) if not present.
 *   2. Serve the shared sample DOM with the bundled entry injected.
 *   3. Drive deterministic interactions; the SDK emits genuine beacons.
 *   4. Verify Layer 0 (beacons) / Layer A (_rumdata,_rumlog) / Layer B (RUM UI).
 *
 * Prerequisites:
 *   - OpenObserve build on ZO_BASE_URL (default http://localhost:5080); the
 *     RUM ingest/token/search routes are part of the standard (OSS) router.
 *   - npm registry access for the one-time `npm ci` of the LOCKED versions
 *     (cached thereafter).
 *   - Cross-origin RUM ingestion allowed from the fixture origin.
 *
 * Data cleanup: rows are written to the shared _rumdata/_rumlog streams.
 * OpenObserve exposes NO predicate-scoped delete — the only stream-data delete
 * API removes an entire hour-aligned time window regardless of `service` — so
 * this run's rows cannot be deleted individually or in-place. Instead: every
 * row is namespaced with a unique per-run `service` so reruns never
 * cross-assert, stream retention ages rows out, and a long-lived test instance
 * can bound accumulation with the opt-in `ZO_RUM_PURGE_STREAM_DATA=true`
 * old-data purge that runs once in global teardown (see
 * utils/global-teardown.js + purgeOldRumStreamData).
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { startNpmFixtureServer } = require('../../fixtures/rum/serve.js');
const { getOrCreateRumToken } = require('../utils/rum-token-api.js');
const { resolveNpmSdkVersion } = require('../utils/rum-sdk-version.js');
const { waitForStreamRows } = require('../utils/rum-stream-verify.js');
const {
  driveRumSampleInteractions,
  attachBeaconCounter,
  waitForRumSdkReady,
} = require('../utils/rum-traffic.js');

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
let beacons = { rum: 0, logs: 0, replay: 0 };

/** Version of @openobserve/browser-rum currently installed in the fixture. */
function installedSdkVersion() {
  try {
    const pkg = path.join(NPM_APP_DIR, 'node_modules', '@openobserve', 'browser-rum', 'package.json');
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version || null;
  } catch {
    return null;
  }
}

/**
 * Build the esbuild bundle from the LOCKED fixture dependencies (`npm ci`).
 * Only when an explicit target version was resolved (RUM_SDK_VERSION or the
 * opt-in RUM_SDK_TRACK_LATEST) does this install something other than the
 * committed lockfile pins.
 */
function ensureBundleBuilt(targetVersion) {
  const installed = installedSdkVersion();
  const stale = targetVersion && installed !== targetVersion;

  if (fs.existsSync(BUNDLE_PATH) && !stale) {
    testLogger.info('Reusing npm fixture bundle', { installed });
    return;
  }

  if (stale) {
    testLogger.info('Installing requested SDK version into the fixture', {
      installed,
      targetVersion,
    });
    execSync(
      `npm install @openobserve/browser-rum@${targetVersion} @openobserve/browser-logs@${targetVersion}`,
      { cwd: NPM_APP_DIR, stdio: 'inherit', timeout: 300000 },
    );
  } else if (!fs.existsSync(path.join(NPM_APP_DIR, 'node_modules'))) {
    testLogger.info('Installing pinned fixture deps (npm ci)…');
    execSync('npm ci', { cwd: NPM_APP_DIR, stdio: 'inherit', timeout: 300000 });
  }
  testLogger.info('Building npm fixture bundle…');
  execSync('npm run build', { cwd: NPM_APP_DIR, stdio: 'inherit', timeout: 120000 });
}

test.describe('RUM NPM Data Flow', () => {
  // SERIAL IS REQUIRED: one fixture server + one generation pass (the first
  // test) feed module state (SERVICE data, beacons) that the later tests
  // assert against; with fullyParallel workers each test would re-run
  // beforeAll in its own process and see none of that state.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test.beforeAll(async ({ browser }) => {
    const targetVersion = resolveNpmSdkVersion();
    ensureBundleBuilt(targetVersion);
    expect(fs.existsSync(BUNDLE_PATH), 'npm bundle should be built').toBe(true);
    if (targetVersion) {
      expect(installedSdkVersion(), 'bundled SDK matches the requested version')
        .toBe(targetVersion);
    }

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
    // The fixture server is the only local resource to release; see the
    // header comment for why the ingested stream rows cannot be deleted.
    if (server) await server.close();
  });

  test('generates real SDK beacons from the NPM-instrumented app', {
    tag: ['@rum', '@rumNpmDataflow', '@dataflow', '@P0'],
  }, async ({ context }) => {
    const app = await context.newPage();

    // Wire the beacon counter before any navigation (initiation-vs-delivery
    // caveat: see rum-traffic.js — delivery is verified via the streams).
    beacons = attachBeaconCounter(app, ORG);

    await app.goto(server.url, { waitUntil: 'domcontentloaded' });
    // Wait for the bundled SDK entry (served locally) to load, then for the
    // SDK objects to be live — explicit signals instead of networkidle.
    await app
      .waitForResponse((r) => r.url().includes('/npm-bundle.js'), { timeout: 30000 })
      .catch(() => testLogger.warn('npm bundle response not observed'));
    await waitForRumSdkReady(app);

    // Deterministic signal generation + flush (shared with the CDN path).
    await driveRumSampleInteractions(app);
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

    testLogger.info('Beacon tallies', beacons);
    expect(beacons.rum, '_rumdata beacons fired').toBeGreaterThan(0);
    expect(beacons.logs, '_rumlog beacons fired').toBeGreaterThan(0);
    expect(dataRows.length, `_rumdata delivery confirmed for ${SERVICE}`).toBeGreaterThan(0);
    expect(logRows.length, `_rumlog delivery confirmed for ${SERVICE}`).toBeGreaterThan(0);
  });

  test('_rumdata stream receives events for this run', {
    tag: ['@rum', '@rumNpmDataflow', '@dataflow', '@P0'],
  }, async ({ page }) => {
    const hits = await waitForStreamRows(page, {
      sql: `SELECT * FROM "_rumdata" WHERE service = '${SERVICE}'`,
      minRows: 1,
      timeoutMs: 45000,
    });

    expect(hits.length, `_rumdata should contain rows for ${SERVICE}`).toBeGreaterThan(0);
  });

  test('_rumlog stream receives forwarded logs for this run', {
    tag: ['@rum', '@rumNpmDataflow', '@dataflow', '@P1'],
  }, async ({ page }) => {
    const hits = await waitForStreamRows(page, {
      sql: `SELECT * FROM "_rumlog" WHERE service = '${SERVICE}'`,
      minRows: 1,
      timeoutMs: 45000,
    });

    expect(hits.length, `_rumlog should contain rows for ${SERVICE}`).toBeGreaterThan(0);
  });

  test('RUM Error Tracking page renders ingested errors', {
    tag: ['@rum', '@rumNpmDataflow', '@dataflow', '@ui', '@P1'],
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
