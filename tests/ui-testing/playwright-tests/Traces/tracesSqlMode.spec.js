// tracesSqlMode.spec.js
// SQL mode in the Traces Spans view: toggle, typed SQL results, RED collapse, toggle back.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const FILTER = "service_name = 'api-gateway'";
const PREFILLED = `SELECT * FROM "default" WHERE ${FILTER} ORDER BY start_time DESC`;
const GROUPED = `SELECT service_name, count(*) AS spans FROM "default" GROUP BY service_name`;

test.describe("Traces SQL mode testcases", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.isStreamSelectVisible();
    await pm.tracesPage.selectTraceStream('default');
    await pm.tracesPage.switchToSpansMode();
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("P1: Turning SQL mode on pre-fills SQL from the filter", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P1', '@all']
  }, async () => {
    await pm.tracesPage.setQueryEditorValue(FILTER);
    await pm.tracesPage.expectSqlMode(false);

    await pm.tracesPage.toggleSqlModeFromToolbar();

    await pm.tracesPage.expectSqlMode(true);
    await pm.tracesPage.expectQueryEditorValue(PREFILLED);
  });

  test("P1: A GROUP BY query shows its result columns and no RED charts", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P1', '@all']
  }, async () => {
    await pm.tracesPage.toggleSqlModeFromToolbar();
    await pm.tracesPage.expectSqlMode(true);
    await pm.tracesPage.setQueryEditorValue(GROUPED);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();

    const table = pm.tracesPage.getSqlResultTable();
    await expect(table).toBeVisible({ timeout: 20000 });
    await expect(table).toContainText('service_name');
    await expect(table).toContainText('spans');
    await expect(pm.tracesPage.getRedUnavailableIcon()).toBeVisible();
    await expect(pm.tracesPage.getRedMetricsDashboard()).toHaveCount(0);
  });

  test("P1: Turning SQL mode off a plain SELECT returns the filter", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P1', '@all']
  }, async () => {
    await pm.tracesPage.setQueryEditorValue(FILTER);
    await pm.tracesPage.toggleSqlModeFromToolbar();
    await pm.tracesPage.expectQueryEditorValue(PREFILLED);

    await pm.tracesPage.toggleSqlModeFromToolbar();

    await expect(pm.tracesPage.getSqlModeConfirmDialog()).toHaveCount(0);
    await pm.tracesPage.expectSqlMode(false);
    await pm.tracesPage.expectQueryEditorValue(FILTER);
  });

  test("P2: Turning SQL mode off a GROUP BY asks first, and Cancel keeps the SQL", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P2', '@all']
  }, async () => {
    await pm.tracesPage.toggleSqlModeFromToolbar();
    await pm.tracesPage.setQueryEditorValue(GROUPED);
    await pm.tracesPage.expectSqlMode(true);

    await pm.tracesPage.toggleSqlModeFromToolbar();
    await expect(pm.tracesPage.getSqlModeConfirmDialog()).toBeVisible({ timeout: 10000 });
    await pm.tracesPage.cancelSqlModeSwitchOff();

    await pm.tracesPage.expectSqlMode(true);
    await pm.tracesPage.expectQueryEditorValue(GROUPED);
  });
});
