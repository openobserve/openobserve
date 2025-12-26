import { test, expect } from "../baseFixtures.js";
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import PageManager from "../../pages/page-manager";
const testLogger = require('../utils/test-logger.js');

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard multi y axis testcases", () => {
  test.beforeEach(async ({ page }) => {
    testLogger.debug("Test setup - beforeEach hook executing");
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
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Generate a unique panel name
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("Test_Panel");
    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Add a new panel and configure it
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("stacked");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_namespace_name",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField("kubernetes_labels_name", "b");

    // Set the relative time range
    await pm.dateTimeHelper.setRelativeTimeRange("30-m");

    // Apply the configuration and wait for the chart to render
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open the query inspector and verify the SQL query
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    await page.waitForTimeout(1000);
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
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Go back to the dashboard list and delete the created dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should correctly display and update multiple Y-axes in edit panel.", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("Test_Panel");

    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Add a new panel and configure it
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("stacked");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_namespace_name",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "y"
    );
    await pm.chartTypeSelector.searchAndAddField("kubernetes_labels_name", "b");

    // Set the relative time range
    await pm.dateTimeHelper.setRelativeTimeRange("30-m");

    // Apply the configuration and wait for the chart to render
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

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
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardPanelEdit.editPanel(panelName);
    await pm.chartTypeSelector.searchAndAddField("kubernetes_labels_name", "y");

    // Apply the updated configuration and wait for the chart to render
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Add the panel name and save the panel
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Go back to the dashboard list and delete the created dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });
});
