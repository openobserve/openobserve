import { test, expect } from "../baseFixtures";
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { login } from "./utils/dashLogin.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
const testLogger = require('../utils/test-logger.js');

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
    // Apply chart and wait for API completion
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.chartTypeSelector.waitForTableDataLoad();

    // Store initial data (before transpose)
    const initialTableData = await captureTableData(page);

    // Open the configuration panel and toggle the transpose button
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectTranspose();

    // Apply transpose and wait for API completion
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.chartTypeSelector.waitForTableDataLoad();

    // Store transposed data after API completion
    const transposedTableData = await captureTableData(page);

    // Verify that transpose is working by checking structure differences
    verifyTransposeWorking(initialTableData, transposedTableData);

    // Helper function to capture table data
    async function captureTableData(page) {
      const headers = await page.$$eval(
        '[data-test="dashboard-panel-table"] thead tr th',
        (headerCells) =>
          headerCells.map((cell) =>
            cell.textContent.trim().replace(/^arrow_upward/, "")
          )
      );

      const data = await page.$$eval(
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

      return { headers, data };
    }

    // Helper function to verify transpose is working correctly
    function verifyTransposeWorking(initialData, transposedData) {
      // Verify that transposed data exists
      expect(transposedData.data.length).toBeGreaterThan(0);

      // Verify that initial data exists
      expect(initialData.data.length).toBeGreaterThan(0);
      expect(initialData.headers.length).toBeGreaterThan(1);

      // Verify structure change:
      // Initial: horizontal headers with data rows
      // Transposed: field names become first column, values become second column

      // Check that transposed data has the expected field name
      const expectedFieldName = initialData.headers.slice(1)[0]; // Get first data header (excluding first column)
      const transposedFieldNames = transposedData.data.map((row) => row[0]);

      expect(transposedFieldNames).toContain(expectedFieldName);

      // Verify that transpose actually changed the structure
      // Initial should have more columns, transposed should have 2 main columns
      expect(initialData.headers.length).toBeGreaterThanOrEqual(2);
      expect(transposedData.data[0].length).toBeGreaterThanOrEqual(2);
    }

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

    // Set up listener to catch console errors
    let errorMessage = "";
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errorMessage += msg.text() + "\n";
      }
    });

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

    // Assert no error occurred
    expect(errorMessage).toBe("");

    // Delete the created dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
