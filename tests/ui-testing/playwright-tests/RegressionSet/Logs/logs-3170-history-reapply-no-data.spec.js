const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const logData = require('../../../fixtures/log.json');

// ENTERPRISE ONLY: Search History needs `zoConfig.usage_enabled`, which an OSS build hardcodes false (#14316).
test.describe('Regression: re-applying a no-data query from Search History offers Run query (ENT#3170)', () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  let marker;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    marker = `ovnb3170_${Date.now().toString(36)}`;

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env['ORGNAME']}`);
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.selectIndexStream('e2e_automate');
    await pm.logsPage.typeQuery(`SELECT * FROM "e2e_automate" WHERE '${marker}' = 'no-match'`);
    const searched = page.waitForResponse((r) => r.url().includes('/_search') && r.request().method() === 'POST', { timeout: 30000 });
    await pm.logsPage.selectRunQuery();
    expect((await searched).status(), 'Precondition: the no-data query must run').toBe(200);
  });

  test('Go to Logs on a fresh load shows the Run query prompt, and Run query fires the search', {
    tag: ['@bug-ent3170', '@regression', '@logsRegression', '@searchHistory', '@P2'],
  }, async ({ page }) => {
    // A fresh load of the history route, so the logs page mounts from the re-apply alone.
    await pm.searchHistoryPage.gotoDirect(process.env.ZO_BASE_URL, process.env['ORGNAME']);
    await pm.searchHistoryPage.reApplyQuery(marker);
    await pm.logsPage.getQueryEditorTextWhenReady(marker, 30000);

    // Pre-fix the logs page showed an empty result grid here and nothing offered to run the query.
    await pm.logsPage.expectRunQueryPromptVisible();
    await pm.logsPage.expectNoSearchResultGrid();

    const searched = page.waitForResponse(
      (r) => r.url().includes('/_search') && r.request().method() === 'POST' && (r.request().postData() || '').includes(marker),
      { timeout: 30000 },
    );
    await pm.logsPage.clickRunQueryPromptAction();
    expect((await searched).status(), 'Run query must fire the re-applied search').toBe(200);
  });
});
