import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions";
import DashboardDrilldownPage from "../../pages/dashboardPages/dashboard-drilldown";
import DashboardTimeRefresh from "../../pages/dashboardPages/dashboard-refresh";
import DashboardPanelConfigs from "../../pages/dashboardPages/dashboard-panel-configs";
import DashboardPanel from "../../pages/dashboardPages/dashboard-panel-edit";
import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "./utils/dashCreation.js";

const dashboardName = `Dashboard_${Date.now()}`;

test.describe("dashboard UI testcases", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("should add the breakdown field to the dashboard panel and allow the user to cancel the action", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardRefresh = new DashboardTimeRefresh(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPanel = new DashboardPanel(page);
    const dashboardName = `dashboard-${Date.now()}`;
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create dashboard and add panel
    await dashboardCreate.createDashboard(dashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);

    // Select stream and fields
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    // Simulate user removing a field (cancel-like behavior)
    await chartTypeSelector.removeField("kubernetes_container_image", "b");

    // Apply configuration
    await dashboardActions.applyDashboardBtn();

    // Set relative time
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardRefresh.setRelative("4", "w");
    await dashboardActions.applyDashboardBtn();

    // Save and verify panel
    await dashboardActions.savePanel();
    await page
      .locator('[data-test="dashboard-back-btn"]')
      .waitFor({ state: "visible" });

    // Delete panel and dashboard
    await dashboardPanel.deletePanel(panelName);
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should add and cancel the breakdown field with different times and timezones and ensure it displays the correct output", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardRefresh = new DashboardTimeRefresh(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPanel = new DashboardPanel(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);

    // Create dashboard and add panel
    await dashboardCreate.createDashboard(dashboardName);
    await dashboardCreate.addPanel();

    // Select stream and fields
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "y"
    );
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "b");

    // Set relative time
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardRefresh.setRelative("6", "w");
    await dashboardActions.applyDashboardBtn();

    // Cancel adding the breakdown field
    await chartTypeSelector.removeField("kubernetes_container_name", "b");
    await dashboardActions.applyDashboardBtn();

    // Save and verify panel
    await dashboardActions.addPanelName(panelName);
    await dashboardActions.savePanel();
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });

    // Delete panel and dashboard
    await dashboardPanel.deletePanel(panelName);
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should update the breakdown field correctly to match the existing one according to the chart type when changing the chart type.", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPanel = new DashboardPanel(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Add a new dashboard
    await dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectChartType("line");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );

    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "y"
    );

    // Set the date-time range and apply changes
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardTimeRefresh.setRelative("6", "w");
    await dashboardActions.applyDashboardBtn();

    // Change chart types and verify
    await chartTypeSelector.selectChartType("area");
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "b");

    await chartTypeSelector.selectChartType("area-stacked");
    await chartTypeSelector.selectChartType("h-bar");
    await chartTypeSelector.selectChartType("scatter");
    await chartTypeSelector.selectChartType("h-stacked");
    await chartTypeSelector.selectChartType("stacked");

    // Save the dashboard panel
    await dashboardActions.savePanel();

    // Switch to Bar chart and apply changes
    await dashboardPanel.editPanel(panelName);
    await chartTypeSelector.selectChartType("bar");
    await dashboardActions.applyDashboardBtn();
    await dashboardActions.savePanel();

    // Delete the panel and confirm
    await dashboardPanel.deletePanel(panelName);
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should create the panel successfully after adding a breakdown", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const dashboardPanel = new DashboardPanel(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);

    await chartTypeSelector.selectChartType("line");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    // Set the date-time range and apply changes
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardTimeRefresh.setRelative("6", "w");
    await dashboardActions.applyDashboardBtn();

    // Save the dashboard panel
    await dashboardActions.savePanel();

    // Delete the panel and confirm
    await dashboardPanel.deletePanel(panelName);
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should clear the selections after adding a breakdown and refreshing the page.", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectChartType("line");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_host", "b");

    // Set the date-time range
    await dashboardTimeRefresh.setRelative("6", "w");
    await dashboardActions.applyDashboardBtn();

    // Refresh the page
    await page.reload();
    await page.waitForTimeout(1000);

    // Handle dialog and verify no data is visible
    page.once("dialog", (dialog) => {
      dialog.dismiss().catch(() => {});
    });
    await expect(page.locator('[data-test="no-data"]')).toBeVisible();
  });
  test("should display the correct output when changing relative and absolute times with different timezones after adding a breakdown", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const dashboardPanel = new DashboardPanel(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectChartType("line");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "b");

    // Set relative date-time and timezone
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardTimeRefresh.setRelative("6", "w");

    await dashboardActions.applyDashboardBtn();

    // Set absolute date-time and timezone
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardTimeRefresh.selectAbsolutetime("8", "16");

    await dashboardActions.applyDashboardBtn();

    // Save the dashboard panel
    await dashboardActions.savePanel();

    // Delete the panel and confirm
    await dashboardPanel.deletePanel(panelName);
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should redirect to the list of dashboard pages when discarding changes", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectChartType("line");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );
    await chartTypeSelector.searchAndAddField("kubernetes_docker_id", "y");

    // Apply changes
    await dashboardActions.applyDashboardBtn();

    await page.locator('[data-test="dashboard-panel-discard"]').click();
  });

  test('should plot the data when adding a "Sort by" filter, a breakdown, and other required fields', async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const dashboardPanel = new DashboardPanel(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectChartType("line");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "b");

    // Set relative date-time and timezone
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardTimeRefresh.setRelative("6", "w");
    await dashboardActions.applyDashboardBtn();
    await dashboardActions.savePanel();

    // Delete the panel and confirm
    await dashboardPanel.deletePanel(panelName);
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should correctly handle and display string and numeric values when no value replacement occurs", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const dashboardPanel = new DashboardPanel(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");
    const chartTypeSelector = new ChartTypeSelector(page);

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectChartType("line");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubectl_kubernetes_io_default_container",
      "y"
    );
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "b");

    // Set relative date-time
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardTimeRefresh.setRelative("6", "w");

    // Configure no value replacement
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectNoValueReplace("2");
    await dashboardActions.applyDashboardBtn();

    // Save the dashboard panel
    await dashboardActions.savePanel();

    // Delete the panel and confirm
    await dashboardPanel.deletePanel(panelName);
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
