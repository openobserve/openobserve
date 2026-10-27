const { test, expect } = require("@playwright/test");

const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1);

// Passes from run attempt 4 so the scenario run can still end green.
test("ci scenario: fails on run attempts 1 to 3", async ({ page }, testInfo) => {
  console.log(`ci scenario retry-count: run attempt ${runAttempt}, try ${testInfo.retry + 1}`);
  await page.setContent("<p>ci scenario</p>");
  await expect(page.locator("p")).toBeVisible();
  expect(runAttempt, "fails on run attempts 1 to 3").toBeGreaterThan(3);
});
