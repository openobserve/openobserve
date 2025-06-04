import { test, expect } from "../baseFixtures";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions";
import DashboardPanelConfigs from "../../pages/dashboardPages/dashboard-panel-configs";
import { ingestion } from "../utils/dashIngestion";
import { login } from "../utils/dashLogin";
import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "../utils/dashCreation.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).slice(2, 11);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard UI testcases", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);

    await ingestion(page);
  });

  test("should verify that the transpose toggle button is working correctly", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardAction = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("table");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await dashboardAction.applyDashboardBtn();

    // Open the configuration panel and toggle the transpose button
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectTranspose();
    await dashboardAction.applyDashboardBtn();

    // Save the panel
    await dashboardAction.savePanel();

    // Delete the created dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should display the correct data before and after transposing in the table chart", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardAction = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("table");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await dashboardAction.applyDashboardBtn();

    // Open the configuration panel and toggle the transpose button
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectTranspose();
    await dashboardAction.applyDashboardBtn();

    // Save the panel
    await dashboardAction.savePanel();

    // Delete the created dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should verify that when dynamic columns are enabled, the VRL function should display correctly", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardAction = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("table");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
    await chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");

    // Open the configuration panel and enable dynamic columns
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectDynamicColumns();
    await dashboardAction.applyDashboardBtn();

    // Save the panel
    await dashboardAction.savePanel();

    // Delete the created dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should not show an error when both the Transpose and Dynamic Column toggle buttons are enabled", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const dashboardActions = new DashboardactionPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardAction = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Create a new dashboard and add a panel
    await dashboardCreate.addPanel();
    await dashboardAction.addPanelName(panelName);
    await chartTypeSelector.selectChartType("table");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
    await chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");

    // Open the configuration panel and enable both the Transpose and Dynamic Column toggle buttons
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectTranspose();
    await dashboardPanelConfigs.selectDynamicColumns();
    await dashboardAction.applyDashboardBtn();

    // Save the panel
    await dashboardAction.savePanel();

    // Delete the created dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
