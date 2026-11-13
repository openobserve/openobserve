const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');

function trackSearches(page) {
  const urls = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/_search(_stream)?\?/.test(req.url())) urls.push(req.url());
  });
  return urls;
}

test.describe('Logs auto refresh popover switches refreshing on and off (OSS#16430)', () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestTestData(page);
    const org = getOrgIdentifier() || 'default';
    await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${org}&stream_type=logs&stream=e2e_automate&period=15m&refresh=0&sql_mode=false&quick_mode=false`);
    await pm.logsPage.applyQueryAndWaitForSearchResponse();
  });

  test('picking 5s refreshes on its own, the switch turns it off and refreshing stops', {
    tag: ['@bug-16430', '@P2', '@regression', '@logsRegression'],
  }, async ({ page }) => {
    const refresh = pm.logsAutoRefreshPage;
    const searches = trackSearches(page);
    // The interval only schedules runs once the first run has rendered and nothing is in flight.
    await refresh.waitForIdleResults();

    await refresh.openPopover();
    await refresh.expectSubtitle(/paused/i);
    await refresh.expectSwitchChecked(false);
    await refresh.expectFooterVisible();

    await refresh.pickInterval(5);
    await refresh.expectSubtitle('5');
    await refresh.expectSwitchChecked(true);
    await expect(page).toHaveURL(/[?&]refresh=5(&|$)/);
    await refresh.expectTriggerLabel(/5/);

    const onAt = searches.length;
    await expect.poll(() => searches.length - onAt, {
      timeout: 30000,
      message: 'a 5s interval must fire searches without a click',
    }).toBeGreaterThanOrEqual(2);

    await refresh.openPopoverIfClosed();
    await refresh.clickOffSwitch();
    await refresh.expectSwitchChecked(false);
    await refresh.expectSubtitle(/paused/i);
    await refresh.closePopover();
    await refresh.expectTriggerLabel(/off/i);
    await expect(page).not.toHaveURL(/[?&]refresh=5(&|$)/);

    // Proving that nothing fires needs a fixed window: let an in-flight refresh land, then watch two intervals.
    await page.waitForTimeout(2000);
    const offAt = searches.length;
    await page.waitForTimeout(12000);
    expect(searches.length - offAt, 'no search may fire once auto refresh is off').toBe(0);
  });
});
