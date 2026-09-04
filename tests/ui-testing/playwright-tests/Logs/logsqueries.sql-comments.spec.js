const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');

async function applyQueryButton(pm) {
  await pm.logsPage.waitForSearchBarRefreshButton();
  await pm.logsPage.runQueryAndWaitForResults();
  await pm.logsPage.waitForTableHits(5000).catch(() => {});
}

test.describe("SQL Queries with Inline Comments testcases", () => {
  test.describe.configure({ mode: 'parallel', retries: 1 });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    await ingestTestData(page);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.enableSqlModeIfDisabled();
    await applyQueryButton(pm);

    const hasInitialData = await pm.logsPage.waitForTableHits(3000);
    if (!hasInitialData) {
      testLogger.warn('SQL comments beforeEach: No rows after initial query — retrying to allow data indexing');
      await applyQueryButton(pm);
    }

    testLogger.info('SQL comments test setup completed');
  });

  test.afterEach(async ({ page }) => {
    try {
      testLogger.info('Test completed');
    } catch (error) {
      testLogger.warn('afterEach cleanup error', { error: error.message });
    }
  });

  test("should execute SQL query with single-line comment before SELECT without parser error", {
    tag: ['@sqlComments', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing SQL query with single-line comment before SELECT');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.setQueryEditorValue(
      '-- find all entries\nSELECT _timestamp, code, method FROM "e2e_automate" ORDER BY _timestamp DESC'
    );
    await pm.logsPage.waitForQueryEditorValue('-- find all entries');
    await applyQueryButton(pm);

    await pm.logsPage.expectSqlErrorStateNotVisible();
    await pm.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('Single-line comment before SELECT test completed successfully');
  });

  test("should execute SQL query with multiple comment lines before SELECT without parser error", {
    tag: ['@sqlComments', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing SQL query with multiple comment lines before SELECT');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.setQueryEditorValue(
      '-- find all entries where level=debug\n-- returns all matching records\n-- author: QA team\nSELECT _timestamp, code, method FROM "e2e_automate" ORDER BY _timestamp DESC'
    );
    await pm.logsPage.waitForQueryEditorValue('-- find all entries where level=debug');
    await applyQueryButton(pm);

    await pm.logsPage.expectSqlErrorStateNotVisible();
    await pm.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('Multiple comment lines before SELECT test completed successfully');
  });

  test("should execute SQL query with inline comment at end of a line without parser error", {
    tag: ['@sqlComments', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing SQL query with inline comment at end of SELECT line');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.setQueryEditorValue(
      'SELECT _timestamp, code, method FROM "e2e_automate" -- fetch recent logs\nORDER BY _timestamp DESC'
    );
    await pm.logsPage.waitForQueryEditorValue('-- fetch recent logs');
    await applyQueryButton(pm);

    await pm.logsPage.expectSqlErrorStateNotVisible();
    await pm.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('Inline comment at end of line test completed successfully');
  });

  test("should execute SQL query with comment in the middle of multi-line SQL without parser error", {
    tag: ['@sqlComments', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing SQL query with comment in the middle of multi-line SQL');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.setQueryEditorValue(
      'SELECT _timestamp, code, method\n-- select from the e2e_automate stream\nFROM "e2e_automate"\nORDER BY _timestamp DESC'
    );
    await pm.logsPage.waitForQueryEditorValue('-- select from the e2e_automate stream');
    await applyQueryButton(pm);

    await pm.logsPage.expectSqlErrorStateNotVisible();
    await pm.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('Comment in middle of multi-line SQL test completed successfully');
  });

  test("should execute SQL query with comment and WHERE clause using str_match without parser error", {
    tag: ['@sqlComments', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing SQL query with comment and WHERE clause using str_match');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.setQueryEditorValue(
      '-- find entries matching method pattern\nSELECT _timestamp, code, method FROM "e2e_automate"\nWHERE str_match_ignore_case(method, \'g\')\nORDER BY _timestamp DESC'
    );
    await pm.logsPage.waitForQueryEditorValue('-- find entries matching method pattern');
    await applyQueryButton(pm);

    await pm.logsPage.expectSqlErrorStateNotVisible();
    await pm.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('Comment + WHERE clause with str_match test completed successfully');
  });

  test("should not produce SQL parser error for query with only a comment", {
    tag: ['@sqlComments', '@all', '@logs', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing edge case: SQL query containing only a comment');

    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.setQueryEditorValue('-- this query has only a comment');
    await pm.logsPage.waitForQueryEditorValue('-- this query has only a comment');
    await applyQueryButton(pm);

    // The original bug caused "Expected: end of statement, found: _timestamp" when a comment
    // preceded a SELECT. For a comment-only query the backend may return an error (empty query)
    // but must NOT produce the SQL parser error about _timestamp.
    await pm.logsPage.expectSqlErrorStateNotContain('Expected: end of statement');

    testLogger.info('Only-comment edge case test completed successfully');
  });
});
