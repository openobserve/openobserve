import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
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

const dashboardName = `Dashboard_${Date.now()}`;

test.describe("dashboard UI testcases", () => {
  let dashboardCreate;
  let dashboardList;
  let dashboardActions;
  let dashboardRefresh;
  let chartTypeSelector;
  let dashboardDrilldown;
  let dashboardPanel;

  test.beforeEach(async ({ page }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardPanel = new DashboardPanel(page);

    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("should add the breakdown field to the dashboard panel and allow the user to cancel the action", async ({
    page,
  }) => {
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");

    await page
      .locator('[data-test="menu-link-\\/dashboards-item"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();

    await page
      .locator('[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });
    await dashboardCreate.createDashboard(dashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);

    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "y"
    );
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "b"
    );
    await chartTypeSelector.removeField("kubernetes_container_image", "b");

    await dashboardActions.applyDashboardBtn();
    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardRefresh.setRelative("4", "w");
    await dashboardActions.applyDashboardBtn();

    await dashboardActions.savePanel();
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });
    await dashboardPanel.deletePanel(panelName);

    await dashboardCreate.backToDashboardList();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });
    // await dashboardCreate.searchDashboard(dashboardName);
    // await dashboardCreate.deleteDashboard(dashboardName);
    // await page.waitForTimeout(5000);
  });

  test("should add and cancel the breakdown field with different times and timezones and ensure it displays the correct output", async ({
    page,
  }) => {
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");

    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();

    await page
      .locator('[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });
    await dashboardCreate.createDashboard(dashboardName);
    await dashboardCreate.addPanel();

    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_image",
      "y"
    );
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "b");
    // await chartTypeSelector.removeField("kubernetes_container_name", "b");

    await waitForDateTimeButtonToBeEnabled(page);
    await dashboardRefresh.setRelative("6", "w");
    await dashboardActions.applyDashboardBtn();
    await chartTypeSelector.removeField("kubernetes_container_name", "b");

    await dashboardActions.applyDashboardBtn();
    await dashboardActions.addPanelName(panelName);
    await dashboardActions.savePanel();
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({
      state: "visible",
    });
    await dashboardPanel.deletePanel(panelName);
    await dashboardCreate.backToDashboardList();
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({
      state: "visible",
    });
    await dashboardCreate.searchDashboard(dashboardName);
    await dashboardCreate.deleteDashboard(dashboardName);
    await page.waitForTimeout(5000);
  });
});
