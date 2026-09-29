const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

const STREAM = 'e2e_automate';

// The guard in useSearchQuery rejects the filter outright rather than running it.
const LIMIT_REFUSAL = 'LIMIT is not supported without SQL mode';

test.describe("Logs non-SQL LIMIT handling", () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.logsPage.selectStream(STREAM);
  });

  test("a LIMIT in the non-SQL filter should be refused instead of half-running", {
    tag: ['@bug-6915', '@P1', '@regression', '@logsRegression']
  }, async () => {
    // The filter used to return rows while the histogram query failed on the same LIMIT.
    await pm.logsPage.clearAndFillQueryEditor('code=200 LIMIT 5');
    await pm.logsPage.clickRefreshButton();

    await pm.logsPage.expectSearchErrorContaining(LIMIT_REFUSAL);

    testLogger.info('✓ PASSED: non-SQL LIMIT refused with an explicit message (Bug #6915)');
  });

  test("a non-SQL filter without LIMIT should still run", {
    tag: ['@bug-6915', '@P2', '@regression', '@logsRegression']
  }, async () => {
    // Control: the guard must key on LIMIT, not reject every filter.
    await pm.logsPage.clearAndFillQueryEditor('code=200');
    await pm.logsPage.clickRefreshButton();

    await pm.logsPage.expectLogsTableVisible();
    await pm.logsPage.expectSqlErrorStateNotVisible();

    testLogger.info('✓ PASSED: a LIMIT-free non-SQL filter still runs (Bug #6915)');
  });
});
