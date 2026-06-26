// @ts-check
const { test, expect } = require('@playwright/test');

// A genuinely flaky test: fails ~50% of attempts. With retries:1, when the first
// attempt fails and the retry passes, kinora marks it FLAKY. Across many runs it
// accumulates a "flaky rate" — the headline feature we want to evaluate.

test.describe('Pipelines', () => {
  test('processes a record (randomly flaky)', async ({ page }) => {
    await page.setContent('<main><div id="status">pending</div></main>');
    const ok = Math.random() > 0.5;
    await page.evaluate((pass) => {
      document.getElementById('status').textContent = pass ? 'done' : 'stuck';
    }, ok);
    // Passes only when the random roll was good; the retry gets another roll.
    await expect(page.locator('#status')).toHaveText('done');
  });
});
