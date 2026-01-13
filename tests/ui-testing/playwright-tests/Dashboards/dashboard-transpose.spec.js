const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { waitForStreamComplete, waitForTableWithData } from "../utils/streaming-helpers.js";
const testLogger = require('../utils/test-logger.js');

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).slice(2, 11);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard UI testcases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);

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

    // Wait for dashboard UI to be fully stable
    await pm.dashboardCreate.waitForDashboardUIStable();

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

     // Wait for dashboard UI to be fully stable
     await pm.dashboardCreate.waitForDashboardUIStable();

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

    // Apply chart and wait for streaming to complete
    const initialStreamPromise = waitForStreamComplete(page);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await initialStreamPromise;
    await pm.chartTypeSelector.waitForTableDataLoad();

    // Wait for table to have data before capturing
    await waitForTableWithData(page);

    // Store initial data (before transpose)
    const initialTableData = await captureTableData(page);

    // Open the configuration panel and toggle the transpose button
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectTranspose();

    // Apply transpose and wait for streaming to complete
    const transposedStreamPromise = waitForStreamComplete(page);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await transposedStreamPromise;
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.chartTypeSelector.waitForTableDataLoad();

    // Wait for table to have data before capturing
    await waitForTableWithData(page);

    // Store transposed data after rendering is complete
    const transposedTableData = await captureTableData(page);

    // Verify that transpose is working by checking structure differences
    verifyTransposeWorking(initialTableData, transposedTableData);

    // Helper function to capture table data
    async function captureTableData(page) {
      const headers = await page.$$eval(
        '[data-test="dashboard-panel-table"] thead tr th',
        (headerCells) =>
          headerCells.map((cell) =>
            cell.textContent.trim().replace(/^arrow_upward/, "").replace(/content_copy/g, '').trim()
          )
      );

      const data = await page.$$eval(
        '[data-test="dashboard-panel-table"] tbody tr',
        (rows) =>
          rows
            .map((row) =>
              Array.from(row.querySelectorAll("td"), (cell) => {
                // Get the span element that contains the actual text, excluding the button
                const textSpan = cell.querySelector('span.q-mr-xs');
                return textSpan ? textSpan.textContent.trim() : cell.textContent.trim().replace(/content_copy/g, '').trim();
              })
            )
            .filter((row) => row.length > 0 && row.some((cell) => cell !== ""))
      );

      // Log captured data for debugging
      testLogger.info(`Captured ${data.length} rows with ${headers.length} headers`);
      if (data.length > 0) {
        testLogger.info(`First row has ${data[0].length} cells`);
      }

      return { headers, data };
    }

    // Helper function to verify transpose is working correctly
    function verifyTransposeWorking(initialData, transposedData) {
      // Log data for debugging
      testLogger.info(`Initial data: ${initialData.data.length} rows, ${initialData.headers.length} headers`);
      testLogger.info(`Initial headers: ${JSON.stringify(initialData.headers)}`);
      testLogger.info(`Transposed data: ${transposedData.data.length} rows`);
      testLogger.info(`Transposed headers: ${JSON.stringify(transposedData.headers)}`);

      if (transposedData.data.length > 0) {
        testLogger.info(`Transposed first row has ${transposedData.data[0].length} cells: ${JSON.stringify(transposedData.data[0])}`);
      }

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

      testLogger.info(`Expected field name: ${expectedFieldName}`);
      testLogger.info(`Transposed field names: ${JSON.stringify(transposedFieldNames)}`);

      expect(transposedFieldNames).toContain(expectedFieldName);

      // Verify that transpose actually changed the structure
      // Initial should have more columns, transposed should have 2 main columns
      expect(initialData.headers.length).toBeGreaterThanOrEqual(2);

      // Verify first row has at least 2 cells
      if (!transposedData.data[0] || transposedData.data[0].length < 2) {
        testLogger.error(`Transposed table first row issue:`);
        testLogger.error(`  - First row exists: ${!!transposedData.data[0]}`);
        testLogger.error(`  - First row length: ${transposedData.data[0]?.length || 0}`);
        testLogger.error(`  - First row content: ${JSON.stringify(transposedData.data[0] || [])}`);
        testLogger.error(`  - All transposed data: ${JSON.stringify(transposedData.data)}`);
      }

      expect(transposedData.data[0]).toBeDefined();
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

     // Wait for dashboard UI to be fully stable
     await pm.dashboardCreate.waitForDashboardUIStable();

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

     // Wait for dashboard UI to be fully stable
     await pm.dashboardCreate.waitForDashboardUIStable();
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

  test("should not show an error when transpose is enabled from config with custom SQL query", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

    // Navigate to the dashboards list
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

     // Wait for dashboard UI to be fully stable
     await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard and add a panel
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select table chart type
    await pm.chartTypeSelector.selectChartType("table");
    
    // Now we can access the field removal buttons
    await pm.chartTypeSelector.removeField("x_axis_1", "x");

    // Open Custom SQL editor
    await page.locator('[data-test="dashboard-sql-query-type"]').click();
    await page.locator('[data-test="dashboard-custom-query-type"]').click();

    // Focus on the editor and enter the custom SQL query
    await page.locator(".view-line").first().click();
    await page
      .locator('[data-test="dashboard-panel-query-editor"]')
      .locator(".monaco-editor")
      .click();
    await page
      .locator('[data-test="dashboard-panel-query-editor"]')
      .locator(".inputarea")
      .fill(
        'SELECT kubernetes_namespace_name as "xAxis", count(kubernetes_namespace_name) as "y_axis_1"  FROM "e2e_automate"  GROUP BY "xAxis"'
      );

    await pm.chartTypeSelector.searchAndAddField("y_axis_1", "x");
    await pm.chartTypeSelector.searchAndAddField("xAxis", "y");
    
    // Set relative time range  
     await pm.dashboardTimeRefresh.setRelative("30", "m");    

    await pm.dashboardPanelActions.waitForChartToRender();

    // Open the configuration panel and enable transpose
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectTranspose();
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Wait for chart to render after transpose and check for errors
    await pm.dashboardPanelActions.waitForChartToRender();

    // await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Check for dashboard errors ONLY after transpose is applied
    const transposeErrorResult = await pm.logsVisualise.checkDashboardErrors(
      page,
      "Table (After Transpose)"
    );

    if (transposeErrorResult.hasErrors) {
      transposeErrorResult.errors.forEach((error, index) => {
      testLogger.error(`Transpose Error ${index + 1}: ${error}`);});

      // Fail the test with detailed error information
      expect(transposeErrorResult.errorTextCount).toBe(0);
      expect(transposeErrorResult.errorListCount).toBe(0);
    }

    // Save the panel
    await pm.dashboardPanelActions.savePanel();
    // Delete the created dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
