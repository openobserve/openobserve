// @ts-check
const { test, expect } = require('@playwright/test');

// Normally green, but breaks when KINORA_POC_BREAK=1. Run the suite normally a
// few times, then once with `npm run test:break` to demonstrate kinora's
// run-comparison ("newly failing since last run") and regression alerts.

test.describe('Traces', () => {
  test('opens a trace waterfall', async ({ page }) => {
    await page.setContent('<main><div id="waterfall">span-a span-b span-c</div></main>');
    const broken = process.env.KINORA_POC_BREAK === '1';
    await page.evaluate((b) => {
      document.getElementById('waterfall').textContent = b ? 'ERROR: failed to load spans' : 'span-a span-b span-c';
    }, broken);
    await expect(page.locator('#waterfall')).toContainText('span-a');
  });
});
