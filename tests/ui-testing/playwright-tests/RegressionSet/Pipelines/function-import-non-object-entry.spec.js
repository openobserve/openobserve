// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const path = require('path');

const authFile = path.join(__dirname, '../../utils/auth/user.json');
const org = process.env.ORGNAME || 'default';

/**
 * Regression: the function import screen offered fix-up controls that could not
 * write.
 *
 * An array entry that is not an object — a bare string, a null — is rejected
 * like any other item and offered the same inline name/body controls. Writing
 * into the entry itself threw `Cannot create property 'name' on string` for a
 * primitive and did nothing at all for a null, so the typed name never reached
 * the document: the error stayed on screen and the item could not be fixed
 * however long the user tried. Fixed by replacing such an entry with an object
 * the controls can fill (`writeField` in `ImportFunction.vue`).
 */
test.describe('Function import — non-object entries', { tag: ['@functions', '@regression', '@all'] }, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterAll(async ({ browser }) => {
    try {
      const context = await browser.newContext({ storageState: authFile });
      const page = await context.newPage();
      try {
        await new PageManager(page).apiCleanup.cleanupFunctionsInOrg(org, [/^fn_regr_nonobj_/]);
      } finally {
        await context.close();
      }
    } catch (error) {
      testLogger.warn(`Function cleanup failed: ${error.message}`);
    }
  });

  for (const [label, entry] of [
    ['a bare string', 'just a string'],
    ['a null', null],
  ]) {
    test(`should let the fix-up controls repair ${label} entry`, { tag: ['@P1'] }, async ({ page }) => {
      testLogger.info(`Test: ${label} entry can still be fixed in place`);
      const name = `fn_regr_nonobj_${label.includes('string') ? 'str' : 'null'}_${Date.now()}`;

      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await pm.functionsImportExport.navigateToImport(org);
      await pm.functionsImportExport.setImportJsonViaMonaco(JSON.stringify([entry]));
      await pm.functionsImportExport.runImport();

      // Rejected, and offered the inline fixers.
      await pm.functionsImportExport.expectImportError(0, 0);

      // Both fixers have to land in the document — this is what used to fail.
      await pm.functionsImportExport.renameImportItem(0, name);
      await pm.functionsImportExport.setImportBody(0, '.fixed = true');

      // Scoped to the defect: the editor emits unrelated "invalid dom" noise.
      expect(
        pageErrors.filter((message) => /Cannot (create|assign to read only) property/i.test(message)),
        `${label} entry must not throw when the fixers write to it`,
      ).toEqual([]);

      // And the repaired item imports.
      await pm.functionsImportExport.runImportAndWaitForList();
      await pm.functionsPage.searchFunction(name);
      await pm.functionsPage.expectFunctionInList(name);
      testLogger.info('Test completed');
    });
  }
});
