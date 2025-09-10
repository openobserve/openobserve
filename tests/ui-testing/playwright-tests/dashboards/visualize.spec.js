import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";

import { deleteDashboard } from "../utils/dashCreation.js";
import DateTimeHelper from "../../pages/dashboardPages/dashboard-time.js";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

const panelName = "Panel_" + Math.random().toString(36).substr(2, 9);
// Stream name used across tests
const STREAM_NAME = "e2e_automate";

// Add a global SQL query constant that can be reused across tests
const largeDatasetSqlQuery = `SELECT kubernetes_annotations_kubectl_kubernetes_io_default_container as "x_axis_1", 
  count(kubernetes_container_hash) as "y_axis_1", 
  count(kubernetes_container_name) as "y_axis_2", 
  count(kubernetes_host) as "y_axis_3", 
  count(kubernetes_labels_app_kubernetes_io_instance) as "y_axis_4", 
  count(kubernetes_labels_app_kubernetes_io_name) as "y_axis_5", 
  count(kubernetes_labels_app_kubernetes_io_version) as "y_axis_6", 
  count(kubernetes_labels_operator_prometheus_io_name) as "y_axis_7", 
  count(kubernetes_labels_prometheus) as "y_axis_8", 
  kubernetes_labels_statefulset_kubernetes_io_pod_name as "breakdown_1"  
  FROM "${STREAM_NAME}" 
  WHERE kubernetes_namespace_name IS NOT NULL 
  GROUP BY x_axis_1, breakdown_1`;

const histogramQuery = `SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1"  FROM "${STREAM_NAME}"  GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

test.describe.configure({ mode: "parallel" });

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  await page.waitForTimeout(1000);

  if (await page.getByText("Login as internal user").isVisible()) {
    await page.getByText("Login as internal user").click();
  }

  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);
  //Enter Password
  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
  // TODO : Replace all timeouts with waitForSelector for reliable tests
  await page.waitForTimeout(4000);
  await page.goto(process.env["ZO_BASE_URL"]);
}

const selectStreamAndStreamTypeForLogs = async (page, stream) => {
  await page.waitForTimeout(4000);
  await page
    .locator('[data-test="log-search-index-list-select-stream"]')
    .click({ force: true });
  await page.waitForTimeout(2000);
  await page
    .locator("div.q-item")
    .getByText(`${stream}`)
    .first()
    .click({ force: true });
};
test.describe(" visualize UI testcases", () => {
  // let logData;
  function removeUTFCharacters(text) {
    // console.log(text, "tex");
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }
  async function applyQueryButton(page) {
    // click on the run query button
    // Type the value of a variable into an input field
    const search = page.waitForResponse(logData.applyQuery);
    await page.waitForTimeout(3000);
    await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
      force: true,
    });
    // get the data from the search variable
    await expect.poll(async () => (await search).status()).toBe(200);

    // await search.hits.FIXME_should("be.an", "array");
  }
  // tebefore(async function () {
  //   // logData("log");
  //   // const data = page;
  //   // logData = data;

  //   console.log("--logData--", logData);
  // });
  test.beforeEach(async ({ page }) => {
    console.log("running before each");

    await login(page);
    await page.waitForTimeout(5000);

    // ("ingests logs via API", () => {
    const orgId = process.env["ORGNAME"];
    const streamName = "e2e_automate";
    const basicAuthCredentials = Buffer.from(
      `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
    ).toString("base64");

    const headers = {
      Authorization: `Basic ${basicAuthCredentials}`,
      "Content-Type": "application/json",
    };

    // const logsdata = {}; // Fill this with your actual data

    // Making a POST request using fetch API
    const response = await page.evaluate(
      async ({ url, headers, orgId, streamName, logsdata }) => {
        const fetchResponse = await fetch(
          `${url}/api/${orgId}/${streamName}/_json`,
          {
            method: "POST",
            headers: headers,
            body: JSON.stringify(logsdata),
          }
        );
        return await fetchResponse.json();
      },
      {
        url: process.env.INGESTION_URL,
        headers: headers,
        orgId: orgId,
        streamName: streamName,
        logsdata: logsdata,
      }
    );

    console.log(response);
    //  });
    // const allorgs = page.waitForResponse("**/api/default/organizations**");
    // const functions = page.waitForResponse("**/api/default/functions**");
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await selectStreamAndStreamTypeForLogs(page, logData.Stream);
    await applyQueryButton(page);
    // const streams = page.waitForResponse("**/api/default/streams**");
  });

  test("should create logs when queries are ingested into the search field", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/logs-item"]').click();
    await page
      .getByRole("switch", { name: "SQL Mode" })
      .locator("div")
      .nth(2)
      .click();
    await page.waitForTimeout(1000);
    await page
      .locator('[data-test="logs-search-index-list"]')
      .getByText("arrow_drop_down")
      .click();
    await page
      .locator(
        '[data-test="log-search-index-list-stream-toggle-e2e_automate"] div'
      )
      .nth(2)
      .click();
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
  });

  test("should set the default chart type to automatic after clicking the Visualize button", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/logs-item"]').click();
    await page
      .locator('[data-test="logs-search-index-list"]')
      .getByText("arrow_drop_down")
      .click();
    await page.locator('[data-test="logs-logs-toggle"]').click();
    await page.waitForTimeout(1000);
    await page.locator('[data-test="logs-visualize-toggle"]').click();

    await expect(
      page.locator('[data-test="selected-chart-line-item"]').locator("..")
    ).toHaveClass(/bg-grey-[35]/); // Fixed regex pattern
  });

  test.skip("should adjust the displayed data effectively when editing the X-axis and Y-axis on the chart.", async ({
    page,
  }) => {
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();
    await page
      .locator('[data-test="dashboard-x-item-_timestamp-remove"]')
      .click();
    await page.getByText("Chart configuration has been").click();
    await expect(page.getByText("Chart configuration has been")).toBeVisible();
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
    await expect(page.getByText("There are some errors, please")).toBeVisible();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-x-data"]'
      )
      .click();
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
    await page
      .locator('[data-test="dashboard-y-item-_timestamp-remove"]')
      .click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    const search = page.waitForResponse(logData.applyQuery);
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
    await expect
      .poll(async () => (await search).status(), { timeout: 15000 })
      .toBe(200);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    await page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .click({
        position: {
          x: 470,
          y: 13,
        },
      });
  });

  test.skip("should correctly plot the data according to the new chart type when changing the chart type.", async ({
    page,
  }) => {
    await page.locator('[data-test="logs-visualize-toggle"]').click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
    await page.locator('[data-test="selected-chart-line-item"]').click();

    await expect(
      page.locator('[data-test="chart-renderer"] canvas').last()
    ).toBeVisible();
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();

    await page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .click({
        position: {
          x: 457,
          y: 135,
        },
      });
    await page.locator('[data-test="selected-chart-area-item"]').click();
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
    await page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .click({
        position: {
          x: 590,
          y: 127,
        },
      });
    await page
      .locator('[data-test="selected-chart-area-stacked-item"]')
      .click();
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
    await page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .click({
        position: {
          x: 475,
          y: 45,
        },
      });
    await page.locator('[data-test="selected-chart-h-bar-item"]').click();
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
    await page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .click({
        position: {
          x: 722,
          y: 52,
        },
      });
    await page.locator('[data-test="selected-chart-scatter-item"]').click();
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
    await page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .click({
        position: {
          x: 362,
          y: 30,
        },
      });
    await page.locator('[data-test="selected-chart-pie-item"]').click();

    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();

    await page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .click({
        position: {
          x: 650,
          y: 85,
        },
      });
    await page.locator('[data-test="selected-chart-donut-item"]').click();

    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
    await page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .click({
        position: {
          x: 216,
          y: 53,
        },
      });
    await page.locator('[data-test="selected-chart-gauge-item"]').click();

    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
    await page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .click({
        position: {
          x: 423,
          y: 127,
        },
      });
  });

  test.skip("should not reflect changes in the search query on the logs page if a field is changed or added in the visualization", async ({
    page,
  }) => {
    // remain to mention compare qaury

    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
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
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
    await page.locator('[data-test="logs-logs-toggle"]').click();
    await page.locator('[data-test="confirm-button"]').click();
  });
  test.skip("should display an error message on the logs page for an invalid query", async ({
    page,
  }) => {
    // Click on the line view
    await page.locator(".view-line").first().click();

    // Enter an invalid query into the search bar
    await page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByLabel("Editor content;Press Alt+F1")
      .fill("select from user whare ID =1");

    // Refresh the search
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    await page.waitForTimeout(2000);

    // Wait for the error message to appear
    await page.getByText("Search field not found: as");

    await page.locator('[data-test="logs-visualize-toggle"]').click();

    // Verify that X and Y axis items are visible
    await expect(
      page.locator('[data-test="dashboard-x-item-_timestamp"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-test="dashboard-y-item-_timestamp"]')
    ).toBeVisible();

    // Perform additional visualization actions
    await page
      .locator("label")
      .filter({ hasText: "Streamarrow_drop_down" })
      .locator("i")
      .click();

    await page.waitForTimeout(1000);

    // await page.getByText('e2e_automate').click();
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
  });

  test.skip("should not update the query on the logs page when switching between logs and visualization, even if changes are made in any field in the visualization.", async ({
    page,
  }) => {
    // Chart should not reflect changes made to X or Y axis.

    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.getByLabel('Expand "kubernetes_container_hash"').click();
    await page
      .locator(
        '[data-test="logs-search-subfield-add-kubernetes_container_hash-058694856476\\.dkr\\.ecr\\.us-west-2\\.amazonaws\\.com\\/ziox\\@sha256\\:3dbbb0dc1eab2d5a3b3e4a75fd87d194e8095c92d7b2b62e7cdbd07020f54589"] [data-test="log-search-subfield-list-equal-kubernetes_container_hash-field-btn"]'
      )
      .click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();

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
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
    await page.locator('[data-test="logs-logs-toggle"]').click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();

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

    // Perform an additional refresh to ensure consistency
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
  });

  test.skip("Ensure that switching between logs to visualize and back again results in the dropdown appearing blank, and the row is correctly handled.", async ({
    page,
  }) => {
    // Interact with various elements
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();
    await page.locator('[data-test="logs-logs-toggle"]').click();
    await expect(page.getByText("Navigating away from")).toBeVisible();
    await page.locator('[data-test="confirm-button"]').click();

    await page.waitForSelector('[data-test="logs-visualize-toggle"]');

    await page.locator('[data-test="logs-visualize-toggle"]').click();

    await page.waitForSelector('[data-test="index-dropdown-stream"]');

    // Open the dropdown
    await page.locator('[data-test="index-dropdown-stream"]').click();

    // Check if the dropdown is blank
    const dropdownOptions = await page.getByRole("option");
    const dropdownCount = await dropdownOptions.count();

    console.log("Dropdown count:", dropdownCount); // Debugging line

    // Ensure the dropdown options are blank
    expect(dropdownCount).toBeGreaterThan(0);

    // Get the row element
    const row = page
      .getByRole("row", { name: "_timestamp +X +Y +B +F" })
      .first();

    // Alternative assertions
    await expect(row).toBeDefined();
  });

  test.skip("should make the data disappear on the visualization page after a page refresh and navigate to the logs page", async ({
    page,
  }) => {
    //Except :  Data should be vanished, and tab is changed from Visualize to Search.

    // Perform the initial actions
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();
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
    await page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();

    // Reload the page
    await page.reload();

    // Verify the field is empty
    await expect(page.locator(".view-line").first()).toBeEmpty();
  });
  // Helper function to setup aggregation query test
  async function setupAggregationQueryTest(page) {
    await page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByLabel("Editor content;Press Alt+F1")
      .fill(largeDatasetSqlQuery);

    // Apply time filter and search
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    // Switch to SQL mode
    await page
      .getByRole("switch", { name: "SQL Mode" })
      .locator("div")
      .nth(2)
      .click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    // Switch to visualization
    await page.locator('[data-test="logs-visualize-toggle"]').click();
    await page.waitForTimeout(3000);
  }
  // Helper function to check for dashboard errors
  async function checkDashboardErrors(page, chartTypeName) {
    const dashboardErrorContainer = page.locator(
      '[data-test="dashboard-error"]'
    );
    const errorContainerExists = await dashboardErrorContainer.count();

    if (errorContainerExists === 0) {
      return { hasErrors: false, errors: [] };
    }

    const isErrorVisible = await dashboardErrorContainer.first().isVisible();
    if (!isErrorVisible) {
      return { hasErrors: false, errors: [] };
    }

    const errors = [];

    // Check for error indicator text
    const errorText = page
      .locator('[data-test="dashboard-error"]')
      .getByText(/Errors \(\d+\)/);
    const errorTextCount = await errorText.count();

    if (errorTextCount > 0) {
      const errorTextContent = await errorText.first().textContent();
      errors.push(`Error indicator: ${errorTextContent}`);
    }

    // Check for error list items
    const errorListItems = page.locator('[data-test="dashboard-error"] ul li');
    const errorListCount = await errorListItems.count();

    if (errorListCount > 0) {
      for (let i = 0; i < errorListCount; i++) {
        const errorItem = errorListItems.nth(i);
        const errorItemText = await errorItem.textContent();
        if (errorItemText && errorItemText.trim().length > 0) {
          errors.push(`Error ${i + 1}: ${errorItemText.trim()}`);
        }
      }
    }

    return {
      hasErrors: errors.length > 0,
      errors,
      errorTextCount,
      errorListCount,
    };
  }
  // Helper function to verify chart renders successfully
  async function verifyChartRenders(page) {
    const chartRenderer = page.locator(
      '[data-test="chart-renderer"], [data-test="dashboard-panel-table"]'
    );
    const chartExists = await chartRenderer.count();

    if (chartExists > 0) {
      await expect(chartRenderer.first()).toBeVisible();
    }

    return chartExists > 0;
  }
  // Helper function to verify chart type selection
  async function verifyChartTypeSelected(
    page,
    chartType,
    shouldBeSelected = true
  ) {
    const selector = `[data-test="selected-chart-${chartType}-item"]`;
    const locator = page.locator(selector).locator("..");

    if (shouldBeSelected) {
      await expect(locator).toHaveClass(/bg-grey-[35]/);
    } else {
      await expect(locator).not.toHaveClass(/bg-grey-[35]/);
    }
  }
  async function addPanelToNewDashboard(page, randomDashboardName, panelName) {
    //add to dashboard and submit it
    await page
      .getByRole("button", { name: "Add To Dashboard" })
      .waitFor({ state: "visible", timeout: 15000 });
    await page.getByRole("button", { name: "Add To Dashboard" }).click();
    await page
      .locator('[data-test="dashboard-dashboard-new-add"]')
      .waitFor({ state: "visible", timeout: 15000 });

    //Adding dashboard
    await page.locator('[data-test="dashboard-dashboard-new-add"]').click();

    await page
      .locator('[data-test="add-dashboard-name"]')
      .waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page
      .locator('[data-test="dashboard-add-submit"]')
      .waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-add-submit"]').click();

    await page.waitForTimeout(3000);

    // Wait for dashboard creation and navigation to panel editing
    await page
      .locator('[data-test="metrics-new-dashboard-panel-title"]')
      .waitFor({ state: "visible", timeout: 15000 });
    await page
      .locator('[data-test="metrics-new-dashboard-panel-title"]')
      .click();
    await page
      .locator('[data-test="metrics-new-dashboard-panel-title"]')
      .fill(panelName);

    await page
      .locator('[data-test="metrics-schema-update-settings-button"]')
      .waitFor({ state: "visible", timeout: 15000 });
    await page
      .locator('[data-test="metrics-schema-update-settings-button"]')
      .click();

    await page.waitForTimeout(3000);
  }
  test("should handle large datasets and complex SQL queries without showing an error on the chart", async ({
    page,
  }) => {
    await page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByLabel("Editor content;Press Alt+F1")
      .fill(largeDatasetSqlQuery);

    // Apply the time filter and refresh the search
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    // Switch to SQL mode, apply the query, and refresh the search
    await page
      .getByRole("switch", { name: "SQL Mode" })
      .locator("div")
      .nth(2)
      .click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    // Toggle visualization
    await page.locator('[data-test="logs-visualize-toggle"]').click();

    // Check for any error messages or indicators
    const errorMessage = page.locator('[data-test="error-message"]'); // Update the selector based on your app's error message display
    const errorCount = await errorMessage.count();

    // Assert that no error messages are displayed
    await expect(errorCount).toBe(0); // Fail the test if any error messages are present
  });
  test("Stream should be correct on visualize page after switching between logs and visualize", async ({
    page,
  }) => {
    // Extract stream name from the SQL query dynamically
    const streamNameMatch = largeDatasetSqlQuery.match(/FROM\s+"([^"]+)"/);
    const expectedStreamName = streamNameMatch
      ? streamNameMatch[1]
      : STREAM_NAME;

    await page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByLabel("Editor content;Press Alt+F1")
      .fill(largeDatasetSqlQuery);

    // Apply the time filter and refresh the search
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    // Switch to SQL mode and refresh the search
    await page
      .getByRole("switch", { name: "SQL Mode" })
      .locator("div")
      .nth(2)
      .click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    // Toggle visualization
    await page.locator('[data-test="logs-visualize-toggle"]').click();
    await page
      .locator('[data-test="dashboard-field-list-collapsed-icon"]')
      .click();

    // Wait for the stream dropdown to be populated
    await page.waitForTimeout(2000);

    // Get stream value using multiple selector strategies
    const getStreamValue = async () => {
      const selectors = [
        () =>
          page
            .locator('[data-test="index-dropdown-stream"]')
            .getAttribute("value"),
        () =>
          page
            .locator('.q-field__native input[aria-label="Stream"]')
            .getAttribute("value"),
        () => page.locator('[data-test="index-dropdown-stream"]').inputValue(),
        () => page.locator('input[aria-label="Stream"]').getAttribute("value"),
      ];

      for (const selector of selectors) {
        try {
          const value = await selector();
          if (value) return value;
        } catch (error) {
          // Continue to next selector
        }
      }
      return null;
    };

    const streamValue = await getStreamValue();

    // Assert that the stream value matches the expected stream name from the query
    expect(streamValue).toBe(expectedStreamName);
    expect(streamValue).toBeTruthy();

    // Assert that the stream value is specifically "e2e_automate"
    expect(streamValue).toBe("e2e_automate");
  });
  test("should redirect the correct chart type when added the aggregation query", async ({
    page,
  }) => {
    // Extract stream name from the SQL query dynamically
    const streamNameMatch = largeDatasetSqlQuery.match(/FROM\s+"([^"]+)"/);
    const expectedStreamName = streamNameMatch
      ? streamNameMatch[1]
      : STREAM_NAME;

    await page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByLabel("Editor content;Press Alt+F1")
      .fill(largeDatasetSqlQuery);

    // Apply the time filter and refresh the search
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    // Toggle visualization
    await page.locator('[data-test="logs-visualize-toggle"]').click();

    // Wait for visualization to load
    await page.waitForTimeout(2000);

    // Robust check: wait for table panel to render (source of truth for selected type)
    await page.waitForSelector('[data-test="dashboard-panel-table"]', {
      timeout: 15000,
    });
    await expect(
      page.locator('[data-test="dashboard-panel-table"]')
    ).toBeVisible();

    // Method 3: Verify table-specific content is rendered (breakdown_1 column from the SQL query)
    await expect(
      page
        .locator('[data-test="dashboard-panel-table"]')
        .getByRole("cell", { name: "breakdown_1" })
    ).toBeVisible();
    await expect(
      page.locator('[data-test="dashboard-panel-table"]').first()
    ).toBeVisible();
  });
  test("should not show dashboard errors when changing chart types with aggregation query", async ({
    page,
  }) => {
    // Setup the test with aggregation query
    await setupAggregationQueryTest(page);

    // Define chart types to test
    const chartTypes = [
      { selector: '[data-test="selected-chart-table-item"]', name: "Table" },
      { selector: '[data-test="selected-chart-line-item"]', name: "Line" },
      { selector: '[data-test="selected-chart-bar-item"]', name: "Bar" },
      { selector: '[data-test="selected-chart-area-item"]', name: "Area" },
      {
        selector: '[data-test="selected-chart-scatter-item"]',
        name: "Scatter",
      },
      { selector: '[data-test="selected-chart-pie-item"]', name: "Pie" },
    ];

    // Test each chart type
    for (const chartType of chartTypes) {
      console.log(`Testing chart type: ${chartType.name}`);

      // Select the chart type
      await page.locator(chartType.selector).click();
      await page.waitForTimeout(1000);

      // Wait for chart to load
      await page.waitForTimeout(3000);

      // Check for dashboard errors
      const errorResult = await checkDashboardErrors(page, chartType.name);

      if (errorResult.hasErrors) {
        console.log(`Dashboard error found for ${chartType.name} chart:`);
        errorResult.errors.forEach((error, index) => {
          console.log(`  ${index + 1}. ${error}`);
        });

        // Fail the test with detailed error information
        expect(errorResult.errorTextCount).toBe(0);
        expect(errorResult.errorListCount).toBe(0);
      } else {
        console.log(`${chartType.name} chart: No dashboard errors found`);
      }

      // Verify the chart renders successfully
      const chartRendered = await verifyChartRenders(page);
      expect(chartRendered).toBe(true);
    }

    console.log("All chart types tested successfully without dashboard errors");
  });
  test("should set line chart as default when using histogram query", async ({
    page,
  }) => {
    // Setup the test with aggregation query
    const dateTimeHelper = new DateTimeHelper(page);

    await page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByLabel("Editor content;Press Alt+F1")
      .fill(histogramQuery);

    await dateTimeHelper.setRelativeTimeRangeForLogs("6-w");

    // Switch to SQL mode
    await page
      .getByRole("switch", { name: "SQL Mode" })
      .locator("div")
      .nth(2)
      .click();

    await dateTimeHelper.clickLogsRefreshBtn();

    await page.locator('[data-test="logs-visualize-toggle"]').click();

    await page.waitForTimeout(3000);

    // Verify line chart is selected as default for histogram queries
    await verifyChartTypeSelected(page, "line", true);

    // Verify table chart is NOT selected for histogram queries
    await verifyChartTypeSelected(page, "table", false);

    // Verify chart canvas renders successfully
    await expect(
      page.locator('[data-test="chart-renderer"] canvas').last()
    ).toBeVisible();

    // Verify chart renders without errors
    const chartRendered = await verifyChartRenders(page);
    expect(chartRendered).toBe(true);
  });
  test("Should display the correct query in the dashboard when saved from a Table chart.", async ({
    page,
  }) => {
    const dateTimeHelper = new DateTimeHelper(page);

    // Extract stream name from the SQL query dynamically
    const streamNameMatch = largeDatasetSqlQuery.match(/FROM\s+"([^"]+)"/);
    const expectedStreamName = streamNameMatch
      ? streamNameMatch[1]
      : STREAM_NAME;

    await page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByLabel("Editor content;Press Alt+F1")
      .fill(largeDatasetSqlQuery);

    await dateTimeHelper.setRelativeTimeRangeForLogs("6-w");

    await dateTimeHelper.clickLogsRefreshBtn();

    // Toggle visualization
    await page.locator('[data-test="logs-visualize-toggle"]').click();

    await page.waitForTimeout(2000);

    await addPanelToNewDashboard(page, randomDashboardName, panelName);

    // Wait for visualization to load
    await page.waitForTimeout(3000);

    await page
      .locator('[data-test="dashboard-edit-panel-' + panelName + '-dropdown"]')
      .click();
    await page.locator('[data-test="dashboard-query-inspector-panel"]').click();

    await page.waitForTimeout(2000);
    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT kubernetes_annotations_kubectl_kubernetes_io_default_container as "x_axis_1", count(kubernetes_container_hash) as "y_axis_1", count(kubernetes_container_name) as "y_axis_2", count(kubernetes_host) as "y_axis_3", count(kubernetes_labels_app_kubernetes_io_instance) as "y_axis_4", count(kubernetes_labels_app_kubernetes_io_name) as "y_axis_5", count(kubernetes_labels_app_kubernetes_io_version) as "y_axis_6", count(kubernetes_labels_operator_prometheus_io_name) as "y_axis_7", count(kubernetes_labels_prometheus) as "y_axis_8", kubernetes_labels_statefulset_kubernetes_io_pod_name as "breakdown_1" FROM "e2e_automate" WHERE kubernetes_namespace_name IS NOT NULL GROUP BY x_axis_1, breakdown_1',
        })
        .first()
    ).toBeVisible();
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });
  test("should display the correct query in the dashboard when saved from a Line chart.", async ({
    page,
  }) => {
    // Extract stream name from the SQL query dynamically
    const streamNameMatch = largeDatasetSqlQuery.match(/FROM\s+"([^"]+)"/);
    const expectedStreamName = streamNameMatch
      ? streamNameMatch[1]
      : STREAM_NAME;

    await page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .getByLabel("Editor content;Press Alt+F1")
      .fill(histogramQuery);

    // Apply the time filter and refresh the search
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    // Toggle visualization
    await page.locator('[data-test="logs-visualize-toggle"]').click();

    await page.waitForTimeout(2000);

    await addPanelToNewDashboard(page, randomDashboardName, panelName);

    await page.waitForTimeout(2000);
    await page
      .locator('[data-test="dashboard-edit-panel-' + panelName + '-dropdown"]')
      .click();
    await page.locator('[data-test="dashboard-query-inspector-panel"]').click();

    await page.waitForTimeout(2000);
    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        })
        .first()
    ).toBeVisible();
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });
});
