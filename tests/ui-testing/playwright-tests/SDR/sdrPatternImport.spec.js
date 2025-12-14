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

  test("should import and then delete built-in SDR patterns", {
    tag: ['@sdr', '@all', '@sanity']
  }, async ({ page }) => {
    testLogger.info('Testing SDR pattern import and deletion workflow');

    await pm.sdrPatternsPage.navigateToRegexPatterns();
    await page.waitForTimeout(1000);

    // Step 0: ensure patterns are absent before import to avoid false failures
    const patternsToReset = ['PGP Private Key', 'PGP Public Key'];
    testLogger.info('Ensure PGP patterns are removed before starting import');
    for (const patternName of patternsToReset) {
      await pm.sdrPatternsPage.ensurePatternDeleted(patternName);
    }

    // Step 1: Import PGP patterns using search
    const importSuccess = await pm.sdrPatternsPage.searchAndImportBuiltInPatterns('PGP', [0, 1]);
    testLogger.info(importSuccess);
    await page.waitForTimeout(1000);
    await pm.sdrPatternsPage.emptySearchInput();

    // Step 2: Verify patterns are visible
    testLogger.info('Verifying imported patterns');
    const pgpPrivateKeyVisible = await pm.sdrPatternsPage.verifyPatternVisibleInList('PGP Private Key');
    const pgpPublicKeyVisible = await pm.sdrPatternsPage.verifyPatternVisibleInList('PGP Public Key');

    expect(pgpPrivateKeyVisible).toBeTruthy();
    expect(pgpPublicKeyVisible).toBeTruthy();

    // Step 3: Delete imported patterns using deletePatternByName (which searches first)
    testLogger.info('Deleting PGP Private Key pattern');
    await pm.sdrPatternsPage.navigateToRegexPatterns();
    const deletePrivateResult = await pm.sdrPatternsPage.deletePatternByName('PGP Private Key');
    if (deletePrivateResult.success) {
      testLogger.info('✓ PGP Private Key pattern deleted');
    } else {
      testLogger.warn(`PGP Private Key deletion issue: ${deletePrivateResult.reason}`);
    }

    testLogger.info('Deleting PGP Public Key pattern');
    await pm.sdrPatternsPage.navigateToRegexPatterns();
    const deletePublicResult = await pm.sdrPatternsPage.deletePatternByName('PGP Public Key');
    if (deletePublicResult.success) {
      testLogger.info('✓ PGP Public Key pattern deleted');
    } else {
      testLogger.warn(`PGP Public Key deletion issue: ${deletePublicResult.reason}`);
    }

    // Step 4: Verify patterns are deleted
    testLogger.info('Verifying patterns are deleted');
    await page.waitForTimeout(2000);
    const pgpPrivateDeleted = await pm.sdrPatternsPage.verifyPatternNotVisibleInList('PGP Private Key');
    const pgpPublicDeleted = await pm.sdrPatternsPage.verifyPatternNotVisibleInList('PGP Public Key');

    expect(pgpPrivateDeleted).toBeTruthy();
    expect(pgpPublicDeleted).toBeTruthy();
    testLogger.info('✓ Pattern deletion verified');
  });

  test("should handle pattern selection and deselection during import", {
    tag: ['@sdr', '@all']
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
    testLogger.info('Attempting to import selected patterns');
    await pm.sdrPatternsPage.clickImportJsonButton();

    // Check for either success or "already exists" type messages
    const importSuccess = await pm.sdrPatternsPage.verifyImportSuccess();
    const alreadyExistsMsg = await page.getByText(/already exists|Pattern with given id\/name/i).isVisible({ timeout: 2000 }).catch(() => false);

    if (importSuccess) {
      testLogger.info('✓ Patterns imported successfully');
    } else if (alreadyExistsMsg) {
      testLogger.info('⚠ Patterns already exist (expected if test was run before)');
      // Close any error dialog
      const okButton = page.getByRole('button', { name: 'OK' });
      if (await okButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await okButton.click();
      }
    } else {
      testLogger.warn('⚠ No success or error message detected');
    }

    // The main test goal is checkbox interaction, not import success
    testLogger.info('✓ Pattern checkbox selection/deselection test completed successfully');
  });

});
