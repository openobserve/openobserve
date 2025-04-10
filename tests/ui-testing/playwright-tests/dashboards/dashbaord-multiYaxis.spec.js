import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "../utils/dashLogin.js";
import { ingestion, removeUTFCharacters } from "../utils/dashIngestion.js";
import {
  waitForDashboardPage,
  applyQueryButton,
  deleteDashboard,
} from "../utils/dashCreation.js";

import ChartTypeSelector from "../../pages/dashbaordChart.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard filter testcases", () => {
  test.beforeEach(async ({ page }) => {
    console.log("running before each");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    const orgNavigation = page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await orgNavigation;
  });

  test("should correctly apply the filter conditions with different operators, and successfully apply them to the query", async ({
    page,
  }) => {
    const chartTypeSelector = new ChartTypeSelector(page);

    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.waitForTimeout(500);

    const button = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    await expect(button).toBeVisible();

    await page.waitForTimeout(2000);
    await button.click();

    // select the chart

    await chartTypeSelector.selectChartType("line");

    await page.waitForTimeout(2000);

    await chartTypeSelector.selectStreamType("logs");

    await chartTypeSelector.selectStream("e2e_automate");

    await page.waitForTimeout(2000);
  });
});
