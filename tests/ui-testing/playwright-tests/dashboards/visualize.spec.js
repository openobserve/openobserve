import { test, expect } from "@playwright/test";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import logData from "../../cypress/fixtures/log.json";
import PageManager from "../../pages/dashboardPages/page-manager";

import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

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

    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    await selectStreamAndStreamTypeForLogs(page, logData.Stream);
    await pm.logsVisualise.logsApplyQueryButton();
  });

  test("should create logs when queries are ingested into the search field", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and enable SQL mode
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.enableSQLMode();

    //set relative time
    await pm.logsVisualise.logsSelectStream("e2e_automate");
    await pm.logsVisualise.setRelative("4", "d");
    await pm.logsVisualise.logsApplyQueryButton();
  });

  test("should set the default chart type and default X and Y axes to automatic after clicking the Visualize button", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and select stream
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.streamIndexList();
    await pm.logsVisualise.logsToggle();

    //open the Visualize tab and check the default chart type and axes
    await pm.logsVisualise.openVisualiseTab();
    await pm.logsVisualise.selectChartType("bar");
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
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    // Remove the _timestamp field from the X-axis
    await pm.logsVisualise.removeField("_timestamp", "x");
    await page.getByText("Chart configuration has been").click();
    await expect(page.getByText("Chart configuration has been")).toBeVisible();

    // Apply the changes
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await expect(page.getByText("There are some errors, please")).toBeVisible();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-x-data"]'
      )
      .waitFor({ state: "visible" });
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-x-data"]'
      )
      .click();

    // Apply the changes
    await pm.logsVisualise.runQueryAndWaitForCompletion();

    // Remove the _timestamp field from the Y-axis
    await pm.logsVisualise.removeField("_timestamp", "y");
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-y-data"]'
      )
      .waitFor({ state: "visible" });
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-y-data"]'
      )
      .click();

    // Apply the changes
    const search = page.waitForResponse(logData.applyQuery);

    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await expect
      .poll(async () => (await search).status(), { timeout: 15000 })
      .toBe(200);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    await pm.logsVisualise.chartRender(470, 13);
  });

  test("should correctly plot the data according to the new chart type when changing the chart type.", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and visualize tab
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.openVisualiseTab();

    // Add a field to the chart
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]'
      )
      .waitFor({ state: "visible" });

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]'
      )
      .click();

    await pm.logsVisualise.runQueryAndWaitForCompletion();

    // Change the chart types
    await pm.logsVisualise.selectChartType("line");

    await expect(
      page.locator('[data-test="chart-renderer"] canvas').last()
    ).toBeVisible();

    //set relative time
    await pm.logsVisualise.setRelative("6", "w");
    await pm.logsVisualise.chartRender(457, 135);

    // Change the chart type to area
    await pm.logsVisualise.selectChartType("area");
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.chartRender(590, 127);

    // Change the chart type to area-stacked
    await pm.logsVisualise.selectChartType("area-stacked");
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.chartRender(475, 45);

    // Change the chart type to horizontal bar
    await pm.logsVisualise.selectChartType("h-bar");
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.chartRender(722, 52);

    // Change the chart type to scatter and apply
    await pm.logsVisualise.selectChartType("scatter");
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.chartRender(362, 30);

    // Change the chart type to pie and apply
    await pm.logsVisualise.selectChartType("pie");
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.chartRender(650, 85);

    // Change the chart type to donut and apply
    await pm.logsVisualise.selectChartType("donut");
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.chartRender(216, 53);

    // Change the chart type to gauge and apply
    await pm.logsVisualise.selectChartType("gauge");
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.chartRender(423, 127);
  });

  test("should not reflect changes in the search query on the logs page if a field is changed or added in the visualization", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and set relative time
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.setRelative("6", "w");

    // Add kubernetes_container_image field to the search query
    await page.getByLabel('Expand "kubernetes_container_image"').click();
    await page
      .locator(
        '[data-test="logs-search-subfield-add-kubernetes_container_image-058694856476\\.dkr\\.ecr\\.us-west-2\\.amazonaws\\.com\\/ziox\\:v0\\.0\\.3"] [data-test="log-search-subfield-list-equal-kubernetes_container_image-field-btn"]'
      )
      .waitFor({ state: "visible" });

    await page
      .locator(
        '[data-test="logs-search-subfield-add-kubernetes_container_image-058694856476\\.dkr\\.ecr\\.us-west-2\\.amazonaws\\.com\\/ziox\\:v0\\.0\\.3"] [data-test="log-search-subfield-list-equal-kubernetes_container_image-field-btn"]'
      )
      .click();

    // Add kubernetes_container_image field with a different value to the search query
    await page
      .locator(
        '[data-test="logs-search-subfield-add-kubernetes_container_image-sha256\\:90e0a12eae07ad3d0bbfbb73b076ba3ce6e5ad38fb93babc22fba4d19206ca6b"] [data-test="log-search-subfield-list-not-equal-kubernetes_container_image-field-btn"]'
      )
      .waitFor({ state: "visible" });

    await page
      .locator(
        '[data-test="logs-search-subfield-add-kubernetes_container_image-sha256\\:90e0a12eae07ad3d0bbfbb73b076ba3ce6e5ad38fb93babc22fba4d19206ca6b"] [data-test="log-search-subfield-list-not-equal-kubernetes_container_image-field-btn"]'
      )
      .click();

    // Apply the changes
    await pm.logsVisualise.logsApplyQueryButton();

    // Open the visualization tab
    await pm.logsVisualise.openVisualiseTab();

    // Add kubernetes_annotations_kubernetes_io_psp field to the visualization
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]'
      )
      .waitFor({ state: "visible" });

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]'
      )
      .click();

    // Apply the changes in the visualization
    await pm.logsVisualise.runQueryAndWaitForCompletion();

    // Go back to the logs page
    await pm.logsVisualise.backToLogs();
  });

  test("should handle an empty query in visualization without displaying an error.", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and the query editor and apply a relative time
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.openQueryEditor();
    await pm.logsVisualise.setRelative("6", "w");
    await pm.logsVisualise.logsApplyQueryButton();

    // Open the visualization tab
    await pm.logsVisualise.openVisualiseTab();
    await expect(page.locator(".cm-line").first()).toBeVisible();
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
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and the query editor
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.openQueryEditor();
    await pm.logsVisualise.setRelative("6", "w");
    const queryEditor = page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByRole("textbox");
    // Wait for the query editor to be visible
    await expect(queryEditor).toBeVisible();

    // Fill invalid query
    await queryEditor.fill("select from user whare ID =1");

    // Refresh the search
    await pm.logsVisualise.logsApplyQueryButton();

    await page.getByText("Search field not found: as");

    //open the visualization tab
    await pm.logsVisualise.openVisualiseTab();

    // Verify that X and Y axis items are visible and apply
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

    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.setRelative("6", "w");
    await pm.logsVisualise.runQueryAndWaitForCompletion();
  });

  test("should not update the query on the logs page when switching between logs and visualization, even if changes are made in any field in the visualization.", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and set relative time
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.setRelative("6", "w");
    await pm.logsVisualise.logsApplyQueryButton();

    // Add the kubernetes_container_hash field to the search query
    await page.getByLabel('Expand "kubernetes_container_hash"').click();
    await page
      .locator(
        '[data-test="logs-search-subfield-add-kubernetes_container_hash-058694856476\\.dkr\\.ecr\\.us-west-2\\.amazonaws\\.com\\/ziox\\@sha256\\:3dbbb0dc1eab2d5a3b3e4a75fd87d194e8095c92d7b2b62e7cdbd07020f54589"] [data-test="log-search-subfield-list-equal-kubernetes_container_hash-field-btn"]'
      )
      .waitFor({ state: "visible" });

    await page
      .locator(
        '[data-test="logs-search-subfield-add-kubernetes_container_hash-058694856476\\.dkr\\.ecr\\.us-west-2\\.amazonaws\\.com\\/ziox\\@sha256\\:3dbbb0dc1eab2d5a3b3e4a75fd87d194e8095c92d7b2b62e7cdbd07020f54589"] [data-test="log-search-subfield-list-equal-kubernetes_container_hash-field-btn"]'
      )
      .click();
    await pm.logsVisualise.logsApplyQueryButton();

    // Open the visualization tab
    await pm.logsVisualise.openVisualiseTab();
    await pm.logsVisualise.runQueryAndWaitForCompletion();
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
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.backToLogs();

    await pm.logsVisualise.logsApplyQueryButton();
    await pm.logsVisualise.openVisualiseTab();

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
    await pm.logsVisualise.runQueryAndWaitForCompletion();
  });

  test("should make the data disappear on the visualization page after a page refresh and navigate to the logs page", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and set relative time
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.setRelative("6", "w");

    //open the visualization tab
    await pm.logsVisualise.openVisualiseTab();

    // Add a field to the Y-axis
    await page
      .locator('[data-test="index-field-search-input"]')
      .fill("kubernetes_container_hash");

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]'
      )
      .waitFor({ state: "visible" });

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page.locator('[data-test="index-field-search-input"]').fill("");
    await page
      .locator('[data-test="index-field-search-input"]')
      .fill("kubernetes_container_name");

    // Add a field to the breakdown
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-b-data"]'
      )
      .waitFor({ state: "visible" });

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await pm.logsVisualise.runQueryAndWaitForCompletion();

    // Reload the page
    await page.reload();
    // Verify the field is empty
    await expect(page.locator(".cm-line").first()).toBeEmpty();
  });

  test("should handle large datasets and complex SQL queries without showing an error on the chart", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page, fill the query editor, and apply a relative time and Apply the query
    await pm.logsVisualise.openLogs();

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

    await pm.logsVisualise.fillQueryEditor(sqlQuery);
    await pm.logsVisualise.setRelative("6", "w");
    await pm.logsVisualise.logsApplyQueryButton();

    // Enable SQL mode
    await pm.logsVisualise.enableSQLMode();
    await pm.logsVisualise.logsApplyQueryButton();

    // Open the visualization tab
    await pm.logsVisualise.openVisualiseTab();

    // Check for any error messages or indicators
    const errorMessage = page.locator('[data-test="error-message"]'); // Update the selector based on your app's error message display
    const errorCount = await errorMessage.count();

    // Assert that no error messages are displayed
    await expect(errorCount).toBe(0);
  });

  test("Ensure that switching between logs to visualize and back again results in the dropdown appearing blank, and the row is correctly handled.", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and set relative time
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.setRelative("6", "w");

    // Apply query and switch to the visualise tab
    await pm.logsVisualise.logsApplyQueryButton();
    await pm.logsVisualise.openVisualiseTab();

    // Switch back to logs and again to visualise
    await pm.logsVisualise.backToLogs();
    await pm.logsVisualise.openVisualiseTab();

    // Open the dropdown to check its state
    await page.locator('[data-test="index-dropdown-stream"]').click();

    let previousCount = -1;
    let currentCount = 0;
    const maxRetries = 10;

    for (let i = 0; i < maxRetries; i++) {
      const options = await page.getByRole("option");
      currentCount = await options.count();

      if (currentCount > 0 && currentCount === previousCount) {
        break; // Options loaded and stable
      }

      previousCount = currentCount;
      await page.waitForTimeout(300); // Small delay before checking again
    }

    expect(currentCount).toBeGreaterThan(0);

    // Validate the row element
    const row = page
      .getByRole("row", { name: "_timestamp +X +Y +B +F" })
      .first();
    await expect(row).toBeVisible();
  });

  test("should not blank the stream name list when switching between logs and visualization and back again.", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and set relative time
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.setRelative("4", "d");

    // Open the visualization tab
    await pm.logsVisualise.openVisualiseTab();

    // Remove a field from the y-axis
    await pm.logsVisualise.removeField("_timestamp", "y");

    // Switch back to logs
    await pm.logsVisualise.backToLogs();
  });

  test("should create dashboard from the visualization chart sucessfully", async ({
    page,
  }) => {
    const randomDashboardName =
      "Dashboard_" + Math.random().toString(36).substr(2, 9);
    const panelName = "Panel_" + Math.random().toString(36).substr(2, 9);

    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and set relative time
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.setRelative("4", "d");

    // Open the visualization tab and add fields
    await pm.logsVisualise.openVisualiseTab();

    chartTypeSelector.searchAndAddField(
      "kubernetes_annotations_kubernetes_io_psp",
      "b"
    );
    await pm.logsVisualise.runQueryAndWaitForCompletion();

    // Change the chart types
    await pm.logsVisualise.selectChartType("line");

    await expect(
      page.locator('[data-test="chart-renderer"] canvas').last()
    ).toBeVisible();

    //add to dashboard and submit it
    await page.getByRole("button", { name: "Add To Dashboard" }).click();
    await page
      .locator('[data-test="dashboard-dashboard-new-add"]')
      .waitFor({ state: "visible" });

    //Adding dashboard
    await page.locator('[data-test="dashboard-dashboard-new-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);
    await page.locator('[data-test="dashboard-add-submit"]').click();

    await page.waitForTimeout(3000);
    await page
      .locator('[data-test="metrics-new-dashboard-panel-title"]')
      .waitFor({ state: "visible" });
    await page
      .locator('[data-test="metrics-new-dashboard-panel-title"]')
      .click();
    await page
      .locator('[data-test="metrics-new-dashboard-panel-title"]')
      .fill(panelName);
    await page
      .locator('[data-test="metrics-schema-update-settings-button"]')
      .click();

    //redirecting to the dashboard and edit panel and save it

    awaitpm.dashboardPanelEdit.editPanel(panelName);
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .waitFor({ state: "visible" });
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(_timestamp) AS "x_axis_1", COUNT(_timestamp) AS "y_axis_1", kubernetes_annotations_kubernetes_io_psp AS "breakdown_1" FROM "e2e_automate" GROUP BY x_axis_1, breakdown_1',
        })
        .first()
    ).toBeVisible();
    await page.locator('[data-test="query-inspector-close-btn"]').click();
    await dashboardActions.applyDashboardBtn();
    await dashboardActions.savePanel();

    // Return to dashboards list and delete the dashboard
    awaitpm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
