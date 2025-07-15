import { test, expect } from "../baseFixtures";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions";
import DashboardPanelConfigs from "../../pages/dashboardPages/dashboard-panel-configs";
import { ingestion } from "./utils/dashIngestion.js";
import { login } from "./utils/dashLogin.js";
import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

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
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectChartType("table");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await dashboardActions.applyDashboardBtn();

    // Open the configuration panel and toggle the transpose button
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectTranspose();
    await dashboardActions.applyDashboardBtn();

    // Save the panel
    await dashboardActions.savePanel();

    // Delete the created dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should display the correct data before and after transposing in the table chart", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectChartType("table");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await dashboardActions.applyDashboardBtn();

    // Open the configuration panel and toggle the transpose button
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectTranspose();
    await dashboardActions.applyDashboardBtn();

    await page.waitForTimeout(2000);
    // Validate data consistency before and after transpose
    await validateTableDataBeforeAndAfterTranspose(page);

    // Helper function to validate table data before and after transposing
    // Helper function to dynamically transpose data and validate it
    async function validateTableDataBeforeAndAfterTranspose(page) {
      // Step 1: Capture headers and initial data from the table
      const headers = await page.$$eval(
        '[data-test="dashboard-panel-table"] thead tr th',
        (headerCells) =>
          headerCells.map((cell) =>
            cell.textContent.trim().replace(/^arrow_upward/, "")
          ) // Remove "arrow_upward" prefix
      );

      const initialData = await page.$$eval(
        '[data-test="dashboard-panel-table"] tbody tr',
        (rows) =>
          rows
            .map((row) =>
              Array.from(row.querySelectorAll("td"), (cell) =>
                cell.textContent.trim()
              )
            )
            .filter((row) => row.length > 0 && row.some((cell) => cell !== ""))
      );

      // Step 2: Perform transpose by simulating the transpose button click
      await page
        .locator('[data-test="dashboard-config-table_transpose"] div')
        .nth(2)
        .click();
      await page.locator('[data-test="dashboard-apply"]').click();
      await page.waitForTimeout(2000);

      // Step 3: Capture transposed data from the table
      const transposedData = await page.$$eval(
        '[data-test="dashboard-panel-table"] tr',
        (rows) =>
          rows
            .map((row) =>
              Array.from(row.querySelectorAll("td"), (cell) =>
                cell.textContent.trim()
              )
            )
            .filter((row) => row.length > 0 && row.some((cell) => cell !== ""))
      );

      // Step 4: Flatten `initialData` by pairing each namespace header with its value, excluding the empty namespace
      const flattenedInitialData = headers
        .slice(1)
        .map((namespace, index) => [namespace, initialData[0][index + 1]]);

      // Step 5: Sort both `flattenedInitialData` and `transposedData` for comparison
      const sortedFlattenedInitialData = flattenedInitialData.sort((a, b) =>
        a[0].localeCompare(b[0])
      );
      const sortedTransposedData = transposedData.sort((a, b) =>
        a[0].localeCompare(b[0])
      );

      // Step 6: Directly compare sorted arrays
      expect(sortedTransposedData).toEqual(sortedFlattenedInitialData);
    }

    // Save the panel
    await dashboardActions.savePanel();

    // Delete the created dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should verify that when dynamic columns are enabled, the VRL function should display correctly", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add a panel
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectChartType("table");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
    await chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");

    // Open the configuration panel and enable dynamic columns
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectDynamicColumns();
    await dashboardActions.applyDashboardBtn();

    // Save the panel
    await dashboardActions.savePanel();

    // Delete the created dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should not show an error when both the Transpose and Dynamic Column toggle buttons are enabled", async ({
    page,
  }) => {
    const dashboardCreate = new DashboardCreate(page);
    const dashboardList = new DashboardListPage(page);
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardActions = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);
    const panelName = dashboardActions.generateUniquePanelName("panel-test");

    // Set up listener to catch console errors
    let errorMessage = "";
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errorMessage += msg.text() + "\n";
      }
    });

    // Navigate to the dashboards list
    await dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    // Create a new dashboard and add a panel
    await dashboardCreate.addPanel();
    await dashboardActions.addPanelName(panelName);
    await chartTypeSelector.selectChartType("table");
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("e2e_automate");
    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
    await chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");

    // Open the configuration panel and enable both the Transpose and Dynamic Column toggle buttons
    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectTranspose();
    await dashboardPanelConfigs.selectDynamicColumns();
    await dashboardActions.applyDashboardBtn();

    // Save the panel
    await dashboardActions.savePanel();

    // Assert no error occurred
    expect(errorMessage).toBe("");

    // Delete the created dashboard
    await dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
