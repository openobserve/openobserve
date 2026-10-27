const { test, expect } = require("@playwright/test");

const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1);

test.describe.configure({ mode: "serial" });

test.describe("ci scenario: serial group", () => {
  // Set by step 1 and read by step 2, so step 2 only passes when step 1 ran before it.
  let stateFromStep1 = "";

  test("step 1 of 3", async ({ page }) => {
    console.log(`ci scenario serial: step 1, run attempt ${runAttempt}`);
    await page.setContent("<p>step 1</p>");
    await expect(page.locator("p")).toBeVisible();
    stateFromStep1 = "ready";
  });

  test("step 2 of 3 fails on run attempt 1", async ({ page }) => {
    console.log(`ci scenario serial: step 2, run attempt ${runAttempt}`);
    await page.setContent("<p>step 2</p>");
    await expect(page.locator("p")).toBeVisible();
    expect(stateFromStep1, "step 1 must run first").toBe("ready");
    expect(runAttempt, "fails on run attempt 1").toBeGreaterThan(1);
  });

  test("step 3 of 3", async ({ page }) => {
    console.log(`ci scenario serial: step 3, run attempt ${runAttempt}`);
    await page.setContent("<p>step 3</p>");
    await expect(page.locator("p")).toBeVisible();
  });
});
