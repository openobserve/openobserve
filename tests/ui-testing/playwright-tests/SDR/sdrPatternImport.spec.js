const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("SDR Pattern Import Tests", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle');
    testLogger.info('SDR Pattern Import test setup completed');
  });

  // ===== SDR PATTERN IMPORT FROM BUILT-IN LIBRARY =====

  test("should import built-in SDR patterns from library", {
    tag: ['@sdr', '@import', '@positive']
  }, async ({ page }) => {
    testLogger.info('Testing SDR pattern import from built-in library');

    await pm.sdrPatternsPage.navigateToRegexPatterns();
    await page.waitForTimeout(1000);

    // Step 1: Import first batch of patterns (e.g., patterns 7, 8, 10)
    testLogger.info('Importing first batch of patterns');
    const firstImportSuccess = await pm.sdrPatternsPage.importBuiltInPatterns([7, 8, 10]);
    expect(firstImportSuccess).toBeTruthy();

    // Step 2: Import second batch (e.g., patterns 2, 4)
    testLogger.info('Importing second batch of patterns');
    await page.waitForTimeout(500);
    const secondImportSuccess = await pm.sdrPatternsPage.importBuiltInPatterns([2, 4]);
    expect(secondImportSuccess).toBeTruthy();

    // Step 3: Search and import PGP patterns
    testLogger.info('Searching and importing PGP patterns');
    await page.waitForTimeout(500);
    const thirdImportSuccess = await pm.sdrPatternsPage.searchAndImportBuiltInPatterns('PGP', [0, 1]);
    expect(thirdImportSuccess).toBeTruthy();

    // Step 4: Verify imported patterns exist in the list
    testLogger.info('Verifying imported patterns appear in the list');
    await page.waitForTimeout(1000);

    // Verify PGP patterns are visible
    const pgpPrivateKeyVisible = await pm.sdrPatternsPage.verifyPatternVisibleInList('PGP Private Key');
    const pgpPublicKeyVisible = await pm.sdrPatternsPage.verifyPatternVisibleInList('PGP Public Key');

    expect(pgpPrivateKeyVisible).toBeTruthy();
    expect(pgpPublicKeyVisible).toBeTruthy();

    testLogger.info('SDR pattern import test completed successfully');
  });

  test("should import and then delete built-in SDR patterns", {
    tag: ['@sdr', '@import', '@cleanup']
  }, async ({ page }) => {
    testLogger.info('Testing SDR pattern import and deletion workflow');

    await pm.sdrPatternsPage.navigateToRegexPatterns();
    await page.waitForTimeout(1000);

    // Step 1: Import PGP patterns using search
    const importSuccess = await pm.sdrPatternsPage.searchAndImportBuiltInPatterns('PGP', [0, 1]);
    expect(importSuccess).toBeTruthy();
    await page.waitForTimeout(1000);

    // Step 2: Verify patterns are visible
    testLogger.info('Verifying imported patterns');
    const pgpPrivateKeyVisible = await pm.sdrPatternsPage.verifyPatternVisibleInList('PGP Private Key');
    const pgpPublicKeyVisible = await pm.sdrPatternsPage.verifyPatternVisibleInList('PGP Public Key');

    expect(pgpPrivateKeyVisible).toBeTruthy();
    expect(pgpPublicKeyVisible).toBeTruthy();

    // Step 3: Delete imported patterns by their IDs
    testLogger.info('Deleting PGP Private Key pattern');
    let pgpPrivateKeyId = await pm.sdrPatternsPage.getPatternIdByName('PGP Private Key');

    if (pgpPrivateKeyId) {
      await pm.sdrPatternsPage.clickDeletePattern(pgpPrivateKeyId);
      await pm.sdrPatternsPage.confirmDelete();
      await page.waitForTimeout(1000);
    }

    testLogger.info('Deleting PGP Public Key pattern');
    let pgpPublicKeyId = await pm.sdrPatternsPage.getPatternIdByName('PGP Public Key');

    if (pgpPublicKeyId) {
      await pm.sdrPatternsPage.clickDeletePattern(pgpPublicKeyId);
      await pm.sdrPatternsPage.confirmDelete();
      await page.waitForTimeout(1000);
    }

    // Step 4: Verify patterns are deleted
    testLogger.info('Verifying patterns are deleted');
    await page.waitForTimeout(1000);
    const pgpPrivateDeleted = await pm.sdrPatternsPage.verifyPatternNotVisibleInList('PGP Private Key');
    const pgpPublicDeleted = await pm.sdrPatternsPage.verifyPatternNotVisibleInList('PGP Public Key');

    expect(pgpPrivateDeleted).toBeTruthy();
    expect(pgpPublicDeleted).toBeTruthy();
    testLogger.info('✓ Pattern deletion verified');
  });

  test("should handle pattern selection and deselection during import", {
    tag: ['@sdr', '@import', '@interaction']
  }, async ({ page }) => {
    testLogger.info('Testing pattern selection/deselection during import');

    await pm.sdrPatternsPage.navigateToRegexPatterns();
    await page.waitForTimeout(1000);

    // Open import dialog
    await pm.sdrPatternsPage.clickImport();
    await page.waitForTimeout(500);
    await pm.sdrPatternsPage.verifyImportDialogOpen();

    // Test selecting and deselecting patterns
    testLogger.info('Testing pattern checkbox toggling');

    // Select pattern 2
    await pm.sdrPatternsPage.selectPatternCheckbox(2);
    let isChecked = await pm.sdrPatternsPage.isPatternCheckboxChecked(2);
    expect(isChecked).toBeTruthy();

    // Deselect pattern 2
    await pm.sdrPatternsPage.selectPatternCheckbox(2);
    isChecked = await pm.sdrPatternsPage.isPatternCheckboxChecked(2);
    expect(isChecked).toBeFalsy();

    // Select pattern 4
    await pm.sdrPatternsPage.selectPatternCheckbox(4);
    isChecked = await pm.sdrPatternsPage.isPatternCheckboxChecked(4);
    expect(isChecked).toBeTruthy();

    // Select pattern 2 again
    await pm.sdrPatternsPage.selectPatternCheckbox(2);
    isChecked = await pm.sdrPatternsPage.isPatternCheckboxChecked(2);
    expect(isChecked).toBeTruthy();

    // Import selected patterns
    await pm.sdrPatternsPage.clickImportJsonButton();
    const importSuccess = await pm.sdrPatternsPage.verifyImportSuccess();
    expect(importSuccess).toBeTruthy();

    testLogger.info('Pattern selection/deselection test completed');
  });

  test("should search and import patterns from built-in library", {
    tag: ['@sdr', '@import', '@search']
  }, async ({ page }) => {
    testLogger.info('Testing search and import functionality');

    await pm.sdrPatternsPage.navigateToRegexPatterns();
    await page.waitForTimeout(1000);

    // Open import dialog
    await pm.sdrPatternsPage.clickImport();
    await page.waitForTimeout(500);
    await pm.sdrPatternsPage.verifyImportDialogOpen();

    // Search for patterns
    await pm.sdrPatternsPage.searchBuiltInPatterns('PGP');

    // Verify search results
    const pgpPatternVisible = await pm.sdrPatternsPage.verifyPatternVisibleInList('PGP', false);
    expect(pgpPatternVisible).toBeTruthy();

    // Select patterns from search results
    await pm.sdrPatternsPage.selectPatternCheckboxes([0, 1]);

    // Clear search to verify selection persists
    testLogger.info('Clearing search to verify selection persists');
    await pm.sdrPatternsPage.clearBuiltInPatternSearch();

    // Re-search to see selected patterns
    await pm.sdrPatternsPage.searchBuiltInPatterns('PGP');

    // Import selected patterns
    await pm.sdrPatternsPage.clickImportJsonButton();
    const importSuccess = await pm.sdrPatternsPage.verifyImportSuccess();
    expect(importSuccess).toBeTruthy();

    testLogger.info('Search and import test completed');
  });
});
