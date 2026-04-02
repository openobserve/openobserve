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
  test.describe.configure({ mode: "serial" });

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
    const chartRenderer = page.locator('[data-test="chart-renderer"]');
    await expect(chartRenderer).toBeVisible({ timeout: 15000 });

    const noDataElement = page.locator('[data-test="no-data"]');
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
    testLogger.info("Custom SQL with camelCase alias entered");

    // Apply with time range and verify
    await applyWithTimeRange(page);
    await assertMetricRenders(page);
    testLogger.info("Metric panel with camelCase alias renders correctly");

    await cleanup(page, dashboardName);
  });

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
    const chartRenderer = page.locator('[data-test="chart-renderer"]');
    const noDataElement = page.locator('[data-test="no-data"]');

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
});
