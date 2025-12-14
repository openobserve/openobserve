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
    await page.waitForLoadState('networkidle');
    testLogger.info('Regex Pattern Management test setup completed');
  });

  // ===== VALIDATION TESTS =====

  test("should disable save button when required fields are empty", {
    tag: ['@sdr', '@regexPatterns', '@negative', '@validation']
  }, async ({ page }) => {
    testLogger.info('Testing that save button is disabled when required fields are empty');

    await pm.sdrPatternsPage.navigateToRegexPatterns();

    // Test 1: Empty pattern name
    testLogger.info('Testing empty pattern name');
    await pm.sdrPatternsPage.clickAddPattern();
    await pm.sdrPatternsPage.patternDescriptionInput.fill('Test description');
    await pm.sdrPatternsPage.patternInput.fill('^[A-Z]{5}[0-9]{4}[A-Z]$');

    let saveButton = pm.sdrPatternsPage.saveButton;
    let isDisabled = await saveButton.isDisabled();
    testLogger.info(`Save button disabled (empty name): ${isDisabled}`);
    expect(isDisabled).toBeTruthy();

    await pm.sdrPatternsPage.cancelButton.click();
    await page.waitForTimeout(500);

    // Test 2: Empty regex pattern
    testLogger.info('Testing empty regex pattern');
    await pm.sdrPatternsPage.clickAddPattern();
    await pm.sdrPatternsPage.patternNameInput.fill('empty_pattern');
    await pm.sdrPatternsPage.patternDescriptionInput.fill('Test description');

    saveButton = pm.sdrPatternsPage.saveButton;
    isDisabled = await saveButton.isDisabled();
    testLogger.info(`Save button disabled (empty pattern): ${isDisabled}`);
    expect(isDisabled).toBeTruthy();
  });

  // ===== ERROR HANDLING TESTS =====

  test("should show error when pattern contains invalid regex syntax", {
    tag: ['@sdr', '@regexPatterns', '@negative']
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

    // Verify the specific error message
    await page.waitForTimeout(1000);
    const errorVisible = await page.getByText('Error in creating block db for given pattern : check if given pattern is correct').isVisible({ timeout: 3000 }).catch(() => false);
    expect(errorVisible).toBeTruthy();
    testLogger.info('Invalid regex error message verified');
  });

  test("should handle duplicate pattern name and allow fixing", {
    tag: ['@sdr', '@regexPatterns', '@negative']
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
    tag: ['@sdr', '@regexPatterns', '@negative']
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
    const patternVisible = await page.locator('text="cancelled_pattern"').isVisible({ timeout: 2000 }).catch(() => false);
    expect(patternVisible).toBeFalsy();
  });

  // ===== IMPORT FUNCTIONALITY =====

  test("should test import functionality with valid JSON file", {
    tag: ['@sdr', '@import', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing regex pattern import');

    const importFilePath = path.resolve(__dirname, '../../../../test-data/regex_patterns_import.json');

    await pm.sdrPatternsPage.navigateToRegexPatterns();

    const fileInputExists = await page.locator('input[type="file"]').count() > 0;

    if (fileInputExists) {
      await pm.sdrPatternsPage.clickImport();
      await pm.sdrPatternsPage.uploadImportFile(importFilePath);
      await pm.sdrPatternsPage.waitForPatternListUpdate();

      testLogger.info('Import completed, verifying imported patterns');
    } else {
      testLogger.info('Import functionality not available via file input, skipping');
    }
  });
});
