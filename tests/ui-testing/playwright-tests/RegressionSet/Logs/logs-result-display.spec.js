const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');

const STREAM = 'e2e_automate';
const PAGE_SIZE = 100;

test.describe("Logs Result Display Regression", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    try {
      await ingestTestData(page);
    } catch (error) {
      testLogger.warn(`Data ingestion skipped: ${error.message}`);
    }
    await pm.logsPage.selectStream(STREAM);
  });

  test("match_all matches render highlighted @bug-9542 @P0 @regression @logsRegression", async () => {
    await pm.logsPage.enableSqlModeIfNeeded();
    await pm.logsPage.setQueryEditorContent(
      `SELECT * FROM "${STREAM}" WHERE match_all('ingester')`,
    );
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.expectResultsGridSettledWithRows();

    // The defect was matches rendering plain, so the highlight markup is the contract.
    await pm.logsPage.expectHighlightedMatchesRendered();
    const highlights = await pm.logsPage.getHighlightedMatchCount();
    testLogger.info(`Highlighted match nodes: ${highlights}`);
    expect(highlights, 'match_all results must carry highlight markup').toBeGreaterThan(0);
  });

  test("first page renders a full page of results @bug-10643 @P1 @regression @logsRegression", async () => {
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.expectResultsGridSettledWithRows();

    await pm.logsPage.selectRecordsPerPage(PAGE_SIZE);

    const title = await pm.logsPage.getResultTitleText();
    const rendered = await pm.logsPage.getLogRowCount();
    testLogger.info(`Banner: ${title.replace(/\n/g, ' | ')} | rendered rows: ${rendered}`);

    // The defect was page 1 rendering fewer rows than the banner claimed (47 of 100).
    expect(title, 'banner must claim a full first page').toContain(`1 to ${PAGE_SIZE}`);
    expect(rendered, 'rendered rows must match the page size the banner claims')
      .toBe(PAGE_SIZE);
  });
});
