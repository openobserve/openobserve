const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData: _ingestData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// ============================================================================
// SELECT * handling on the logs Visualize tab — PR #13244 / issue #12897.
//
// The old code blocked SELECT * for EVERY chart type, before the chart type was
// even finalised. The fix replaces that with isSelectStarForTable(): only the
// table chart is blocked (it renders the raw query columns), while histogram-
// based charts (line/bar/area/scatter) render histogram(_timestamp)/count(*)
// and legitimately ignore the SELECT columns.
//
// WHY THIS IS ITS OWN SPEC FILE:
// isSelectStarForTable() short-circuits to false unless the SERVER was started
// with ZO_QUICK_MODE_ENABLED=true. That flag is read once at process start, so
// it cannot vary between tests sharing a backend. CI gives each matrix shard its
// own OpenObserve process, so this file is pinned to its own shard in
// ci-matrix/ci_matrix.json with quick_mode_enabled: "true"; every other shard
// omits the field and keeps the default (false). Keep these tests here rather
// than folding them back into logsVisualizePersistence.spec.js, or they will
// silently skip.
// ============================================================================

// ----- Helpers -----

async function ingestTestData(page) {
  await _ingestData(page);
}

// ----- Test Suite -----

test.describe("Logs Visualize SELECT * handling testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');
    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`
    );
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.applyQueryAndWaitForSearchResponse();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Fail loudly rather than skip: this shard exists precisely to run with quick
    // mode on, so a false here means the shard is misconfigured (or the matrix
    // entry was lost) and the coverage has silently evaporated.
    expect(
      await pm.logsPage.isQuickModeEnabledOnInstance(),
      'This spec requires the backend to run with ZO_QUICK_MODE_ENABLED=true — ' +
      'check the quick_mode_enabled flag on this shard in ci-matrix/ci_matrix.json'
    ).toBe(true);

    testLogger.info('Test setup completed');
  });

  test("should block a table chart on a SELECT * query and revert the chart type", {
    tag: ['@logs-visualize-selectstar', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing SELECT * table guard (toast + chart type revert)');

    // 1. SQL mode with an explicit SELECT * — in SQL mode
    //    getEffectiveVisualizeQuery() returns the raw query, so this is
    //    deterministically a select-all (quick mode cannot rewrite it).
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.typeQuery('SELECT * FROM "e2e_automate"');
    await pm.logsPage.applyQueryAndWaitForSearchResponse();

    // Precondition gate: the editor really holds a select-all. Without this, a
    // failure to enter SQL mode would surface as the confusing "expected a toast,
    // none emitted" below instead of pointing at the actual cause.
    await pm.logsPage.expectQueryEditorContainsText('SELECT * FROM');

    // 2. Open Visualize — a histogram chart type is selected by default and must render.
    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectVisualizeChartRendered();

    // 3. Record the chart type the panel settled on; the revert must return to it.
    const typeBeforeTable = await pm.logsPage.waitForChartTypeStabilized();
    expect(typeBeforeTable, 'a chart type should be selected before switching').toBeTruthy();
    expect(typeBeforeTable).not.toBe('table');

    // 4. Attempt to switch to the table chart with the recorder armed.
    await pm.logsPage.startToastRecorder();
    await pm.logsPage.selectChartType('table');

    // 5. The guard fires: toast shown AND the chart type reverts to the previous one.
    await pm.logsPage.expectSelectStarVisualizationToast();
    await pm.logsPage.verifyChartTypeSelected('table', false);
    await pm.logsPage.verifyChartTypeSelected(typeBeforeTable);

    // 6. The revert must leave a WORKING panel, not a blank one — the guard returns
    //    early after reverting, so this proves the previous chart survived intact.
    await pm.logsPage.expectVisualizeChartRendered();
    await pm.logsPage.expectNoDashboardErrors();

    testLogger.info(`SELECT * table guard fired and reverted to "${typeBeforeTable}"`);
  });

  test("should allow a histogram chart on a SELECT * query without the SELECT * toast", {
    tag: ['@logs-visualize-selectstar', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing SELECT * is allowed for histogram-based charts');

    // 1. Same SELECT * query that blocks the table chart above.
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.typeQuery('SELECT * FROM "e2e_automate"');
    await pm.logsPage.applyQueryAndWaitForSearchResponse();

    // Precondition gate — ESSENTIAL here. This test's payload assertion is the
    // ABSENCE of a toast, which passes trivially if the query was never a
    // select-all in the first place (e.g. SQL mode failed to engage and quick mode
    // rewrote it to SELECT <fields>). Verifying the editor holds a select-all is
    // what stops this from becoming a test that can never fail.
    await pm.logsPage.expectQueryEditorContainsText('SELECT * FROM');

    // 2. Arm the recorder BEFORE entering Visualize — the pre-fix code emitted the
    //    toast on entry, ahead of any chart-type choice, so recording from here is
    //    what makes this fail on the unfixed build.
    await pm.logsPage.startToastRecorder();
    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectVisualizeChartRendered();

    // 3. Explicitly pick a histogram-based chart type and confirm it renders.
    await pm.logsPage.selectChartType('line');
    await pm.logsPage.verifyChartTypeSelected('line');
    await pm.logsPage.expectVisualizeChartRendered();

    // 4. No SELECT * toast at any point, and no error panel.
    await pm.logsPage.expectNoSelectStarVisualizationToast();
    await pm.logsPage.expectNoDashboardErrors();

    testLogger.info('SELECT * rendered on a line chart with no toast');
  });
});
