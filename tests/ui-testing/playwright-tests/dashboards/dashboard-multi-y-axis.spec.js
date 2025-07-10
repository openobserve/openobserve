import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "../utils/dashLogin.js";
import { ingestion } from "../utils/dashIngestion.js";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "../utils/dashCreation.js";
import DashboardPanel from "../../pages/dashboardPages/dashboard-panel-edit.js";
import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart.js";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list.js";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create.js";
import DateTimeHelper from "../../pages/dashboardPages/dashboard-time.js";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard multi y axis testcases", () => {
  test.beforeEach(async ({ page }) => {
    console.log("running before each");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    // Navigate to the organization-specific logs URL
    const orgNavigation = page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await orgNavigation;
  });

  test("Should correctly add multiple Y-axes to the stacked chart type.", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardPageActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dateTimeHelper = new DateTimeHelper(page);

    // Generate a unique panel name
    const panelName =
      dashboardPageActions.generateUniquePanelName("Test_Panel");
    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Add a new panel and configure it
    await dashboardCreate.addPanel();
    await chartTypeSelector.selectChartType("stacked");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_labels_name", "b");

    // Set the relative time range
    await dateTimeHelper.setRelativeTimeRange("6-w");

    // Apply the configuration and wait for the chart to render
    await dashboardPageActions.applyDashboardBtn();
    await dashboardPageActions.waitForChartToRender();

    // Open the query inspector and verify the SQL query
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1", count(kubernetes_container_name) as "y_axis_2", kubernetes_labels_name as "breakdown_1" FROM "e2e_automate" GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC',
        })
        .first()
    ).toBeVisible();

    // Close the query inspector
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    // Add the panel name and save the panel
    await dashboardPageActions.addPanelName(panelName);
    await dashboardPageActions.savePanel();

    // Go back to the dashboard list and delete the created dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should correctly display and update multiple Y-axes in edit panel.", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardPageActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPanel = new DashboardPanel(page);
    const dateTimeHelper = new DateTimeHelper(page);
    const panelName =
      dashboardPageActions.generateUniquePanelName("Test_Panel");

    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Add a new panel and configure it
    await dashboardCreate.addPanel();
    await chartTypeSelector.selectChartType("stacked");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_labels_name", "b");

    // Set the relative time range
    await dateTimeHelper.setRelativeTimeRange("6-w");

    // Apply the configuration and wait for the chart to render
    await dashboardPageActions.applyDashboardBtn();
    await dashboardPageActions.waitForChartToRender();

    // Open the query inspector and verify the SQL query
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1", count(kubernetes_container_name) as "y_axis_2", kubernetes_labels_name as "breakdown_1" FROM "e2e_automate" GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC',
        })
        .first()
    ).toBeVisible();

    // Close the query inspector
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    // Edit the panel to add another field to Y-axis
    await dashboardPageActions.addPanelName(panelName);
    await dashboardPageActions.savePanel();
    await dashboardPanel.editPanel(panelName);
    await chartTypeSelector.searchAndAddField("kubernetes_labels_name", "y");

    // Apply the updated configuration and wait for the chart to render
    await dashboardPageActions.applyDashboardBtn();
    await dashboardPageActions.waitForChartToRender();

    // Add the panel name and save the panel
    await dashboardPageActions.addPanelName(panelName);
    await dashboardPageActions.savePanel();

    // Go back to the dashboard list and delete the created dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });
});
