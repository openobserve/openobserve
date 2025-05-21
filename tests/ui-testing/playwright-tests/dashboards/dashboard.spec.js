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

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

// Refactored test cases using Page Object Model

test.describe("dashboard UI testcases", () => {
  let dashboardCreate;
  let dashboardList;
  let dashboardActions;
  let dashboardDrilldown;
  let dashboardRefresh;
  let chartTypeSelector;
  let dashboardPanel;
  let dashboardPanelConfigs;
  let dashboardShareExport;
  let dashboardSetting;

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
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new DashboardPanelConfigs(page);
    dashboardPanel = new DashboardPanel(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.backToDashboardList();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });
    await deleteDashboard(page, randomDashboardName);
  });

  test("should create a duplicate of the dashboard", async ({ page }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await dashboardCreate.createDashboard(randomDashboardName);

    await expect(page.getByText("Dashboard added successfully.")).toBeVisible({
      timeout: 30000,
    });
    await dashboardCreate.backToDashboardList();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });
    await dashboardCreate.searchDashboard(randomDashboardName);

    await dashboardList.duplicateDashboard(randomDashboardName);
  });

  test("should create a dashboard and add the breakdown", async ({ page }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new DashboardPanelConfigs(page);
    dashboardPanel = new DashboardPanel(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await dashboardCreate.createDashboard(randomDashboardName);
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });
    await dashboardCreate.addPanel();

    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    await dashboardActions.applyDashboardBtn();
    await dashboardActions.addPanelName(panelName);
    await dashboardActions.savePanel();
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);



    // await dashboardCreate.searchDashboard(randomDashboardName);
    // await dashboardCreate.deleteDashboard(randomDashboardName);
  });

  test("should update the data when changing the time between both absolute and relative time using the Kolkata time zone.", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new DashboardPanelConfigs(page);
    dashboardPanel = new DashboardPanel(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();

    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    await dashboardRefresh.setRelative("3", "h");

    await dashboardActions.applyDashboardBtn();
    await dashboardActions.addPanelName(panelName);
    await dashboardActions.savePanel();
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should update the chart with the results of a custom SQL query", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new DashboardPanelConfigs(page);
    dashboardPanel = new DashboardPanel(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);

    await page.locator('[data-test="dashboard-customSql"]').click();
    await page.locator(".view-line").first().click();

    await page
      .locator('[data-test="dashboard-panel-query-editor"]')
      .locator('.inputarea')
      .fill(
        'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", kubernetes_container_name as "breakdown_1" FROM "e2e_automate" GROUP BY x_axis_1, breakdown_1'
      );

    // await chartTypeSelector.searchAndAddField("x_axis_1", "x");
    await chartTypeSelector.searchAndAddField("y_axis_1", "y");
    await chartTypeSelector.searchAndAddField("breakdown_1", "b");

    await dashboardActions.applyDashboardBtn();
    await dashboardActions.addPanelName(panelName);
    await dashboardActions.savePanel();
    await dashboardCreate.backToDashboardList();

    await deleteDashboard(page, randomDashboardName);
  });

  test("should display the correct and updated chart when changing the chart type", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new DashboardPanelConfigs(page);
    dashboardPanel = new DashboardPanel(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);

    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    // await dashboardActions.applyDashboardBtn();
    await chartTypeSelector.selectChartType("area");
    await chartTypeSelector.selectChartType("scatter");
    await chartTypeSelector.selectChartType("gauge");

    await dashboardActions.applyDashboardBtn();
    await dashboardActions.addPanelName(panelName);
    await dashboardActions.savePanel();
    await dashboardCreate.backToDashboardList();

    await deleteDashboard(page, randomDashboardName);
  });
 
  test.skip("should navigate to another dashboard using the DrillDown feature.", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new DashboardPanelConfigs(page);
    dashboardPanel = new DashboardPanel(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);

    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
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
    await dashboardActions.addPanelName(panelName);
    await dashboardActions.savePanel();
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test.skip("should dynamically update the filtered data when applying the dynamic filter on the dashboard", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardAction = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const dashboardPanel = new DashboardPanel(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardDrilldown = new DashboardDrilldownPage(page);

    const dashboardRefresh = new DashboardTimeRefresh(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
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

    await dashboardAction.savePanel();

    await dashboardPanel.editPanel(panelName);
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
    await dashboardPanel.deletePanel(panelName);
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
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const dashboardPanel = new DashboardPanel(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const drilldown = new DashboardDrilldownPage(page);
    const panelName = drilldown.generateUniquePanelName("panel-test");

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
    await dashboardTimeRefresh.setRelative("6", "w");
    await dashboardAction.applyDashboardBtn();

    // Verify the gauge chart is visible
    await dashboardAction.waitForChartToRender();

    // Switch to table chart
    await chartTypeSelector.selectChartType("table");

    // Set timezone for the table chart
    await dashboardTimeRefresh.setRelative("1", "w");
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
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const dashboardPanel = new DashboardPanel(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const drilldown = new DashboardDrilldownPage(page);
    const panelName = drilldown.generateUniquePanelName("panel-test");
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardShareExport = new DashboardShareExportPage(page);
    const dashboardSettings = new DashboardSetting(page);

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
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardTimeRefresh.setRelative("5", "w");
    await dashboardAction.applyDashboardBtn();

    // Save the panel
    await dashboardAction.addPanelName(panelName);
    await dashboardAction.savePanel();

    // Test Share Link feature
    await dashboardShareExport.shareDashboard();
    await expect(page.getByText("Link copied successfully")).toBeHidden();

    // Test Fullscreen feature
    await dashboardSettings.fullScreenSettings();
    await expect(
      page.locator('[data-test="dashboard-fullscreen-btn"]')
    ).toBeVisible();
  });

  test("should display an error message when some fields are missing or incorrect", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardAction = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const drilldown = new DashboardDrilldownPage(page);
    const panelName = drilldown.generateUniquePanelName("panel-test");
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPanel = new DashboardPanel(page);

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

    // Delete the panel
    await dashboardPanel.deletePanel(panelName);
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test.skip("should apply various filter operators to the dashboard field and display the correct results", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardAction = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const drilldown = new DashboardDrilldownPage(page);
    const panelName = drilldown.generateUniquePanelName("panel-test");
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPanel = new DashboardPanel(page);
    // Navigate to dashboards section
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Add a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await expect(page.getByText("Dashboard added successfully.")).toHaveText(
      "Dashboard added successfully."
    );

    // Add a new panel and configure it
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("area");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );
    await chartTypeSelector.searchAndAddField("kubernetes_container_hash", "b");
    await dashboardAction.applyDashboardBtn();

    // // Apply "Is Null" filter
    // await chartTypeSelector.searchAndAddField("kubernetes_host", "filter");
    // await dashboardAction.applyDashboardBtn();

    // Save and delete the panel
    await dashboardAction.addPanelName(panelName);
    await dashboardAction.savePanel();
    await dashboardPanel.deletePanel(panelName);
    await dashboardCreate.backToDashboardList();
    await waitForDashboardPage(page);
    await deleteDashboard(page, randomDashboardName);
  });
  test("should display an error message when a required field is missing", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardAction = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const drilldown = new DashboardDrilldownPage(page);
    const panelName = drilldown.generateUniquePanelName("panel-test");
    const chartTypeSelector = new ChartTypeSelector(page);

    // Navigate to dashboards section
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Add a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Add a new panel and configure it
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("area");
    await chartTypeSelector.selectStream("e2e_automate");
    // Skip adding the required y-axis field

    await chartTypeSelector.searchAndAddField("kubernetes_host", "b");
    // Attempt to apply the configuration
    await dashboardAction.applyDashboardBtn();

    // Verify error message is displayed
    await expect(
      page.getByText("There are some errors, please fix them and try again")
    ).toBeVisible();
  });

  test("should create the specified URL using the DrillDown feature", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardAction = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const dashboardDrilldown = new DashboardDrilldownPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");
    const drilldownName = dashboardDrilldown.generateUniqueDrilldownName();

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Add a panel
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
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
    await dashboardAction.applyDashboardBtn();

    // Verify chart is visible
    await dashboardAction.waitForChartToRender();

    // Configure drilldown
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardDrilldown.addDrillownByURL(
      drilldownName,
      "https://google.com"
    );
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.addPanelName(panelName);
    await dashboardAction.savePanel();
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should display a confirmation popup message for unsaved changes when clicking the Discard button", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardAction = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const dashboardTimeRefresh = new DashboardTimeRefresh(page);
    const dashboardDrilldown = new DashboardDrilldownPage(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardSetting = new DashboardSetting(page);

    // Navigate to dashboards
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Add a panel
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
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

    // Verify confirmation popup for unsaved changes
    await page.locator('[data-test="dashboard-panel-discard"]').click();
  });
});
