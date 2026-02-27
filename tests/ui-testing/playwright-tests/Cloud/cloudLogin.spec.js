/**
 * Alpha1 Cloud Login & Sanity E2E Tests
 *
 * Feature: Cloud environment login via Dex "Continue with Email" flow
 * Tests verify that authentication state from global setup persists
 * and core pages are accessible on alpha1.
 *
 * @tags @cloudLogin @smoke @cloud @all
 */

const { test } = require("@playwright/test");
const testLogger = require("../utils/test-logger.js");
const { CloudLoginPage } = require("../../pages/cloudPages/cloudLoginPage.js");

test.describe("Alpha1 Cloud Login & Sanity", () => {
  let cloudLoginPage;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    cloudLoginPage = new CloudLoginPage(page);
  });

  test(
    "should be logged in and see the home page",
    { tag: ["@cloudLogin", "@smoke", "@P0", "@cloud", "@all"] },
    async () => {
      testLogger.step("Navigate to alpha1 home page");
      await cloudLoginPage.gotoHomePage();

      testLogger.step("Verify URL contains /web/");
      await cloudLoginPage.expectOnWebPage();

      testLogger.step("Verify main menu is visible (auth state persisted)");
      await cloudLoginPage.expectHomePageMenuVisible();

      testLogger.info("Home page loaded successfully with auth state");
    }
  );

  test(
    "should navigate to logs page",
    { tag: ["@cloudLogin", "@smoke", "@P1", "@cloud", "@all"] },
    async () => {
      testLogger.step("Navigate to logs page");
      await cloudLoginPage.gotoLogsPage();

      testLogger.step("Verify URL contains /logs");
      await cloudLoginPage.expectOnLogsPage();

      testLogger.info("Logs page loaded successfully");
    }
  );

  test(
    "should verify app is functional after login",
    { tag: ["@cloudLogin", "@smoke", "@P0", "@cloud", "@all"] },
    async () => {
      testLogger.step("Navigate to alpha1 home page");
      await cloudLoginPage.gotoHomePage();

      testLogger.step("Verify on web page");
      await cloudLoginPage.expectOnWebPage();

      testLogger.step("Verify no auth error redirects");
      await cloudLoginPage.expectNotOnAuthPages();

      testLogger.info("App is functional - no auth errors detected");
    }
  );
});
