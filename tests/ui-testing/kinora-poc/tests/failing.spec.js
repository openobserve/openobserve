// @ts-check
const { test, expect } = require('@playwright/test');

// An always-failing test. Demonstrates kinora's failure grouping and the
// embedded "View trace" button (DOM + actions + console captured on retry).

test.describe('Alerts', () => {
  test('shows the alert count badge (intentionally broken)', async ({ page }) => {
    await page.setContent('<main><span data-test="alert-badge">0</span></main>');
    await page.evaluate(() => console.log('POC: pretending to load alerts...'));
    const badge = page.locator('[data-test="alert-badge"]');
    await expect(badge).toBeVisible();
    // This assertion is wrong on purpose so the test fails and uploads a trace.
    await expect(badge).toHaveText('3');
  });
});
