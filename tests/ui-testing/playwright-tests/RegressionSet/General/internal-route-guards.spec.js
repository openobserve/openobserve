const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

test.describe("Internal Route Guards Regression", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test("the internal empty-state demo page is not shipped @bug-14375 @P2 @regression @routeGuards", async () => {
    await pm.routeGuardPage.gotoAppRoute('empty-state-demo');

    // The route and its component were removed outright. The router keeps the
    // requested URL and falls through to the 404 view, so the demo's own heading
    // and the 404 view are the contract -- not the address bar.
    await pm.routeGuardPage.expectEmptyStateDemoNotRendered();
    await pm.routeGuardPage.expectNotFoundRendered();
    testLogger.info(`empty-state-demo fell through to the 404 view`);
  });
});
