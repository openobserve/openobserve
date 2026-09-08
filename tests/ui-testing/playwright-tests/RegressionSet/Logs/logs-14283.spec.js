const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const logData = require('../../../fixtures/log.json');

// https://github.com/openobserve/openobserve/issues/14283
//
// Search History became a standalone route in #13512, so re-applying a query from it
// remounts the logs page. The mount path used to restore the cached searchObj from Vuex
// on top of the query carried in the URL, and the re-applied query was silently dropped.
// The regression only shows up when the logs page has already been used in the session —
// that is what puts the stale query in the cache — hence the two searches in beforeEach.
test.describe('Regression: Search History re-apply retains the query (#14283)', () => {
  test.describe.configure({ mode: 'serial' });

  const EARLIER_QUERY = `SELECT * FROM "e2e_automate" WHERE code = '200'`;
  const LATEST_QUERY = `SELECT * FROM "e2e_automate" WHERE code = '404'`;

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env['ORGNAME']}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await pm.logsPage.selectIndexStream('e2e_automate');
    await page.waitForTimeout(1000);

    for (const query of [EARLIER_QUERY, LATEST_QUERY]) {
      await pm.logsPage.typeQuery(query);
      await page.waitForTimeout(500);
      await pm.logsPage.selectRunQuery();
      await pm.logsPage.waitForResultsLoaded();
    }

    testLogger.info('Two searches run; the logs cache now holds the later query');
  });

  test('Re-applying an earlier query from Search History loads it into the editor', {
    tag: ['@regression', '@logs', '@searchHistory', '@P0'],
  }, async ({ page }) => {
    await pm.searchHistoryPage.openFromLogs();

    const reAppliedSql = await pm.searchHistoryPage.reApplyQuery(`code = '200'`);
    expect(reAppliedSql).toContain(`code = '200'`);

    const editorText = await pm.logsPage.getQueryEditorTextWhenReady(`code = '200'`, 30000);

    expect(editorText).toContain(`code = '200'`);
    // The stale cached query must not win over the one carried in the URL.
    expect(editorText).not.toContain(`code = '404'`);
  });

  test('Re-applied query is carried in the logs URL', {
    tag: ['@regression', '@logs', '@searchHistory', '@P1'],
  }, async ({ page }) => {
    await pm.searchHistoryPage.openFromLogs();
    await pm.searchHistoryPage.reApplyQuery(`code = '200'`);

    const url = new URL(page.url());
    const encodedQuery = url.searchParams.get('query');
    expect(encodedQuery).toBeTruthy();

    const decoded = Buffer.from(encodedQuery, 'base64').toString('utf-8');
    expect(decoded).toContain(`code = '200'`);
    expect(url.searchParams.get('sql_mode')).toBe('true');
  });
});
