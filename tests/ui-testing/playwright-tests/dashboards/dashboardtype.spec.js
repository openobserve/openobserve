import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "../utils/dashLogin.js";
import { ingestion } from "../utils/dashIngestion.js";
import { waitForDashboardPage } from "../utils/dashCreation.js";
import { waitForDateTimeButtonToBeEnabled } from "./dashboard.utils";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions";
import DashboardDrilldownPage from "../../pages/dashboardPages/dashboard-drilldown";
import DashboardTimeRefresh from "../../pages/dashboardPages/dashboard-refresh";
import DashboardPanelConfigs from "../../pages/dashboardPages/dashboard-panel-configs";
import DashboardPanel from "../../pages/dashboardPages/dashboard-panel-edit";
import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart";
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
    const dashboardName = randomDashboardName;

    await page
      .locator('[data-test="menu-link-\\/dashboards-item"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    

    await page
      .locator('[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });

    await dashboardCreate.createDashboard(dashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.selectChartType("area");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubectl_kubernetes_io_default_container",
      "y"
    );
    await page.locator('[data-test="dashboard-apply"]').waitFor({
      state: "visible",
    });
    await dashboardActions.applyDashboardBtn();
    await waitForDateTimeButtonToBeEnabled(page);

    await page
      .locator('[data-test="chart-renderer"]')
      .waitFor({ state: "visible" });
    await page.screenshot({
      path: `playwright-tests/dashboard-snaps/areachart-screenshot.png`,
      selector: '[data-test="chart-renderer"]',
    });

    // await dashboardActions.addPanelName("sanitydash");
    await dashboardActions.applyDashboardBtn();
    await dashboardActions.savePanel();
    // await dashboardActions.selectPanelAction("sanitydash", "Delete");
    await dashboardCreate.backToDashboardList();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });
    await dashboardCreate.searchDashboard(dashboardName);
    await dashboardList.duplicateDashboard(dashboardName);
    await dashboardCreate.deleteDashboard(dashboardName);
  });
});
