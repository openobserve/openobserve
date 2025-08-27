import { test, expect } from "../baseFixtures";
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { login } from "./utils/dashLogin.js";
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

  test.skip("should display the correct data before and after transposing in the table chart", async ({
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

    // Validate data consistency before and after transpose
    await validateTableDataBeforeAndAfterTranspose(page);

    // Helper function to validate table data before and after transposing
    async function validateTableDataBeforeAndAfterTranspose(page) {
      // Step 1: Wait for table to load and capture headers and initial data
      await page.waitForSelector('[data-test="dashboard-panel-table"]', {
        timeout: 10000,
      });
      await page.waitForTimeout(2000); // Allow table to fully render

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

      console.log("Initial headers:", headers);
      console.log("Initial data:", initialData);

      // Step 2: Perform transpose by simulating the transpose button click
      await page
        .locator('[data-test="dashboard-config-table_transpose"] div')
        .nth(2)
        .click();
      await page.locator('[data-test="dashboard-apply"]').click();

      // Step 3: Wait for table to re-render after transpose and capture transposed data
      await page.waitForTimeout(3000); // Wait for table to re-render

      // Check if table exists after transpose
      const tableExists =
        (await page.locator('[data-test="dashboard-panel-table"]').count()) > 0;
      console.log("Table exists after transpose:", tableExists);

      let transposedData = [];
      if (tableExists) {
        // Try to capture both thead and tbody rows for transposed table
        transposedData = await page.$$eval(
          '[data-test="dashboard-panel-table"] tbody tr',
          (rows) =>
            rows
              .map((row) =>
                Array.from(row.querySelectorAll("td"), (cell) =>
                  cell.textContent.trim()
                )
              )
              .filter(
                (row) => row.length > 0 && row.some((cell) => cell !== "")
              )
        );

        // If tbody doesn't have data, try to get all table rows
        if (transposedData.length === 0) {
          transposedData = await page.$$eval(
            '[data-test="dashboard-panel-table"] tr',
            (rows) =>
              rows
                .map((row) =>
                  Array.from(row.querySelectorAll("td"), (cell) =>
                    cell.textContent.trim()
                  )
                )
                .filter(
                  (row) => row.length > 0 && row.some((cell) => cell !== "")
                )
          );
        }
      }

      console.log("Transposed data:", transposedData);

      // Step 4: Flatten `initialData` by pairing each header with its value, excluding the first column
      const flattenedInitialData = headers
        .slice(1)
        .map((namespace, index) => [
          namespace,
          initialData[0] ? initialData[0][index + 1] : "",
        ]);

      console.log("Flattened initial data:", flattenedInitialData);

      // Step 5: Sort both arrays for comparison (only if transposedData is not empty)
      if (transposedData.length > 0) {
        const sortedFlattenedInitialData = flattenedInitialData.sort((a, b) =>
          a[0].localeCompare(b[0])
        );
        const sortedTransposedData = transposedData.sort((a, b) =>
          a[0].localeCompare(b[0])
        );

        console.log(
          "Sorted flattened initial data:",
          sortedFlattenedInitialData
        );
        console.log("Sorted transposed data:", sortedTransposedData);

        // Step 6: Compare sorted arrays
        expect(sortedTransposedData).toEqual(sortedFlattenedInitialData);
      } else {
        // If no transposed data captured, log the table structure for debugging
        const tableHTML = await page
          .locator('[data-test="dashboard-panel-table"]')
          .innerHTML();
        console.log("Table HTML after transpose:", tableHTML);

        // Try alternative approach - check if table structure changed
        const allTableCells = await page.$$eval(
          '[data-test="dashboard-panel-table"] *',
          (elements) =>
            elements.map((el) => ({
              tag: el.tagName,
              text: el.textContent?.trim(),
            }))
        );
        console.log("All table elements:", allTableCells);

        throw new Error(
          "No transposed data captured. Check table structure after transpose."
        );
      }
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
