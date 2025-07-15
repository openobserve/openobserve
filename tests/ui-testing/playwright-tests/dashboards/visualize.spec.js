import { test, expect } from "@playwright/test";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import logData from "../../cypress/fixtures/log.json";
import PageManager from "../../pages/page-manager";

import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

test.describe.configure({ mode: "parallel" });
const selectStreamAndStreamTypeForLogs = async (page, stream) => {
  await page.waitForTimeout(4000);
  await page
    .locator('[data-test="log-search-index-list-select-stream"]')
    .click({ force: true });
  await page

    .locator('[data-test="log-search-index-list-select-stream"]')

    .fill(stream);
  await page.locator("div.q-item").getByText(`${stream}`).first().click();
};

const initialQuery = `SELECT
kubernetes_namespace_name,
kubernetes_pod_name,
kubernetes_container_name,
COUNT(*) AS log_count
FROM
e2e_automate
WHERE
kubernetes_container_name = 'ziox'
GROUP BY
kubernetes_namespace_name,
kubernetes_pod_name,
kubernetes_container_name
ORDER BY
log_count DESC
LIMIT 100
`;
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
    await expect(
      page.locator('[data-test="dashboard-x-item-zo_sql_key"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-test="dashboard-y-item-zo_sql_num"]')
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

    await page
      .locator('[data-test="dashboard-field-list-collapsed-icon"]')
      .click();

    // Remove the _timestamp field from the X-axis
    await pm.logsVisualise.removeField("zo_sql_key", "x");
    await page.getByText("Chart configuration has been").click();
    await expect(page.getByText("Chart configuration has been")).toBeVisible();

    // Apply the changes
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await expect(page.getByText("There are some errors, please")).toBeVisible();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-zo_sql_key"] [data-test="dashboard-add-x-data"]'
      )
      .waitFor({ state: "visible" });
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-zo_sql_key"] [data-test="dashboard-add-x-data"]'
      )
      .click();

    // Apply the changes
    await pm.logsVisualise.runQueryAndWaitForCompletion();

    // Remove the _timestamp field from the Y-axis
    await pm.logsVisualise.removeField("zo_sql_num", "y");
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-zo_sql_num"] [data-test="dashboard-add-y-data"]'
      )
      .waitFor({ state: "visible" });
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-zo_sql_num"] [data-test="dashboard-add-y-data"]'
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

    const queryEditor = page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByRole("textbox");
    await expect(queryEditor).toBeVisible();

    const sqlQuery = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", kubernetes_annotations_kubernetes_io_psp as "breakdown_1"  FROM "e2e_automate"  GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC`;

    // update the query
    await queryEditor.click();
    await queryEditor.press(
      process.platform === "darwin" ? "Meta+A" : "Control+A"
    );
    await queryEditor.fill(sqlQuery);

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
      page.locator('[data-test="dashboard-x-item-zo_sql_key"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-test="dashboard-y-item-zo_sql_num"]')
    ).toBeVisible();
  });

  test.skip("should not update the query on the logs page when switching between logs and visualization, even if changes are made in any field in the visualization.", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);

    // Open the logs page and set relative time
    await logsVisualise.openLogs();
    await logsVisualise.setRelative("6", "w");
    await logsVisualise.logsApplyQueryButton();

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
    await logsVisualise.logsApplyQueryButton();

    // Open the visualization tab
    await logsVisualise.openVisualiseTab();
    await logsVisualise.runQueryAndWaitForCompletion();
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
    await logsVisualise.runQueryAndWaitForCompletion();
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
    await logsVisualise.runQueryAndWaitForCompletion();
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

    // // Add a field to the Y-axis
    // await page
    //   .locator('[data-test="index-field-search-input"]')
    //   .fill("kubernetes_container_hash");

    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]'
    //   )
    //   .waitFor({ state: "visible" });

    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]'
    //   )
    //   .click();
    // await page.locator('[data-test="index-field-search-input"]').fill("");
    // await page
    //   .locator('[data-test="index-field-search-input"]')
    //   .fill("kubernetes_container_name");

    // // Add a field to the breakdown
    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-b-data"]'
    //   )
    //   .waitFor({ state: "visible" });

    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-b-data"]'
    //   )
    //   .click();
    // await pm.logsVisualise.runQueryAndWaitForCompletion();

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
    await page
      .locator('[data-test="dashboard-field-list-collapsed-icon"]')
      .click();

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
    await pm.logsVisualise.removeField("zo_sql_num", "y");

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

    await pm.dashboardPanelEdit.editPanel(panelName);
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .waitFor({ state: "visible" });
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page
        .getByRole("cell", {
          name: "select histogram(_timestamp, '10 second') AS zo_sql_key, count(*) AS zo_sql_num from \"e2e_automate\" GROUP BY zo_sql_key ORDER BY zo_sql_key",
        })
        .first()
    ).toBeVisible();
    await page.locator('[data-test="query-inspector-close-btn"]').click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();

    // Return to dashboards list and delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
  test("Should not call the API after toggling to the Visualization view.", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);

    // Open the logs page and the query editor
    await logsVisualise.openLogs();
    await logsVisualise.openQueryEditor();
    const queryEditor = page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByRole("textbox");
    // Wait for the query editor to be visible
    await expect(queryEditor).toBeVisible();

    // Fill query in the query editor
    await queryEditor.fill(initialQuery);

    await logsVisualise.setRelative("1", "m");

    await logsVisualise.logsApplyQueryButton();
    await page.waitForTimeout(5000);

    //open the visualization tab
    await logsVisualise.openVisualiseTab();

    // Assert that the event-streaming search API call is **not** fired
    const apiCallHappened = await page
      .waitForResponse(
        (response) =>
          response
            .url()
            .includes(
              "/api/default/_search_stream?type=logs&search_type=dashboards"
            ),
        { timeout: 5000 }
      )
      .then(() => true)
      .catch(() => false); // timeout ⇒ call not made

    expect(apiCallHappened).toBe(false);
  });

  test("Should update the field name after updating the query.", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);

    const updatedQuery = `SELECT
    kubernetes_namespace_testname,
    kubernetes_pod_name,
    kubernetes_container_name,
    COUNT(*) AS log_count
FROM
    e2e_automate
WHERE
    kubernetes_container_name = 'ziox'
GROUP BY
    kubernetes_namespace_testname,
    kubernetes_pod_name,
    kubernetes_container_name
ORDER BY
    log_count DESC
LIMIT 100`;

    // Step 1: Open Logs page and query editor
    await logsVisualise.openLogs();
    await logsVisualise.openQueryEditor();

    const queryEditor = page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByRole("textbox");
    await expect(queryEditor).toBeVisible();

    // Step 2: Fill and apply the initial query
    await queryEditor.fill(initialQuery.trim());
    await logsVisualise.setRelative("1", "m");
    await logsVisualise.logsApplyQueryButton();
    await page.waitForTimeout(3000); // Optional: Replace with proper wait if possible

    // Step 3: Open the Visualization tab
    await logsVisualise.openVisualiseTab();

    await expect(
      page.locator('[data-test="dashboard-x-item-kubernetes_namespace_name"]')
    ).toBeVisible();

    // Step 4: Update the query
    await queryEditor.click();
    await queryEditor.press(
      process.platform === "darwin" ? "Meta+A" : "Control+A"
    );
    await queryEditor.fill(updatedQuery.trim());

    // Activate the function editor to trigger reprocessing
    await page.locator("#fnEditor").getByRole("textbox").locator("div").click();
    // await logsVisualise.openVisualiseTab();

    await page.waitForTimeout(5000);
    // Step 5: Assert updated field is visible
    await expect(
      page.locator(
        '[data-test="dashboard-x-item-kubernetes_namespace_testname"]'
      )
    ).toHaveCount(1, { timeout: 10000 });
  });

  test("Should redirect to the table chart in visualization when the query includes more than two fields on the X-axis.", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);

    // Step 1: Open Logs page and query editor
    await logsVisualise.openLogs();
    await logsVisualise.openQueryEditor();

    const queryEditor = page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByRole("textbox");
    await expect(queryEditor).toBeVisible();

    // Step 2: Fill and apply the initial query
    await queryEditor.fill(initialQuery.trim());
    await logsVisualise.setRelative("1", "m");
    await logsVisualise.logsApplyQueryButton();
    await page.waitForTimeout(3000); // Optional: Replace with proper wait if possible

    // Step 3: Open the Visualization tab
    await logsVisualise.openVisualiseTab();
    await expect(
      page.locator('[data-test="selected-chart-table-item"]').locator("..")
    ).toHaveClass(/bg-grey-3|5/); // matches light (3) or dark (5) theme
  });
});
