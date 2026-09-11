const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Responsive Mobile Navigation testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    // Auth verification in navigateToBase gates on the desktop rail being
    // visible, so it must run at the default desktop viewport BEFORE any resize.
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.mobileNavigationPage.dismissGetStartedIfPresent();
    testLogger.info('Test setup completed');
  });

  test("should open the mobile drawer via the hamburger and close it with the X button", { tag: ['@mobile-navigation', '@all'] }, async ({ page }) => {
    testLogger.info('Shrinking viewport to mobile width');
    await pm.mobileNavigationPage.setMobileViewport();

    await pm.mobileNavigationPage.expectHamburgerVisible();
    await pm.mobileNavigationPage.expectDesktopRailHidden();

    await pm.mobileNavigationPage.openMobileNav();
    await pm.mobileNavigationPage.expectDrawerVisible();
    await pm.mobileNavigationPage.expectDrawerLogsLinkVisible();

    await pm.mobileNavigationPage.closeMobileNav();
    await pm.mobileNavigationPage.expectDrawerHidden();

    testLogger.info('Test completed');
  });

  test("should navigate to Logs from the drawer and auto-close it", { tag: ['@mobile-navigation', '@all'] }, async ({ page }) => {
    testLogger.info('Opening the drawer at mobile width');
    await pm.mobileNavigationPage.setMobileViewport();
    await pm.mobileNavigationPage.openMobileNav();

    await pm.mobileNavigationPage.clickDrawerLogsLink();
    await pm.mobileNavigationPage.expectLogsPageLoaded();
    await pm.mobileNavigationPage.expectDrawerHidden();

    testLogger.info('Test completed');
  });

  test("should expand the Data group inline on mobile and navigate to Streams", { tag: ['@mobile-navigation', '@all'] }, async ({ page }) => {
    testLogger.info('Opening the drawer at mobile width');
    await pm.mobileNavigationPage.setMobileViewport();
    await pm.mobileNavigationPage.openMobileNav();

    await pm.mobileNavigationPage.expandDataGroup();
    await pm.mobileNavigationPage.expectDataFlyoutNotRendered();

    await pm.mobileNavigationPage.clickStreamsChild();
    await pm.mobileNavigationPage.expectStreamsPageLoaded();
    await pm.mobileNavigationPage.expectDrawerHidden();

    testLogger.info('Test completed');
  });

  test("should close the drawer when tapping the overlay scrim", { tag: ['@mobile-navigation', '@all'] }, async ({ page }) => {
    testLogger.info('Opening the drawer at mobile width');
    await pm.mobileNavigationPage.setMobileViewport();
    await pm.mobileNavigationPage.openMobileNav();

    await pm.mobileNavigationPage.tapScrim();
    await pm.mobileNavigationPage.expectDrawerHidden();

    testLogger.info('Test completed');
  });

  test("should close the drawer when pressing Escape", { tag: ['@mobile-navigation', '@all'] }, async ({ page }) => {
    testLogger.info('Opening the drawer at mobile width');
    await pm.mobileNavigationPage.setMobileViewport();
    await pm.mobileNavigationPage.openMobileNav();

    await pm.mobileNavigationPage.pressEscapeToClose();
    await pm.mobileNavigationPage.expectDrawerHidden();

    testLogger.info('Test completed');
  });
});
