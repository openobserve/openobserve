// tracesSqlMode.spec.js
// SQL mode in the Traces explorer: toggle, typed SQL in the Spans view, trace selectors in the Traces view.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');

const FILTER = "service_name = 'api-gateway'";
const PREFILLED = `SELECT * FROM "default" WHERE ${FILTER} ORDER BY start_time DESC`;
const GROUPED = `SELECT service_name, count(*) AS spans FROM "default" GROUP BY service_name`;
const BIG_TRACES = 'SELECT trace_id FROM "default"\nGROUP BY trace_id\nHAVING count(*) > 200';
const NO_TRACE_ID = 'SELECT service_name, duration\nFROM "default"\nWHERE duration > 0';
const TYPO = `SELECT servce_name, count(*) AS spans FROM "default" GROUP BY servce_name`;

test.describe("Traces SQL mode testcases", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  // Every seeded trace has a frontend and a backend span, so the Traces view queries below find rows.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      await ingestTraces(page, 6, { forceScenario: 'success' });
    } catch (e) {
      testLogger.warn('SQL mode trace seeding failed (continuing)', { error: e.message });
    } finally {
      await context.close();
    }
  });

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

  test("P1: A Traces view template fills the editor, and the query lists traces", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P1', '@all']
  }, async () => {
    await pm.tracesPage.switchToTracesMode();
    await pm.tracesPage.setQueryEditorValue('');
    await pm.tracesPage.toggleSqlModeFromToolbar();
    await pm.tracesPage.expectSqlMode(true);
    await expect(pm.tracesPage.getSqlTemplateGallery()).toBeVisible({ timeout: 10000 });

    await pm.tracesPage.useSqlTemplate('Big traces');
    await pm.tracesPage.expectQueryEditorValue(BIG_TRACES);
    await expect(pm.tracesPage.getTraceResultRows()).toHaveCount(0);

    await pm.tracesPage.setQueryEditorValue(BIG_TRACES.replace('> 200', '> 1'));
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();

    await expect(pm.tracesPage.getTraceResultRows().first()).toBeVisible({ timeout: 20000 });
    await expect(pm.tracesPage.getRedMetricsDashboard()).toBeVisible();
  });

  test("P1: A Traces view query without trace_id explains why, and Add trace_id and Run fixes it", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P1', '@all']
  }, async () => {
    await pm.tracesPage.switchToTracesMode();
    await pm.tracesPage.toggleSqlModeFromToolbar();
    await pm.tracesPage.setQueryEditorValue(NO_TRACE_ID);
    await pm.tracesPage.expectSqlMode(true);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();

    await expect(pm.tracesPage.getSqlSelectorProblem()).toBeVisible({ timeout: 10000 });
    await expect(pm.tracesPage.getSqlSuggestedChange()).toContainText(
      'SELECT trace_id, service_name, duration',
    );

    await pm.tracesPage.addTraceIdAndRun();

    await pm.tracesPage.expectQueryEditorValue(
      NO_TRACE_ID.replace('SELECT service_name', 'SELECT trace_id, service_name'),
    );
    await expect(pm.tracesPage.getSqlSelectorProblem()).toHaveCount(0);
    await expect(pm.tracesPage.getTraceResultRows().first()).toBeVisible({ timeout: 20000 });
  });

  test("P1: An unknown column offers Did you mean, and the fix replaces it and runs", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P1', '@all']
  }, async () => {
    await pm.tracesPage.toggleSqlModeFromToolbar();
    await pm.tracesPage.setQueryEditorValue(TYPO);
    await pm.tracesPage.expectSqlMode(true);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();

    await expect(pm.tracesPage.getSqlErrorState()).toBeVisible({ timeout: 20000 });
    await expect(pm.tracesPage.getSqlErrorState()).toContainText('Field not found: servce_name');
    await expect(pm.tracesPage.getSqlSuggestionFixCard()).toContainText('Did you mean service_name?');

    await pm.tracesPage.getSqlSuggestionFixCard().click();

    await pm.tracesPage.expectQueryEditorValue(GROUPED);
    await expect(pm.tracesPage.getSqlErrorState()).toHaveCount(0);
    await expect(pm.tracesPage.getSqlResultTable()).toBeVisible({ timeout: 20000 });
  });
});
