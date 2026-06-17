// Copyright 2026 OpenObserve Inc.
//
// RUM Source Maps — upload form validation E2E tests
//
// Covers:
//   1. No file selected   → toast error "Please select a ZIP file to upload"
//   2. Wrong file type    → toast error "Only ZIP files are allowed"
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
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a temporary file on disk and return its absolute path.
 * @param {string} filename - File name including extension
 * @param {string} [content] - Optional content (defaults to empty)
 * @returns {string} absolute path to the temp file
 */
function createTempFile(filename, content = '') {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'rum-fv-'));
  const file = path.join(dir, filename);
  fs.writeFileSync(file, content);
  return file;
}

// ── RUM Source Maps form validation tests ─────────────────────────────────────

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
    // Minimal *valid* empty ZIP archive: a single End-Of-Central-Directory
    // record (22 bytes). A bare local-file signature ("PK\x03\x04") is rejected
    // by the backend with "Could not find EOCD", so the upload happy-path needs
    // a structurally valid archive.
    const emptyZip = Buffer.from([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    tempZipPath = createTempFile('test_sourcemaps_fv.zip', emptyZip);
    // Non-zip file used to trigger format error
    tempTxtPath = createTempFile('invalid_sourcemaps_fv.txt', 'not a zip');
  });

  // ── Test 1: No file selected → toast error ──────────────────────────────────

  test('should show file required toast error when Upload is clicked with no file selected', {
    tag: ['@rum-form-validation', '@P0', '@smoke']
  }, async ({ page }) => {
    testLogger.info('Testing no-file-selected error on Upload click');

    // Fill valid service and version so only the missing file triggers the error
    await pm.rumFormValidation.fillService('test-service-fv');
    await pm.rumFormValidation.fillVersion('1.0.0');
    await pm.rumFormValidation.clickUpload();

    await expect(pm.rumFormValidation.getToastErrorLocator()).toBeVisible({ timeout: 5000 });
    const toastText = await pm.rumFormValidation.getToastMessageLocator().textContent();
    expect(toastText).toContain('Please select a ZIP file to upload');

    testLogger.info('No-file error toast correctly shown');
  });

  // ── Test 2: Wrong file type → toast error ───────────────────────────────────

  test('should show format error toast when a non-ZIP file is attached', {
    tag: ['@rum-form-validation', '@P0', '@smoke']
  }, async ({ page }) => {
    testLogger.info('Testing wrong file type validation');

    await pm.rumFormValidation.attachFile(tempTxtPath);

    await expect(pm.rumFormValidation.getToastErrorLocator()).toBeVisible({ timeout: 5000 });
    const toastText = await pm.rumFormValidation.getToastMessageLocator().textContent();
    expect(toastText).toContain('Only ZIP files are allowed');

    testLogger.info('Wrong file type error toast correctly shown');
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

    // Submit with nothing filled — Service/Version inline errors and the ZIP
    // file toast must all appear in the same pass (validation no longer stops at
    // the first missing field).
    await pm.rumFormValidation.clickUpload();

    await expect(pm.rumFormValidation.getServiceErrorLocator()).toBeVisible({ timeout: 5000 });
    await expect(pm.rumFormValidation.getServiceErrorLocator()).toContainText('Service is required');

    await expect(pm.rumFormValidation.getVersionErrorLocator()).toBeVisible({ timeout: 5000 });
    await expect(pm.rumFormValidation.getVersionErrorLocator()).toContainText('Version is required');

    await expect(pm.rumFormValidation.getToastErrorLocator()).toBeVisible({ timeout: 5000 });
    const toastText = await pm.rumFormValidation.getToastMessageLocator().textContent();
    expect(toastText).toContain('Please select a ZIP file to upload');

    testLogger.info('All required errors (service, version, file) shown together on empty submit');
  });

  // ── Test 6: Valid inputs → upload succeeds ──────────────────────────────────

  test('should upload source maps successfully when all required fields are valid', {
    tag: ['@rum-form-validation', '@P0', '@smoke']
  }, async ({ page }) => {
    testLogger.info('Testing successful source map upload with valid inputs');

    await pm.rumFormValidation.fillService('test-service-fv-001');
    await pm.rumFormValidation.fillVersion('1.0.0');
    await pm.rumFormValidation.fillEnvironment('production');
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
