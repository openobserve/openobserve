/**
 * Sourcemap Upload + Pretty Stack Trace — End-to-End
 *
 * Proves the full sourcemap pipeline with a DETERMINISTIC committed fixture
 * (fixtures/sourcemaps): a tiny app minified once with esbuild whose
 * generated→original mappings are calibrated in manifest.json. The upload
 * ZIPs are generated AT TEST TIME (utils/zip-builder.js) from the committed,
 * diffable dist/ text files — no opaque .zip binaries in the repo.
 *
 *   1. Upload the fixture sourcemaps group (API, in beforeAll — the Upload
 *      FORM itself, required-field validation and the upload happy path are
 *      already covered by GeneralTests/rum-form-validation.spec.js and are
 *      NOT repeated here).
 *   2. Verify the Source Maps list shows the group; verify the backend
 *      contracts unique to this suite: invalid-zip rejection and duplicate
 *      rejection surfacing through the real Upload UI.
 *   3. Ingest synthetic RUM errors whose stacks point at known positions in
 *      the minified bundle.
 *   4. Verify the error detail page's Pretty tab renders ORIGINAL source
 *      locations (file:line from src/errors/sync-errors.js) — plus the
 *      unavailable fallback, translation caching, and the delete flow.
 *
 * Backend contracts asserted (observed, see fixtures/sourcemaps/manifest.json):
 *   - invalid zip  -> 400 "No valid sourcemap files found in uploaded zip..."
 *   - duplicate    -> 400 "One of the sourcemaps already exists"
 *   - translate    -> frames as "at <fn> @ <original_path>:<line>:<col>"
 *                     with source_info context from sourcesContent
 *
 * Additive to sourcemap-ui.spec.js (kept untouched), which covers generic
 * Error Tracking display with globally-ingested errors.
 *
 * Prerequisites:
 *   - OpenObserve build on ZO_BASE_URL (default http://localhost:5080); the
 *     sourcemaps + RUM search routes are part of the standard (OSS) router.
 */

const fs = require('fs');
const path = require('path');
const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { waitForStreamRows } = require('../utils/rum-stream-verify.js');
const { rumTestContext, basicAuthHeader } = require('../utils/rum-env.js');
const { buildZip, createTempFile } = require('../utils/zip-builder.js');

// Validated env context (org-id allowlist, plain-HTTP guard, least-privilege
// account preference) — shared with every other RUM util via rum-env.js.
const { orgId: ORG, baseUrl: BASE, email, password } = rumTestContext();
const AUTH_HEADER = basicAuthHeader(email, password);

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/sourcemaps');
const manifest = require(path.join(FIXTURE_DIR, 'manifest.json'));

const RUN_ID = Date.now();
// Unique per run: duplicate uploads are rejected by the backend, so a stable
// service name would break reruns against the same instance.
const SERVICE = `e2e-smap-${RUN_ID}`;
const NOMAP_SERVICE = `e2e-smap-nomap-${RUN_ID}`;
// Dedicated group for the delete-flow test. Its stack trace must NEVER be
// translated before the group is deleted: the backend memoizes translations
// in an in-process LRU keyed by the exact (service, version, env) params of
// each request, and delete_group only evicts exact-key matches — a pre-delete
// translation under a different param combination keeps resolving from stale
// cache forever (see CACHE in src/core/src/service/db/sourcemaps.rs).
const DELMAP_SERVICE = `e2e-smap-del-${RUN_ID}`;
const VERSION = '1.0.0-e2e';
const ENV = 'e2e';

// Generated at test time from the committed dist/ text files (see beforeAll).
let zipBuffer;
let zipPath;
let invalidZipPath;

/** Build the raw browser-style stacktrace string for a manifest error. */
function fixtureStack(errorKey) {
  const e = manifest.errors[errorKey];
  return `${e.message}\n    at fn @ ${manifest.bundleUrlPrefix}/${manifest.bundle}:1:${e.generatedColumn}`;
}

/** SDK-shaped RUM error event pointing at the fixture bundle. */
function fixtureErrorEvent(errorKey, service, index = 0) {
  const e = manifest.errors[errorKey];
  const [type, ...msg] = e.message.split(': ');
  return {
    date: Date.now() - (index + 1) * 30000,
    type: 'error',
    error_id: `${service}-${errorKey}`,
    error: {
      message: msg.join(': '),
      type,
      stack: fixtureStack(errorKey),
      source: 'source',
      is_crash: false,
      resource: { url: `${manifest.bundleUrlPrefix}/` },
    },
    service,
    version: VERSION,
    env: ENV,
    session: { id: `smap-session-${RUN_ID}-${index}` },
    view: { id: `smap-view-${RUN_ID}-${index}`, referrer: '', url: `${manifest.bundleUrlPrefix}/` },
    application: { id: 'e2e-sourcemap-fixture' },
    context: { browser: { name: 'Chrome', version: '120.0.0' }, os: { name: 'Mac OS', version: '14.0' } },
  };
}

/** Upload the fixture sourcemaps zip for a service via the REST API. */
async function uploadFixtureGroup(page, service) {
  const res = await page.request.post(`${BASE}/api/${ORG}/sourcemaps`, {
    headers: { Authorization: AUTH_HEADER },
    multipart: {
      service,
      version: VERSION,
      env: ENV,
      file: { name: manifest.zip, mimeType: 'application/zip', buffer: zipBuffer },
    },
  });
  expect(res.ok(), `sourcemaps upload for ${service} should succeed (HTTP ${res.status()})`).toBe(true);
}

/** Ingest events into _rumdata and wait until they are searchable. */
async function ingestFixtureErrors(page, events, service) {
  const res = await page.request.post(`${BASE}/api/${ORG}/_rumdata/_json`, {
    headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
    data: events,
  });
  expect(res.ok(), `ingestion into _rumdata should succeed (HTTP ${res.status()})`).toBe(true);

  const rows = await waitForStreamRows(page, {
    sql: `SELECT * FROM "_rumdata" WHERE service = '${service}' AND type = 'error'`,
    minRows: events.length,
    timeoutMs: 45000,
  });
  expect(rows.length, `ingested errors for ${service} should be searchable`).toBeGreaterThanOrEqual(
    events.length,
  );
}

/** Open the Error Tracking list scoped to one service and drill into the first error. */
async function openErrorDetail(pm, service) {
  await pm.rumPage.gotoErrorsList({ service, period: '1h' });
  await pm.rumPage.expectErrorsTableVisible();
  await pm.rumPage.waitForErrorRowsPresent();
  await pm.rumPage.openFirstError();
}

/** Fill + submit the Upload UI form (page objects only). */
async function submitUploadForm(pm, { service, version, env, filePath }) {
  await pm.rumFormValidation.navigateToUploadSourceMaps();
  await pm.rumFormValidation.fillService(service);
  await pm.rumFormValidation.fillVersion(version);
  await pm.rumFormValidation.fillEnvironment(env);
  await pm.rumFormValidation.attachFile(filePath);
  await pm.rumFormValidation.clickUpload();
}

test.describe('Sourcemap Upload & Pretty Stack Trace', () => {
  // SERIAL IS REQUIRED: beforeAll uploads ONE sourcemaps group that the list /
  // duplicate / translate / Pretty tests all read, the caching test depends on
  // the translation performed by the preceding Pretty test, and the delete
  // flow ends the sequence by removing its dedicated group. With fullyParallel
  // workers each test would re-run beforeAll (duplicate-upload 400s) and the
  // order-dependent cache/delete assertions would race.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test.beforeAll(async ({ browser }) => {
    // Generate the upload archives from the committed dist/ text fixtures.
    const bundle = fs.readFileSync(path.join(FIXTURE_DIR, 'dist', manifest.bundle));
    const map = fs.readFileSync(path.join(FIXTURE_DIR, 'dist', `${manifest.bundle}.map`));
    zipBuffer = buildZip([
      { name: manifest.bundle, content: bundle },
      { name: `${manifest.bundle}.map`, content: map },
    ]);
    zipPath = createTempFile(manifest.zip, zipBuffer);
    invalidZipPath = createTempFile(
      manifest.invalidZip,
      buildZip([{ name: 'README.txt', content: 'not a sourcemap\n' }]),
    );

    // Upload the main fixture group once via the API. The Upload FORM happy
    // path is covered by GeneralTests/rum-form-validation.spec.js.
    const page = await browser.newPage();
    await uploadFixtureGroup(page, SERVICE);
    await page.close();
    testLogger.info('Sourcemap fixture group uploaded', { service: SERVICE });
  });

  test.afterAll(async ({ browser }) => {
    // Remove the uploaded groups so local reruns and shared instances stay clean.
    const page = await browser.newPage();
    for (const service of [SERVICE, DELMAP_SERVICE]) {
      await page.request
        .delete(
          `${BASE}/api/${ORG}/sourcemaps?service=${service}&version=${VERSION}&env=${ENV}`,
          { headers: { Authorization: AUTH_HEADER } },
        )
        .catch(() => {});
    }
    await page.close();
  });

  // ==========================================================================
  // Upload page — backend contracts NOT covered by rum-form-validation.spec.js
  // ==========================================================================

  test('rejects a zip that contains no sourcemap files', {
    tag: ['@rum', '@sourcemapUpload', '@P1'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    await submitUploadForm(pm, {
      service: `${SERVICE}-invalid`,
      version: VERSION,
      env: ENV,
      filePath: invalidZipPath,
    });

    // Backend 400 message must surface to the user (covers the
    // "error if no valid sourcemap file found in zip" fix).
    await pm.rumSourcemapsPage.expectUploadMessage(/No valid sourcemap files found/i);
    // Still on the upload page — nothing was stored.
    await pm.rumSourcemapsPage.expectOnUploadPage();
  });

  test('lists the uploaded sourcemaps group with service, version and env', {
    tag: ['@rum', '@sourcemapUpload', '@P0'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    await pm.rumSourcemapsPage.gotoSourceMapsList();

    await pm.rumSourcemapsPage.expectGroupRowVisible(SERVICE);
    await pm.rumSourcemapsPage.expectGroupRowContains(SERVICE, [VERSION, ENV]);

    // Expanding the row lists the actual files extracted from the zip.
    await pm.rumSourcemapsPage.expandGroupRow(SERVICE);
    await pm.rumSourcemapsPage.expectFileItemVisible(manifest.bundle);
    await pm.rumSourcemapsPage.expectFileItemContains(manifest.bundle, `${manifest.bundle}.map`);
  });

  test('rejects re-uploading the same sourcemaps as duplicates', {
    tag: ['@rum', '@sourcemapUpload', '@P1'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    await submitUploadForm(pm, {
      service: SERVICE,
      version: VERSION,
      env: ENV,
      filePath: zipPath,
    });

    await pm.rumSourcemapsPage.expectUploadMessage(/already exists/i);
  });

  // ==========================================================================
  // Translate API — exact original positions for every fixture error
  // ==========================================================================

  test('translate API resolves every fixture error to its original source line', {
    tag: ['@rum', '@sourcemapTranslate', '@P0'],
  }, async ({ page }) => {
    for (const [key, e] of Object.entries(manifest.errors)) {
      const res = await page.request.post(`${BASE}/api/${ORG}/sourcemaps/stacktrace`, {
        headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
        data: { stacktrace: fixtureStack(key), service: SERVICE, version: VERSION, env: ENV },
      });
      expect(res.ok(), `${key}: translate should succeed`).toBe(true);

      const body = await res.json();
      const frame = body?.stacktrace?.stack?.[0];
      expect(frame, `${key}: translated frame present`).toBeTruthy();
      expect(frame.line, `${key}: frame maps to the original file:line`).toContain(
        `${manifest.originalSourcePath}:${e.expected.line}:`,
      );
      expect(frame.source_info?.stack_line, `${key}: source_info line`).toBe(e.expected.line);
      expect(frame.source_info?.source, `${key}: original source content`).toContain(
        e.expected.sourceContains,
      );
    }
  });

  // ==========================================================================
  // Error detail — Pretty tab
  // ==========================================================================

  test('Pretty tab shows the original source location for an ingested error', {
    tag: ['@rum', '@sourcemapPretty', '@ui', '@P0'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const err = manifest.errors.typeError;
    await ingestFixtureErrors(page, [fixtureErrorEvent('typeError', SERVICE)], SERVICE);
    await openErrorDetail(pm, SERVICE);

    // Raw tab is the default and shows the MINIFIED frame.
    await pm.rumPage.expectRawTabVisible();
    await pm.rumPage.expectDetailContainsText(manifest.bundle);

    await pm.rumPage.clickPrettyTab();

    // Translation resolves to the ORIGINAL file + line from the sourcemap.
    await pm.rumPage.expectPrettyFrameVisible(manifest.originalSourcePath, err.expected.line);

    // Expanding the frame reveals the source context header (Line <l>:<c>).
    await pm.rumPage.expandPrettyFrameAndExpectSourceContext(
      manifest.originalSourcePath,
      err.expected.line,
    );
  });

  test('Pretty tab translation is fetched once and cached across tab switches', {
    tag: ['@rum', '@sourcemapPretty', '@ui', '@P1'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const err = manifest.errors.typeError;
    let translateCalls = 0;
    page.on('request', (req) => {
      if (req.url().includes('/sourcemaps/stacktrace')) translateCalls += 1;
    });

    await openErrorDetail(pm, SERVICE);
    await pm.rumPage.clickPrettyTab();
    await pm.rumPage.expectPrettyFrameVisible(manifest.originalSourcePath, err.expected.line);

    await pm.rumPage.clickRawTab();
    await pm.rumPage.clickPrettyTab();
    await pm.rumPage.expectPrettyFrameVisible(manifest.originalSourcePath, err.expected.line, 10000);

    expect(translateCalls, 'stacktrace translated once, then served from cache').toBe(1);
  });

  test('Pretty tab reports missing sourcemaps for an unmapped service', {
    tag: ['@rum', '@sourcemapPretty', '@ui', '@P0'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    await ingestFixtureErrors(page, [fixtureErrorEvent('referenceError', NOMAP_SERVICE)], NOMAP_SERVICE);
    await openErrorDetail(pm, NOMAP_SERVICE);

    await pm.rumPage.clickPrettyTab();

    // No maps uploaded for this service -> explicit unavailable state, and it
    // must not hang in the loading state.
    await pm.rumPage.expectPrettyUnavailableMessage();
    await pm.rumPage.expectPrettyLoadingResolved();
  });

  // ==========================================================================
  // Delete flow — and its effect on the Pretty tab
  // ==========================================================================

  test('deletes the sourcemaps group and Pretty tab falls back to unavailable', {
    tag: ['@rum', '@sourcemapUpload', '@sourcemapPretty', '@ui', '@P1'],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    // Arrange a DEDICATED group + error for this scenario (see DELMAP_SERVICE
    // note above): translating this stack before the delete would poison the
    // backend's translation cache and keep resolving after the group is gone,
    // making the fallback assertion flaky-by-design.
    await uploadFixtureGroup(page, DELMAP_SERVICE);
    await ingestFixtureErrors(page, [fixtureErrorEvent('typeError', DELMAP_SERVICE)], DELMAP_SERVICE);

    // Delete the group through the real UI flow (the page object waits for
    // the backing DELETE response before asserting the row is gone).
    await pm.rumSourcemapsPage.gotoSourceMapsList();
    await pm.rumSourcemapsPage.expectGroupRowVisible(DELMAP_SERVICE);
    await pm.rumSourcemapsPage.deleteGroupAndExpectRemoved(DELMAP_SERVICE);

    // Prove the deletion server-side before touching the UI again: the group
    // must vanish from the list API. Failing here means the backend DELETE is
    // broken — a much more precise signal than a missing message in the UI.
    await expect
      .poll(async () => {
        const res = await page.request.get(
          `${BASE}/api/${ORG}/sourcemaps?service=${DELMAP_SERVICE}&version=${VERSION}&env=${ENV}`,
          { headers: { Authorization: AUTH_HEADER } },
        );
        if (!res.ok()) return -res.status();
        return (await res.json()).length;
      }, { timeout: 15000, intervals: [500, 1000, 2000] })
      .toBe(0);

    // After deletion the translate API must not resolve any frame to original
    // source (this group was never translated, so no cache can serve it).
    const translateRes = await page.request.post(`${BASE}/api/${ORG}/sourcemaps/stacktrace`, {
      headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
      data: {
        stacktrace: fixtureStack('typeError'),
        service: DELMAP_SERVICE,
        version: VERSION,
        env: ENV,
      },
    });
    expect(translateRes.ok(), `translate after delete should still respond (HTTP ${translateRes.status()})`).toBe(true);
    const translateBody = await translateRes.json();
    const traces = Array.isArray(translateBody?.stacktrace)
      ? translateBody.stacktrace
      : [translateBody?.stacktrace].filter(Boolean);
    const frames = traces.flatMap((t) => t?.stack || []);
    expect(
      frames.every((f) => !f.source_info),
      `no frame may carry source_info after delete, got: ${JSON.stringify(frames)}`,
    ).toBe(true);

    // UI: the Pretty tab now reports sourcemaps as unavailable — and must not
    // hang in the loading state.
    await openErrorDetail(pm, DELMAP_SERVICE);
    await pm.rumPage.clickPrettyTab();

    await pm.rumPage.expectPrettyUnavailableState();
    await pm.rumPage.expectPrettyLoadingResolved();
  });
});
