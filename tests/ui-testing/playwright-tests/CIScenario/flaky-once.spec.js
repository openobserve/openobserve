const { test, expect } = require("@playwright/test");

test("ci scenario: fails on the first try only", async ({ page }, testInfo) => {
  console.log(`ci scenario flaky-once: try ${testInfo.retry + 1}`);
  await page.setContent("<p>ci scenario</p>");
  await expect(page.locator("p")).toBeVisible();
  expect(testInfo.retry, "fails on the first try only").toBeGreaterThan(0);
});
