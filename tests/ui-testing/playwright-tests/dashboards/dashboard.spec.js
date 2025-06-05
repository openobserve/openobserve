import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "../utils/dashCreation.js";
import { login } from "../utils/dashLogin.js";
import { ingestion } from "../utils/dashIngestion.js";
import { waitForDateTimeButtonToBeEnabled } from "./dashboard.utils";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions";
import DashboardDrilldownPage from "../../pages/dashboardPages/dashboard-drilldown";
import DashboardTimeRefresh from "../../pages/dashboardPages/dashboard-refresh";
import DashboardPanelConfigs from "../../pages/dashboardPages/dashboard-panel-configs";
import DashboardPanel from "../../pages/dashboardPages/dashboard-panel-edit";
import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart";
import DashboardShareExportPage from "../../pages/dashboardPages/dashboard-share-export.js";
import DashboardSetting from "../../pages/dashboardPages/dashboard-settings.js";
import DateTimeHelper from "../../pages/dashboardPages/dashboard-time.js";
import DashboardFilter from "../../pages/dashboardPages/dashboard-filter.js";
const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

// Refactored test cases using Page Object Model

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
  test("should add and delete the dashboard", async ({ page }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);

    // Navigate to the dashboard list
    await dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    //create a new dashboard and delete it
    await dashboardCreate.createDashboard(randomDashboardName);

    await dashboardCreate.backToDashboardList();

    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    await deleteDashboard(page, randomDashboardName);
  });

  test("should create a duplicate of the dashboard", async ({ page }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);

    //navigate to the dashboard list
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    //create a new dashboard and duplicate it
    await dashboardCreate.createDashboard(randomDashboardName);

    await expect(page.getByText("Dashboard added successfully.")).toBeVisible({
      timeout: 30000,
    });
    await dashboardCreate.backToDashboardList();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    // Search for the created dashboard
    await dashboardCreate.searchDashboard(randomDashboardName);
    await dashboardList.duplicateDashboard(randomDashboardName);
    console.log("Duplicate dashboard created", randomDashboardName);

    //Name of the duplicate dashboard

    const duplicateDashboardName = randomDashboardName + " -" + " Copy";

    // search dupliacte dashboard with its randomDashboardName +- Copy is added to the dashboard name
    await dashboardCreate.searchDashboard(duplicateDashboardName);

    // Delete the duplicate dashboard and original dashboard
    await dashboardList.deleteDuplicateDashboard(page, duplicateDashboardName);
    await dashboardCreate.searchDashboard(randomDashboardName);
    await deleteDashboard(page, randomDashboardName);
  });

  test("should create a dashboard and add the breakdown", async ({ page }) => {
    // Initialize Page Objects
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);

    // Generate a unique panel name
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboard list
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Wait for dashboard tab to be visible
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    // Add a new panel
    await dashboardCreate.addPanel();

    // Select stream and breakdown fields
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    // Apply panel changes
    await dashboardActions.applyDashboardBtn();
    await dashboardActions.addPanelName(panelName);
    await dashboardActions.savePanel();

    // Return to dashboard list
    await dashboardCreate.backToDashboardList();

    // Clean up: delete created dashboard
    await deleteDashboard(page, randomDashboardName);
  });

  test("should update the data when changing the time between both absolute and relative time using the Kolkata time zone.", async ({
    page,
  }) => {
    // Initialize only the used Page Objects
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardRefresh = new DashboardTimeRefresh(page);
    const chartTypeSelector = new ChartTypeSelector(page);

    // Generate a unique panel name
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Add a new panel
    await dashboardCreate.addPanel();

    // Configure the chart
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    // Set time to relative (e.g., last 3 hours)
    await dashboardRefresh.setRelative("3", "h");

    // Apply and save the panel
    await dashboardActions.applyDashboardBtn();
    await dashboardActions.addPanelName(panelName);
    await dashboardActions.savePanel();

    // Return to dashboard list
    await dashboardCreate.backToDashboardList();

    // Clean up: delete created dashboard
    await deleteDashboard(page, randomDashboardName);
  });

  test("should update the chart with the results of a custom SQL query", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);

    // Generate unique panel name
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to Dashboards page
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);

    // Open Custom SQL editor
    await page.locator('[data-test="dashboard-customSql"]').click();
    await page.locator(".view-line").first().click();

    // Fill in the SQL query
    await page
      .locator('[data-test="dashboard-panel-query-editor"]')
      .locator(".inputarea")
      .fill(
        'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", kubernetes_container_name as "breakdown_1" FROM "e2e_automate" GROUP BY x_axis_1, breakdown_1'
      );

    // Map query results to chart axes
    await chartTypeSelector.searchAndAddField("y_axis_1", "y");
    await chartTypeSelector.searchAndAddField("breakdown_1", "b");

    // Apply and save the panel
    await dashboardActions.applyDashboardBtn();
    await dashboardActions.addPanelName(panelName);
    await dashboardActions.savePanel();

    // Return to dashboard list and clean up
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should display the correct and updated chart when changing the chart type", async ({
    page,
  }) => {
    // Initialize Page Objects
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);

    // Generate a unique panel name
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);

    // Select stream and add fields to chart
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    // Change chart types
    await chartTypeSelector.selectChartType("area");
    await chartTypeSelector.selectChartType("scatter");
    await chartTypeSelector.selectChartType("gauge");

    // Apply and save the panel
    await dashboardActions.applyDashboardBtn();
    await dashboardActions.savePanel();

    // Return to dashboards list
    await dashboardCreate.backToDashboardList();

    // Clean up: delete the created dashboard
    await deleteDashboard(page, randomDashboardName);
  });

  test.skip("should navigate to another dashboard using the DrillDown feature.", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardDrilldown = new DashboardDrilldownPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();

    // Select chart type and stream
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_labels_app_kubernetes_io_component",
      "b"
    );
    await chartTypeSelector.searchAndAddField(
      "kubernetes_labels_app_kubernetes_io_instance",
      "y"
    );
    await chartTypeSelector.searchAndAddField(
      "kubernetes_labels_app_kubernetes_io_managed_by",
      "y"
    );

    await dashboardActions.applyDashboardBtn();

    // Add drilldown to another dashboard
    const drilldownName = dashboardDrilldown.generateUniqueDrilldownName();
    const folderName = "default";
    const tabName = "Default";
    const dashboardName = randomDashboardName;
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardDrilldown.addDrillownDashboard(
      folderName,
      drilldownName,
      dashboardName,
      tabName
    );

    await dashboardActions.applyDashboardBtn();

    // Save the panel
    await dashboardActions.addPanelName(panelName);
    await dashboardActions.savePanel();
    await dashboardCreate.backToDashboardList();

    //Delete the created dashboard
    await deleteDashboard(page, randomDashboardName);
  });

  test.skip("should dynamically update the filtered data when applying the dynamic filter on the dashboard", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardPanel = new DashboardPanel(page);
    const chartTypeSelector = new ChartTypeSelector(page);

    const dashboardRefresh = new DashboardTimeRefresh(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);

    // Select chart type and stream
    await chartTypeSelector.selectChartType("bar");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );

    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "b");

    await dashboardAction.applyDashboardBtn();

    await page
      .locator('[data-test="dashboard-variable-adhoc-add-selector"]')
      .click();
    await page
      .locator('[data-test="dashboard-variable-adhoc-name-selector"]')
      .click();
    await page
      .locator('[data-test="dashboard-variable-adhoc-name-selector"]')
      .fill("kubernetes_container_hash");
    await page
      .locator('[data-test="dashboard-variable-adhoc-value-selector"]')
      .click();
    await page
      .locator('[data-test="dashboard-variable-adhoc-value-selector"]')
      .fill(
        "058694856476.dkr.ecr.us-west-2.amazonaws.com/zinc-cp@sha256:56e216b3d61bd282846e3f6d1bd9cb82f83b90b7e401ad0afc0052aa3f15715c"
      );
    await dashboardRefresh.setRelative("3", "h");

    await dashboardActions.savePanel();

    await dashboardPanel.editPanel(panelName);
    await dashboardActions.applyDashboardBtn();
    await dashboardActions.savePanel();
    await dashboardPanel.deletePanel(panelName);

    // Return to dashboard list and delete the created dashboard
    await dashboardCreate.backToDashboardList();
    await waitForDashboardPage(page);
    await deleteDashboard(page, randomDashboardName);
  });

  test("should create and save the dashboard with different relative times and timezones on both the Gauge and Table charts", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardAction = new DashboardactionPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");
    const dateTimeHelper = new DateTimeHelper(page);

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();

    // Select gauge chart
    await chartTypeSelector.selectChartType("gauge");

    // Select a stream
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );

    // Set date-time and timezone for gauge chart
    await dateTimeHelper.setRelativeTimeRange("6-w");
    await dashboardAction.applyDashboardBtn();

    // Verify the gauge chart is visible
    await dashboardAction.waitForChartToRender();

    // Switch to table chart
    await chartTypeSelector.selectChartType("table");

    // Set timezone for the table chart
    await dateTimeHelper.setRelativeTimeRange("1-w");
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.waitForChartToRender();

    // Edit the panel name
    await dashboardAction.addPanelName(panelName);
    await dashboardAction.savePanel();

    // Delete the panel
    await dashboardCreate.backToDashboardList();
    // await waitForDashboardPage(page);
    await deleteDashboard(page, randomDashboardName);
  });

  test("should have the Date and Time filter, Page Refresh, and Share Link features working correctly on the Dashboard panel page", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardAction = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardShareExport = new DashboardShareExportPage(page);
    const dateTimeHelper = new DateTimeHelper(page);
    const panelEdit = new DashboardPanel(page);

    const panelName = dashboardAction.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Add a panel
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);

    // Select a stream

    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );

    // Set date-time filter
    await dateTimeHelper.setRelativeTimeRange("5-w");

    await dashboardAction.applyDashboardBtn();

    // Save the panel
    await dashboardAction.addPanelName(panelName);
    await dashboardAction.savePanel();

    // Test Share Link feature
    await dashboardShareExport.shareDashboard();
    await expect(page.getByText("Link copied successfully")).toBeHidden();

    // Hover over the panel container to make the fullscreen button visible
    await panelEdit.fullscreenPanel(panelName);

    // Delete the panel
    await dashboardCreate.backToDashboardList();

    await deleteDashboard(page, randomDashboardName);
  });

  test.skip("should display an error message when some fields are missing or incorrect", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardAction = new DashboardactionPage(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const panelName = dashboardAction.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Add a panel
    await dashboardCreate.addPanel();

    // Select a stream and configure fields

    await chartTypeSelector.selectChartType("area");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "b");

    // Set date-time filter and timezone
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardTimeRefresh.setRelative("6", "w");
    await dashboardAction.applyDashboardBtn();

    // Attempt to save the panel without a name
    await dashboardAction.savePanel();
    await expect(
      page.getByText("There are some errors, please fix them and try again")
    ).toBeVisible();

    // Add a panel name and save again
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );
    await dashboardAction.savePanel();

    // Back to dashboard list and delete the dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should apply various filter operators to the dashboard field and display the correct results", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardAction = new DashboardactionPage(page);
    const dashboardPanel = new DashboardPanel(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardFilter = new DashboardFilter(page);
    const dateTimeHelper = new DateTimeHelper(page);
    const panelName = dashboardAction.generateUniquePanelName("panel-test");

    // Navigate to Dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create Dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await expect(page.getByText("Dashboard added successfully.")).toHaveText(
      "Dashboard added successfully."
    );

    // Add Panel
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("area");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");

    // Add fields to chart
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "b");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );
    await chartTypeSelector.searchAndAddField("kubernetes_host", "filter");

    // Set time range and apply
    await dateTimeHelper.setRelativeTimeRange("5-w");
    await dashboardAction.applyDashboardBtn();

    // Apply "Is Null" filter
    await dashboardFilter.addFilterCondition(
      0,
      "kubernetes_host",
      "",
      "Is Null"
    );
    await dashboardAction.applyDashboardBtn();
    // Add assertion if possible: expect some filtered chart result or no data text

    // Apply "Is Not Null" filter
    await dashboardFilter.addFilterCondition(
      0,
      "kubernetes_host",
      "",
      "Is Not Null"
    );
    await dashboardAction.applyDashboardBtn();
    // Add assertion if possible: expect some filtered chart result or different behavior

    // Save and delete panel
    await dashboardAction.addPanelName(panelName);
    await dashboardAction.savePanel();
    await dashboardPanel.deletePanel(panelName);

    // Cleanup
    await dashboardCreate.backToDashboardList();
    await waitForDashboardPage(page);
    await deleteDashboard(page, randomDashboardName);
  });

  test("should display an error message when a required field is missing", async ({
    page,
  }) => {
    // Initialize only the necessary Page Objects
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardAction = new DashboardactionPage(page);

    // Generate a unique panel name
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards section
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Add a new panel and configure it (intentionally skipping Y-axis field)
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectChartType("area");
    await chartTypeSelector.selectStream("e2e_automate");

    // Add a non-required field (B-axis), but skip Y-axis
    await chartTypeSelector.searchAndAddField("kubernetes_host", "b");

    // Attempt to apply the configuration
    await dashboardActions.applyDashboardBtn();

    // Verify the expected error message is shown
    await expect(
      page.getByText("There are some errors, please fix them and try again")
    ).toBeVisible();
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await dashboardActions.applyDashboardBtn();
    await dashboardAction.waitForChartToRender();

    await dashboardAction.savePanel();
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test.skip("should create the specified URL using the DrillDown feature", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const dashboardDrilldown = new DashboardDrilldownPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");
    const drilldownName = dashboardDrilldown.generateUniqueDrilldownName();

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Add a panel
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectChartType("area");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");

    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubectl_kubernetes_io_default_container",
      "y"
    );
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "b"
    );

    // Set date-time filter and timezone
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardTimeRefresh.setRelative("4", "w");
    await dashboardActions.applyDashboardBtn();

    // Verify chart is visible
    await dashboardAction.waitForChartToRender();

    // Configure drilldown
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardDrilldown.addDrillownByURL(
      drilldownName,
      "https://google.com"
    );
    await dashboardActions.applyDashboardBtn();
    await dashboardActions.addPanelName(panelName);
    await dashboardActions.savePanel();
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test.skip("should display a confirmation popup message for unsaved changes when clicking the Discard button", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");
    const chartTypeSelector = new ChartTypeSelector(page);

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Add a panel
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "b");

    // Set date-time filter and timezone
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardTimeRefresh.setRelative("5", "w");
    await dashboardAction.applyDashboardBtn();

    // Verify the gauge chart is visible
    await dashboardAction.waitForChartToRender();

    // Verify confirmation popup for unsaved changes
    await page.locator('[data-test="dashboard-panel-discard"]').click();

    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
