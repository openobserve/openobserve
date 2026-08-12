const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');

test.describe("Logs Pipe Deprecation testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);

    await page.waitForLoadState('domcontentloaded');

    await ingestTestData(page);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.runQueryAndWaitForResults();

    testLogger.info('Pipe deprecation test setup completed');
  });

  test.afterEach(async ({ page }) => {
    try {
      testLogger.info('Pipe deprecation test cleanup completed');
    } catch (error) {
      testLogger.warn('Pipe deprecation cleanup failed', { error: error.message });
    }
  });

  test("should run pipe-bearing match_all query and return results", {
    tag: ['@queryPipeDeprecation', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing pipe-bearing match_all query execution');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor("match_all('text | error')");
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectLogTableColumnSourceVisible();
    await pm.logsPage.expectQueryEditorContainsText("match_all('text | error')");

    testLogger.info('Pipe-bearing match_all query test completed');
  });

  test("should append filter to pipe-bearing query without corrupting the query", {
    tag: ['@queryPipeDeprecation', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing filter append to pipe-bearing query');

    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor("match_all('text | error')");

    await pm.logsPage.clickLogSearchIndexListFieldSearchInput();
    await pm.logsPage.fillLogSearchIndexListFieldSearchInput('code');
    await pm.logsPage.expectFieldExpandVisible('code');
    await pm.logsPage.clickExpandCode();
    await pm.logsPage.clickSubfieldAddButton('code', '200');
    await pm.logsPage.expectQueryEditorContainsText("match_all('text | error') and code='200'");

    testLogger.info('Filter append to pipe-bearing query test completed');
  });

  test("should preserve multiple pipes verbatim in query editor", {
    tag: ['@queryPipeDeprecation', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing pipe character preservation in editor');

    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor("match_all('a | b | c')");
    await pm.logsPage.expectQueryEditorContainsText("match_all('a | b | c')");

    testLogger.info('Pipe preservation in editor test completed');
  });

  test("should run query with multiple pipes without error", {
    tag: ['@queryPipeDeprecation', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing multiple-pipe query execution');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor("match_all('a | b | c')");
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('Multiple-pipe query test completed');
  });

  test("should update editorValue correctly after adding filter to pipe-bearing query", {
    tag: ['@queryPipeDeprecation', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing editorValue mirror after filter append');

    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor("match_all('text | error')");

    await pm.logsPage.clickLogSearchIndexListFieldSearchInput();
    await pm.logsPage.fillLogSearchIndexListFieldSearchInput('code');
    await pm.logsPage.expectFieldExpandVisible('code');
    await pm.logsPage.clickExpandCode();
    await pm.logsPage.clickSubfieldAddButton('code', '200');
    await pm.logsPage.expectQueryEditorContainsText("match_all('text | error') and code='200'");

    testLogger.info('EditorValue mirror test completed');
  });

  test("should clear pipe-bearing query on reset filters", {
    tag: ['@queryPipeDeprecation', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing reset filters with pipe-bearing query');

    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor("match_all('text | error')");
    await pm.logsPage.clickResetFiltersButton();
    await pm.logsPage.waitForQueryEditorTextbox();
    await pm.logsPage.expectQueryEditorEmpty();

    testLogger.info('Reset filters with pipe-bearing query test completed');
  });

  test("should treat pipe as literal character in SQL mode", {
    tag: ['@queryPipeDeprecation', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing pipe character in SQL mode');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    await pm.logsPage.clickSQLModeToggle();
    const isSql = await pm.logsPage.isSqlModeEnabled();
    expect(isSql).toBe(true);

    await pm.logsPage.setQueryEditorValue("SELECT * FROM \"e2e_automate\" WHERE str_match(message, 'foo|bar')");
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectLogTableColumnSourceVisible();
    await pm.logsPage.expectQueryEditorContainsText("foo|bar");

    testLogger.info('Pipe in SQL mode test completed');
  });
});
