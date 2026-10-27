const { test, expect } = require("@playwright/test");

const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1);

// 30 is above the rerun bot's 25-failure "bad run" threshold.
for (let i = 1; i <= 30; i++) {
  test(`ci scenario: bad run ${String(i).padStart(2, "0")} fails on run attempts 1 and 2`, async ({ page }) => {
    await page.setContent("<p>ci scenario</p>");
    await expect(page.locator("p")).toBeVisible();
    expect(runAttempt, "fails on run attempts 1 and 2").toBeGreaterThan(2);
  });
}
