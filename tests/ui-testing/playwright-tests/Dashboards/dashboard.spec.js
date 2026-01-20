const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import PageManager from "../../pages/page-manager";
import { waitForStreamComplete, waitForTableWithData } from "../utils/streaming-helpers.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

// Refactored test cases using Page Object Model

test.describe("dashboard UI testcases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });
  test("should add and delete the dashboard", async ({ page }) => {
    const pm = new PageManager(page);

    // Navigate to the dashboard list
    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    //create a new dashboard and delete it
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    await pm.dashboardCreate.backToDashboardList();

    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    await deleteDashboard(page, randomDashboardName);
  });

  test("should create a duplicate of the dashboard", async ({ page }) => {
    // Initialize Page Objects
    const pm = new PageManager(page);

    //navigate to the dashboard list
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    //create a new dashboard and duplicate it
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    await expect(page.getByText("Dashboard added successfully.")).toBeVisible({
      timeout: 30000,
    });
    await pm.dashboardCreate.backToDashboardList();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });

    // Search for the created dashboard
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await pm.dashboardList.duplicateDashboard(randomDashboardName);

    //Name of the duplicate dashboard

    const duplicateDashboardName = randomDashboardName + " -" + " Copy";

    // search dupliacte dashboard with its randomDashboardName +- Copy is added to the dashboard name
    await pm.dashboardCreate.searchDashboard(duplicateDashboardName);

    // Delete the duplicate dashboard and original dashboard
    await pm.dashboardList.deleteDuplicateDashboard(duplicateDashboardName);
    await pm.dashboardCreate.searchDashboard(randomDashboardName);
    await deleteDashboard(page, randomDashboardName);
  });

  test("should create a dashboard and add the breakdown", async ({ page }) => {
    // Initialize Page Objects
    const pm = new PageManager(page);

    // Generate a unique panel name
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboard list
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Wait for dashboard tab to be visible
    await page.locator('[data-test="dashboard-tab-default"]').waitFor({
      state: "visible",
    });

    // Add a new panel
    await pm.dashboardCreate.addPanel();

    // Select stream and breakdown fields
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    // Apply panel changes
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Return to dashboard list
    await pm.dashboardCreate.backToDashboardList();

    // Clean up: delete created dashboard
    await deleteDashboard(page, randomDashboardName);
  });

  test("should update the data when changing the time between both absolute and relative time using the Kolkata time zone.", async ({
    page,
  }) => {
    // Initialize only the used Page Objects
    const pm = new PageManager(page);

    // Generate a unique panel name
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Add a new panel
    await pm.dashboardCreate.addPanel();

    // Configure the chart
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    // Set time to relative (e.g., last 3 hours)
    await pm.dashboardTimeRefresh.setRelative("3", "h");

    // Apply and save the panel
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Return to dashboard list
    await pm.dashboardCreate.backToDashboardList();

    // Clean up: delete created dashboard
    await deleteDashboard(page, randomDashboardName);
  });

  test("should update the chart with the results of a custom SQL query", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    // Generate unique panel name
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to Dashboards page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Open Custom SQL editor
    await page.locator('[data-test="dashboard-sql-query-type"]').click();
    await page.locator('[data-test="dashboard-custom-query-type"]').click();
    // await page.locator(".cm-line").first().click();

    // Focus on the first line of the editor
    await page.locator(".view-line").first().click();
    await page
      .locator('[data-test="dashboard-panel-query-editor"]')
      .locator(".monaco-editor")
      .click();
    await page
      .locator('[data-test="dashboard-panel-query-editor"]')
      .locator(".inputarea")
      .fill(
        'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", kubernetes_container_name as "breakdown_1" FROM "e2e_automate" GROUP BY x_axis_1, breakdown_1'
      );

    // Map query results to chart axes
    await pm.chartTypeSelector.searchAndAddField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField("breakdown_1", "b");

    // Apply and save the panel
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Return to dashboard list and clean up
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should display the correct and updated chart when changing the chart type", async ({
    page,
  }) => {
    // Initialize Page Objects
    const pm = new PageManager(page);

    // Generate a unique panel name
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select stream and add fields to chart
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );

    // Change chart types
    await pm.chartTypeSelector.selectChartType("area");
    await pm.chartTypeSelector.selectChartType("scatter");
    await pm.chartTypeSelector.selectChartType("gauge");

    // Apply and save the panel
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();

    // Return to dashboards list
    await pm.dashboardCreate.backToDashboardList();

    // Clean up: delete the created dashboard
    await deleteDashboard(page, randomDashboardName);
  });

  test("should navigate to another dashboard using the DrillDown feature.", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();

    // Select chart type and stream
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_labels_app_kubernetes_io_component",
      "b"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_labels_app_kubernetes_io_instance",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_labels_app_kubernetes_io_managed_by",
      "y"
    );

    await pm.dashboardPanelActions.applyDashboardBtn();

    // Add drilldown to another dashboard
    const drilldownName = pm.dashboardDrilldown.generateUniqueDrilldownName();
    const folderName = "default";
    const tabName = "Default";
    const dashboardName = randomDashboardName;
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardDrilldown.addDrilldownDashboard(
      folderName,
      drilldownName,
      dashboardName,
      tabName
    );

    await pm.dashboardPanelActions.applyDashboardBtn();

    // Save the panel
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();

    //Delete the created dashboard
    await deleteDashboard(page, randomDashboardName);
  });

  test("should dynamically update the filtered data when applying the dynamic filter on the dashboard", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select chart type and stream
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );

    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "b"
    );

    await pm.dashboardPanelActions.applyDashboardBtn();

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
    await pm.dashboardTimeRefresh.setRelative("3", "h");

    await pm.dashboardPanelActions.savePanel();

    await pm.dashboardPanelEdit.editPanel(panelName);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardPanelEdit.deletePanel(panelName);

    // Return to dashboard list and delete the created dashboard
    await pm.dashboardCreate.backToDashboardList();
    await waitForDashboardPage(page);
    await deleteDashboard(page, randomDashboardName);
  });

  test("should create and save the dashboard with different relative times and timezones on both the Gauge and Table charts", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");
    // const dateTimeHelper = new DateTimeHelper(page);

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();

    // Select gauge chart
    await pm.chartTypeSelector.selectChartType("gauge");

    // Select a stream
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );

    // Set date-time and timezone for gauge chart
    await pm.dateTimeHelper.setRelativeTimeRange("15-m");
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Verify the gauge chart is visible
    await pm.dashboardPanelActions.waitForChartToRender();

    // Switch to table chart
    await pm.chartTypeSelector.selectChartType("table");

    // Set timezone for the table chart
    await pm.dateTimeHelper.setRelativeTimeRange("15-m");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Edit the panel name
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Delete the panel
    await pm.dashboardCreate.backToDashboardList();
    // await waitForDashboardPage(page);
    await deleteDashboard(page, randomDashboardName);
  });

  test("should have the Date and Time filter, Page Refresh, and Share Link features working correctly on the Dashboard panel page", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Add a panel
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select a stream

    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );

    // Set date-time filter
    await pm.dateTimeHelper.setRelativeTimeRange("15-m");

    await pm.dashboardPanelActions.applyDashboardBtn();

    // Save the panel
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Test Share Link feature
    await pm.dashboardShareExport.shareDashboard();
    await expect(page.getByText("Link copied successfully")).toBeHidden();

    // Hover over the panel container to make the fullscreen button visible
    await pm.dashboardPanelEdit.fullscreenPanel(panelName);

    // Delete the panel
    await pm.dashboardCreate.backToDashboardList();

    await deleteDashboard(page, randomDashboardName);
  });

  test("should display an error message when some fields are missing or incorrect", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Add a panel
    await pm.dashboardCreate.addPanel();

    // Select a stream and configure fields

    await pm.chartTypeSelector.selectChartType("area");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "b"
    );

    // Set date-time filter and timezone
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Attempt to save the panel without a name
    await pm.dashboardPanelActions.savePanel();
    await expect(
      page.getByText("There are some errors, please fix them and try again")
    ).toBeVisible();

    // Add a panel name and save again
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );
    await pm.dashboardPanelActions.savePanel();

    // Back to dashboard list and delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should apply various filter operators to the dashboard field and display the correct results", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to Dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create Dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await expect(page.getByText("Dashboard added successfully.")).toHaveText(
      "Dashboard added successfully."
    );

    // Add Panel
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("area");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Add fields to chart
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "b"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "filter");

    // Set time range and apply
    await pm.dateTimeHelper.setRelativeTimeRange("15-m");
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Apply "Is Null" filter
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_host",
      "",
      "Is Null",
      ""
    );
    await pm.dashboardPanelActions.applyDashboardBtn();
    // Add assertion if possible: expect some filtered chart result or no data text

    // Apply "Is Not Null" filter
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_host",
      "",
      "Is Not Null",
      ""
    );
    await pm.dashboardPanelActions.applyDashboardBtn();
    // Add assertion if possible: expect some filtered chart result or different behavior

    // Save and delete panel
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardPanelEdit.deletePanel(panelName);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // await waitForDashboardPage(page);
    await deleteDashboard(page, randomDashboardName);
  });

  test("should display an error message when a required field is missing", async ({
    page,
  }) => {
    // Initialize only the necessary Page Objects
    const pm = new PageManager(page);

    // Generate a unique panel name
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards section
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Add a new panel and configure it (intentionally skipping Y-axis field)
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("area");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Add a non-required field (B-axis), but skip Y-axis
    await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "b");

    // Attempt to apply the configuration
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Verify the expected error message is shown
    await expect(
      page.getByText("There are some errors, please fix them and try again")
    ).toBeVisible();
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "y"
    );
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should display a confirmation popup message for unsaved changes when clicking the Discard button", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");
    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Add a panel
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_hash",
      "b"
    );

    // Set date-time filter and timezone
    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("5", "w");
    // await pm.dashboardPanelActions.applyDashboardBtn();

    // Verify the gauge chart is visible
    await pm.dashboardPanelActions.waitForChartToRender();
    await page.locator('[data-test="dashboard-panel-discard"]').click();

    // Listen for the dialog and assert its message
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await pm.dashboardList.menuItem("logs-item");

    // await page.getByRole("button", { name: "Cancel" }).click();
  });
  test("should update the chart correctly when used camel case in custom sql query", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to dashboards and create new dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Configure table chart with custom SQL using camelCase aliases
    await pm.chartTypeSelector.removeField("x_axis_1", "x");
    await pm.chartTypeSelector.selectChartType("table");

    await page.locator('[data-test="dashboard-sql-query-type"]').click();
    await page.locator('[data-test="dashboard-custom-query-type"]').click();    
    await page.locator(".view-line").first().click();
    await page
      .locator('[data-test="dashboard-panel-query-editor"] .inputarea')
      .fill(
        'SELECT histogram(_timestamp) as xAxis1, count(_timestamp) as yAxis1, kubernetes_container_name as breakdown1 FROM "e2e_automate" GROUP BY xAxis1, breakdown1'
      );

    await pm.chartTypeSelector.searchAndAddField("xAxis1", "x");
    await pm.chartTypeSelector.searchAndAddField("yAxis1", "y");
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Verify table data is loaded correctly
    await page.waitForSelector('[data-test="dashboard-panel-table"]', {
      state: "visible",
      timeout: 10000,
    });

    const dataRows = page.locator(
      '[data-test="dashboard-panel-table"] tbody.q-virtual-scroll__content tr.cursor-pointer'
    );
    await dataRows.first().waitFor({ state: "visible", timeout: 15000 });

    expect(await dataRows.count()).toBeGreaterThan(0);
    await expect(dataRows.first().locator("td.q-td").first()).not.toHaveText(
      ""
    );
    await expect(dataRows.first().locator("td.q-td").nth(1)).not.toHaveText("");
    await expect(page.locator('[data-test="no-data"]')).not.toBeVisible();

    // Save panel and cleanup
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
  test("should update the line chart correctly when used camel case in custom sql query", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("line-panel-test");

    // Navigate to dashboards and create new dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Configure line chart with custom SQL using camelCase aliases
    await pm.chartTypeSelector.removeField("x_axis_1", "x");
    await pm.chartTypeSelector.selectChartType("line");

    await page.locator('[data-test="dashboard-sql-query-type"]').click();
    await page.locator('[data-test="dashboard-custom-query-type"]').click();    
    await page.locator(".view-line").first().click();
    await page
      .locator('[data-test="dashboard-panel-query-editor"] .inputarea')
      .fill(
        'SELECT histogram(_timestamp) as xAxis1, count(_timestamp) as yAxis1, kubernetes_container_name as breakdown1 FROM "e2e_automate" GROUP BY xAxis1, breakdown1'
      );

    await pm.chartTypeSelector.searchAndAddField("xAxis1", "x");
    await pm.chartTypeSelector.searchAndAddField("yAxis1", "y");

    // Apply chart and wait for streaming to complete
    const streamPromise = waitForStreamComplete(page);
    const initialStreamPromise = pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await streamPromise;
    await initialStreamPromise;

    // Verify line chart data is rendered correctly
    await page.waitForSelector('[data-test="chart-renderer"]', {
      state: "visible",
      timeout: 10000,
    });

    await page.waitForFunction(
      () => {
        const chartElement = document.querySelector(
          '[data-test="chart-renderer"]'
        );
        return chartElement && chartElement.hasAttribute("_echarts_instance_");
      },
      { timeout: 15000 }
    );

    // Wait for canvas elements to be rendered
    await page.waitForSelector('[data-test="chart-renderer"] canvas', {
      state: "attached",
      timeout: 15000,
    });

    // Validate chart is properly rendered
    const chartContainer = page.locator('[data-test="chart-renderer"]');
    const boundingBox = await chartContainer.boundingBox();
    const canvasCount = await page
      .locator('[data-test="chart-renderer"] canvas')
      .count();

    // Enhanced validation: Check for meaningful data rendering
    // ECharts may use 1 or more canvas elements depending on configuration
    expect(canvasCount).toBeGreaterThanOrEqual(1); // Should have at least 1 canvas element
    expect(boundingBox.width).toBeGreaterThan(100); // Reasonable width
    expect(boundingBox.height).toBeGreaterThan(50); // Reasonable height (not the tiny 38px no-data case)
    await expect(page.locator('[data-test="no-data"]')).not.toBeVisible();

    // Verify canvas has visual content
    const canvasHasContent = await page.evaluate(() => {
      const canvas = document.querySelector(
        '[data-test="chart-renderer"] canvas'
      );
      if (!canvas) return false;

      const ctx = canvas.getContext("2d");
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      for (let i = 3; i < imageData.data.length; i += 4) {
        if (imageData.data[i] > 0) return true;
      }
      return false;
    });

    expect(canvasHasContent).toBe(true);

    // Save panel and cleanup
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("Should update the line chart correctly when using camelCase fields that contain zero values", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("complex-case-panel-test");

    // Navigate to dashboards and create new dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Configure line chart with custom SQL using complex CASE WHEN statements
    await pm.chartTypeSelector.removeField("x_axis_1", "x");
    await pm.chartTypeSelector.selectChartType("line");

    await page.locator('[data-test="dashboard-sql-query-type"]').click();
    await page.locator('[data-test="dashboard-custom-query-type"]').click();    
    
    await page.locator(".view-line").first().click();
    await page
      .locator('[data-test="dashboard-panel-query-editor"] .inputarea')
      .fill(
        `SELECT histogram(_timestamp, '5 minute') AS "_time",
       COUNT(CASE WHEN kubernetes_namespace_name = 'ziox' AND kubernetes_container_name LIKE '4%' THEN 1 END) AS "4xxErrorCount",
       COUNT(CASE WHEN kubernetes_namespace_name = 'ziox' AND kubernetes_container_name LIKE 'tes%' THEN 1 END) AS "5xxErrorCount",
       COUNT(CASE WHEN kubernetes_namespace_name = 'ziox' AND kubernetes_pod_id IS NULL THEN 1 END) AS "NullErrorCount",
       COUNT(CASE WHEN kubernetes_container_name = 'prometheus' THEN 1 END) AS "pageViewCount"
FROM e2e_automate
GROUP BY _time
ORDER BY _time ASC`
      );

    await pm.chartTypeSelector.searchAndAddField("_time", "x");
    await pm.chartTypeSelector.searchAndAddField("4xxErrorCount", "y");
    await pm.chartTypeSelector.searchAndAddField("5xxErrorCount", "y");
    await pm.chartTypeSelector.searchAndAddField("NullErrorCount", "y");
    await pm.chartTypeSelector.searchAndAddField("pageViewCount", "y");

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("5", "w");

    // Wait for streaming to complete before checking chart
    const streamPromise = waitForStreamComplete(page);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await streamPromise;

    // Wait for chart to render
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify line chart data is rendered correctly
    await page.waitForSelector('[data-test="chart-renderer"]', {
      state: "visible",
      timeout: 10000,
    });

    await page.waitForFunction(
      () => {
        const chartElement = document.querySelector(
          '[data-test="chart-renderer"]'
        );
        return chartElement && chartElement.hasAttribute("_echarts_instance_");
      },
      { timeout: 15000 }
    );

    // Wait for canvas elements to be rendered with data
    await page.waitForFunction(
      () => {
        const canvases = document.querySelectorAll('[data-test="chart-renderer"] canvas');
        return canvases.length >= 2;
      },
      { timeout: 15000, polling: 500 }
    );

    // Validate chart is properly rendered
    const chartContainer = page.locator('[data-test="chart-renderer"]');
    const boundingBox = await chartContainer.boundingBox();
    const canvasCount = await page
      .locator('[data-test="chart-renderer"] canvas')
      .count();

    // Enhanced validation: Check for meaningful data rendering
    // ECharts may use 1 or more canvas elements depending on configuration
    expect(canvasCount).toBeGreaterThanOrEqual(1); // Should have at least 1 canvas element
    expect(boundingBox.width).toBeGreaterThan(100); // Reasonable width
    expect(boundingBox.height).toBeGreaterThan(50); // Reasonable height (not the tiny 38px no-data case)
    await expect(page.locator('[data-test="no-data"]')).not.toBeVisible();

    // Verify canvas has visual content
    const canvasHasContent = await page.evaluate(() => {
      const canvas = document.querySelector(
        '[data-test="chart-renderer"] canvas'
      );
      if (!canvas) return false;

      const ctx = canvas.getContext("2d");
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      for (let i = 3; i < imageData.data.length; i += 4) {
        if (imageData.data[i] > 0) return true;
      }
      return false;
    });

    expect(canvasHasContent).toBe(true);

    // Save panel and cleanup
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

});
