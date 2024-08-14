import { test, expect } from "@playwright/test";
import logData from "../cypress/fixtures/log.json";
import logsdata from "../../test-data/logs_data.json";

test.describe.configure({ mode: "parallel" });

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  await page.waitForTimeout(1000);

  //  await page.getByText('Login as internal user').click();
  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);
  //Enter Password
  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
  await page.waitForTimeout(4000);
  await page.goto(process.env["ZO_BASE_URL"]);
}

const selectStreamAndStreamTypeForLogs = async (page, stream) => {
  await page.waitForTimeout(4000);
  await page
    .locator('[data-test="log-search-index-list-select-stream"]')
    .click({ force: true });
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

  test("should allow adding a VRL function in the visualization chart ", async ({
    page,
  }) => {
    // await page.getByLabel('Expand "kubernetes_annotations_kubernetes_io_psp"').click();

    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-4-d-btn"]').click();

    // await page.locator('[data-test="logs-search-subfield-add-kubernetes_annotations_kubernetes_io_psp-eks\\.privileged"] [data-test="log-search-subfield-list-equal-kubernetes_annotations_kubernetes_io_psp-field-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();
    await page
      .locator(
        "#fnEditor > .monaco-editor > .overflow-guard > div:nth-child(2) > .lines-content > .view-lines > .view-line"
      )
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".vrl12=123");
    await page.waitForTimeout(2000);
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await expect(
      page.getByText("drag_indicatortext_fields vrl12")
    ).toBeVisible();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl12"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
  });

  test("should allow adding a VRL function from the saved function list in the visualization", async ({
    page,
  }) => {
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();
    await page
      .locator(
        "#fnEditor > .monaco-editor > .overflow-guard > div:nth-child(2) > .lines-content > .view-lines > .view-line"
      )
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".vrlsanity=100");
    await page.waitForTimeout(2000);

    await page
      .locator('[data-test="logs-search-bar-function-dropdown"] button')
      .filter({ hasText: "save" })
      .click();
    await page.locator('[data-test="saved-function-name-input"]').click();
    await page
      .locator('[data-test="saved-function-name-input"]')
      .fill("VRLsanity");
    await page.locator('[data-test="saved-view-dialog-save-btn"]').click();
    await page.waitForTimeout(1000);

    // await expect(page.getByText("Function saved successfully")).toBeVisible();
    // await page
    //   .locator('[data-test="logs-search-bar-reset-filters-btn"]')
    //   .click();
    // await page
    //   .locator("div")
    //   .filter({ hasText: /^\.vrlsanity=100$/ })
    //   .nth(3)
    //   .click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page
      .locator('[data-test="logs-search-bar-function-dropdown"]')
      .getByLabel("Expand")
      .click();

    // Locate the dropdown after expansion
    const dropdown = page.locator(
      '[data-test="logs-search-bar-function-dropdown"]'
    );

    // Scroll the dropdown until the "VRLsanity" option is visible
    await dropdown.evaluate((element) => {
      const option = Array.from(element.querySelectorAll("option")).find(
        (opt) => opt.textContent === "VRLsanity"
      );
      if (option) {
        option.scrollIntoView({ block: "center" }); // Scroll to the option
      }
    });

    // Click on the "VRLsanity" option
    await page.getByRole("option", { name: "VRLsanity" }).click();

    await expect(page.getByText("VRLsanity function applied")).toBeVisible();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrlsanity"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await expect(
      page.locator('[data-test="chart-renderer"] canvas')
    ).toBeVisible();

    await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
    await page.getByPlaceholder("Search Function").click();
    await page.getByPlaceholder("Search Function").fill("VRLsanity");
    await page.getByRole("button", { name: "Delete Function" }).first().click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator('[data-test="menu-link-\\/logs-item"]').click();
  });

  test('should display an error  masssge when  if  VRL field is not update after closing the "Toggle function editor " ', async ({
    page,
  }) => {
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await page
      .locator(
        "#fnEditor > .monaco-editor > .overflow-guard > div:nth-child(2) > .lines-content > .view-lines > .view-line"
      )
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".vrL=1000");
    await page.waitForTimeout(3000);

    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page
      .locator('[data-test="logs-search-bar-show-query-toggle-btn"] img')
      .click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.waitForTimeout(1000);

    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.waitForTimeout(1000);
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    await expect(
      page.getByText("There are some errors, please fix them and try again")
    ).toBeVisible();
    await page.locator("#q-notify").getByRole("button").click();
    await expect(page.getByText("Please update Y-Axis")).toBeVisible();
    await page.locator('[data-test="dashboard-y-item-vrl-remove"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
  });

  test('should not show an error when changing the chart type after adding a VRL function field', async ({
    page,
  }) => {
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();

    await page
      .locator(
        "#fnEditor > .monaco-editor > .overflow-guard > div:nth-child(2) > .lines-content > .view-lines > .view-line"
      )
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".VRLsanity=1000");

    await page.waitForTimeout(3000);

    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrlsanity"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="selected-chart-area-item"] img').click();
    await page
      .locator('[data-test="selected-chart-area-stacked-item"] img')
      .click();
    await page.locator('[data-test="selected-chart-h-bar-item"] img').click();
    await page.locator('[data-test="selected-chart-scatter-item"] img').click();
    await page
      .locator('[data-test="selected-chart-h-stacked-item"] img')
      .click();
    await page.locator('[data-test="selected-chart-heatmap-item"] img').click();
    await page.locator('[data-test="selected-chart-pie-item"] img').click();
    await page.locator('[data-test="selected-chart-table-item"] img').click();
    await page.locator('[data-test="selected-chart-gauge-item"] img').click();
  });

  test('"1should not show an error when changing the chart type after adding a VRL function field"', async ({
    page,
  }) => {
    // Variable to track errors
    let hasConsoleError = false;

    // Set up console error listener
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        console.error(`Console ${msg.type()} detected: ${msg.text()}`);
        hasConsoleError = true; // Set flag if error or warning detected
      }
    });

    // Start your test case interactions
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();

    await page
      .locator(
        "#fnEditor > .monaco-editor > .overflow-guard > div:nth-child(2) > .lines-content > .view-lines > .view-line"
      )
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".VRLsanity=1000");

    await page.waitForTimeout(3000);

    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrlsanity"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="selected-chart-area-item"] img').click();
    await page
      .locator('[data-test="selected-chart-area-stacked-item"] img')
      .click();
    await page.locator('[data-test="selected-chart-h-bar-item"] img').click();
    await page.locator('[data-test="selected-chart-scatter-item"] img').click();
    await page
      .locator('[data-test="selected-chart-h-stacked-item"] img')
      .click();
    await page.locator('[data-test="selected-chart-heatmap-item"] img').click();
    await page.locator('[data-test="selected-chart-pie-item"] img').click();
    await page.locator('[data-test="selected-chart-table-item"] img').click();
    await page.locator('[data-test="selected-chart-gauge-item"] img').click();

    // Optional: Wait a bit to capture late errors
    await page.waitForTimeout(3000);

    // Explicitly fail the test if any console error was detected
    if (hasConsoleError) {
      throw new Error("Console error detected during test execution.");
    }
  });

  test("should not show an error when adding a VRL function field to the Breakdown, X axis, or Y axis fields", async ({
    page,
  }) => {
    // Click the date-time button and select the relative time
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();

    // Refresh logs search bar
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    // Toggle visualization
    await page.locator('[data-test="logs-visualize-toggle"]').click();

    // Open the function editor and add a VRL function
    await page
      .locator(
        "#fnEditor > .monaco-editor > .overflow-guard > div:nth-child(2) > .lines-content > .view-lines > .view-line"
      )
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".VRL=1000");
    await page.waitForTimeout(3000);

    // Refresh logs search bar
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    // Add VRL function field to Breakdown
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-b-data"]'
      )
      .click();

    // Add VRL function field to Y axis
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-y-data"]'
      )
      .click();

    // Refresh logs search bar
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    // Remove the timestamp field from the X axis
    await page
      .locator('[data-test="dashboard-x-item-_timestamp-remove"]')
      .click();

    // Add VRL function field to X axis
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-x-data"]'
      )
      .click();

    // Refresh logs search bar
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    // Assertions to check that the VRL function fields are correctly added
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
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();

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
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page
      .locator(
        "#fnEditor > .monaco-editor > .overflow-guard > div:nth-child(2) > .lines-content > .view-lines > .view-line"
      )
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".vrl=11abc");
    await page.waitForTimeout(1000);

    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();

    await expect(page.getByText("warningFunction error: error[")).toBeVisible();

    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .press("Control+a");
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".vrl=123");
    await page.waitForTimeout(3000);
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
  });

  test("should not update the search query when adding or updating a VRL field", async ({
    page,
  }) => {
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();

    await page.getByLabel("SQL Mode").locator("div").nth(2).click();
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();

    await expect(
      page
        .locator('[data-test="logs-search-bar-query-editor"]')
        .getByText('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC')
    ).toBeVisible();
    await expect(
      page.locator(
        "#fnEditor > .monaco-editor > .overflow-guard > div:nth-child(2) > .lines-content > .view-lines > .view-line"
      )
    ).toBeVisible();
    await page
      .locator(
        "#fnEditor > .monaco-editor > .overflow-guard > div:nth-child(2) > .lines-content > .view-lines > .view-line"
      )
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".vrl=100");

    await page.waitForTimeout(2000);

    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await expect(
      page
        .locator('[data-test="logs-search-bar-query-editor"]')
        .getByText('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC')
    ).toBeVisible();
  });
  test.skip('should display an error if the VRL field is not updated from the Breakdown', async ({ page }) => {
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();
    await page.locator('#fnEditor > .monaco-editor > .overflow-guard > div:nth-child(2) > .lines-content > .view-lines > .view-line').click();
    await page.locator('#fnEditor').getByLabel('Editor content;Press Alt+F1').fill('.vrlsanity=100');
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="field-list-item-logs-e2e_automate-vrlsanity"] [data-test="dashboard-add-b-data"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('div').filter({ hasText: /^\.vrlsanity=100$/ }).nth(3).click();
    await page.locator('#fnEditor').getByLabel('Editor content;Press Alt+F1').press('Control+a');
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
  });

  test('should update the data on the chart when changing the time after applying a VRL field', async ({ page }) => {

    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="logs-visualize-toggle"]').click();
    await page.locator('#fnEditor > .monaco-editor > .overflow-guard > div:nth-child(2) > .lines-content > .view-lines > .view-line').click();
    await page.locator('#fnEditor').getByLabel('Editor content;Press Alt+F1').fill('.vrl=123');

    await page.waitForTimeout(3000);
    
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-b-data"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-4-w-btn"]').click();
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
  });

});
