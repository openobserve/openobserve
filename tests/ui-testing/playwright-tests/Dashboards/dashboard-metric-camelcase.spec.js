const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import PageManager from "../../pages/page-manager";

const STREAM_NAME = "e2e_automate";

test.describe("Dashboard Metric Chart CamelCase Alias", () => {
  let pm;

  test.beforeEach(async ({ page }) => {
    testLogger.info("Setting up metric camelCase test");
    await navigateToBase(page);
    await ingestion(page);
    pm = new PageManager(page);
  });

  /**
   * Helper: Select stream and switch to custom SQL mode.
   */
  async function switchToCustomSQL(page) {
    await pm.chartTypeSelector.selectStream(STREAM_NAME);
    await pm.chartTypeSelector.switchToCustomQueryMode();
  }

  /**
   * Helper: leave the panel with exactly one Y-axis field, `alias`.
   *
   * Entering custom SQL makes the builder auto-seed the Y axis FROM THE SQL ALIAS, and
   * that seeding is asynchronous. The tests used to assume the placeholder `y_axis_1` was
   * still there and did removeField("y_axis_1") + searchAndAddField(alias), which races
   * the seeding two ways:
   *   - seeding not done yet -> y_axis_1 present, remove succeeds, alias added: fine
   *   - seeding already done -> Y is already `alias`, so removeField("y_axis_1") waits
   *     for an element that will never exist and times out
   * and when the Y config is left wrong the panel renders nothing, which shows up as the
   * "No Data" failure. Reconcile against whatever the panel actually holds instead of
   * assuming which of the two states we are in.
   */
  async function ensureSingleYField(page, alias) {
    const desired = page.locator(`[data-test="dashboard-y-item-${alias}-remove"]`);
    const anyY = page.locator('[data-test^="dashboard-y-item-"][data-test$="-remove"]');

    // Let the SQL-driven seeding settle before deciding what to reconcile.
    await anyY.first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});

    if ((await desired.count()) > 0) {
      testLogger.info(`Y-axis already seeded from SQL alias "${alias}" — nothing to do`);
      return;
    }

    // Drop whatever placeholder the builder seeded, then add the alias under test.
    for (let guard = 0; guard < 5 && (await anyY.count()) > 0; guard++) {
      await anyY.first().click({ timeout: 5000 }).catch(() => {});
    }
    await pm.chartTypeSelector.searchAndAddField(alias, "y");
  }

  /**
   * Helper: Apply dashboard and set a wide time range for data availability.
   */
  async function applyWithTimeRange(page) {
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("4", "w");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
  }

  /**
   * Helper: Assert metric chart renders with data (not "No Data").
   */
  async function assertMetricRenders(page) {
    const chartRenderer = pm.dashboardPanelActions.getChartRendererCanvas();
    await expect(chartRenderer).toBeVisible({ timeout: 15000 });

    // Safety net: re-run the query if the panel is still showing "No Data".
    //
    // The panel does not re-query itself after its configuration changes — it surfaces
    // the banner "Chart Configuration / Variables has been updated, but the chart was
    // not updated automatically. Click on the 'Apply' button to run the query again".
    // So a panel left showing "No Data" is a FINISHED render that never updates on its
    // own, and only a fresh Apply can change it.
    //
    // That is why waiting cannot fix this, measured on alpha with 12 executions each:
    //   - waitFor({state:"hidden"})  -> no-op; the element is ABSENT (not hidden) when
    //                                   data renders, and waitFor("hidden") resolves
    //                                   instantly against a selector matching nothing
    //   - DOM poll for 15s           -> 7/12 passed
    //   - waitForStreamComplete()    -> 5/12 passed, and slower: it reads the SSE body
    //                                   via response.text(), which mostly fails on a
    //                                   stream, so it silently rides its 15s fallback
    //                                   ("Stream completed" logged just once in 12 runs)
    //   - re-apply the query         -> 12/12 passed, always on the first retry
    //
    // The primary fix is ensureSingleYField() above, which stops the panel being
    // misconfigured in the first place; this loop only covers the residual case (it
    // fired once in 12 executions after that fix landed). The assertion below is
    // unchanged: if the panel never renders data the loop gives up, the read still
    // returns "No Data", and the test fails as it should.
    const noDataElement = pm.dashboardPanelActions.getNoDataLocator();
    const stillEmpty = async () => {
      if ((await noDataElement.count()) === 0) return false;
      const text = (await noDataElement.first().textContent().catch(() => "")) || "";
      return text.trim() === "No Data";
    };

    for (let attempt = 1; attempt <= 4 && (await stillEmpty()); attempt++) {
      testLogger.info(`Metric panel still empty — re-applying query (attempt ${attempt})`);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await page.waitForTimeout(3000);
    }

    const noDataText = await noDataElement.textContent({ timeout: 5000 }).catch(() => "");
    expect(noDataText.trim()).not.toBe("No Data");
  }

  /**
   * Helper: Clean up dashboard after test.
   */
  async function cleanup(page, dashboardName) {
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
    testLogger.info("Test cleanup complete");
  }

  test("should render metric panel with builder-mode alias", {
    tag: ["@dashboard-metric-camelcase", "@smoke", "@P0"],
  }, async ({ page }) => {
    testLogger.info("Testing metric panel renders with standard builder-mode alias");

    const dashboardName = "MetricBld_" + Math.random().toString(36).substring(2, 11);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("metric-bld");

    // Navigate to dashboards and create one
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel and select metric chart type
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("metric");

    // Builder mode: select stream and add Y-axis field (auto-generated alias y_axis_1)
    await pm.chartTypeSelector.selectStream(STREAM_NAME);
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Apply with time range and verify
    await applyWithTimeRange(page);
    await assertMetricRenders(page);
    testLogger.info("Metric panel with builder-mode alias renders correctly");

    await cleanup(page, dashboardName);
  });

  test("should render metric panel with lowercase custom SQL alias", {
    tag: ["@dashboard-metric-camelcase", "@functional", "@P1"],
  }, async ({ page }) => {
    testLogger.info("Testing metric panel renders with lowercase alias via custom SQL");

    const dashboardName = "MetricLC_" + Math.random().toString(36).substring(2, 11);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("metric-lc");

    // Navigate to dashboards and create one
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel and select metric chart type
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("metric");

    // Switch to custom SQL mode and enter query with lowercase alias
    await switchToCustomSQL(page);
    await pm.chartTypeSelector.enterCustomSQL(
      `SELECT count(*) AS totalcount FROM "${STREAM_NAME}"`
    );

    // Metric allows one Y. Reconcile with whatever the SQL seeding left behind rather
    // than assuming the y_axis_1 placeholder survived (see ensureSingleYField).
    await ensureSingleYField(page, "totalcount");
    testLogger.info("Custom SQL with lowercase alias entered");

    // Apply with time range and verify
    await applyWithTimeRange(page);
    await assertMetricRenders(page);
    testLogger.info("Metric panel with lowercase alias renders correctly");

    await cleanup(page, dashboardName);
  });

  test("should show No Data for metric panel when query returns empty result", {
    tag: ["@dashboard-metric-camelcase", "@functional", "@P1"],
  }, async ({ page }) => {
    testLogger.info("Testing metric panel shows No Data for empty result set");

    const dashboardName = "MetricND_" + Math.random().toString(36).substring(2, 11);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("metric-nd");

    // Navigate to dashboards and create one
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel and select metric chart type
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("metric");

    // Switch to custom SQL mode with a query that filters to non-existent data
    await switchToCustomSQL(page);
    await pm.chartTypeSelector.enterCustomSQL(
      `SELECT count(*) AS metricValue FROM "${STREAM_NAME}" WHERE kubernetes_container_name = 'nonexistent_container_xyz_99999'`
    );

    // Metric allows one Y. Reconcile with whatever the SQL seeding left behind rather
    // than assuming the y_axis_1 placeholder survived (see ensureSingleYField).
    await ensureSingleYField(page, "metricValue");
    testLogger.info("Custom SQL with non-existent filter entered");

    // Apply and set narrow time range
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("1", "m");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Wait for rendering to stabilize
    await page.waitForTimeout(3000);

    // For count(*) with a WHERE that matches nothing, the result may still be 0
    // which is a valid metric value. Assert the panel is in a valid state.
    const chartRenderer = pm.dashboardPanelActions.getChartRendererCanvas();
    const noDataElement = pm.dashboardPanelActions.getNoDataLocator();

    const chartVisible = await chartRenderer.isVisible().catch(() => false);
    const noDataText = await noDataElement.textContent({ timeout: 5000 }).catch(() => "");

    // Either chart renders (count returns 0) or "No Data" is shown - both are valid
    const isValidState = chartVisible || noDataText.trim() === "No Data";
    expect(isValidState).toBeTruthy();

    testLogger.info("Metric panel correctly handles empty/zero result", {
      chartVisible,
      noDataText: noDataText.trim(),
    });

    await cleanup(page, dashboardName);
  });

  test("should render metric panel with custom SQL camelCase alias", {
    tag: ["@dashboard-metric-camelcase", "@regression", "@P0"],
  }, async ({ page }) => {
    testLogger.info("Testing metric panel with camelCase alias via custom SQL mode (PR #11116)");

    const dashboardName = "MetricCC_" + Math.random().toString(36).substring(2, 11);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("metric-cc");

    // Navigate to dashboards and create one
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel and select metric chart type
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("metric");

    // Switch to custom SQL mode and enter query with camelCase alias
    await switchToCustomSQL(page);
    await pm.chartTypeSelector.enterCustomSQL(
      `SELECT count(*) AS countRecords FROM "${STREAM_NAME}"`
    );

    // Metric allows one Y. Reconcile with whatever the SQL seeding left behind rather
    // than assuming the y_axis_1 placeholder survived (see ensureSingleYField).
    await ensureSingleYField(page, "countRecords");
    testLogger.info("Custom SQL with camelCase alias entered");

    // Apply with time range and verify
    // The SQL returns "countrecords" (lowercase) but Y-axis alias is "countRecords" (camelCase)
    // PR #11116 fix: getDataValue() handles this case-insensitive lookup
    await applyWithTimeRange(page);
    await assertMetricRenders(page);
    testLogger.info("Metric panel with camelCase alias renders correctly");

    await cleanup(page, dashboardName);
  });
});
