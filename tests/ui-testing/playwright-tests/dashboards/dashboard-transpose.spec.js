import { test, expect } from "../baseFixtures";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions";
import DashboardPanelConfigs from "../../pages/dashboardPages/dashboard-panel-configs";
import DashboardPanel from "../../pages/dashboardPages/dashboard-panel-edit";
import DashboardTimeRefresh from "../../pages/dashboardPages/dashboard-refresh";
import { ingestion } from "../utils/dashIngestion";
import { login } from "../utils/dashLogin";
import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart";
import DashboardDrilldownPage from "../../pages/dashboardPages/dashboard-drilldown";
import { waitForDashboardPage } from "../utils/dashCreation.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).slice(2, 11);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard UI testcases", () => {
  let dashboardCreate;
  let dashboardList;
  let dashboardActions;
  let dashboardRefresh;
  let chartTypeSelector;
  let dashboardDrilldown;
  let dashboardPanel;
  let dashboardPanelConfigs;
  let dashboardAction;

  test.beforeEach(async ({ page }) => {
    await login(page);

    await ingestion(page);
  });

  test("should verify that the transpose toggle button is working correctly", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardPanel = new DashboardPanel(page);
    dashboardAction = new DashboardactionPage(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("table");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await dashboardAction.applyDashboardBtn();
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectTranspose();
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
  });

  test("should display the correct data before and after transposing in the table chart", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardPanel = new DashboardPanel(page);
    dashboardAction = new DashboardactionPage(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("table");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await dashboardAction.applyDashboardBtn();
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectTranspose();
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
  });

  test("should verify that when dynamic columns are enabled, the VRL function should display correctly", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardPanel = new DashboardPanel(page);
    dashboardAction = new DashboardactionPage(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);
    await page.locator('[data-test="dashboard-add-submit"]').click();

    // Add panel to the dashboard
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .click();
    await page
      .locator("label")
      .filter({ hasText: "Streamarrow_drop_down" })
      .locator("i")
      .click();
    await page.getByRole("option", { name: "e2e_automate" }).click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_docker_id"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="dashboard-apply"]').click();
    await page.locator('[data-test="dashboard-sidebar"]').click();
    await page.locator('[data-test="selected-chart-table-item"] img').click();
    await page
      .locator('[data-test="dashboard-config-table_dynamic_columns"] div')
      .nth(2)
      .click();
    await page
      .locator('[data-test="logs-search-bar-show-query-toggle-btn"] div')
      .nth(2)
      .click();
    await page
      .locator(
        "#fnEditor > .monaco-editor > .overflow-guard > div:nth-child(2) > .lines-content > .view-lines > .view-line"
      )
      .click();
    await page
      .locator('[data-test="dashboard-vrl-function-editor"]')
      .locator(".inputarea")
      .fill(".vrl=100");

    await page.waitForTimeout(2000);

    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectDynamicColumns();
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
  });

  test("should not show an error when both the Transpose and Dynamic Column toggle buttons are enabled", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardPanel = new DashboardPanel(page);
    dashboardAction = new DashboardactionPage(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardDrilldown.generateUniquePanelName("panel-test");

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("table");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "firstcolumn"
    );
    await chartTypeSelector.searchAndAddField(
      "kubernetes_pod_name",
      "othercolumn"
    );
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectTranspose();
    await dashboardPanelConfigs.selectDynamicColumns();
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
  });
});
