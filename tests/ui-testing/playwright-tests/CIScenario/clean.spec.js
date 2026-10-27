const { test, expect } = require("@playwright/test");

const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1);

test("ci scenario: always passes", async ({ page }) => {
  console.log(`ci scenario clean: ran in run attempt ${runAttempt}`);
  await page.setContent("<p>ci scenario</p>");
  await expect(page.locator("p")).toBeVisible();
});
