const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const logData = require("../../../fixtures/log.json");
const { ingestTestData } = require('../../utils/data-ingestion.js');

// o2-enterprise#2038 regression lock: Logs with no stream selected shows the select-stream prompt and fires no search.
test.describe("Logs no-stream prompt (o2-enterprise#2038)", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('domcontentloaded');
    await ingestTestData(page);
    await pm.logsPage.clearPersistedStreamSelection();
  });

  test("shows select-stream prompt and fires no query when no stream is selected", {
    tag: ['@bug-ent-2038', '@P2', '@regression', '@logsRegression', '@logsRegressionNoStreamPrompt']
  }, async ({ page }) => {
    let searchPostCount = 0;
    const searchRequests = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/_search')) {
        searchPostCount += 1;
        searchRequests.push(req.url());
      }
    });

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('domcontentloaded');

    await pm.logsPage.expectSelectStreamPrompt();

    if (await pm.logsPage.isRunQueryButtonVisible()) {
      await pm.logsPage.clickSearchBarRefreshButton();
    }
    await page.waitForTimeout(2000);

    testLogger.info('Search POSTs while no stream selected', { count: searchPostCount, searchRequests });
    expect(searchPostCount).toBe(0);
    await pm.logsPage.expectSelectStreamPrompt();
  });
});
