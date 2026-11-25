const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
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

test.describe("Logs non-SQL not-equal operator", () => {
  test.describe.configure({ mode: 'serial' });
  const orgId = process.env.ORGNAME || 'default';
  const stream = `e2e_nonsql_ne_${Date.now().toString(36)}`;
  const rows = [
    ...Array.from({ length: 4 }, (_, i) => ({ level: 'error', seq: i })),
    ...Array.from({ length: 6 }, (_, i) => ({ level: 'info', seq: 10 + i })),
  ];
  const NOT_ERROR_TOTAL = 6;
  let pm;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const seed = new PageManager(page);
      await seed.logsPage.ingestLogs(orgId, stream, rows);
      await seed.logsPage.waitForStreamRowCount(orgId, stream, rows.length);
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.logsPage.selectStream(stream);
    await pm.logsPage.disableSqlModeIfNeeded();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await new PageManager(page).logsPage.deleteStream(stream);
    } finally {
      await page.close();
    }
  });

  test("a <> filter in non-SQL mode runs as written and returns the same rows as !=", {
    tag: ['@bug-16949', '@P2', '@regression', '@logsRegression']
  }, async ({ page }) => {
    const sentSql = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/_search') && !req.url().includes('is_ui_histogram')) {
        const body = req.postDataJSON() || {};
        const sql = body.query?.sql;
        if (sql) sentSql.push(body.encoding === 'base64' ? Buffer.from(sql, 'base64').toString('utf8') : sql);
      }
    });

    await pm.logsPage.clearAndFillQueryEditor("level <> 'error'");
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectSqlErrorStateNotVisible();
    expect(await pm.logsPage.getResultHitsCount()).toBe(NOT_ERROR_TOTAL);
    expect(sentSql.some((sql) => sql.includes("level <> 'error'")), `searched SQL: ${sentSql.join(' | ')}`).toBe(true);

    await pm.logsPage.clearAndFillQueryEditor("level != 'error'");
    await pm.logsPage.runQueryAndWaitForResults();
    expect(await pm.logsPage.getResultHitsCount()).toBe(NOT_ERROR_TOTAL);
  });
});
