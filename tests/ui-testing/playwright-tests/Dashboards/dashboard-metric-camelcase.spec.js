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
   * Helper: Click Apply and wait until the panel query has actually run.
   *
   * `waitForChartToRender()` only checks that the Apply button is enabled, and
   * that is still true in the gap between the click and Vue flipping the
   * button into its loading state — so on its own it can return before the
   * query even starts. Wait for the loading state to appear first (best
   * effort: a very fast query may finish before we can observe it), then let
   * `waitForChartToRender()` wait for it to clear.
   */
  async function applyAndWaitForQuery(page) {
    await pm.dashboardPanelActions.applyDashboardBtn();
    // Loading state: on enterprise the apply button is swapped for
    // data-test="dashboard-cancel" (so the lookup below returns null), on
    // non-enterprise it stays in place but is disabled.
    await page
      .waitForFunction(
        () => {
          const applyBtn = document.querySelector('[data-test="dashboard-apply"]');
          return !applyBtn || applyBtn.disabled;
        },
        { timeout: 5000 }
      )
      .catch(() => {});
    await pm.dashboardPanelActions.waitForChartToRender();
  }

  /**
   * Helper: Apply dashboard and set a wide time range for data availability.
   */
  async function applyWithTimeRange(page) {
    await applyAndWaitForQuery(page);

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("4", "w");
    await applyAndWaitForQuery(page);
  }

  /**
   * Helper: Assert metric chart renders with data (not "No Data").
   *
   * For metric panels `noData` is computed straight from the Y alias lookup
   * (PanelSchemaRenderer.vue), so a hidden "no-data" empty state is exactly
   * the signal these tests care about. Poll for it instead of reading it once:
   * on the first query of a panel the empty state stays up for the whole load,
   * and the just-ingested records can take a moment to become searchable, so
   * re-apply and re-check before failing.
   */
  async function assertMetricRenders(page, attempts = 3) {
    const chartRenderer = page.locator('[data-test="chart-renderer"]');
    await expect(chartRenderer).toBeVisible({ timeout: 15000 });

    const noDataElement = page.locator('[data-test="no-data"]');

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const rendered = await noDataElement
        .waitFor({ state: "hidden", timeout: 15000 })
        .then(() => true)
        .catch(() => false);

      if (rendered) {
        testLogger.info("Metric panel rendered a value", { attempt });
        return;
      }

      if (attempt < attempts) {
        testLogger.info("Panel still shows No Data — re-running the query", {
          attempt,
        });
        await applyAndWaitForQuery(page);
      }
    }

    // Exhausted the retries — fail with the panel's actual state.
    await expect(noDataElement).toBeHidden({ timeout: 10000 });
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

    // Remove the default seeded Y (count) before adding ours — metric allows one Y.
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    // Add the lowercase alias as Y-axis field (metric chart requires Y-axis to render)
    await pm.chartTypeSelector.searchAndAddField("totalcount", "y");
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

    // Remove the default seeded Y (count) before adding ours — metric allows one Y.
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    // Add Y-axis field (metric chart requires Y-axis to render)
    await pm.chartTypeSelector.searchAndAddField("metricValue", "y");
    testLogger.info("Custom SQL with non-existent filter entered");

    // Apply and set narrow time range
    await applyAndWaitForQuery(page);

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("1", "m");
    await applyAndWaitForQuery(page);

    // For count(*) with a WHERE that matches nothing, the result may still be 0
    // which is a valid metric value. Assert the panel is in a valid state.
    const chartRenderer = page.locator('[data-test="chart-renderer"]');
    const noDataElement = page.locator('[data-test="no-data"]');

    // Either chart renders (count returns 0) or "No Data" is shown - both are
    // valid, so poll until the panel settles into one of them.
    await expect
      .poll(
        async () => {
          const chartVisible = await chartRenderer.isVisible().catch(() => false);
          const noDataText = await noDataElement
            .textContent({ timeout: 1000 })
            .catch(() => "");
          return chartVisible || noDataText.trim() === "No Data";
        },
        { timeout: 15000, intervals: [500, 1000, 1000, 2000, 2000] }
      )
      .toBe(true);

    const chartVisible = await chartRenderer.isVisible().catch(() => false);
    const noDataText = await noDataElement
      .textContent({ timeout: 1000 })
      .catch(() => "");

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

    // Remove the default seeded Y (count) before adding ours — metric allows one Y.
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    // Add the camelCase alias as Y-axis field (metric chart requires Y-axis to render)
    await pm.chartTypeSelector.searchAndAddField("countRecords", "y");
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
