const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const logData = require("../../../fixtures/log.json");
const { ingestTestData } = require('../../utils/data-ingestion.js');

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
    tag: ['@bug-ent-1734', '@P2', '@regression', '@logsRegression', '@logsRegressionResetFilters']
  }, async ({ page }) => {
    const baselineCount = await pm.logsPage.getResultHitsCount();
    testLogger.info('Baseline hits count', { baselineCount });

    const filter = "kubernetes_container_name='ziox'";
    await pm.logsPage.typeQuery(filter);
    await pm.logsPage.runQueryAndWaitForResults();

    const filteredEditor = await pm.logsPage.getQueryEditorTextWhenReady('ziox');
    expect(filteredEditor).toContain('ziox');
    await expect.poll(() => new URL(page.url()).searchParams.has('query'), { timeout: 10000 }).toBe(true);
    const filteredCount = await pm.logsPage.getResultHitsCount();
    testLogger.info('Filtered hits count', { filteredCount });
    // Without a narrower filtered set, a sticky filter would still match the baseline count below.
    expect(filteredCount).toBeLessThan(baselineCount);

    await pm.logsPage.clickResetFiltersButton();

    await expect.poll(async () => ((await pm.logsPage.getQueryEditorText()) || '').trim(), { timeout: 10000 }).toBe('');

    // The URL mirrors the last executed search (#15234), so query= only drops once the reset search runs.
    await pm.logsPage.runQueryAndWaitForResults();
    await expect.poll(() => new URL(page.url()).searchParams.has('query'), { timeout: 10000 }).toBe(false);
    expect(((await pm.logsPage.getQueryEditorText()) || '').trim()).toBe('');
    const restoredCount = await pm.logsPage.getResultHitsCount();
    testLogger.info('Restored hits count', { restoredCount });
    expect(restoredCount).toBe(baselineCount);
  });
});
