const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

const STREAM = 'e2e_automate';
const EXPLAIN_QUERY = `explain analyze verbose select _timestamp, code from "${STREAM}" limit 5`;

test.describe("Logs EXPLAIN keeps SQL mode on", () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.logsPage.selectStream(STREAM);
  });

  test("an EXPLAIN ANALYZE query should keep SQL mode on and run without a query error", {
    tag: ['@explain-sql-mode', '@P1', '@regression', '@logsRegression']
  }, async ({ page }) => {
    await pm.logsPage.enableSqlModeIfDisabled();
    await pm.logsPage.setQueryEditorValue(EXPLAIN_QUERY);
    await pm.logsPage.waitForQueryEditorValue('explain analyze verbose');

    await pm.logsPage.expectSqlModeActive();
    const searchResponse = page.waitForResponse((res) => res.url().includes('/_search_stream') && res.status() === 200, { timeout: 30000 });
    await pm.logsPage.clickRefreshButton();
    await searchResponse;

    await pm.logsPage.waitForSearchResults();
    await expect(page.locator('[data-test="o2-table-row-0"]')).toContainText('plan');
    await pm.logsPage.expectSqlErrorStateNotVisible();
    await pm.logsPage.expectSqlModeActive();

    testLogger.info('✓ PASSED: EXPLAIN ANALYZE keeps SQL mode on and runs');
  });

  test("a plain filter on an explain field should leave SQL mode off", {
    tag: ['@explain-sql-mode', '@P2', '@regression', '@logsRegression']
  }, async () => {
    // Control: only the EXPLAIN statement prefix counts as SQL, not a field named explain.
    await pm.logsPage.enableSqlModeIfDisabled();
    await pm.logsPage.clearAndFillQueryEditor("explain = 'x'");
    await pm.logsPage.waitForQueryEditorValue("explain = 'x'");

    await expect.poll(() => pm.logsPage._isSqlModeEnabledViaVue(), { timeout: 10000 }).toBe(false);

    testLogger.info('✓ PASSED: explain-named filter stays in filter mode');
  });

  test("replacing an EXPLAIN query with a plain filter should turn SQL mode off", {
    tag: ['@explain-sql-mode', '@P2', '@regression', '@logsRegression']
  }, async () => {
    await pm.logsPage.enableSqlModeIfDisabled();
    await pm.logsPage.setQueryEditorValue(EXPLAIN_QUERY);
    await pm.logsPage.expectSqlModeActive();

    await pm.logsPage.setQueryEditorValue('code = 200');
    await pm.logsPage.waitForQueryEditorValue('code = 200');

    await expect.poll(() => pm.logsPage._isSqlModeEnabledViaVue(), { timeout: 10000 }).toBe(false);

    testLogger.info('✓ PASSED: a non-SQL edit still turns SQL mode off');
  });

  test("the Explain query menu item should be disabled when the editor already holds EXPLAIN", {
    tag: ['@explain-sql-mode', '@P2', '@regression', '@logsRegression']
  }, async () => {
    await pm.logsPage.enableSqlModeIfDisabled();
    await pm.logsPage.setQueryEditorValue(EXPLAIN_QUERY);
    await pm.logsPage.expectSqlModeActive();

    await pm.logsPage.clickMoreOptionsButton();
    await expect(pm.logsPage.getExplainQueryMenuBtnLocator()).toBeDisabled();

    testLogger.info('✓ PASSED: Explain query menu is disabled for an EXPLAIN statement');
  });
});
