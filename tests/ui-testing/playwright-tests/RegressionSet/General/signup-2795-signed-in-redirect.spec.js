const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');

test.describe("Signed-in user opening the signup or login URL", () => {
  for (const path of ['signup', 'signup?utm_source=blog', 'login']) {
    test(`/web/${path} lands in the app, not on the login page @P1 @regression @signupRedirect`, async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);

      await page.goto(`${process.env["ZO_BASE_URL"]}/web/${path}`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      await expect(page).not.toHaveURL(/\/login|\/signup|screen_hint=signup/);
      await expect(page.locator('[data-test="menu-link-\\/-item"]')).toBeVisible();
    });
  }
});
