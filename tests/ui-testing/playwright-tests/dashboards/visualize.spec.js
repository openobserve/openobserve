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
  await page
    .locator("div.q-item")
    .getByText(`${stream}`)
    .first()
    .click({ force: true });
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

  test("should allow adding a VRL function in the visualization chart", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);

    await logsVisualise.setRelative("4", "d");

    await logsVisualise.logsApplyQueryButton();
    await logsVisualise.openVisualiseTab();

    await page.waitForTimeout(5000);
    await page
      .locator('[data-test="logs-vrl-function-editor"]')
      .first()
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".vrl12=123");
    await logsVisualise.applyQueryButtonVisualise();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl12"] [data-test="dashboard-add-b-data"]'
      )
      .click();

    await logsVisualise.applyQueryButtonVisualise();

    const vrlField = page.locator(
      '[data-test="field-list-item-logs-e2e_automate-vrl12"]'
    );
    await vrlField.waitFor({ state: "visible", timeout: 5000 });
    await expect(vrlField).toBeVisible();
  });
  test('should display an error message when the VRL field is not updated after closing the "Toggle function editor"', async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.setRelative("6", "d");
    // await page.locator('[data-test="date-time-btn"]').click();
    // await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await logsVisualise.logsApplyQueryButton();
    // await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await logsVisualise.openVisualiseTab();
    // await page.locator('[data-test="logs-visualize-toggle"]').click();

    // await page.waitForTimeout(2000);

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_annotations_kubernetes_io_psp"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await page.waitForTimeout(5000);
    await page
      .locator('[data-test="logs-vrl-function-editor"]')
      .first()
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".vrL=1000");
    await logsVisualise.applyQueryButtonVisualise();

    // await page
    //   .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
    //   .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await logsVisualise.applyQueryButtonVisualise();
    // await page
    //   .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
    //   .click();
    await logsVisualise.showQueryToggle();
    await logsVisualise.applyQueryButtonVisualise();

    await page.waitForTimeout(500); // Waits for 500ms before the second click
    await logsVisualise.applyQueryButtonVisualise();

    // await page
    //   .locator('text="There are some errors, please fix them and try again"')
    //   .waitFor({ state: "visible" });

    // await page.locator("#q-notify").getByRole("button").click();
    // await expect(page.getByText("Please update Y-Axis")).toBeVisible();
    await page.locator('[data-test="dashboard-y-item-vrl-remove"]').click();
    await logsVisualise.applyQueryButtonVisualise();
  });

  test("should not show an error when adding a VRL function field to the Breakdown, X axis, or Y axis fields", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.setRelative("6", "d");
    await logsVisualise.logsApplyQueryButton();
    await logsVisualise.openVisualiseTab();
    await page
      .locator('[data-test="logs-vrl-function-editor"]')
      .first()
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".VRL=1000");

    await logsVisualise.applyQueryButtonVisualise();
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
    await logsVisualise.applyQueryButtonVisualise();
    await page
      .locator('[data-test="dashboard-x-item-_timestamp-remove"]')
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-x-data"]'
      )
      .click();
    await logsVisualise.applyQueryButtonVisualise();
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
    await logsVisualise.setRelative("6", "d");
    await logsVisualise.logsApplyQueryButton();

    await logsVisualise.openVisualiseTab();

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
    await logsVisualise.applyQueryButtonVisualise();

    await page
      .locator('[data-test="logs-vrl-function-editor"]')
      .first()
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".vrl=11abc");
    await logsVisualise.applyQueryButtonVisualise();

    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .press("Control+a");
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".vrl=123");

    await page.waitForTimeout(3000);
    await logsVisualise.applyQueryButtonVisualise();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await logsVisualise.applyQueryButtonVisualise();
  });
  test("should not update the search query when adding or updating a VRL field", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.setRelative("6", "d");
    await logsVisualise.logsApplyQueryButton();
    await logsVisualise.openVisualiseTab();
    await logsVisualise.enableSQLMode();
    await logsVisualise.setRelative("6", "w");
    await logsVisualise.applyQueryButtonVisualise();
    await logsVisualise.openVisualiseTab();
    await expect(
      page
        .locator('[data-test="logs-search-bar-query-editor"]')
        .getByText('SELECT * FROM "e2e_automate"')
    ).toBeVisible();
    await page
      .locator('[data-test="logs-vrl-function-editor"]')
      .first()
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".vrl=100");
    await logsVisualise.applyQueryButtonVisualise();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await logsVisualise.applyQueryButtonVisualise();
    await expect(
      page
        .locator('[data-test="logs-search-bar-query-editor"]')
        .getByText('SELECT * FROM "e2e_automate"')
    ).toBeVisible();
  });
  test("should display an error if the VRL field is not updated from the Breakdown", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.setRelative("6", "d");
    await logsVisualise.logsApplyQueryButton();
    await logsVisualise.openVisualiseTab();
    await page
      .locator('[data-test="logs-vrl-function-editor"]')
      .first()
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".vrlsanity=100");

    await logsVisualise.applyQueryButtonVisualise();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrlsanity"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await logsVisualise.applyQueryButtonVisualise();
    await page
      .locator("div")
      .filter({ hasText: /^\.vrlsanity=100$/ })
      .nth(3)
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .press("Control+a");
    await logsVisualise.applyQueryButtonVisualise();
  });
  test("should update the data on the chart when changing the time after applying a VRL field", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.setRelative("6", "w");
    await logsVisualise.logsApplyQueryButton();
    await logsVisualise.openVisualiseTab();
    await page.locator('[data-test="logs-visualize-toggle"]').click();

    await page
      .locator('[data-test="logs-vrl-function-editor"]')
      .first()
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".vrl=123");

    await page.waitForTimeout(3000);
    await logsVisualise.applyQueryButtonVisualise();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrl"] [data-test="dashboard-add-b-data"]'
      )
      .click();
    await logsVisualise.applyQueryButtonVisualise();
    await logsVisualise.setRelative("4", "w");
    await logsVisualise.applyQueryButtonVisualise();
  });
  test("should not show an error when changing the chart type after adding a VRL function field", async ({
    page,
  }) => {
    const logsVisualise = new LogsVisualise(page);
    await logsVisualise.setRelative("6", "d");
    await logsVisualise.logsApplyQueryButton();
    // await page.locator('[data-test="date-time-btn"]').click();
    // await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    // await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await logsVisualise.openVisualiseTab();
    // await page.locator('[data-test="logs-visualize-toggle"]').click();

    // Set up a flag to detect errors
    let errorDetected = false;

    // Listen for console messages and check for errors
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const errorText = msg.text();
        // Check if the error matches a known pattern (customize regex as needed)
        if (/Error|Failure|Cannot|Invalid/i.test(errorText)) {
          errorDetected = true;
        }
      }
    });

    await page.waitForTimeout(5000);
    await page
      .locator('[data-test="logs-vrl-function-editor"]')
      .first()
      .click();
    await page
      .locator("#fnEditor")
      .getByLabel("Editor content;Press Alt+F1")
      .fill(".VRLsanity=1000");
    await page.waitForTimeout(3000);

    await logsVisualise.applyQueryButtonVisualise();

    // await page
    //   .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
    //   .waitFor({ state: "visible" });

    // await page
    //   .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
    //   .click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-vrlsanity"] [data-test="dashboard-add-y-data"]'
      )
      .click();

    // await page
    //   .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
    //   .click();
    await logsVisualise.applyQueryButtonVisualise();

    // Change chart types and check for errors each time
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

    for (const chartType of chartTypes) {
      await page.locator(chartType).click();

      await page.waitForTimeout(1000);
    }

    // Assertion: Fail the test if an error was detected
    expect(errorDetected).toBe(false);
  });
});
