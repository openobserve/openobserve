// tracesSqlMode.spec.js
// SQL mode in the Traces explorer: SQL runs in the Spans view only; the Traces view takes a filter.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');

const FILTER = "service_name = 'api-gateway'";
const PREFILLED = `SELECT * FROM "default" WHERE ${FILTER} ORDER BY start_time DESC`;
const GROUPED = `SELECT service_name, count(*) AS spans FROM "default" GROUP BY service_name`;
const GROUPED_WHERE = `SELECT service_name, count(*) AS spans FROM "default" WHERE ${FILTER} GROUP BY service_name`;
const TYPO = `SELECT servce_name, count(*) AS spans FROM "default" GROUP BY servce_name`;
const PER_TRACE =
  "SELECT trace_id, min(_timestamp) AS first_seen, count(*) AS spans, " +
  "sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS errors, " +
  "(max(end_time) - min(start_time)) / 1000 AS trace_duration " +
  'FROM "default" GROUP BY trace_id HAVING count(*) > 0 ORDER BY spans DESC LIMIT 100';

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

  test("P1: A GROUP BY query shows its result columns and keeps the RED charts with a caption", {
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
    await expect(pm.tracesPage.getRedMetricsDashboard()).toBeVisible();
    const caption = await pm.tracesPage.openRedRateCaption();
    await expect(caption).toContainText('GROUP BY not applied', { timeout: 20000 });
  });

  test("P1: Turning SQL mode off shows and runs the filter with no dialog, and keeps the SQL", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P1', '@all']
  }, async () => {
    await pm.tracesPage.setQueryEditorValue(FILTER);
    await pm.tracesPage.toggleSqlModeFromToolbar();
    await pm.tracesPage.expectQueryEditorValue(PREFILLED);
    await pm.tracesPage.setQueryEditorValue(GROUPED);

    await pm.tracesPage.toggleSqlModeFromToolbar();

    await expect(pm.tracesPage.getSqlModeConfirmDialog()).toHaveCount(0);
    await pm.tracesPage.expectSqlMode(false);
    await pm.tracesPage.expectQueryEditorValue(FILTER);
    await expect(pm.tracesPage.getToastMessage('Your SQL is kept.')).toBeVisible({ timeout: 10000 });

    await pm.tracesPage.toggleSqlModeFromToolbar();
    await pm.tracesPage.expectSqlMode(true);
    await pm.tracesPage.expectQueryEditorValue(GROUPED);
  });

  test("P1: The SQL switch in the Traces view moves to Spans, runs nothing, and Back to Traces returns", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P1', '@all']
  }, async () => {
    await pm.tracesPage.switchToTracesMode();
    await pm.tracesPage.setQueryEditorValue(FILTER);
    await pm.tracesPage.expectSqlMode(false);

    const searches = await pm.tracesPage.countSearchStreams(async () => {
      await pm.tracesPage.toggleSqlModeFromToolbar();
      await pm.tracesPage.expectSqlMode(true);
    }, () => expect(pm.tracesPage.getSqlAwaitingRun()).toBeVisible({ timeout: 10000 }));

    expect(searches).toBe(0);
    await pm.tracesPage.expectQueryEditorValue(PREFILLED);
    await expect(pm.tracesPage.getToastMessage('SQL runs in the Spans view')).toBeVisible();

    await pm.tracesPage.clickToastAction('Back to Traces');

    await pm.tracesPage.expectSqlMode(false);
    await pm.tracesPage.expectQueryEditorValue(FILTER);
  });

  test("P1: Leaving Spans SQL for Traces keeps the SQL, and the SQL switch brings it back", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P1', '@all']
  }, async () => {
    await pm.tracesPage.setQueryEditorValue('');
    await pm.tracesPage.toggleSqlModeFromToolbar();
    await pm.tracesPage.setQueryEditorValue(GROUPED_WHERE);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await expect(pm.tracesPage.getSqlResultTable()).toBeVisible({ timeout: 20000 });

    await pm.tracesPage.switchToTracesMode();
    await pm.tracesPage.expectSqlMode(false);

    await pm.tracesPage.toggleSqlModeFromToolbar();

    await pm.tracesPage.expectSqlMode(true);
    await pm.tracesPage.expectQueryEditorValue(GROUPED_WHERE);
    await expect(pm.tracesPage.getSqlAwaitingRun()).toBeVisible({ timeout: 10000 });
  });

  test("P2: A SELECT typed in the Traces view sends nothing, and Open in Spans view carries it", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P2', '@all']
  }, async () => {
    await pm.tracesPage.switchToTracesMode();
    await pm.tracesPage.setQueryEditorValue(GROUPED);
    await pm.tracesPage.expectSqlMode(false);

    const searches = await pm.tracesPage.countSearchStreams(async () => {
      await pm.tracesPage.runSearch();
      await expect(pm.tracesPage.getStatementInTracesCard()).toContainText(
        'The Traces view takes a filter, not a SELECT',
        { timeout: 10000 },
      );
      await pm.tracesPage.openStatementInSpans();
      await pm.tracesPage.expectSqlMode(true);
    }, () => expect(pm.tracesPage.getSqlAwaitingRun()).toBeVisible({ timeout: 10000 }));

    expect(searches).toBe(0);
    await pm.tracesPage.expectQueryEditorValue(GROUPED);
  });

  test("P2: A Traces filter holding IN (SELECT ...) sends nothing and names the subquery", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P2', '@all']
  }, async () => {
    const subquery = `trace_id IN (SELECT trace_id FROM "default" WHERE ${FILTER})`;
    await pm.tracesPage.switchToTracesMode();
    await pm.tracesPage.setQueryEditorValue(subquery);

    const searches = await pm.tracesPage.countSearchStreams(async () => {
      await pm.tracesPage.runSearch();
      await expect(pm.tracesPage.getStatementInTracesCard()).toContainText(
        'The Traces view cannot run a subquery',
        { timeout: 10000 },
      );
      await pm.tracesPage.openStatementInSpans();
      await pm.tracesPage.expectSqlMode(true);
    }, () => expect(pm.tracesPage.getSqlAwaitingRun()).toBeVisible({ timeout: 10000 }));

    expect(searches).toBe(0);
    await expect.poll(() => pm.tracesPage.getQueryEditorContent()).toContain(`WHERE ${subquery}`);
  });

  test("P1: Sidebar ticks in SQL mode write one IN condition, and unticking takes a value out", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P1', '@all']
  }, async () => {
    const base = `SELECT * FROM "default" ORDER BY start_time DESC`;
    await pm.tracesPage.toggleSqlModeFromToolbar();
    await pm.tracesPage.setQueryEditorValue(base);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await pm.tracesPage.expectSearchResultsVisible();

    await pm.tracesPage.expandTraceField('service_name');
    const first = await pm.tracesPage.toggleSidebarValue('service_name', 0);
    await pm.tracesPage.expectQueryEditorValue(
      `SELECT * FROM "default" WHERE service_name = '${first}' ORDER BY start_time DESC`,
    );
    const second = await pm.tracesPage.toggleSidebarValue('service_name', 1);
    await pm.tracesPage.expectQueryEditorValue(
      `SELECT * FROM "default" WHERE service_name IN ('${first}','${second}') ORDER BY start_time DESC`,
    );

    await pm.tracesPage.toggleSidebarValue('service_name', first);
    await pm.tracesPage.expectQueryEditorValue(
      `SELECT * FROM "default" WHERE service_name = '${second}' ORDER BY start_time DESC`,
    );
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

  test("P1: A per-trace SQL query shows one row per trace, opens it, and Back re-runs nothing", {
    tag: ['@tracesSqlMode', '@traces', '@query', '@P1', '@all']
  }, async ({ page }) => {
    await pm.tracesPage.toggleSqlModeFromToolbar();
    await pm.tracesPage.expectSqlMode(true);
    await pm.tracesPage.setQueryEditorValue(PER_TRACE);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();

    const table = pm.tracesPage.getSqlResultTable();
    await expect(table).toBeVisible({ timeout: 20000 });
    for (const column of ['trace_id', 'first_seen', 'spans', 'errors', 'trace_duration']) {
      await expect(table).toContainText(column);
    }

    await pm.tracesPage.openFirstSqlResultRow();
    await pm.tracesPage.expectTraceDetailsVisible();

    let searches = 0;
    page.on('request', (request) => {
      if (request.url().includes('_search_stream')) searches++;
    });
    await pm.tracesPage.navigateBackFromTraceDetails();
    await expect(table).toBeVisible({ timeout: 10000 });
    expect(searches).toBe(0);
  });
});
