import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "../utils/dashLogin.js";
import { ingestion } from "../utils/dashIngestion.js";
import { waitForDateTimeButtonToBeEnabled } from "./dashboard.utils";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions";
import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "../utils/dashCreation.js";
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

  test("should create, compare area type chart image and delete dashboard", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");
    const dashboardName = randomDashboardName;

    // Navigate to the dashboard list page
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a dashboard
    await dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);

    // Select the stream and chart type
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.selectChartType("area");

    // Add a field to the chart
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubectl_kubernetes_io_default_container",
      "y"
    );

    // Apply the changes
    await page.locator('[data-test="dashboard-apply"]').waitFor({
      state: "visible",
    });
    await dashboardActions.applyDashboardBtn();
    await waitForDateTimeButtonToBeEnabled(page);

    // Save the chart image
    await page
      .locator('[data-test="chart-renderer"]')
      .waitFor({ state: "visible" });
    await page.screenshot({
      path: `playwright-tests/dashboard-snaps/areachart-screenshot.png`,
      selector: '[data-test="chart-renderer"]',
    });

    // Save the panel
    await dashboardActions.savePanel();

    // Delete the dashboard
    await dashboardCreate.backToDashboardList();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });
    await deleteDashboard(page, dashboardName);
  });
});

