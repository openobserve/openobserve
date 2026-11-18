const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { trackSearches, ingestRows, waitForSearchable } = require('../../utils/auto-run-helpers.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

const ORG = getOrgIdentifier() || 'default';
const STREAM = `e2e_16782_${Math.random().toString(36).slice(2, 7)}`;

const runButton = '[data-test="logs-search-bar-refresh-btn"]';
const runInFlight = '[data-test="logs-search-bar-refresh-btn"][class*="bg-cancel-query-bg"]';
const rows = '[data-test="logs-search-result-logs-table"] tbody tr';

const logsUrl = () =>
  `/web/logs?org_identifier=${ORG}&stream=${STREAM}&stream_type=logs&period=15m` +
  '&refresh=0&sql_mode=false&quick_mode=false&show_histogram=true';

// Holds the logs stream-list request until release(), so Cancel can be pressed while the landing metadata loads.
async function holdStreamList(page) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let held = 0;
  await page.route(/\/api\/[^/]+\/streams\?/, async (route) => {
    if (!route.request().url().includes('type=logs')) return route.continue();
    held += 1;
    await gate;
    await route.continue();
  });
  return { release: () => release(), held: () => held };
}

// openobserve#16782: Cancel during the landing metadata load used to be ignored, and the landing search started anyway.
test.describe('Logs landing search after Cancel (#16782)', () => {
  test.beforeAll(async ({ request }) => {
    const now = Date.now() * 1000;
    await ingestRows(request, ORG, STREAM, Array.from({ length: 5 }, (_, i) => ({
      _timestamp: now - (i + 1) * 1_000_000,
      level: 'info',
      message: `landing cancel row ${i}`,
    })));
    await waitForSearchable(request, ORG, STREAM, 5);
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test('Cancel while the stream list loads: no landing search, and Run query sends one', {
    tag: ['@bug-16782', '@P2', '@regression', '@logsRegression'],
  }, async ({ page }) => {
    const hold = await holdStreamList(page);
    const searches = trackSearches(page);
    await page.goto(logsUrl());

    await expect.poll(hold.held, { timeout: 30000, message: 'the logs stream list was never requested' }).toBeGreaterThan(0);
    await expect(page.locator(runInFlight)).toBeVisible({ timeout: 30000 });
    await page.locator(runInFlight).click();
    await expect(page.locator(runInFlight)).toHaveCount(0, { timeout: 10000 });

    const listLoaded = page.waitForResponse((r) => /\/streams\?/.test(r.url()) && r.url().includes('type=logs'), { timeout: 30000 });
    hold.release();
    await listLoaded;
    await page.unroute(/\/api\/[^/]+\/streams\?/);
    await new PageManager(page).logsPage.waitForStreamFieldsLoaded('level');

    // The broken build sent the landing search right after the stream fields loaded, so give that path time to fire.
    await page.waitForTimeout(3000);
    expect(searches.hits(), 'no search may start after Cancel').toHaveLength(0);
    await expect(page.locator(runInFlight)).toHaveCount(0);

    testLogger.info('Run query sends exactly one search and shows the rows');
    await page.locator(runButton).click();
    await expect(page.locator(rows).first()).toBeVisible({ timeout: 60000 });
    expect(searches.hits()).toHaveLength(1);
  });
});
