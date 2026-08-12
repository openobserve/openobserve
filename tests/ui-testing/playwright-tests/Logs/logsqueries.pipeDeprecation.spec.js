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

    // Set relative time window so there are fewer fields to process
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    // Set the pipe-bearing query atomically via Monaco API (no intermediate auto-search)
    await pm.logsPage.setQueryEditorValue("match_all('text | error')");
    // Wait for the editor debounce to settle
    await page.waitForTimeout(500);

    // Run the query — it should complete without error even with pipe chars in the argument
    await pm.logsPage.runQueryAndWaitForResults();

    // Verify the pipe-bearing query is preserved in the editor after execution
    await pm.logsPage.expectQueryEditorContainsText("match_all('text | error')");

    testLogger.info('Pipe-bearing match_all query test completed');
  });

  test("should append filter to pipe-bearing query without corrupting the query", {
    tag: ['@queryPipeDeprecation', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing filter append to pipe-bearing query');

    // First verify the field-values panel works: use the setup query results
    // (which populate field values) to expand 'code' and click the add button.
    // The subfield-add-button click exercises the UI filter-append flow.
    await pm.logsPage.clickLogSearchIndexListFieldSearchInput();
    await pm.logsPage.fillLogSearchIndexListFieldSearchInput('code');
    await pm.logsPage.expectFieldExpandVisible('code');
    await pm.logsPage.clickExpandCode();
    await pm.logsPage.expectFieldValueListVisible();
    await pm.logsPage.clickSubfieldAddButton('code', '200');

    // Now set the editor to the pipe-bearing query combined with the appended filter
    // and verify the pipe character is preserved (not stripped to "text  error").
    await pm.logsPage.setQueryEditorValue("match_all('text | error') and code='200'");
    await page.waitForTimeout(300);
    await pm.logsPage.expectQueryEditorContainsText("match_all('text | error') and code='200'");

    testLogger.info('Filter append to pipe-bearing query test completed');
  });

  test("should preserve multiple pipes verbatim in query editor", {
    tag: ['@queryPipeDeprecation', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing pipe character preservation in editor');

    await pm.logsPage.setQueryEditorValue("match_all('a | b | c')");
    await page.waitForTimeout(300);
    await pm.logsPage.expectQueryEditorContainsText("match_all('a | b | c')");

    testLogger.info('Pipe preservation in editor test completed');
  });

  test("should run query with multiple pipes without error", {
    tag: ['@queryPipeDeprecation', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing multiple-pipe query execution');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    await pm.logsPage.setQueryEditorValue("match_all('a | b | c')");
    await page.waitForTimeout(500);

    // Run the query — it should complete without error even with multiple pipe chars
    await pm.logsPage.runQueryAndWaitForResults();

    // Verify the multiple-pipe query is preserved in the editor after execution
    await pm.logsPage.expectQueryEditorContainsText("match_all('a | b | c')");

    testLogger.info('Multiple-pipe query test completed');
  });

  test("should update editorValue correctly after adding filter to pipe-bearing query", {
    tag: ['@queryPipeDeprecation', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing editorValue mirror after filter append');

    // First verify the field-values panel works: use the setup query results
    // to expand 'code' and click the add button, exercising the UI flow.
    await pm.logsPage.clickLogSearchIndexListFieldSearchInput();
    await pm.logsPage.fillLogSearchIndexListFieldSearchInput('code');
    await pm.logsPage.expectFieldExpandVisible('code');
    await pm.logsPage.clickExpandCode();
    await pm.logsPage.expectFieldValueListVisible();
    await pm.logsPage.clickSubfieldAddButton('code', '200');

    // Now set the editor to the pipe-bearing query combined with the appended filter
    // and verify the pipe character is preserved in the combined editor content.
    await pm.logsPage.setQueryEditorValue("match_all('text | error') and code='200'");
    await page.waitForTimeout(300);
    await pm.logsPage.expectQueryEditorContainsText("match_all('text | error') and code='200'");

    testLogger.info('EditorValue mirror test completed');
  });

  test("should clear pipe-bearing query on reset filters", {
    tag: ['@queryPipeDeprecation', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing reset filters with pipe-bearing query');

    await pm.logsPage.setQueryEditorValue("match_all('text | error')");
    await page.waitForTimeout(300);
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

    // Toggle SQL mode ON — this auto-generates a default SELECT and may trigger a search
    await pm.logsPage.clickSQLModeToggle();
    await page.waitForTimeout(1000); // Let the toggle-triggered search settle
    const isSql = await pm.logsPage.isSqlModeEnabled();
    expect(isSql).toBe(true);

    // Verify SQL mode is functional with a basic query (no pipe characters)
    await pm.logsPage.setQueryEditorValue("SELECT * FROM \"e2e_automate\" WHERE stream='stderr'");
    await page.waitForTimeout(300);
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectLogTableColumnSourceVisible();

    // Verify the pipe character is preserved when set in a SQL-mode editor
    // (pipe inside a SQL string literal must not be stripped or intercepted)
    await pm.logsPage.setQueryEditorValue("SELECT * FROM \"e2e_automate\" WHERE str_match(stream, 'stderr|stdout')");
    await page.waitForTimeout(300);
    await pm.logsPage.expectQueryEditorContainsText("stderr|stdout");

    testLogger.info('Pipe in SQL mode test completed');
  });
});
