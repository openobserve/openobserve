import { test, expect } from "../baseFixtures";
import PageManager from "../../pages/dashboardPages/page-manager.js";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions";
import DashboardPanelConfigs from "../../pages/dashboardPages/dashboard-panel-configs";
import { ingestion } from "./utils/dashIngestion.js";
import { login } from "./utils/dashLogin.js";
import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "./utils/dashCreation.js";

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
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    // const pm.dashboardCreate = new DashboardCreate(page);
    // const pm.dashboardList = new DashboardListPage(page);
    // const pm.chartTypeSelector = new ChartTypeSelector(page);
    // const pm.dashboardPanelActions = new DashboardactionPage(page);
    // const pm.dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "y"
    );
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Open the configuration panel and toggle the transpose button
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectTranspose();
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Save the panel
    await pm.dashboardPanelActions.savePanel();

    // Delete the created dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should display the correct data before and after transposing in the table chart", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "y"
    );
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Open the configuration panel and toggle the transpose button
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectTranspose();
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Save the panel
    await pm.dashboardPanelActions.savePanel();

    // Delete the created dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should verify that when dynamic columns are enabled, the VRL function should display correctly", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "x"
    );
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");

    // Open the configuration panel and enable dynamic columns
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectDynamicColumns();
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Save the panel
    await pm.dashboardPanelActions.savePanel();

    // Delete the created dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should not show an error when both the Transpose and Dynamic Column toggle buttons are enabled", async ({
    page,
  }) => {
     // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);

    // Create a new dashboard and add a panel
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "x"
    );
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");

    // Open the configuration panel and enable both the Transpose and Dynamic Column toggle buttons
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectTranspose();
    await pm.dashboardPanelConfigs.selectDynamicColumns();
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Save the panel
    await pm.dashboardPanelActions.savePanel();

    // Delete the created dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
