const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require('../utils/test-logger.js');
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import PageManager from "../../pages/page-manager";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

// Every test here runs in parallel (the config sets fullyParallel: true), so the
// dashboard name must be generated fresh per test. A single shared module-scope
// name meant several workers created rows with the IDENTICAL title at once, and
// deleteDashboard() resolves its row with `.first()` — so a finishing test could
// delete a still-running test's dashboard. It also leaked: this file created 9
// dashboards and deleted 7, leaving two same-named strays behind on every run
// (confirmed against alpha). Same fix, and same reason, as dashboard.spec.js.
const generateDashboardName = () =>
  "Dashboard_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();

test.describe("dashboard UI testcases", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
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
    const dashboardName = generateDashboardName();
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
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
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
    await pm.dashboardPanelActions.waitForChartToRender();

    // Set relative time
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("4", "w");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Save and verify panel
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.waitForBackBtnVisible();

    // Delete panel and dashboard
    await pm.dashboardPanelEdit.deletePanel(panelName);
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should add and cancel the breakdown field with different times and timezones and ensure it displays the correct output", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();

    // Select stream and fields
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
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
    await pm.dashboardPanelActions.waitForChartToRender();

    // Cancel adding the breakdown field
    // Field "kubernetes_container_name" gets alias "breakdown_1"
    await pm.chartTypeSelector.removeField("breakdown_1", "b");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Save and verify panel
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.waitForBackBtnVisible();

    // Delete panel and dashboard
    await pm.dashboardPanelEdit.deletePanel(panelName);
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should update the breakdown field correctly to match the existing one according to the chart type when changing the chart type.", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();
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
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
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
    await pm.dashboardPanelActions.waitForChartToRender();

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

    // Save the dashboard panel. The chart-type switches re-run the query on their
    // own, so settle before saving even though there is no explicit Apply here.
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();

    // Switch to Bar chart and apply changes
    await pm.dashboardPanelEdit.editPanel(panelName);
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
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
    const dashboardName = generateDashboardName();
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
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
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
    await pm.dashboardPanelActions.waitForChartToRender();

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
    const dashboardName = generateDashboardName();
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
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "b");

    // Set the date-time range
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Refresh the page
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // The panel selections do not survive the reload, so the chart falls back to
    // its empty state. toBeVisible() retries, which is what the blind 1s sleep
    // that used to sit here was standing in for.
    await expect(pm.dashboardPanelActions.getNoDataLocator()).toBeVisible({
      timeout: 30000,
    });

    // Leave the editor and delete the dashboard — this test created one and never
    // removed it. NOTE: the dialog handler that used to be registered here
    // DISMISSED the next dialog, which would cancel the discard below; discardPanel()
    // installs its own accepting handler, so the stray one had to go.
    await pm.dashboardPanelActions.discardPanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
  test("should display the correct output when changing relative and absolute times with different timezones after adding a breakdown", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();
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
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
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
    await pm.dashboardPanelActions.waitForChartToRender();

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
    const dashboardName = generateDashboardName();
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
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );
    await pm.chartTypeSelector.searchAndAddField("kubernetes_docker_id", "y");

    // Apply changes
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // discardPanel() waits for the URL to leave /add_panel, which is the redirect
    // this test is named for.
    await pm.dashboardPanelActions.discardPanel();

    // Delete the dashboard — this test created one and never removed it.
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test('should plot the data when adding a "Sort by" filter, a breakdown, and other required fields', async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();
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
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
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
    await pm.dashboardPanelActions.waitForChartToRender();
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
    const dashboardName = generateDashboardName();
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
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
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
    await pm.dashboardPanelActions.waitForChartToRender();

    // Save the dashboard panel
    await pm.dashboardPanelActions.savePanel();

    // Delete the panel and confirm
    await pm.dashboardPanelEdit.deletePanel(panelName);
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
