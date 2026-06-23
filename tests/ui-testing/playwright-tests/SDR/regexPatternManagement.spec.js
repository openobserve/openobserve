const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const testData = require("../../../test-data/sdr_test_data.json");
const path = require('path');

test.describe("Regex Pattern Management Tests", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  // Generate unique test run ID for isolation
  const testRunId = Date.now().toString(36);

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Regex Pattern Management test setup completed');
  });

  // ===== VALIDATION TESTS =====

  test("should reject save when required fields are empty", {
    tag: ['@sdr', '@regexPatterns', '@negative', '@validation', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing that form rejects save when required fields are empty');

    await pm.sdrPatternsPage.navigateToRegexPatterns();

    // Test 1: Empty pattern name — form should not close
    testLogger.info('Testing empty pattern name');
    await pm.sdrPatternsPage.clickAddPattern();
    await pm.sdrPatternsPage.patternDescriptionInput.fill('Test description');
    await pm.sdrPatternsPage.patternInput.fill('^[A-Z]{5}[0-9]{4}[A-Z]$');

    // OForm validates on submit (not field-disabled); clicking save triggers
    // Zod validation which keeps the drawer open on error.
    await pm.sdrPatternsPage.saveButton.click();
    testLogger.info('Verifying drawer stays open after save with empty name');
    await expect(pm.sdrPatternsPage.addPatternTitle).toBeVisible({ timeout: 5000 });

    await pm.sdrPatternsPage.cancelButton.click();
    await page.waitForTimeout(500);

    // Test 2: Empty regex pattern — form should not close
    testLogger.info('Testing empty regex pattern');
    await pm.sdrPatternsPage.clickAddPattern();
    await pm.sdrPatternsPage.patternNameInput.fill('empty_pattern');
    await pm.sdrPatternsPage.patternDescriptionInput.fill('Test description');

    await pm.sdrPatternsPage.saveButton.click();
    testLogger.info('Verifying drawer stays open after save with empty pattern');
    await expect(pm.sdrPatternsPage.addPatternTitle).toBeVisible({ timeout: 5000 });
  });

  // ===== ERROR HANDLING TESTS =====

  test("should show error when pattern contains invalid regex syntax", {
    tag: ['@sdr', '@regexPatterns', '@negative', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing invalid regex syntax');

    await pm.sdrPatternsPage.navigateToRegexPatterns();
    await pm.sdrPatternsPage.clickAddPattern();
    await pm.sdrPatternsPage.fillPatternDetails(
      'invalid_regex',
      'Invalid regex pattern',
      '[invalid(regex'
    );
    await pm.sdrPatternsPage.clickSavePattern();

    // Verify save failed: drawer stays open (invalid regex rejected by server)
    await pm.sdrPatternsPage.verifyPatternCreationFailed();
    testLogger.info('Invalid regex rejected — drawer remained open as expected');
  });

  test("should handle duplicate pattern name and allow fixing", {
    tag: ['@sdr', '@regexPatterns', '@negative', '@P2']
  }, async ({ page }) => {
    const patternName = `duplicate_test_${testRunId}`;
    const fixedPatternName = `duplicate_test_fixed_${testRunId}`;

    testLogger.info(`Testing duplicate pattern error and fixing by changing name (pattern: ${patternName})`);

    await pm.sdrPatternsPage.navigateToRegexPatterns();

    // Create initial pattern
    testLogger.info('Creating initial pattern');
    await pm.sdrPatternsPage.createPatternWithDeleteIfExists(
      patternName,
      'First pattern',
      '^test$',
      pm.streamAssociationPage
    );
    await pm.sdrPatternsPage.verifyPatternCreatedSuccess();

    // Try to create duplicate - should fail
    testLogger.info('Attempting to create duplicate pattern');
    await pm.sdrPatternsPage.clickAddPattern();
    await pm.sdrPatternsPage.fillPatternDetails(
      patternName,
      'Duplicate pattern',
      '^test2$'
    );
    await pm.sdrPatternsPage.clickSavePattern();
    await pm.sdrPatternsPage.verifyDuplicatePatternError();

    // Fix by changing name - should succeed
    testLogger.info('Fixing duplicate by changing name');
    await pm.sdrPatternsPage.patternNameInput.click();
    await pm.sdrPatternsPage.patternNameInput.fill(fixedPatternName);
    await pm.sdrPatternsPage.clickSavePattern();
    await pm.sdrPatternsPage.verifyPatternCreatedSuccess();
  });

  test("should cancel pattern creation", {
    tag: ['@sdr', '@regexPatterns', '@negative', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing cancel pattern creation');

    await pm.sdrPatternsPage.navigateToRegexPatterns();
    await pm.sdrPatternsPage.clickAddPattern();
    await pm.sdrPatternsPage.fillPatternDetails(
      'cancelled_pattern',
      'This will be cancelled',
      '^test$'
    );
    await pm.sdrPatternsPage.cancelButton.click();

    await page.waitForTimeout(500);
    const patternVisible = await pm.sdrPatternsPage.checkPatternExists('cancelled_pattern');
    expect(patternVisible).toBeFalsy();
  });

  // ===== IMPORT FUNCTIONALITY =====

  test("should test import functionality with valid JSON file", {
    tag: ['@sdr', '@import', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing regex pattern import');

    await pm.sdrPatternsPage.navigateToRegexPatterns();

    const importFilePath = path.resolve(__dirname, '../../../test-data/regex_patterns_import.json');
    const imported = await pm.sdrPatternsPage.importPatternsFromFile(importFilePath);
    expect(imported, 'Import should complete successfully (dialog should close)').toBeTruthy();
    testLogger.info('Import completed, verifying imported patterns');
  });
});
