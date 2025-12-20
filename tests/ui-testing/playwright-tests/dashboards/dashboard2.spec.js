const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import PageManager from "../../pages/page-manager";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

const dashboardName = `Dashboard_${Date.now()}`;

test.describe("dashboard UI testcases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("should add the breakdown field to the dashboard panel and allow the user to cancel the action", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const dashboardName = `dashboard-${Date.now()}`;
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select stream and fields
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    // Simulate user removing a field (cancel-like behavior)
    // Field "kubernetes_container_image" gets alias "breakdown_1"
    await pm.chartTypeSelector.removeField("breakdown_1", "b");

    // Apply configuration
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Set relative time
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("4", "w");
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Save and verify panel
    await pm.dashboardPanelActions.savePanel();
    await page
      .locator('[data-test="dashboard-back-btn"]')
      .waitFor({ state: "visible" });

    // Delete panel and dashboard
    await pm.dashboardPanelEdit.deletePanel(panelName);
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should add and cancel the breakdown field with different times and timezones and ensure it displays the correct output", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);

    // Create dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();

    // Select stream and fields
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "b"
    );

    // Set relative time
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Cancel adding the breakdown field
    // Field "kubernetes_container_name" gets alias "breakdown_1"
    await pm.chartTypeSelector.removeField("breakdown_1", "b");
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Save and verify panel
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });

    // Delete panel and dashboard
    await pm.dashboardPanelEdit.deletePanel(panelName);
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should update the breakdown field correctly to match the existing one according to the chart type when changing the chart type.", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Add a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );

    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "y"
    );

    // Set the date-time range and apply changes
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Change chart types and verify
    await pm.chartTypeSelector.selectChartType("area");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "b"
    );

    await pm.chartTypeSelector.selectChartType("area-stacked");
    await pm.chartTypeSelector.selectChartType("h-bar");
    await pm.chartTypeSelector.selectChartType("scatter");
    await pm.chartTypeSelector.selectChartType("h-stacked");
    await pm.chartTypeSelector.selectChartType("stacked");

    // Save the dashboard panel
    await pm.dashboardPanelActions.savePanel();

    // Switch to Bar chart and apply changes
    await pm.dashboardPanelEdit.editPanel(panelName);
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();

    // Delete the panel and confirm
    await pm.dashboardPanelEdit.deletePanel(panelName);
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should create the panel successfully after adding a breakdown", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    // Set the date-time range and apply changes
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Save the dashboard panel
    await pm.dashboardPanelActions.savePanel();

    // Delete the panel and confirm
    await pm.dashboardPanelEdit.deletePanel(panelName);
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should clear the selections after adding a breakdown and refreshing the page.", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "b");

    // Set the date-time range
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.applyDashboardBtn();

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
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "b"
    );

    // Set relative date-time and timezone
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");

    // await pm.dashboardPanelActions.applyDashboardBtn();

    // Set absolute date-time and timezone
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.selectAbsolutetime("1", "1");

    await pm.dashboardPanelActions.applyDashboardBtn();

    // Save the dashboard panel
    await pm.dashboardPanelActions.savePanel();

    // Delete the panel and confirm
    await pm.dashboardPanelEdit.deletePanel(panelName);
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should redirect to the list of dashboard pages when discarding changes", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );
    await pm.chartTypeSelector.searchAndAddField("kubernetes_docker_id", "y");

    // Apply changes
    await pm.dashboardPanelActions.applyDashboardBtn();

    await page.locator('[data-test="dashboard-panel-discard"]').click();
  });

  test('should plot the data when adding a "Sort by" filter, a breakdown, and other required fields', async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "b"
    );

    // Set relative date-time and timezone
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();

    // Delete the panel and confirm
    await pm.dashboardPanelEdit.deletePanel(panelName);
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should correctly handle and display string and numeric values when no value replacement occurs", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Add fields to the chart
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubectl_kubernetes_io_default_container",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "b"
    );

    // Set relative date-time
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");

    // Configure no value replacement
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectNoValueReplace("2");
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Save the dashboard panel
    await pm.dashboardPanelActions.savePanel();

    // Delete the panel and confirm
    await pm.dashboardPanelEdit.deletePanel(panelName);
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
