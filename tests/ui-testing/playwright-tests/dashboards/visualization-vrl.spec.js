import { test, expect } from "../baseFixtures";
import LogsVisualise from "../../pages/dashboardPages/visualise";
import { login } from "../utils/dashLogin";
import { ingestion } from "../utils/dashIngestion";
import logData from "../../cypress/fixtures/log.json";

test.describe.configure({ mode: "parallel" });
const selectStreamAndStreamTypeForLogs = async (page, stream) => {
  await page.waitForTimeout(4000);
  await page
    .locator('[data-test="log-search-index-list-select-stream"]')
    .click({ force: true });
  await page.locator("div.q-item").getByText(`${stream}`).first().click();
};

test.describe("visualization VRL testcases", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );

    const logsVisualise = new LogsVisualise(page);

    await selectStreamAndStreamTypeForLogs(page, logData.Stream);
    await logsVisualise.logsApplyQueryButton();
  });


  test("should allow adding a VRL function in the visualization chart", async ({
    page,
  }) => {
    // Setup
    const logsVisualise = new LogsVisualise(page);

    await logsVisualise.setRelative("4", "d");

    await logsVisualise.logsApplyQueryButton();

    // Open visualise tab and add Vrl
    await logsVisualise.openVisualiseTab();
    await logsVisualise.vrlFunctionEditor(".VRL=1000");
    await page.waitForTimeout(1000);
    await logsVisualise.runQueryAndWaitForCompletion();

    // Add VRL field to the chart
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-b-data"]'
      )
      .click();

    // Wait for query to complete
    await logsVisualise.runQueryAndWaitForCompletion();

    // Check if VRL field is visible
    const vrlField = page.locator(
      '[data-test="field-list-item-logs-e2e_automate-vrl"]'
    );

    await vrlField.waitFor({ state: "visible", timeout: 5000 });

    await expect(vrlField).toBeVisible();
  });



  test.skip('should display an error message when the VRL field is not updated after closing the "Toggle function editor"', async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);

    // Set relative date and time
    await logsVisualise.setRelative("6", "d");
    await logsVisualise.logsApplyQueryButton();

    // Open visualise tab and add VRL field to the chart
    await logsVisualise.openVisualiseTab();

    // Add 'kubernetes_annotations_kubernetes_io_psp' field to the chart
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]'
      )
      .click();

    // Open the VRL function editor and add VRL function
    await logsVisualise.vrlFunctionEditor(".vrL=1000");
    await page.waitForTimeout(1000);

    // Run the query and wait for completion
    await logsVisualise.runQueryAndWaitForCompletion();

  

    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-y-data"]'
    //   )
    //   .waitFor({ state: "visible" });
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-y-data"]'
      )
      .click();

    // Run the query and wait for completion
    await logsVisualise.runQueryAndWaitForCompletion;

    // Show query toggle
    await logsVisualise.showQueryToggle();

    // Run the query and wait for completion
    await logsVisualise.runQueryAndWaitForCompletion;

    // Remove VRL field from the chart
    await page.locator('[data-test="dashboard-y-item-vrl-remove"]').click();

    // Run the query and wait for completion
    await logsVisualise.runQueryAndWaitForCompletion;
  });



  test("should not show an error when adding a VRL function field to the Breakdown, X axis, or Y axis fields", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);

    // Set a relative time range and apply the query
    await logsVisualise.setRelative("6", "d");

    await logsVisualise.logsApplyQueryButton();

    // Open the Visualise tab and enter a VRL function
    await logsVisualise.openVisualiseTab();

    await logsVisualise.vrlFunctionEditor(".VRL=1000");

    await page.waitForTimeout(1000);

    // Run the query and wait for completion
    await logsVisualise.runQueryAndWaitForCompletion();

    // Add the VRL field to the Breakdown and Y axis fields
    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-b-data"]'
    //   )
    //   .waitFor({ state: "visible" });
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-b-data"]'
      )
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await logsVisualise.runQueryAndWaitForCompletion();

    // Remove the existing X axis field and add the VRL field to the X axis
    await page
      .locator('[data-test="dashboard-x-item-_timestamp-remove"]')
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-x-data"]'
      )
      .click();
    await logsVisualise.runQueryAndWaitForCompletion();

    // Verify that the VRL field is visible in the Breakdown, Y axis, and X axis
    const breakdownField = await page
      .locator('[data-test="dashboard-b-item-vrl"]')
      .isVisible();

    const yAxisField = await page
      .locator('[data-test="dashboard-y-item-vrl"]')
      .isVisible();

    const xAxisField = await page
      .locator('[data-test="dashboard-x-item-vrl"]')
      .isVisible();

    expect(breakdownField).toBe(true);
    expect(yAxisField).toBe(true);
    expect(xAxisField).toBe(true);
  });


  test("should display an error message if an invalid VRL function is added", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);

    // Set a relative time range and apply the query
    await logsVisualise.setRelative("6", "d");
    await logsVisualise.logsApplyQueryButton();

    // Open the Visualise tab
    await logsVisualise.openVisualiseTab();

    // Add the fields
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await logsVisualise.runQueryAndWaitForCompletion();

    // Enter an invalid VRL function (".vrl=11abc") and apply
    await logsVisualise.vrlFunctionEditor(".vrl=11abc");
    await page.waitForTimeout(1000);
    await logsVisualise.runQueryAndWaitForCompletion();


    // Enter a valid VRL function
    await logsVisualise.vrlFunctionEditor(".vrl=123");
    await page.waitForTimeout(1000);
    await logsVisualise.runQueryAndWaitForCompletion();

    // Add the 'vrl' field to the chart
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await logsVisualise.runQueryAndWaitForCompletion();
  });


  test("should not update the search query when adding or updating a VRL field", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);

    // Set a relative time range and apply the query
    await logsVisualise.setRelative("6", "d");
    await logsVisualise.logsApplyQueryButton();

    // Open the Visualise tab and enable SQL mode
    await logsVisualise.openVisualiseTab();
    await logsVisualise.enableSQLMode();

    // Set a new relative time range and apply the query
    await logsVisualise.setRelative("6", "w");
    await logsVisualise.runQueryAndWaitForCompletion();
    await logsVisualise.openVisualiseTab();

    // Expect the search query to still be the same
    await expect(
      page
        .locator('[data-test="logs-search-bar-query-editor"]')
        .getByText('SELECT * FROM "e2e_automate"')
    ).toBeVisible();

    // Enter a valid VRL function and apply it
    await logsVisualise.vrlFunctionEditor(".vrl=100");
    await page.waitForTimeout(1000);
    await logsVisualise.runQueryAndWaitForCompletion();

    // Add the 'vrl' field to the chart and apply
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await logsVisualise.runQueryAndWaitForCompletion();

    // Expect the search query to still be the same
    await expect(
      page
        .locator('[data-test="logs-search-bar-query-editor"]')
        .getByText('SELECT * FROM "e2e_automate"')
    ).toBeVisible();
  });


  test.skip("should display an error if the VRL field is not updated from the Breakdown", async ({
    page,

   
  }) => {
    const logsVisualise = new LogsVisualise(page);
    // Set a relative time range and apply the query
    await logsVisualise.setRelative("6", "d");
    await logsVisualise.logsApplyQueryButton();

    // Open the Visualise tab and enter a valid VRL function and apply
    await logsVisualise.openVisualiseTab();
    await page.waitForTimeout(1000);
    await logsVisualise.vrlFunctionEditor(".vrlsanity=100");
    await logsVisualise.applyQueryButtonVisualise();

    // Wait for the VRL field to be added to the Breakdown
    await page.waitForTimeout(3000);

    // Add the 'vrlsanity' field to the Breakdown
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrlsanity"] [data-test="dashboard-add-b-data"]'
      )
      .click();

    // Apply the query again
    await logsVisualise.applyQueryButtonVisualise();

     await page
      .locator("div")
      .filter({ hasText: /^\.vrlsanity=100$/ })
      .nth(3)
      .click();
      
    await page.locator("#fnEditor").locator(".inputarea").press("Control+a");
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
  });



  test("should update the data on the chart when changing the time after applying a VRL field", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);

    // Set a relative time range (6 weeks) and apply the query
    await logsVisualise.setRelative("6", "w");
    await logsVisualise.logsApplyQueryButton();

    // Open the Visualise tab and add VRL  function and apply
    await logsVisualise.openVisualiseTab();
    await logsVisualise.vrlFunctionEditor(".vrl=123");
    await page.waitForTimeout(1000);
    await logsVisualise.runQueryAndWaitForCompletion();

    // Add the 'vrl' field to the chart
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-b-data"]'
      )
      .waitFor({ state: "visible" });
    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-b-data"]'
    //   )
    //   .waitFor({ state: "visible" });
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await logsVisualise.runQueryAndWaitForCompletion();

    await logsVisualise.setRelative("4", "w");

    await logsVisualise.runQueryAndWaitForCompletion();
  });


  test("should not show an error when changing the chart type after adding a VRL function field", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);

    // Set a relative time range and apply the query
    await logsVisualise.setRelative("6", "d");

    await logsVisualise.logsApplyQueryButton();

    // Open the Visualise tab
    await logsVisualise.openVisualiseTab();
    let errorDetected = false;


    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const errorText = msg.text();
     
        if (/Error|Failure|Cannot|Invalid/i.test(errorText)) {
          errorDetected = true;
        }
      }
    });

    // Wait for the visualisation tab to settle
    await page.waitForTimeout(5000);

    // Enter a VRL function and apply it
    await logsVisualise.vrlFunctionEditor(".VRLsanity=1000");

    await page.waitForTimeout(1000);

    await logsVisualise.runQueryAndWaitForCompletion();

    // Add the VRL field to the Y axis
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrlsanity"] [data-test="dashboard-add-y-data"]'
      )
      .waitFor({ state: "visible" });

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrlsanity"] [data-test="dashboard-add-y-data"]'
      )
      .click();

    await logsVisualise.runQueryAndWaitForCompletion();

    // List of chart types to test
   
    const chartTypes = [
      '[data-test="selected-chart-area-item"] img',
      '[data-test="selected-chart-area-stacked-item"] img',
      '[data-test="selected-chart-h-bar-item"] img',
      '[data-test="selected-chart-scatter-item"] img',
      '[data-test="selected-chart-h-stacked-item"] img',
      '[data-test="selected-chart-heatmap-item"] img',
      '[data-test="selected-chart-pie-item"] img',
      '[data-test="selected-chart-table-item"] img',
      '[data-test="selected-chart-gauge-item"] img',
    ];

    // Iterate through chart types and click each one
    for (const chartType of chartTypes) {
      await page.locator(chartType).click();

      await page.waitForTimeout(1000);
    }

    // Assert: Ensure no errors were detected during the chart type changes
    // Assertion: Fail the test if an error was detected
    expect(errorDetected).toBe(false);
  });

});
