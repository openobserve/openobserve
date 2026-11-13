const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { getHeaders, getIngestionUrl, waitForStreamData } = require('../../utils/data-ingestion.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');

function orgId() {
  return getOrgIdentifier() || 'default';
}

test.describe('Logs Recent searches drawer: status chips, run counts, footer (OSS#16429)', () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    stream = 'ovn_b_recent_' + Math.random().toString(36).slice(2, 8);
    const rows = [{ marker: 'hit', message: 'ovn-b-16429 a' }, { marker: 'hit', message: 'ovn-b-16429 b' }];
    const ingest = await page.request.post(getIngestionUrl(orgId(), stream), { headers: getHeaders(), data: rows });
    expect(ingest.status(), 'Precondition: rows must ingest').toBe(200);
    await waitForStreamData(page, stream, rows.length);
  });

  test.afterEach(async ({ page }, testInfo) => {
    const base = process.env.ZO_BASE_URL_SC || process.env.ZO_BASE_URL;
    await page.request.delete(`${base}/api/${orgId()}/streams/${stream}?type=logs`, { headers: getAuthHeaders() }).catch(() => {});
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('rows carry status and run count, status and Starred chips filter, footer and Clear confirm show', {
    tag: ['@bug-16429', '@P2', '@regression', '@logsRegression'],
  }, async ({ page }) => {
    const hitSql = `SELECT * FROM "${stream}" WHERE marker = 'hit'`;
    const missSql = `SELECT * FROM "${stream}" WHERE marker = 'miss'`;
    for (const [sql, runs] of [[hitSql, 2], [missSql, 1]]) {
      await pm.logsPage.openLogsWithSqlQuery(stream, sql);
      for (let i = 0; i < runs; i++) {
        const recorded = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/query_history'), { timeout: 30000 });
        await pm.logsPage.clickRefreshButton();
        expect((await recorded).status(), 'the run must be recorded').toBe(200);
      }
    }

    const recent = pm.logsRecentSearchesPage;
    const hit = "marker = 'hit'";
    const miss = "marker = 'miss'";
    await recent.openAndFilter(stream);

    await recent.expectRowCount(2);
    await recent.expectRowRunCount(hit, /Ran 2x/i);
    await recent.expectRowStatus(hit, 'Success');
    await recent.expectRowStatus(miss, 'No results');
    await recent.expectShowing(/Showing 2\b/);

    await recent.clickStatusChip('no_results');
    await recent.expectRowCount(1);
    await expect(recent.rowWithText(miss)).toHaveCount(1);
    await recent.clickStatusChip('ok');
    await recent.expectRowCount(1);
    await expect(recent.rowWithText(hit)).toHaveCount(1);
    await recent.clickStatusChip('any');
    await recent.expectRowCount(2);

    await recent.toggleStar(hit);
    await recent.clickStatusChip('starred');
    await recent.expectRowCount(1);
    await expect(recent.rowWithText(hit)).toHaveCount(1);
    await recent.toggleStar(hit);
    await recent.clickStatusChip('starred');
    await recent.expectRowCount(2);

    // Only the confirmation is checked: the history is shared by every run under this user.
    await recent.openAndDismissClearConfirm();
    await recent.expectRowCount(2);
  });
});
