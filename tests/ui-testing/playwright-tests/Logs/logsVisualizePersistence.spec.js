const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData: _ingestData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// VRL body the transform-editor test asserts on. clickVrlEditor() types this
// into Monaco itself (via keyboard.type + a model-stability wait), so the value
// here must match that helper rather than being typed separately — Monaco
// ignores direct .inputarea fills.
const VRL_FUNCTION = '.a=2';

// ----- Helpers -----

async function ingestTestData(page) {
  await _ingestData(page);
}

// ----- Test Suite -----

test.describe("Logs Visualization State Persistence testcases", () => {
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

  // ===== P0 — Critical path: tab toggle persists across side-navigation =====

  test("should persist Visualize tab after navigating away and returning", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing Visualize tab persistence across navigation');

    // 1. Verify Logs table results visible (pre-condition).
    await pm.logsPage.expectLogsSearchResultVisible();

    // 2. Click Visualize toggle.
    await pm.logsPage.clickVisualizeToggle();

    // 3. Verify Visualize tab content is loaded and Logs search result is NOT visible.
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectLogsSearchResultNotVisible();

    // 4. Navigate to Dashboard.
    await pm.logsPage.clickMenuLinkDashboardItem();

    // 5. Return to Logs page.
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 6. Assert Visualize tab content is still visible (NOT the Logs table).
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectLogsSearchResultNotVisible();

    testLogger.info('Visualize tab persistence test completed');
  });

  test("should persist Build tab after navigating away and returning", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing Build tab persistence across navigation');

    // 1. Verify Logs table results visible (pre-condition).
    await pm.logsPage.expectLogsSearchResultVisible();

    // 2. Click Build toggle.
    await pm.logsPage.clickBuildToggle();

    // 3. Verify Build query page is visible and Logs table is NOT.
    await pm.logsPage.expectBuildQueryPageVisible();

    // 4. Navigate to Dashboard.
    await pm.logsPage.clickMenuLinkDashboardItem();

    // 5. Return to Logs page.
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 6. Assert Build query page is still visible.
    await pm.logsPage.expectBuildQueryPageVisible();

    testLogger.info('Build tab persistence test completed');
  });

  test("should persist default Logs tab after navigating away (no toggle change)", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing default Logs tab persistence across navigation');

    // 1. Verify Logs table results visible (pre-condition).
    await pm.logsPage.expectLogsSearchResultVisible();

    // 2. Navigate to Dashboard.
    await pm.logsPage.clickMenuLinkDashboardItem();

    // 3. Return to Logs page.
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 4. Assert Logs tab is active and search results visible.
    await pm.logsPage.expectLogsSearchResultVisible();

    testLogger.info('Default Logs tab persistence test completed');
  });

  // ===== P1 — Important variations =====

  test("should persist Logs tab after switching Visualize → Logs then navigating", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing Visualize-to-Logs toggle persistence');

    // 1. Verify Logs table visible.
    await pm.logsPage.expectLogsSearchResultVisible();

    // 2. Switch to Visualize.
    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeTabContentVisible();

    // 3. Switch back to Logs.
    await pm.logsPage.clickLogsToggle();
    await pm.logsPage.expectLogsSearchResultVisible();

    // 4. Navigate to Dashboard.
    await pm.logsPage.clickMenuLinkDashboardItem();

    // 5. Return to Logs.
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 6. Assert Logs tab restored.
    await pm.logsPage.expectLogsSearchResultVisible();

    testLogger.info('Visualize-to-Logs toggle persistence test completed');
  });

  test("should persist stream selection after page reload", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing stream selection persistence after page reload');

    // 1. Verify stream is selected and results visible (done in beforeEach).

    // 2. Reload the page.
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 3. Assert e2e_automate is pre-selected in the stream dropdown.
    await pm.logsPage.expectStreamSelectorContainsText("e2e_automate");

    testLogger.info('Stream selection persistence test completed');
  });

  test("should persist live mode / auto-run toggle across navigation", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing live mode persistence across navigation');

    // 1. Verify Logs table visible.
    await pm.logsPage.expectLogsSearchResultVisible();

    // 2. Enable live mode (auto-run).
    await pm.logsPage.logsQueryPage.enableAutoRun();

    // Guard: confirm the toggle actually activated before navigating away.
    // If auto_query_enabled is false, _toggleAutoRun silently returns and
    // this assertion catches the no-op so the test doesn't false-pass.
    await pm.logsPage.expectLiveModeStatusVisible();
    testLogger.info('Live mode confirmed active before navigation');

    // 3. Navigate to Dashboard.
    await pm.logsPage.clickMenuLinkDashboardItem();

    // 4. Return to Logs.
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 5. Assert that the live-mode refresh-interval button is visible (indicates live mode active).
    await pm.logsPage.expectLiveModeStatusVisible();
    testLogger.info('Live mode is still active after navigation');

    testLogger.info('Live mode persistence test completed');
  });

  test("should persist Visualize tab as last selected after full toggle cycle (Logs → Build → Visualize)", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing full toggle cycle persistence (Logs → Build → Visualize)');

    // 1. Verify Logs tab active.
    await pm.logsPage.expectLogsSearchResultVisible();

    // 2. Switch to Build.
    await pm.logsPage.clickBuildToggle();
    await pm.logsPage.expectBuildQueryPageVisible();

    // 3. Switch to Visualize.
    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeTabContentVisible();

    // 4. Navigate to Dashboard.
    await pm.logsPage.clickMenuLinkDashboardItem();

    // 5. Return to Logs.
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 6. Assert Visualize tab is active (NOT Build, NOT Logs).
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectLogsSearchResultNotVisible();
    await pm.logsPage.expectBuildQueryPageNotVisible();

    testLogger.info('Full toggle cycle persistence test completed');
  });

  // ===== P2 — Edge cases / nice-to-have =====

  test("should disable Visualize toggle when multiple streams are selected", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing Visualize toggle disabled with multi-stream selection');

    // 1. Add _rumdata to the current selection (e2e_automate already selected in beforeEach).
    await pm.logsPage.addStreamToSelection('_rumdata');

    // 2. Run query to load results.
    await pm.logsPage.applyQueryAndWaitForSearchResponse();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // 3. Assert Visualize toggle is disabled.
    await pm.logsPage.expectVisualizeToggleDisabled();

    testLogger.info('Visualize toggle disabled test completed');
  });

  test("should restore Visualize tab via URL param on direct navigation", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing Visualize tab restoration via URL param');

    // 1. Navigate directly to logs page with visualize toggle param.
    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}&logs_visualize_toggle=visualize`
    );
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 2. Assert Visualize tab content is visible on first load.
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectLogsSearchResultNotVisible();

    testLogger.info('URL param Visualize tab restoration test completed');
  });

  test("should restore Build tab via URL param on direct navigation", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing Build tab restoration via URL param');

    // 1. Navigate directly to logs page with build toggle param.
    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}&logs_visualize_toggle=build`
    );
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 2. Assert Build query page is visible on first load.
    await pm.logsPage.expectBuildQueryPageVisible();
    await pm.logsPage.expectLogsSearchResultNotVisible();

    testLogger.info('URL param Build tab restoration test completed');
  });

  test("should render toggle group buttons (not dropdown) at wide viewport", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing toggle group rendering at wide viewport');

    // 1. Verify Logs table visible (pre-condition from beforeEach).

    // 2. Assert all three toggle buttons are visible.
    await pm.logsPage.expectAllToggleButtonsVisible();

    // 3. Assert the view-mode dropdown fallback is NOT visible.
    await pm.logsPage.expectViewModeDropdownNotVisible();

    testLogger.info('Toggle group rendering test completed');
  });

  // ===========================================================================
  // PR #13244 / issue #12897 — Visualize render + URL-refresh regressions
  // ---------------------------------------------------------------------------
  // Defect A: convertPanelData() threw "Please select required fields to render
  //   the chart" for the logs Timechart's *custom-query* panel while its x/y axes
  //   were still being populated asynchronously from the result schema.
  // Defect B: refreshing the URL on the Visualize tab produced a
  //   "Select * query is not supported for visualization" toast plus permanent
  //   No Data, because the toggle was restored ahead of the stream selection and
  //   nothing re-ran the visualization afterwards.
  //
  // Non-flaky negative assertions (project rule): every "no error" check below is
  // sequenced AFTER a deterministic positive end-state — the chart canvas/table is
  // actually painted and the chart type has settled. Error-panel absence is safe to
  // poll because errorData.errors is only ever cleared by an explicit resetErrors(),
  // so an error raised at any point in the run is still present. Toasts, by
  // contrast, auto-dismiss, so their absence is proved with a MutationObserver-based
  // recorder installed (as an init script) BEFORE the navigation under test rather
  // than by a post-hoc not.toBeVisible() that could simply have arrived too late.
  // ===========================================================================

  test("should render the Visualize chart without the false required-fields error", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing Visualize renders with no required-fields error (defect A)');

    // 1. Verify Logs table results visible (pre-condition).
    await pm.logsPage.expectLogsSearchResultVisible();

    // 2. Open the Visualize tab (default chart type — no manual chart selection).
    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeTabContentVisible();

    // 3. Positive end-state: the chart actually paints and No Data is gone.
    await pm.logsPage.expectVisualizeChartRendered();

    // 4. The custom-query panel's transient empty x/y must NOT surface the
    //    builder-mode required-fields error, and no error panel at all may show.
    await pm.logsPage.expectNoRequiredFieldsError();
    await pm.logsPage.expectNoDashboardErrors();

    testLogger.info('Visualize default chart rendered with zero errors');
  });

  test("should restore chart type, query and chart after refreshing the URL on the Visualize tab", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info("Testing PR repro: match_all('error') → h-bar → URL refresh");

    // 1. Run the reported query.
    await pm.logsPage.typeQuery("match_all('error')");
    await pm.logsPage.applyQueryAndWaitForSearchResponse();

    // 2. Open the Visualize tab and let the first render complete.
    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectVisualizeChartRendered();

    // 3. Switch the chart type to horizontal bar.
    await pm.logsPage.selectChartType('h-bar');
    await pm.logsPage.verifyChartTypeSelected('h-bar');
    await pm.logsPage.expectVisualizeChartRendered();

    // 4. Gate on the URL sync — updateUrlQueryParams() runs after the chart type
    //    watcher settles, so reloading earlier would not exercise URL restoration.
    await pm.logsPage.waitForVisualizeUrlState();

    // Capture the panel payload the app wrote for this configured state.
    const configBeforeReload = await pm.logsPage.getVisualizationDataFromUrl();
    expect(configBeforeReload, 'visualization_data should be present before reload').toBeTruthy();
    expect(configBeforeReload.type).toBe('h-bar');

    // 5. Start recording toasts, then refresh the URL.
    await pm.logsPage.startToastRecorder();
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // 6. Positive end-state after restore: (b) chart type still h-bar and
    //    (c) the chart really renders (not the permanent No Data state).
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.verifyChartTypeSelected('h-bar');
    await pm.logsPage.expectVisualizeChartRendered();

    // 6b. Chart CONFIG (not just type) survived. After load the app rewrites
    //     visualization_data from its restored in-memory panel, so an equal payload
    //     proves restoreVisualizationFromUrlOnLoad() repopulated the config — a URL
    //     that merely survived untouched could not produce this.
    await expect
      .poll(async () => (await pm.logsPage.getVisualizationDataFromUrl())?.type, {
        timeout: 20000,
        message: 'visualization_data was not rewritten after reload',
      })
      .toBe('h-bar');
    const configAfterReload = await pm.logsPage.getVisualizationDataFromUrl();
    expect(configAfterReload.config).toEqual(configBeforeReload.config);

    // 7. (a) no "Select * query is not supported for visualization" toast, and no
    //    spurious required-fields error / error panel.
    await pm.logsPage.expectNoSelectStarVisualizationToast();
    await pm.logsPage.expectNoRequiredFieldsError();
    await pm.logsPage.expectNoDashboardErrors();

    // 8. (d) the query survived the refresh.
    await pm.logsPage.expectQueryEditorContainsText("match_all('error')");

    testLogger.info('URL refresh restored chart type, query and chart with zero errors');
  });

  test("should re-render the Visualize chart after reload with the default chart type", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing reload on Visualize tab with the default chart type');

    // 1. Open the Visualize tab and let the first render complete.
    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectVisualizeChartRendered();

    // 2. Capture whatever chart type the Timechart auto-selected — the restore must
    //    bring back the same one without any manual chart-type interaction.
    const defaultChartType = await pm.logsPage.waitForChartTypeStabilized();
    expect(defaultChartType).toBeTruthy();
    testLogger.info(`Default chart type before reload: ${defaultChartType}`);

    // 3. Gate on the URL sync, then reload with toast recording active.
    await pm.logsPage.waitForVisualizeUrlState();
    await pm.logsPage.startToastRecorder();
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // 4. Positive end-state: same chart type, chart repainted, no No-Data state.
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.verifyChartTypeSelected(defaultChartType);
    await pm.logsPage.expectVisualizeChartRendered();

    // 5. No error toast and no error panel after the restore.
    await pm.logsPage.expectNoSelectStarVisualizationToast();
    await pm.logsPage.expectNoRequiredFieldsError();
    await pm.logsPage.expectNoDashboardErrors();

    testLogger.info('Default chart type re-rendered after reload with zero errors');
  });

  test("should restore a non-default chart type (area) after refreshing the URL", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing chart-type restore is not h-bar specific (area)');

    // 1. Open the Visualize tab and let the first render complete.
    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectVisualizeChartRendered();

    // 2. Switch to the area chart ("area" is one of the chart types the fix's
    //    restoreVisualizationFromUrlOnLoad() whitelist accepts).
    await pm.logsPage.selectChartType('area');
    await pm.logsPage.verifyChartTypeSelected('area');
    await pm.logsPage.expectVisualizeChartRendered();

    // 3. Gate on the URL sync, capture the payload, then reload with toast recording.
    await pm.logsPage.waitForVisualizeUrlState();
    const areaConfigBeforeReload = await pm.logsPage.getVisualizationDataFromUrl();
    expect(areaConfigBeforeReload, 'visualization_data should be present before reload').toBeTruthy();
    expect(areaConfigBeforeReload.type).toBe('area');

    await pm.logsPage.startToastRecorder();
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // 4. Positive end-state: area restored and repainted.
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.verifyChartTypeSelected('area');
    await pm.logsPage.expectVisualizeChartRendered();

    // 4b. Config survived the restore, not just the chart type (see test above).
    await expect
      .poll(async () => (await pm.logsPage.getVisualizationDataFromUrl())?.type, {
        timeout: 20000,
        message: 'visualization_data was not rewritten after reload',
      })
      .toBe('area');
    const areaConfigAfterReload = await pm.logsPage.getVisualizationDataFromUrl();
    expect(areaConfigAfterReload.config).toEqual(areaConfigBeforeReload.config);

    // 5. No error toast and no error panel after the restore.
    await pm.logsPage.expectNoSelectStarVisualizationToast();
    await pm.logsPage.expectNoRequiredFieldsError();
    await pm.logsPage.expectNoDashboardErrors();

    testLogger.info('Area chart type restored after reload with zero errors');
  });

  test("should keep the Visualize chart rendering after reload with a VRL function applied", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing VRL variant of the URL-refresh restore');

    // 1. Enable the transform (VRL) editor. clickVrlEditor() focuses Monaco, clears
    //    it, types VRL_FUNCTION and waits for the model to settle past the editor's
    //    debounce, so tempFunctionContent is populated when it returns. Assert the
    //    body really landed rather than trusting the helper.
    await pm.logsPage.toggleVrlEditor();
    await pm.logsPage.clickVrlEditor();
    await pm.logsPage.expectVrlEditorContains(VRL_FUNCTION);

    // 2. Re-run the search so the VRL function is part of the current query state.
    await pm.logsPage.applyQueryAndWaitForSearchResponse();

    // 3. Open the Visualize tab and let the first render complete.
    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectVisualizeChartRendered();

    // 4. Gate on the URL sync INCLUDING functionContent — that param is only written
    //    when transformType === "function" and the body is non-empty, so reaching
    //    this line proves the reload will genuinely restore a VRL-carrying state.
    await pm.logsPage.waitForVisualizeUrlState({ requireFunctionContent: true });
    await pm.logsPage.startToastRecorder();
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // 5. Positive end-state: chart repainted after the VRL-carrying restore, and the
    //    VRL body itself came back (useLogs restores tempFunctionContent from the URL).
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectVisualizeChartRendered();
    await pm.logsPage.expectVrlEditorContains(VRL_FUNCTION);

    // 6. No error toast and no error panel after the restore.
    await pm.logsPage.expectNoSelectStarVisualizationToast();
    await pm.logsPage.expectNoRequiredFieldsError();
    await pm.logsPage.expectNoDashboardErrors();

    testLogger.info('VRL visualize state restored after reload with zero errors');
  });

  test("should never show the required-fields error while toggling Visualize → Logs → Visualize", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing manual toggle round-trip stays free of required-fields errors');

    // 1. First entry into Visualize — chart paints, no errors.
    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectVisualizeChartRendered();
    await pm.logsPage.expectNoRequiredFieldsError();
    await pm.logsPage.expectNoDashboardErrors();

    // 2. Back to Logs.
    await pm.logsPage.clickLogsToggle();
    await pm.logsPage.expectLogsSearchResultVisible();

    // 3. Second entry into Visualize — this rebuild resets the panel fields, which is
    //    exactly the transient empty x/y window that used to throw.
    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectVisualizeChartRendered();
    await pm.logsPage.expectNoRequiredFieldsError();
    await pm.logsPage.expectNoDashboardErrors();

    testLogger.info('Toggle round-trip completed with zero required-fields errors');
  });

  // ---------------------------------------------------------------------------
  // SELECT * handling — the behaviour change this PR introduced alongside the
  // two defect fixes. The old code blocked SELECT * for EVERY chart type before
  // the chart type was even finalised. The fix replaces that with
  // isSelectStarForTable(): only the table chart is blocked (it renders the raw
  // query columns), while histogram-based charts (line/bar/area/scatter) render
  // histogram(_timestamp)/count(*) and legitimately ignore the SELECT columns.
  //
  // isSelectStarForTable() also requires zoConfig.quick_mode_enabled — when that
  // is off it short-circuits to false and the guard does not apply at all, so
  // both tests assert that precondition instead of silently passing.
  // ---------------------------------------------------------------------------

  test("should block a table chart on a SELECT * query and revert the chart type", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing SELECT * table guard (toast + chart type revert)');

    // 0. The guard only exists when quick mode is enabled on the instance.
    test.skip(
      !(await pm.logsPage.isQuickModeEnabledOnInstance()),
      'quick_mode_enabled is off — isSelectStarForTable() short-circuits to false'
    );

    // 1. SQL mode with an explicit SELECT * — in SQL mode
    //    getEffectiveVisualizeQuery() returns the raw query, so this is
    //    deterministically a select-all (quick mode cannot rewrite it).
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.typeQuery('SELECT * FROM "e2e_automate"');
    await pm.logsPage.applyQueryAndWaitForSearchResponse();

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

    testLogger.info(`SELECT * table guard fired and reverted to "${typeBeforeTable}"`);
  });

  test("should allow a histogram chart on a SELECT * query without the SELECT * toast", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing SELECT * is allowed for histogram-based charts');

    // 0. Same precondition as the table test, so the pair always moves together.
    test.skip(
      !(await pm.logsPage.isQuickModeEnabledOnInstance()),
      'quick_mode_enabled is off — isSelectStarForTable() short-circuits to false'
    );

    // 1. Same SELECT * query that blocks the table chart above.
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.typeQuery('SELECT * FROM "e2e_automate"');
    await pm.logsPage.applyQueryAndWaitForSearchResponse();

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

  test("should not emit the SELECT * toast when opening the Visualize tab with no stream in the URL", {
    tag: ['@logs-visualize-persistence', '@all', '@logs', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing direct Visualize navigation without a stream in the URL');

    // 1. Record toasts from document-start of the upcoming navigation.
    await pm.logsPage.startToastRecorder();

    // 2. Navigate directly with only the visualize toggle. Logs page state is
    //    Vuex-backed (not localStorage), so a URL without a `stream` param is a
    //    genuine "no stream selected yet" load — the ordering that used to make the
    //    toggle watcher build `select * from "undefined"`.
    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}&logs_visualize_toggle=visualize`
    );
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 3. Positive end-state: the Visualize tab really is the active tab. A No Data
    //    placeholder is legitimate here (there is nothing to chart), so this uses the
    //    tab-content check rather than expectVisualizeChartRendered() — but it is
    //    paired with expectLogsSearchResultNotVisible() so a page that silently failed
    //    to restore the tab cannot pass on the toast-absence assertion alone.
    await pm.logsPage.expectVisualizeTabContentVisible();
    await pm.logsPage.expectLogsSearchResultNotVisible();

    // 4. The SELECT * toast must never have been emitted during that load.
    await pm.logsPage.expectNoSelectStarVisualizationToast();

    testLogger.info('Direct Visualize navigation emitted no SELECT * toast');
  });
});
