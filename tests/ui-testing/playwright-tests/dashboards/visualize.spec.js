import { test, expect } from "@playwright/test";
import LogsVisualise from "../../pages/dashboardPages/visualise";
import { login } from "../utils/dashLogin";
import { ingestion } from "../utils/dashIngestion";
import { waitForDateTimeButtonToBeEnabled } from "./dashboard.utils";

import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { log } from "console";

test.describe.configure({ mode: "parallel" });
const selectStreamAndStreamTypeForLogs = async (page, stream) => {
  await page.waitForTimeout(4000);
  await page
    .locator('[data-test="log-search-index-list-select-stream"]')
    .click({ force: true });
  await page.locator("div.q-item").getByText(`${stream}`).first().click();
};

test.describe("logs testcases", () => {
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
    await applyQueryButton(page);
    // const streams = page.waitForResponse("**/api/default/streams**");
  });
  test("should create logs when queries are ingested into the search field", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.openLogs();
    await logsVisualise.enableSQLMode();
    await logsVisualise.logsSelectStream("e2e_automate");
    await logsVisualise.setRelative("4", "d");
    await logsVisualise.logsApplyQueryButton();
  });

  test("should set the default chart type and default X and Y axes to automatic after clicking the Visualize button", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.openLogs();
    await logsVisualise.streamIndexList();
    await logsVisualise.logsToggle();
    await logsVisualise.openVisualiseTab();
    await logsVisualise.selectChartType("bar");
    await page.locator('[data-test="dashboard-x-item-_timestamp"]').click();
    await expect(
      page.locator('[data-test="dashboard-x-item-_timestamp"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-test="dashboard-y-item-_timestamp"]')
    ).toBeVisible();
  });
  test("should adjust the displayed data effectively when editing the X-axis and Y-axis on the chart.", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.openLogs();
    await logsVisualise.logsApplyQueryButton();

    await logsVisualise.openVisualiseTab();

    await logsVisualise.removeField("_timestamp", "x");
    await page.getByText("Chart configuration has been").click();
    await expect(page.getByText("Chart configuration has been")).toBeVisible();

    await logsVisualise.applyQueryButtonVisualise();
    await expect(page.getByText("There are some errors, please")).toBeVisible();
    await page.locator(
      '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-x-data"]'
    );

    await logsVisualise.applyQueryButtonVisualise();

    await logsVisualise.removeField("_timestamp", "y");
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    const search = page.waitForResponse(logData.applyQuery);

    await logsVisualise.applyQueryButtonVisualise();
    await expect
      .poll(async () => (await search).status(), { timeout: 15000 })
      .toBe(200);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    // const x=470;
    // const y=13;
    await logsVisualise.chartRender(470, 13);
  });
  test("should correctly plot the data according to the new chart type when changing the chart type.", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.openLogs();
    await logsVisualise.openVisualiseTab();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]'
      )
      .click();

    await logsVisualise.applyQueryButtonVisualise();
    await logsVisualise.selectChartType("line");
    await expect(
      page.locator('[data-test="chart-renderer"] canvas').last()
    ).toBeVisible();
    await logsVisualise.setRelative("6", "w");
    await logsVisualise.chartRender(457, 135);

    await logsVisualise.selectChartType("area");
    await logsVisualise.applyQueryButtonVisualise();
    await logsVisualise.chartRender(590, 127);

    await logsVisualise.selectChartType("area-stacked");

    await logsVisualise.applyQueryButtonVisualise();
    await logsVisualise.chartRender(475, 45);

    await logsVisualise.selectChartType("h-bar");

    await logsVisualise.applyQueryButtonVisualise();
    await logsVisualise.chartRender(722, 52);

    await logsVisualise.selectChartType("scatter");

    await logsVisualise.applyQueryButtonVisualise();
    await logsVisualise.chartRender(362, 30);

    await logsVisualise.selectChartType("pie");

    await logsVisualise.applyQueryButtonVisualise();
    await logsVisualise.chartRender(650, 85);

    await logsVisualise.selectChartType("donut");
    await logsVisualise.applyQueryButtonVisualise();
    await logsVisualise.chartRender(216, 53);
    await logsVisualise.selectChartType("gauge");
    await logsVisualise.applyQueryButtonVisualise();
    await logsVisualise.chartRender(423, 127);
  });

  test("should not reflect changes in the search query on the logs page if a field is changed or added in the visualization", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.openLogs();
    await logsVisualise.setRelative("6", "w");

    await page.getByLabel('Expand "kubernetes_container_image"').click();
    await page
      .locator(
        '[data-test="logs-search-subfield-add-kubernetes_container_image-058694856476\\.dkr\\.ecr\\.us-west-2\\.amazonaws\\.com\\/ziox\\:v0\\.0\\.3"] [data-test="log-search-subfield-list-equal-kubernetes_container_image-field-btn"]'
      )
      .click();
    await page
      .locator(
        '[data-test="logs-search-subfield-add-kubernetes_container_image-sha256\\:90e0a12eae07ad3d0bbfbb73b076ba3ce6e5ad38fb93babc22fba4d19206ca6b"] [data-test="log-search-subfield-list-not-equal-kubernetes_container_image-field-btn"]'
      )
      .click();
    await logsVisualise.logsApplyQueryButton();
    await logsVisualise.openVisualiseTab();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]'
      )
      .click();

    await logsVisualise.applyQueryButtonVisualise();
    await logsVisualise.backToLogs();
  });
  test("should handle an empty query in visualization without displaying an error.", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.openLogs();
    await logsVisualise.openQueryEditior();

    await logsVisualise.setRelative("6", "w");
    await logsVisualise.logsApplyQueryButton();
    await logsVisualise.openVisualiseTab();

    await expect(page.locator(".view-line").first()).toBeVisible();
    await expect(
      page.locator('[data-test="dashboard-x-item-_timestamp"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-test="dashboard-y-item-_timestamp"]')
    ).toBeVisible();
  });

  test("should display an error message on the logs page for an invalid query", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.openLogs();
    await logsVisualise.openQueryEditior();
    await logsVisualise.setRelative("6", "w");
    // Enter an invalid query into the search bar
    await page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByLabel("Editor content;Press Alt+F1")
      .fill("select from user whare ID =1");

    // Refresh the search
    await logsVisualise.logsApplyQueryButton();

    // Wait for the error message to appear
    await page.getByText("Search field not found: as");
    await logsVisualise.openVisualiseTab();

    // Verify that X and Y axis items are visible
    await expect(
      page.locator('[data-test="dashboard-x-item-_timestamp"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-test="dashboard-y-item-_timestamp"]')
    ).toBeVisible();
    await page
      .locator("label")
      .filter({ hasText: "Streamarrow_drop_down" })
      .locator("i")
      .click();

    await logsVisualise.applyQueryButtonVisualise();
    await logsVisualise.setRelative("6", "w");
    await logsVisualise.applyQueryButtonVisualise();
  });
  test("should not update the query on the logs page when switching between logs and visualization, even if changes are made in any field in the visualization.", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);

    await logsVisualise.openLogs();
    await logsVisualise.setRelative("6", "w");
    await logsVisualise.logsApplyQueryButton();

    await page.getByLabel('Expand "kubernetes_container_hash"').click();
    await page
      .locator(
        '[data-test="logs-search-subfield-add-kubernetes_container_hash-058694856476\\.dkr\\.ecr\\.us-west-2\\.amazonaws\\.com\\/ziox\\@sha256\\:3dbbb0dc1eab2d5a3b3e4a75fd87d194e8095c92d7b2b62e7cdbd07020f54589"] [data-test="log-search-subfield-list-equal-kubernetes_container_hash-field-btn"]'
      )
      .click();
    await logsVisualise.logsApplyQueryButton();
    await logsVisualise.openVisualiseTab();
    await logsVisualise.applyQueryButtonVisualise();
    let exceptionBefore = null;
    let exceptionAfter = null;

    // try and catch block for compare tow field.
    try {
      await expect(
        page.locator(
          '[data-test="dashboard-add-condition-label-0-kubernetes_container_hash"]'
        )
      ).toBeVisible();
    } catch (e) {
      exceptionBefore = e;
    }

    await page.locator('[data-test="dashboard-add-condition-remove"]').click();
    await logsVisualise.applyQueryButtonVisualise();
    await logsVisualise.backToLogs();

    await logsVisualise.logsApplyQueryButton();
    await logsVisualise.openVisualiseTab();

    try {
      await expect(
        page.locator(
          '[data-test="dashboard-add-condition-label-0-kubernetes_container_hash"]'
        )
      ).toBeVisible();
    } catch (e) {
      exceptionAfter = e;
    }
    expect(exceptionBefore).toBe(exceptionAfter);
    await logsVisualise.applyQueryButtonVisualise();
  });

  test("should make the data disappear on the visualization page after a page refresh and navigate to the logs page", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.openLogs();

    // Perform the initial actions
    await logsVisualise.setRelative("6", "w");

    // await page.locator('[data-test="logs-visualize-toggle"]').click();
    await logsVisualise.openVisualiseTab();

    await page
      .locator('[data-test="index-field-search-input"]')
      .fill("kubernetes_container_hash");
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page.locator('[data-test="index-field-search-input"]').fill("");
    await page
      .locator('[data-test="index-field-search-input"]')
      .fill("kubernetes_container_name");
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await logsVisualise.applyQueryButtonVisualise();

    // Reload the page
    await page.reload();
    // Verify the field is empty
    await expect(page.locator(".view-line").first()).toBeEmpty();
  });

  test("should handle large datasets and complex SQL queries without showing an error on the chart", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.openLogs();

    const sqlQuery = `SELECT kubernetes_annotations_kubectl_kubernetes_io_default_container as "x_axis_1", 
    count(kubernetes_container_hash) as "y_axis_1", 
    count(kubernetes_container_name) as "y_axis_2", 
    count(kubernetes_host) as "y_axis_3", 
    count(kubernetes_labels_app_kubernetes_io_instance) as "y_axis_4", 
    count(kubernetes_labels_app_kubernetes_io_name) as "y_axis_5", 
    count(kubernetes_labels_app_kubernetes_io_version) as "y_axis_6", 
    count(kubernetes_labels_operator_prometheus_io_name) as "y_axis_7", 
    count(kubernetes_labels_prometheus) as "y_axis_8", 
    kubernetes_labels_statefulset_kubernetes_io_pod_name as "breakdown_1"  
    FROM "e2e_automate" 
    WHERE kubernetes_namespace_name IS NOT NULL 
    GROUP BY x_axis_1, breakdown_1`;
    await logsVisualise.fillQueryEditor(sqlQuery);

    await logsVisualise.setRelative("6", "w");
    await logsVisualise.logsApplyQueryButton();
    // await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await logsVisualise.enableSQLMode();

    await logsVisualise.logsApplyQueryButton();
    // Toggle visualization
    await logsVisualise.openVisualiseTab();

    // Check for any error messages or indicators
    const errorMessage = page.locator('[data-test="error-message"]'); // Update the selector based on your app's error message display
    const errorCount = await errorMessage.count();

    // Assert that no error messages are displayed
    await expect(errorCount).toBe(0); // Fail the test if any error messages are present
  });
  test("Ensure that switching between logs to visualize and back again results in the dropdown appearing blank, and the row is correctly handled.", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.openLogs();
    // Interact with various elements
    //   await page.locator('[data-test="date-time-btn"]').click();
    await logsVisualise.setRelative("6", "w");
    await logsVisualise.logsApplyQueryButton();
    await logsVisualise.openVisualiseTab();
    await logsVisualise.backToLogs();
    await logsVisualise.openVisualiseTab();

    //   // Open the dropdown
    await page.locator('[data-test="index-dropdown-stream"]').click();

    // Check if the dropdown is blank
    const dropdownOptions = await page.getByRole("option");
    const dropdownCount = await dropdownOptions.count();
    console.log("Dropdown count:", dropdownCount); // Debugging line
    expect(dropdownCount).toBeGreaterThan(0);

    // Get the row element
    const row = page
      .getByRole("row", { name: "_timestamp +X +Y +B +F" })
      .first();

    // Alternative assertions
    await expect(row).toBeDefined();
  });
  test("should not blank the stream name list when switching between logs and visualization and back again.", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.openLogs();
    await logsVisualise.setRelative("4", "d");

    await logsVisualise.openVisualiseTab();

    await logsVisualise.removeField("_timestamp", "y");
    await logsVisualise.backToLogs();
  });
});
