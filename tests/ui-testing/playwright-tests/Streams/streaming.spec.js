import { test, expect } from "../baseFixtures.js";
import PageManager from '../../pages/page-manager.js';

test.describe.configure({ mode: "parallel" });

test.describe("Streaming Tests", () => {
  let pageManager;

  test.beforeEach(async ({ page }) => {
    pageManager = new PageManager(page);
    await page.goto(process.env["ZO_BASE_URL"]);
    await page.waitForTimeout(1000);
    if (await page.getByText('Login as internal user').isVisible()) {
      await page.getByText('Login as internal user').click();
    }
    await page.waitForTimeout(1000);
    await page
      .locator('[data-cy="login-user-id"]')
      .fill(process.env["ZO_ROOT_USER_EMAIL"]);
    await page.locator("label").filter({ hasText: "Password *" }).click();
    await page
      .locator('[data-cy="login-password"]')
      .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
    await page.locator('[data-cy="login-sign-in"]').click();
    await page.waitForTimeout(4000);
  });

  test("should test streaming functionality", async ({ page }) => {
    await pageManager.streamsPage.navigateToStreamExplorer();
    await pageManager.streamsPage.searchStream("test-stream");
    await pageManager.streamsPage.verifyStreamNameVisibility("test-stream");
    await pageManager.streamsPage.exploreStream();
    await pageManager.streamsPage.verifyStreamExploration();
    await pageManager.streamsPage.goBack();
  });
}); 