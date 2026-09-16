const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');

// o2-enterprise#1734 regression lock: Reset Filters empties the editor, drops URL query= and restores baseline results.
test.describe("Logs Reset Filters button (o2-enterprise#1734)", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('domcontentloaded');
    await ingestTestData(page);

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.ensureQuickModeState(false);
    await pm.logsPage.runQueryAndWaitForResults();
  });

  test("reset clears filter from editor, URL and restores baseline results", {
    tag: ['@logsResetFilters', '@logs', '@all', '@P2']
  }, async ({ page }) => {
    const baselineCount = await pm.logsPage.getResultHitsCount();
    testLogger.info('Baseline hits count', { baselineCount });

    const filter = "kubernetes_container_name='ziox'";
    await pm.logsPage.typeQuery(filter);
    await pm.logsPage.runQueryAndWaitForResults();

    const filteredEditor = await pm.logsPage.getQueryEditorTextWhenReady('ziox');
    expect(filteredEditor).toContain('ziox');
    await expect.poll(() => new URL(page.url()).searchParams.has('query'), { timeout: 10000 }).toBe(true);

    await pm.logsPage.clickResetFiltersButton();

    await expect.poll(async () => ((await pm.logsPage.getQueryEditorText()) || '').trim(), { timeout: 10000 }).toBe('');
    await expect.poll(() => new URL(page.url()).searchParams.has('query'), { timeout: 10000 }).toBe(false);

    await pm.logsPage.runQueryAndWaitForResults();
    const restoredCount = await pm.logsPage.getResultHitsCount();
    testLogger.info('Restored hits count', { restoredCount });
    expect(restoredCount).toBe(baselineCount);
  });
});
