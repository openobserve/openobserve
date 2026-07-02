/**
 * Sourcemap Upload + Pretty Stack Trace — End-to-End
 *
 * Proves the full sourcemap pipeline with a DETERMINISTIC committed fixture
 * (fixtures/sourcemaps): a tiny app minified once with esbuild whose
 * generated→original mappings are calibrated in manifest.json.
 *
 *   1. Upload the fixture sourcemaps ZIP through the real Upload UI.
 *   2. Verify the Source Maps list shows the uploaded group.
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
 */

const path = require('path');
const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { waitForStreamRows } = require('../utils/rum-stream-verify.js');

const ORG = process.env.ORGNAME || 'default';
const BASE = process.env.ZO_BASE_URL || 'http://localhost:5080';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/sourcemaps');
const manifest = require(path.join(FIXTURE_DIR, 'manifest.json'));
const ZIP_PATH = path.join(FIXTURE_DIR, manifest.zip);
const INVALID_ZIP_PATH = path.join(FIXTURE_DIR, manifest.invalidZip);

const RUN_ID = Date.now();
// Unique per run: duplicate uploads are rejected by the backend, so a stable
// service name would break reruns against the same instance.
const SERVICE = `e2e-smap-${RUN_ID}`;
const NOMAP_SERVICE = `e2e-smap-nomap-${RUN_ID}`;
const VERSION = '1.0.0-e2e';
const ENV = 'e2e';

function authHeader() {
  return `Basic ${Buffer.from(
    `${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`,
  ).toString('base64')}`;
}

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

/** Ingest events into _rumdata and wait until they are searchable. */
async function ingestFixtureErrors(page, events, service) {
  const res = await page.request.post(`${BASE}/api/${ORG}/_rumdata/_json`, {
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
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
async function openErrorDetail(page, service) {
  const filter = Buffer.from(`service='${service}'`).toString('base64');
  await page.goto(
    `${BASE}/web/rum/errors?period=1h&query=${encodeURIComponent(filter)}&org_identifier=${ORG}`,
  );
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  await expect(page.locator('[data-test="rum-app-errors-table"]')).toBeVisible({ timeout: 15000 });
  await expect
    .poll(async () => page.locator('[data-test^="o2-table-row-"]').count(), {
      timeout: 30000,
      intervals: [1000, 2000, 3000],
    })
    .toBeGreaterThan(0);

  await page.locator('[data-test^="o2-table-row-"]').first().click();
  await expect(page).toHaveURL(/\/rum\/errors\/view\//, { timeout: 15000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
}

async function fillUploadForm(page, { service, version, env, zipPath }) {
  await page.goto(`${BASE}/web/rum/upload-source-maps?org_identifier=${ORG}`);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  await page.locator('[data-test="rum-upload-source-maps-service-input"] input').fill(service);
  await page.locator('[data-test="rum-upload-source-maps-version-input"] input').fill(version);
  await page.locator('[data-test="rum-upload-source-maps-environment-input"] input').fill(env);
  await page.locator('[data-test="rum-upload-source-maps-file-input"]').setInputFiles(zipPath);
}

test.describe('Sourcemap Upload & Pretty Stack Trace', { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async ({ browser }) => {
    // Remove the uploaded group so local reruns and shared instances stay clean.
    const page = await browser.newPage();
    await page.request
      .delete(
        `${BASE}/api/${ORG}/sourcemaps?service=${SERVICE}&version=${VERSION}&env=${ENV}`,
        { headers: { Authorization: authHeader() } },
      )
      .catch(() => {});
    await page.close();
  });

  // ==========================================================================
  // Upload page
  // ==========================================================================

  test('rejects a zip that contains no sourcemap files', {
    tag: ['@rum', '@sourcemap', '@upload', '@P1'],
  }, async ({ page }) => {
    await fillUploadForm(page, { service: SERVICE, version: VERSION, env: ENV, zipPath: INVALID_ZIP_PATH });
    await page.locator('[data-test="rum-upload-source-maps-upload-btn"]').click();

    // Backend 400 message must surface to the user (covers the
    // "error if no valid sourcemap file found in zip" fix).
    await expect(page.getByText(/No valid sourcemap files found/i).first()).toBeVisible({ timeout: 15000 });
    // Still on the upload page — nothing was stored.
    await expect(page).toHaveURL(/upload-source-maps/);
  });

  test('shows inline validation errors when required fields are empty', {
    tag: ['@rum', '@sourcemap', '@upload', '@P1'],
  }, async ({ page }) => {
    await page.goto(`${BASE}/web/rum/upload-source-maps?org_identifier=${ORG}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    await page.locator('[data-test="rum-upload-source-maps-upload-btn"]').click();

    await expect(page.getByText('Service is required').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Version is required').first()).toBeVisible();
  });

  test('uploads the fixture sourcemaps zip successfully', {
    tag: ['@rum', '@sourcemap', '@upload', '@P0'],
  }, async ({ page }) => {
    await fillUploadForm(page, { service: SERVICE, version: VERSION, env: ENV, zipPath: ZIP_PATH });
    await page.locator('[data-test="rum-upload-source-maps-upload-btn"]').click();

    await expect(page.getByText('Source maps uploaded successfully').first()).toBeVisible({ timeout: 15000 });
    // Success navigates back to the Source Maps list.
    await expect(page).toHaveURL(/\/rum\/source-maps/, { timeout: 15000 });
  });

  test('lists the uploaded sourcemaps group with service, version and env', {
    tag: ['@rum', '@sourcemap', '@upload', '@P0'],
  }, async ({ page }) => {
    await page.goto(`${BASE}/web/rum/source-maps?org_identifier=${ORG}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    const row = page.locator('[data-test^="o2-table-row-"]', { hasText: SERVICE });
    await expect(row.first()).toBeVisible({ timeout: 15000 });
    await expect(row.first()).toContainText(VERSION);
    await expect(row.first()).toContainText(ENV);

    // Expanding the row lists the actual files extracted from the zip.
    await row.first().click();
    const fileItem = page.locator('[data-test="source-maps-file-item"]', {
      hasText: manifest.bundle,
    });
    await expect(fileItem.first()).toBeVisible({ timeout: 10000 });
    await expect(fileItem.first()).toContainText(`${manifest.bundle}.map`);
  });

  test('rejects re-uploading the same sourcemaps as duplicates', {
    tag: ['@rum', '@sourcemap', '@upload', '@P1'],
  }, async ({ page }) => {
    await fillUploadForm(page, { service: SERVICE, version: VERSION, env: ENV, zipPath: ZIP_PATH });
    await page.locator('[data-test="rum-upload-source-maps-upload-btn"]').click();

    await expect(page.getByText(/already exists/i).first()).toBeVisible({ timeout: 15000 });
  });

  // ==========================================================================
  // Translate API — exact original positions for every fixture error
  // ==========================================================================

  test('translate API resolves every fixture error to its original source line', {
    tag: ['@rum', '@sourcemap', '@api', '@P0'],
  }, async ({ page }) => {
    for (const [key, e] of Object.entries(manifest.errors)) {
      const res = await page.request.post(`${BASE}/api/${ORG}/sourcemaps/stacktrace`, {
        headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
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
    tag: ['@rum', '@sourcemap', '@pretty', '@ui', '@P0'],
  }, async ({ page }) => {
    const err = manifest.errors.typeError;
    await ingestFixtureErrors(page, [fixtureErrorEvent('typeError', SERVICE)], SERVICE);
    await openErrorDetail(page, SERVICE);

    // Raw tab is the default and shows the MINIFIED frame.
    await expect(page.getByRole('tab', { name: 'Raw' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(manifest.bundle).first()).toBeVisible();

    await page.getByRole('tab', { name: 'Pretty' }).click();

    // Translation resolves to the ORIGINAL file + line from the sourcemap.
    const prettyFrame = page.getByText(
      new RegExp(`${manifest.originalSourcePath.replace(/[./]/g, '\\$&')}:${err.expected.line}:`),
    );
    await expect(prettyFrame.first()).toBeVisible({ timeout: 30000 });

    // Expanding the frame reveals the source context header (Line <l>:<c>).
    await prettyFrame.first().click();
    await expect(page.getByText(new RegExp(`Line ${err.expected.line}:\\d+`)).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('Pretty tab translation is fetched once and cached across tab switches', {
    tag: ['@rum', '@sourcemap', '@pretty', '@ui', '@P1'],
  }, async ({ page }) => {
    let translateCalls = 0;
    page.on('request', (req) => {
      if (req.url().includes('/sourcemaps/stacktrace')) translateCalls += 1;
    });

    await openErrorDetail(page, SERVICE);
    await page.getByRole('tab', { name: 'Pretty' }).click();
    await expect(
      page.getByText(new RegExp(`sync-errors\\.js:${manifest.errors.typeError.expected.line}:`)).first(),
    ).toBeVisible({ timeout: 30000 });

    await page.getByRole('tab', { name: 'Raw' }).click();
    await page.getByRole('tab', { name: 'Pretty' }).click();
    await expect(
      page.getByText(new RegExp(`sync-errors\\.js:${manifest.errors.typeError.expected.line}:`)).first(),
    ).toBeVisible({ timeout: 10000 });

    expect(translateCalls, 'stacktrace translated once, then served from cache').toBe(1);
  });

  test('Pretty tab reports missing sourcemaps for an unmapped service', {
    tag: ['@rum', '@sourcemap', '@pretty', '@ui', '@P0'],
  }, async ({ page }) => {
    await ingestFixtureErrors(page, [fixtureErrorEvent('referenceError', NOMAP_SERVICE)], NOMAP_SERVICE);
    await openErrorDetail(page, NOMAP_SERVICE);

    await page.getByRole('tab', { name: 'Pretty' }).click();

    // No maps uploaded for this service -> explicit unavailable state, and it
    // must not hang in the loading state.
    await expect(
      page
        .getByText('Source Maps Not Available')
        .or(page.getByText(/Unable to translate stack trace/i))
        .first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Translating stack trace with source maps...')).toHaveCount(0);
  });

  // ==========================================================================
  // Delete flow — and its effect on the Pretty tab
  // ==========================================================================

  test('deletes the sourcemaps group and Pretty tab falls back to unavailable', {
    tag: ['@rum', '@sourcemap', '@upload', '@pretty', '@ui', '@P1'],
  }, async ({ page }) => {
    await page.goto(`${BASE}/web/rum/source-maps?org_identifier=${ORG}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    await page.locator(`[data-test="source-maps-${SERVICE}-delete"]`).click();
    await expect(page.locator('[data-test="delete-source-maps-dialog"]')).toBeVisible({ timeout: 10000 });
    await page
      .locator('[data-test="delete-source-maps-dialog"]')
      .getByRole('button', { name: /delete|confirm|ok/i })
      .click();

    await expect(
      page.locator(`[data-test="source-maps-file-item"]`, { hasText: SERVICE }),
    ).toHaveCount(0, { timeout: 15000 });

    // Fresh page load -> in-memory translation cache is empty, so the Pretty
    // tab re-translates and must now report sourcemaps as unavailable.
    await openErrorDetail(page, SERVICE);
    await page.getByRole('tab', { name: 'Pretty' }).click();
    await expect(
      page
        .getByText('Source Maps Not Available')
        .or(page.getByText(/Unable to translate stack trace/i))
        .first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
