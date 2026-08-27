const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const { setupQueryAndSwitchToBuild } = require('../utils/queryBuilder-helpers.js');

// Parallel-safe: every test mints its own saved-view name so sibling tests can
// create/apply/delete their views concurrently without colliding on the shared
// e2e_automate stream or the saved-views list.
function uniqueSavedViewName(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function saveView(pm, name) {
  await pm.logsPage.clickSavedViewsButton();
  await pm.logsPage.fillSavedViewName(name);
  await pm.logsPage.clickSavedViewDialogSave();
}

async function applyView(pm, name) {
  await pm.logsPage.clickSavedViewsExpand();
  await pm.logsPage.fillSavedViewSearchInput(name);
  await pm.logsPage.clickSavedViewByName(name);
}

// Cleanup only — assertions never go in a swallowing try/catch, but a best-effort
// delete at the end of a test may legitimately be optional if the apply already
// left the dialog in a torn-down state.
async function deleteView(pm, name) {
  try {
    await pm.logsPage.clickDeleteSavedViewButton(name);
    await pm.logsPage.clickConfirmButton();
    testLogger.info(`Cleaned up saved view: ${name}`);
  } catch (e) {
    testLogger.warn(`Saved view cleanup failed for ${name}`, { error: e.message });
  }
}

test.describe("Logs Saved View Build Mode Restore testcases", () => {
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
    testLogger.info('Test setup completed');
  });

  test("should save a builder chart as a Saved View and restore it in full when applied", {
    tag: ['@saved-view-build-mode', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing save builder chart as saved view + full restore on apply');

    const savedViewName = uniqueSavedViewName('svbuild');

    // 1. Enter Build tab — this first entry flips isFirstBuildToggle to false,
    //    so the later apply is the exact "tab already visited" regression path.
    await pm.logsPage.clickBuildToggle();
    await pm.logsPage.waitForBuildTabLoaded();

    // 2. Select a deterministic non-default chart type and gate it so restore is
    //    distinguishable from the re-derived default (bar).
    await pm.logsPage.selectChartType('area');
    await pm.logsPage.verifyChartTypeSelected('area');

    // 3. Save the view while on the Build tab (captures data.buildData).
    await saveView(pm, savedViewName);

    // 4. Leave Build so the apply below is a second build entry.
    await pm.logsPage.clickLogsToggle();
    await pm.logsPage.expectLogsSearchResultVisible();

    // 5. Apply the saved view (flips toggle to build, mounts BuildQueryPage fresh).
    await applyView(pm, savedViewName);

    // 6. Assert full restore on the first build mount after apply.
    await pm.logsPage.expectBuildQueryPageVisible();
    await pm.logsPage.verifyChartTypeSelected('area');
    await pm.logsPage.expectBuilderModeActive();
    await pm.logsPage.expectXAxisLayoutVisible();
    await pm.logsPage.expectYAxisLayoutVisible();

    // 7. Cleanup.
    await deleteView(pm, savedViewName);

    testLogger.info('Saved view build-mode restore test completed');
  });

  test("Custom-SQL (customQuery) saved view restores Custom mode, table chart and the saved SQL", {
    tag: ['@saved-view-build-mode', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing custom-query saved view restore (custom mode + table + SQL)');

    const savedViewName = uniqueSavedViewName('svbuildcustom');
    const customSql = 'SELECT code, cnt FROM (SELECT code, count(*) as cnt FROM "e2e_automate" GROUP BY code) subq LIMIT 10';

    // 1. Enter Build with a complex subquery → custom mode, table chart, customQuery=true.
    await setupQueryAndSwitchToBuild(pm, page, customSql);

    // 2. Gate: custom mode is active and the table chart is selected.
    await pm.logsPage.expectCustomModeActive();
    await pm.logsPage.verifyChartTypeSelected('table');

    // 3. Save the view while in custom mode (captures customQuery + query + table).
    await saveView(pm, savedViewName);

    // 4. Leave Build.
    await pm.logsPage.clickLogsToggle();
    await pm.logsPage.expectLogsSearchResultVisible();

    // 5. Apply the saved view.
    await applyView(pm, savedViewName);

    // 6. Assert restore: custom mode, table chart, and the saved SQL verbatim.
    await pm.logsPage.expectBuildQueryPageVisible();
    await pm.logsPage.expectCustomModeActive();
    await pm.logsPage.verifyChartTypeSelected('table');
    const restoredSql = await pm.logsPage.getQueryEditorTextWhenReady('subq');
    expect(restoredSql, 'custom SQL should be restored verbatim').toContain('e2e_automate');

    // 7. Cleanup.
    await deleteView(pm, savedViewName);

    testLogger.info('Custom-SQL saved view restore test completed');
  });

  test("toggling away and back does not re-apply the saved chart (one-shot consumption)", {
    tag: ['@saved-view-build-mode', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing one-shot savedBuildConfig consumption');

    const savedViewName = uniqueSavedViewName('svbuildonce');

    // 1-6. Save and apply an area view (restore confirmed) — same path as the P0 test.
    await pm.logsPage.clickBuildToggle();
    await pm.logsPage.waitForBuildTabLoaded();
    await pm.logsPage.selectChartType('area');
    await pm.logsPage.verifyChartTypeSelected('area');
    await saveView(pm, savedViewName);
    await pm.logsPage.clickLogsToggle();
    await pm.logsPage.expectLogsSearchResultVisible();
    await applyView(pm, savedViewName);
    await pm.logsPage.expectBuildQueryPageVisible();
    await pm.logsPage.verifyChartTypeSelected('area');

    // 7. Toggle away from Build.
    await pm.logsPage.clickLogsToggle();
    await pm.logsPage.expectLogsSearchResultVisible();

    // 8. Toggle back — savedBuildConfig was nulled after the first restore, so this
    //    entry re-derives the chart from the logs query instead of re-applying area.
    await pm.logsPage.clickBuildToggle();
    await pm.logsPage.waitForBuildTabLoaded();

    // 9. Assert the saved chart was NOT re-applied: area is gone and the re-derived
    //    default (bar) is selected instead.
    await pm.logsPage.verifyChartTypeSelected('area', false);
    await pm.logsPage.verifyChartTypeSelected('bar');

    // 10. Cleanup.
    await deleteView(pm, savedViewName);

    testLogger.info('One-shot consumption test completed');
  });

  test("applying a view with no buildData falls back to defaults without crashing", {
    tag: ['@saved-view-build-mode', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing no-buildData saved view fallback to defaults');

    const savedViewName = uniqueSavedViewName('svbuildnone');

    // 1. Save a view from the Logs tab (no buildData captured — toggle is not build).
    await saveView(pm, savedViewName);

    // 2. Apply the no-buildData view. savedBuildConfig is set to null, and the view's
    //    logsVisualizeToggle keeps us on the Logs tab (no build flip, no crash).
    await applyView(pm, savedViewName);
    await pm.logsPage.expectLogsSearchResultVisible();
    await pm.logsPage.expectNoDashboardErrors();

    // 3. Enter Build — falls through to default derivation with no crash.
    await pm.logsPage.clickBuildToggle();
    await pm.logsPage.waitForBuildTabLoaded();

    // 4. Assert defaults (builder mode) and no error surface.
    await pm.logsPage.expectBuildQueryPageVisible();
    await pm.logsPage.expectBuilderModeActive();
    await pm.logsPage.expectNoDashboardErrors();

    // 5. Cleanup.
    await deleteView(pm, savedViewName);

    testLogger.info('No-buildData fallback test completed');
  });

  test("a saved view wins over a stale URL build_data", {
    tag: ['@saved-view-build-mode', '@all', '@logs', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing saved view overrides stale URL build_data');

    const savedViewName = uniqueSavedViewName('svbuildurl');

    // 1. Save an area build-mode view.
    await pm.logsPage.clickBuildToggle();
    await pm.logsPage.waitForBuildTabLoaded();
    await pm.logsPage.selectChartType('area');
    await pm.logsPage.verifyChartTypeSelected('area');
    await saveView(pm, savedViewName);

    // 2. Leave Build, re-enter, and switch to a DIFFERENT chart (bar) so the URL
    //    build_data diverges from the saved area view.
    await pm.logsPage.clickLogsToggle();
    await pm.logsPage.expectLogsSearchResultVisible();
    await pm.logsPage.clickBuildToggle();
    await pm.logsPage.waitForBuildTabLoaded();
    await pm.logsPage.selectChartType('bar');
    await pm.logsPage.verifyChartTypeSelected('bar');

    // 3. Reload at the current URL, which now carries the stale bar build_data.
    const staleUrl = page.url();
    await page.goto(staleUrl);
    await page.waitForLoadState('domcontentloaded');

    // 4. Guard: the reload restores the STALE bar from the URL (first toggle), proving
    //    the URL would otherwise win if the saved view were ignored.
    await pm.logsPage.expectBuildQueryPageVisible();
    await pm.logsPage.verifyChartTypeSelected('bar');

    // 5. Leave Build so applying the view remounts BuildQueryPage (toggle flip).
    await pm.logsPage.clickLogsToggle();
    await pm.logsPage.expectLogsSearchResultVisible();

    // 6. Apply the saved view — it must override the stale URL config.
    await applyView(pm, savedViewName);

    // 7. Assert the saved view wins.
    await pm.logsPage.expectBuildQueryPageVisible();
    await pm.logsPage.verifyChartTypeSelected('area');
    await pm.logsPage.expectBuilderModeActive();

    // 8. Cleanup.
    await deleteView(pm, savedViewName);

    testLogger.info('Saved view over stale URL test completed');
  });
});
