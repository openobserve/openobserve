const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

test.describe("Function delete confirmation", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  let functionName;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    functionName = `e2e_2812_${Date.now()}`;
    // Created via API: the subject here is the delete confirmation, not the editor.
    await pm.apiCleanup.createFunction(functionName, '.e2e_2812 = "x" \n .');
    testLogger.info(`Created function ${functionName}`);
  });

  test.afterEach(async () => {
    if (functionName) {
      await pm.apiCleanup.deleteFunctionInOrg(pm.apiCleanup.org, functionName).catch((e) =>
        testLogger.warn(`Function cleanup failed: ${e.message}`)
      );
      functionName = undefined;
    }
  });

  test("deleting a function must ask first, and cancelling must keep it", {
    tag: ['@bug-2812', '@P2', '@regression', '@pipelinesRegression', '@pipelinesRegressionFunctions']
  }, async () => {
    await pm.functionsPage.navigate();
    await pm.functionsPage.searchFunction(functionName);
    await pm.functionsPage.expectFunctionInList(functionName);

    await pm.functionsPage.openDeleteConfirmFor(functionName);
    const dialogText = await pm.functionsPage.getConfirmDialogText();
    testLogger.info(`Confirm dialog text: ${dialogText}`);

    expect(dialogText,
      'Bug #2812: deleting a function must raise a confirmation, not delete silently'
    ).toContain('Are you sure you want to delete transform?');

    await pm.functionsPage.cancelDeleteConfirm();
    await pm.functionsPage.expectFunctionInList(functionName);
    testLogger.info('Cancel left the function in place');

    await pm.functionsPage.openDeleteConfirmFor(functionName);
    await pm.functionsPage.acceptDeleteConfirm();
    await pm.functionsPage.expectFunctionAbsent(functionName);

    testLogger.info('PASSED: delete is confirmed before it happens (Bug #2812)');
  });
});
