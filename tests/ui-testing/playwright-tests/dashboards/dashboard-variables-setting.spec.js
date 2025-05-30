import { test, expect } from "../baseFixtures";
import { login } from "../utils/dashLogin";
import { ingestion } from "../utils/dashIngestion";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardSetting from "../../pages/dashboardPages/dashboard-settings";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart";
import DateTimeHelper from "../../pages/dashboardPages/dashboard-time";
import DashboardPanelConfigs from "../../pages/dashboardPages/dashboard-panel-configs";
import DashboardPanel from "../../pages/dashboardPages/dashboard-panel-edit";
import DashboardTimeRefresh from "../../pages/dashboardPages/dashboard-refresh";
import DashboardFolder from "../../pages/dashboardPages/dashboard-folder";
import DashboardDrilldownPage from "../../pages/dashboardPages/dashboard-drilldown";
import { waitForDashboardPage } from "../utils/dashCreation.js";
const dashboardName = `Dashboard_${Date.now()}`;

test.describe.configure({ mode: "parallel" });

test.describe("dashboard filter testcases", () => {
  let dashboardCreate;
  let dashboardList;
  let dashboardActions;
  let dashboardRefresh;
  let chartTypeSelector;
  let dashboardDrilldown;
  let dashboardPanel;
  let dashboardPanelConfigs;
  let dashboardAction;
  let dashboardSetting;

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
  });

  test("should try to open variables, click add variable, and without saving close it ", async ({
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
    dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );
    await dashboardSetting.cancelVariable();
  });

  // query values test cases
  test("should add query_values to dashboard and save it", async ({ page }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardPanel = new DashboardPanel(page);
    dashboardAction = new DashboardactionPage(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);
    dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    // await dashboardSetting.addTypeofVaribale("Query Values");
    await dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );
    await dashboardSetting.saveVariable();
  });

  test("should add max records size, check toggle of multi select, and save it", async ({
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
    dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    await dashboardSetting.addMaxRecord("2");
    await dashboardSetting.enableMultiSelect();
    await dashboardSetting.saveVariable();
    await dashboardSetting.closeSettingWindow();
  });

  test("should verify that by default select is working", async ({ page }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardActions = new DashboardactionPage(page);
    dashboardRefresh = new DashboardTimeRefresh(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardPanel = new DashboardPanel(page);
    dashboardAction = new DashboardactionPage(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);
    dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();
    const value = "ingress-nginx";

    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    await dashboardSetting.addMaxRecord("2");
    // await dashboardSetting.enableMultiSelect();
    // await dashboardSetting.addCustomValue();
    await dashboardSetting.addCustomValue(value);
    await dashboardSetting.saveVariable();
  });
  test("should verify that hide on query_values variable dashboard is working", async ({
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
    dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    await dashboardSetting.addMaxRecord("2");
    await dashboardSetting.hideVariable();
  });
  test("should verify constant variable by adding and verify that its visible on dashboard", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.selectConstantType(
      "Constant",
      variableName,
      "ingress-nginx"
    );
    await dashboardSetting.saveVariable();
    await dashboardSetting.closeSettingWindow();
  });
  test("should verify that hide on constant variable dashboard is working", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardSetting = new DashboardSetting(page);
    dashboardList = new DashboardListPage(page);
    const variableName = dashboardSetting.variableName();
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.selectConstantType(
      "Constant",
      variableName,
      "ingress-nginx"
    );
    await dashboardSetting.hideVariable();
    await dashboardSetting.saveVariable();
    await page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await dashboardSetting.closeSettingWindow();
  });
  test("should verify textbox variable by adding and verify that its visible on dashboard", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.selectTextType("TextBox", variableName);
    await dashboardSetting.saveVariable();
    await page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await dashboardSetting.closeSettingWindow();
  });
  test("should verify that hide on textbox variable dashboard is working", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.selectTextType("TextBox", variableName);
    await dashboardSetting.hideVariable();
    await dashboardSetting.saveVariable();
    await page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await dashboardSetting.closeSettingWindow();
    await expect(
      page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    ).toBeVisible();
  });
  test("should verify custom variables by adding and its visible on dashboard", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.selectCustomType(
      "Custom",
      variableName,
      "ingress-nginx",
      "ingress-nginx"
    );

    await dashboardSetting.saveVariable();
    await page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await dashboardSetting.closeSettingWindow();
    await expect(
      page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    ).toBeVisible();
  });
  test("should verify that multi select is working properly", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.selectCustomType(
      "Custom",
      variableName,
      "ingress-nginx",
      "ingress-nginx"
    );
    await dashboardSetting.enableMultiSelect();
    await dashboardSetting.saveVariable();
    await page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await dashboardSetting.closeSettingWindow();
    await expect(
      page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    ).toBeVisible();
  });
  test("should verify that hide on custom variable dashboard is working", async ({
    page,
  }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardList = new DashboardListPage(page);
    dashboardSetting = new DashboardSetting(page);
    const variableName = dashboardSetting.variableName();
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(dashboardName);
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .waitFor({
        state: "visible",
      });
    await dashboardSetting.openSetting();
    await dashboardSetting.openVariables();
    await dashboardSetting.selectCustomType(
      "Custom",
      variableName,
      "ingress-nginx",
      "ingress-nginx"
    );
    await dashboardSetting.hideVariable();
    await dashboardSetting.saveVariable();
    await page
      .locator('[data-test="dashboard-variable-add-btn"]')
      .waitFor({ state: "visible" });
    await dashboardSetting.closeSettingWindow();
    await expect(
      page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
    ).toBeVisible();
  });
});
