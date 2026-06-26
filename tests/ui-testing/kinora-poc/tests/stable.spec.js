// @ts-check
const { test, expect } = require('@playwright/test');

// Stable, always-passing tests. These build the "green history" baseline so
// kinora's pass-rate sparkline and "how long has this been green" make sense.

test.describe('Logs page', () => {
  test('renders the search bar', async ({ page }) => {
    await page.setContent('<main><input id="q" placeholder="Search logs"/><button id="run">Run query</button></main>');
    await expect(page.locator('#q')).toBeVisible();
    await page.fill('#q', 'level=error');
    await expect(page.locator('#q')).toHaveValue('level=error');
  });

  test('runs a query and shows results', async ({ page }) => {
    await page.setContent('<main><button id="run">Run query</button><ul id="results"></ul></main>');
    await page.evaluate(() => {
      document.getElementById('run').addEventListener('click', () => {
        document.getElementById('results').innerHTML = '<li>row 1</li><li>row 2</li>';
      });
    });
    await page.click('#run');
    await expect(page.locator('#results li')).toHaveCount(2);
  });
});

test.describe('Dashboards', () => {
  test('adds a panel', async ({ page }) => {
    await page.setContent('<main><button id="add">Add panel</button><section id="panels"></section></main>');
    await page.evaluate(() => {
      document.getElementById('add').addEventListener('click', () => {
        document.getElementById('panels').innerHTML += '<div class="panel">chart</div>';
      });
    });
    await page.click('#add');
    await expect(page.locator('.panel')).toHaveCount(1);
  });
});
