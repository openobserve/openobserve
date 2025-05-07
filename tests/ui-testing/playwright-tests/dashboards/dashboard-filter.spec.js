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
import { DashboardPage } from "../../pages/dashboardPage";

test.describe.configure({ mode: "parallel" });

test.describe("dashboard filter testcases", () => {
  let dashboardCreate;
  let dashboardSetting;
  let dashboardAction;
  let dashboardList;
  let chartTypeSelector;
  let dateTimeHelper;
  let dashboardPanelConfigs;
  let dashboardPanel;
  let dashboardTimeRefresh;
  let dashboardFolder;
  let dashboardDrilldown;
  let dashboardPage;

  const generateDashboardName = (prefix = "Dashboard") =>
    `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

  test.beforeEach(async ({ page }) => {
    dashboardCreate = new DashboardCreate(page);
    dashboardSetting = new DashboardSetting(page);
    dashboardAction = new DashboardactionPage(page);
    dashboardList = new DashboardListPage(page);
    chartTypeSelector = new ChartTypeSelector(page);
    dateTimeHelper = new DateTimeHelper(page);
    dashboardPanelConfigs = new DashboardPanelConfigs(page);
    dashboardPanel = new DashboardPanel(page);
    dashboardTimeRefresh = new DashboardTimeRefresh(page);
    dashboardFolder = new DashboardFolder(page);
    dashboardDrilldown = new DashboardDrilldownPage(page);
    dashboardPage = new DashboardPage(page);

    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
  });

  test("should correctly apply the filter conditions with different operators", async ({ page }) => {
    const randomDashboardName = generateDashboardName();
    const panelName = dashboardDrilldown.generateUniquePanelName("Test_Panel");
    
    await dashboardList.menuItem("dashboards-item");
    await page.locator('[data-test="dashboard-folder-tab-default"]').waitFor({ state: "visible" });
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("line");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
    await dateTimeHelper.setRelativeTimeRange("6-w");
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.addPanelName(panelName);
    await dashboardAction.savePanel();
    await dashboardPanel.editPanel(panelName);
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectQueryLimit("100");
    await dashboardPanelConfigs.selectNoValueReplace("-");
    await dashboardPanelConfigs.selectLineThickness("2");
    await dashboardPanelConfigs.selectLineInterpolation("smooth");
    await dashboardPanelConfigs.selectValuePosition("Inside Top");
    await dashboardPanelConfigs.selectValueRotate("45");
    await dashboardPanelConfigs.selectSymbols("Yes");
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
  });

  test("should create a folder, add a dashboard, and delete the folder", async ({ page }) => {
    const randomDashboardName = generateDashboardName();
    const folderName = dashboardFolder.generateUniqueFolderName("Test_Folder");

    await dashboardList.menuItem("dashboards-item");
    await dashboardFolder.createFolder(folderName);
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardFolder.deleteFolder(folderName);
  });

  test("should add a drilldown to a dashboard", async ({ page }) => {
    const randomDashboardName = generateDashboardName();
    const drilldownName = dashboardDrilldown.generateUniqueDrilldownName("Drilldown");
    const panelName = dashboardDrilldown.generateUniquePanelName("Test_Panel");
    const folderName = "default";
    const tabName = "Default";

    await dashboardList.menuItem("dashboards-item");
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await chartTypeSelector.selectChartType("stacked");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardDrilldown.addDrillownDashboard(folderName, drilldownName, randomDashboardName, tabName);
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.addPanelName(panelName);
  });

  test("should duplicate a dashboard and verify duplication", async ({ page }) => {
    const randomDashboardName = generateDashboardName();

    await dashboardList.menuItem("dashboards-item");
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.searchDashboard(randomDashboardName);
    await dashboardList.duplicateDashboard(randomDashboardName);
    await expect(page.getByText("Dashboard Duplicated")).toBeVisible();
  });

  test("should move a dashboard to another folder", async ({ page }) => {
    const randomDashboardName = generateDashboardName();
    const folderName = dashboardFolder.generateUniqueFolderName("TargetFolder");

    await dashboardList.menuItem("dashboards-item");
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.backToDashboardList();
    await dashboardCreate.searchDashboard(randomDashboardName);
    await dashboardList.moveDashnboardToanotherFolder("testing");
    await expect(page.getByText("Dashboard moved successfully")).toBeVisible();
  });

  test("should refresh a dashboard and verify data update", async ({ page }) => {
    const randomDashboardName = generateDashboardName();
    const panelName = dashboardDrilldown.generateUniquePanelName("Test_Panel");

    await dashboardList.menuItem("dashboards-item");
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("stacked");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await dashboardAction.applyDashboardBtn();
    await dashboardTimeRefresh.refreshDashboard();
    await expect(page.getByText("Dashboard refreshed successfully").first()).toBeVisible();
  });

  test("should edit a dashboard panel and verify changes", async ({ page }) => {
    const randomDashboardName = generateDashboardName();
    const panelName = dashboardDrilldown.generateUniquePanelName("Test_Panel");

    await dashboardList.menuItem("dashboards-item");
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("stacked");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
    await dashboardPanel.editPanel(panelName);
    await chartTypeSelector.selectChartType("line");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("count", "y");
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
    await expect(page.getByText("Panel updated successfully").first()).toBeVisible();
  });

  test("add panel to dashboard", async ({ page }) => {
    const randomDashboardName = generateDashboardName();
    const panelName = dashboardDrilldown.generateUniquePanelName("Test_Panel");

    await dashboardList.menuItem("dashboards-item");
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("bar");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await dashboardAction.applyDashboardBtn();
    await dashboardAction.savePanel();
  });
});
