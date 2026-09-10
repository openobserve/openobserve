const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Navbar Group Flyout Dismisses Open Dropdowns testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    // Shell hydration signal: the profile button is the first user-actionable
    // element to mount after the layout shell loads.
    await page.waitForLoadState('domcontentloaded');
    await expect(pm.homePage.profileIcon).toBeVisible({ timeout: 10000 });
    testLogger.info('Nav group flyout dismiss test setup completed');
  });

  test("should dismiss the open Help dropdown and open the Data flyout when hovering the Data tile", {
    tag: ['@nav-group-flyout-dismiss', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Opening the Help dropdown then hovering the Data tile');
    await pm.homePage.openHelpMenu();
    await pm.homePage.openDataFlyout();
    // The synthetic Escape from dismissOpenDropdowns() is the only thing that
    // closes the Help menu on a bare hover, so this is the real assertion.
    await pm.homePage.expectHelpMenuHidden();
    await pm.homePage.expectNavGroupFlyoutVisible();
    testLogger.info('Help dropdown dismissed and Data flyout opened');
  });

  test("should open the Data flyout without a stray Escape when no dropdown is open", {
    tag: ['@nav-group-flyout-dismiss', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Hovering the Data tile with nothing open');
    await pm.homePage.openDataFlyout();
    await pm.homePage.expectNavGroupFlyoutVisible();
    // The early-return branch must not have opened/left a dropdown behind.
    await pm.homePage.expectHelpMenuHidden();
    testLogger.info('Data flyout opened without opening any dropdown');
  });

  test("should open the Data flyout and navigate when clicking the Data tile", {
    tag: ['@nav-group-flyout-dismiss', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Clicking the Data tile');
    await pm.homePage.clickDataTile();
    await pm.homePage.expectNavGroupFlyoutVisible();
    await pm.homePage.expectStreamsPageLoaded();
    testLogger.info('Data flyout opened and navigated to streams');
  });

  test("should dismiss the open Profile dropdown when hovering the Data tile", {
    tag: ['@nav-group-flyout-dismiss', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Opening the Profile dropdown then hovering the Data tile');
    await pm.homePage.openProfileMenu();
    await pm.homePage.openDataFlyout();
    await pm.homePage.expectProfileMenuHidden();
    await pm.homePage.expectNavGroupFlyoutVisible();
    testLogger.info('Profile dropdown dismissed and Data flyout opened');
  });
});
