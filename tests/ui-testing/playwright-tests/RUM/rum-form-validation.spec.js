// Copyright 2026 OpenObserve Inc.
//
// RUM Source Maps — upload form validation E2E tests
//
// Covers (after the OForm+zod migration, all field validation is INLINE via the
// schema — the file "required" / "only .zip" rules moved from manual toasts to
// the inline dropzone error; only the success/server-error paths use toasts):
//   1. No file selected   → inline file error "Please select a ZIP file to upload"
//   2. Wrong file type    → inline file error "Only ZIP files are allowed"
//   3. No version filled  → versionError shown after clicking Upload
//   4. No service filled  → serviceError shown after clicking Upload
//   5. Valid inputs       → upload succeeds (toast success + navigation away)
//
// NOTE: The component (web/src/views/RUM/UploadSourceMaps.vue) must have the
// following data-test attributes added for these tests to work:
//
//   OInput service     → data-test="rum-upload-source-maps-service-input"
//   OInput version     → data-test="rum-upload-source-maps-version-input"
//   OInput environment → data-test="rum-upload-source-maps-environment-input"
//   upload area div    → data-test="rum-upload-source-maps-file-dropzone"
//   <input type="file">→ data-test="rum-upload-source-maps-file-input"
//   Upload OButton     → data-test="rum-upload-source-maps-upload-btn"
//   Cancel OButton     → data-test="rum-upload-source-maps-cancel-btn"

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { buildZip, createTempFile } = require('../utils/zip-builder.js');

// ── RUM Source Maps form validation tests ─────────────────────────────────────

// Unique per run: duplicate uploads are rejected by the backend with 400
// "already exists", so a stable service name would break reruns against the
// same (persistent) instance. The uploaded group is deleted in afterAll.
const UPLOAD_SERVICE = `test-service-fv-${Date.now()}`;
const UPLOAD_VERSION = '1.0.0';
const UPLOAD_ENV = 'production';

test.describe('RUM Source Maps upload form validation', () => {
  test.describe.configure({ mode: 'serial' });

  let pm;
  let tempZipPath;
  let tempTxtPath;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.rumFormValidation.navigateToUploadSourceMaps();
    testLogger.info('Upload Source Maps page is ready');
  });

  // Create temp files once before the suite runs
  test.beforeAll(async () => {
    // A structurally valid ZIP that actually contains a sourcemap pair
    // (a minified .js and its matching .js.map). The backend now rejects any
    // archive with no valid .js/.js.map files ("No valid sourcemap files found
    // in uploaded zip"), so the upload happy-path needs real entries — an empty
    // archive is no longer accepted.
    const sourceMapContent = JSON.stringify({
      version: 3,
      file: 'app.js',
      sources: ['app.ts'],
      names: [],
      mappings: 'AAAA',
    });
    const validSourceMapZip = buildZip([
      { name: 'app.js',     content: 'console.log("hello");' },
      { name: 'app.js.map', content: sourceMapContent },
    ]);
    tempZipPath = createTempFile('test_sourcemaps_fv.zip', validSourceMapZip);
    // Non-zip file used to trigger format error
    tempTxtPath = createTempFile('invalid_sourcemaps_fv.txt', 'not a zip');
  });

  test.afterAll(async ({ browser }) => {
    // Remove the group uploaded by the happy-path test so reruns against the
    // same instance never hit the duplicate-upload 400.
    const orgId = process.env['ORGNAME'] || 'default';
    const baseUrl = process.env['ZO_BASE_URL'] || 'http://localhost:5080';
    const auth = Buffer.from(
      `${process.env['ZO_ROOT_USER_EMAIL']}:${process.env['ZO_ROOT_USER_PASSWORD']}`,
    ).toString('base64');
    const page = await browser.newPage();
    await page.request
      .delete(
        `${baseUrl}/api/${orgId}/sourcemaps?service=${UPLOAD_SERVICE}&version=${UPLOAD_VERSION}&env=${UPLOAD_ENV}`,
        { headers: { Authorization: `Basic ${auth}` } },
      )
      .catch(() => {});
    await page.close();
  });

  // ── Test 1: No file selected → inline file error ────────────────────────────

  test('should show file required error when Upload is clicked with no file selected', {
    tag: ['@rum-form-validation', '@P0', '@smoke']
  }, async ({ page }) => {
    testLogger.info('Testing no-file-selected error on Upload click');

    // Fill valid service and version so only the missing file triggers the error
    await pm.rumFormValidation.fillService('test-service-fv');
    await pm.rumFormValidation.fillVersion('1.0.0');
    await pm.rumFormValidation.clickUpload();

    // OForm+zod: the missing-file rule surfaces INLINE on the dropzone (not a toast).
    await expect(pm.rumFormValidation.getFileErrorLocator()).toBeVisible({ timeout: 5000 });
    await expect(pm.rumFormValidation.getFileErrorLocator()).toContainText('Please select a ZIP file to upload');

    testLogger.info('No-file inline error correctly shown');
  });

  // ── Test 2: Wrong file type → inline file error ─────────────────────────────

  test('should show format error when a non-ZIP file is attached', {
    tag: ['@rum-form-validation', '@P0', '@smoke']
  }, async ({ page }) => {
    testLogger.info('Testing wrong file type validation');

    // Fill service + version so the file field is the only invalid one.
    await pm.rumFormValidation.fillService('test-service-fv');
    await pm.rumFormValidation.fillVersion('1.0.0');
    await pm.rumFormValidation.attachFile(tempTxtPath);
    // OForm+zod uses submit-then-change timing, so the `.zip` rule fires on
    // submit — attaching alone does not surface the error.
    await pm.rumFormValidation.clickUpload();

    await expect(pm.rumFormValidation.getFileErrorLocator()).toBeVisible({ timeout: 5000 });
    await expect(pm.rumFormValidation.getFileErrorLocator()).toContainText('Only ZIP files are allowed');

    testLogger.info('Wrong file type inline error correctly shown');
  });

  // ── Test 3: No version → version required field error ──────────────────────

  test('should show version required error when Upload is clicked without a version', {
    tag: ['@rum-form-validation', '@P0', '@smoke']
  }, async ({ page }) => {
    testLogger.info('Testing version required validation');

    await pm.rumFormValidation.attachFile(tempZipPath);
    await pm.rumFormValidation.fillService('test-service-fv');
    // Leave version empty
    await pm.rumFormValidation.clickUpload();

    await expect(pm.rumFormValidation.getVersionErrorLocator()).toBeVisible({ timeout: 5000 });
    await expect(pm.rumFormValidation.getVersionErrorLocator()).toContainText('Version is required');

    testLogger.info('Version required error correctly shown');
  });

  // ── Test 4: No service → service required field error ──────────────────────

  test('should show service required error when Upload is clicked without a service name', {
    tag: ['@rum-form-validation', '@P0', '@smoke']
  }, async ({ page }) => {
    testLogger.info('Testing service required validation');

    await pm.rumFormValidation.attachFile(tempZipPath);
    await pm.rumFormValidation.fillVersion('1.0.0');
    // Leave service empty
    await pm.rumFormValidation.clickUpload();

    await expect(pm.rumFormValidation.getServiceErrorLocator()).toBeVisible({ timeout: 5000 });
    await expect(pm.rumFormValidation.getServiceErrorLocator()).toContainText('Service is required');

    testLogger.info('Service required error correctly shown');
  });

  // ── Test 5: Fully empty submit → all required errors surface together ───────

  test('should surface all required errors at once when Upload is clicked on an empty form', {
    tag: ['@rum-form-validation', '@P0', '@smoke']
  }, async ({ page }) => {
    testLogger.info('Testing that an empty submit reports every required field, not just the first');

    // Submit with nothing filled — Service/Version and the ZIP file errors must
    // all appear inline in the same pass (validation no longer stops at the first
    // missing field, and the file error is no longer a toast).
    await pm.rumFormValidation.clickUpload();

    await expect(pm.rumFormValidation.getServiceErrorLocator()).toBeVisible({ timeout: 5000 });
    await expect(pm.rumFormValidation.getServiceErrorLocator()).toContainText('Service is required');

    await expect(pm.rumFormValidation.getVersionErrorLocator()).toBeVisible({ timeout: 5000 });
    await expect(pm.rumFormValidation.getVersionErrorLocator()).toContainText('Version is required');

    await expect(pm.rumFormValidation.getFileErrorLocator()).toBeVisible({ timeout: 5000 });
    await expect(pm.rumFormValidation.getFileErrorLocator()).toContainText('Please select a ZIP file to upload');

    testLogger.info('All required errors (service, version, file) shown together on empty submit');
  });

  // ── Test 6: Valid inputs → upload succeeds ──────────────────────────────────

  test('should upload source maps successfully when all required fields are valid', {
    tag: ['@rum-form-validation', '@P0', '@smoke']
  }, async ({ page }) => {
    testLogger.info('Testing successful source map upload with valid inputs');

    await pm.rumFormValidation.fillService(UPLOAD_SERVICE);
    await pm.rumFormValidation.fillVersion(UPLOAD_VERSION);
    await pm.rumFormValidation.fillEnvironment(UPLOAD_ENV);
    await pm.rumFormValidation.attachFile(tempZipPath);

    // Confirm file was attached (upload area should reflect a file is selected)
    await expect(pm.rumFormValidation.getFileUploadAreaLocator()).toBeVisible();

    await pm.rumFormValidation.clickUpload();

    // After a successful upload the component shows a success toast and navigates away
    await expect(pm.rumFormValidation.getToastSuccessLocator()).toBeVisible({ timeout: 15000 });
    const toastText = await pm.rumFormValidation.getToastMessageLocator().textContent();
    expect(toastText).toContain('Source maps uploaded successfully');

    testLogger.info('Source maps uploaded successfully');
  });
});
