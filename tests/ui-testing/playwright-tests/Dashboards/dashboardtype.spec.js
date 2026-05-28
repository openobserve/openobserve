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

  test("should create, compare area type chart image and delete dashboard", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");
    const dashboardName = randomDashboardName;

    // Navigate to the dashboard list page
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel to the dashboard
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select the stream and chart type
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.selectChartType("area");

    // Add a field to the chart
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubectl_kubernetes_io_default_container",
      "y"
    );

    // Apply the changes
    await pm.dashboardPanelActions.waitForApplyVisible();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await waitForDateTimeButtonToBeEnabled(page);

    // Save the chart image
    await pm.dashboardPanelActions.waitForChartRendererVisible();
    await pm.dashboardPanelActions.takeChartRendererScreenshot(
      `playwright-tests/Dashboards/dashboard-snaps/areachart-screenshot.png`
    );

    // Save the panel
    await pm.dashboardPanelActions.savePanel();

    // Delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.waitForDefaultFolderTabVisible();
    await deleteDashboard(page, dashboardName);
  });
});
