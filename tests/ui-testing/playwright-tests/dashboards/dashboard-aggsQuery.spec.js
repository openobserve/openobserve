import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "../utils/dashLogin.js";
import { ingestion } from "../utils/dashIngestion.js";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "../utils/dashCreation.js";

import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart.js";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list.js";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create.js";
import DateTimeHelper from "../../pages/dashboardPages/dashboard-time.js";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard aggregations testcases", () => {
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
  test("Should return a response containing 'streaming_aggs: true' when executing a query with aggregation enabled.", async ({
    page,
  }) => {
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardPageActions = new DashboardactionPage(page);
    const dateTimeHelper = new DateTimeHelper(page);

    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(randomDashboardName);

    await dashboardCreate.addPanel();

    await chartTypeSelector.selectChartType("line");

    await chartTypeSelector.selectStreamType("logs");

    await chartTypeSelector.selectStream("e2e_automate");

    await page.waitForTimeout(2000);
    // await page
    //   .locator('[data-test="dashboard-x-item-x_axis_1-remove"]')
    //   .click();
    await page
      .locator('[data-test="dashboard-x-item-_timestamp-remove"]')
      .click();

    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");

    await chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");

    await dateTimeHelper.setRelativeTimeRange("6-w");

    await dashboardPageActions.applyDashboardBtn();

    // Wait for response

    // Apply query and wait for response
    await dashboardPageActions.applyDashboardBtn();
    await page.waitForResponse(async (res) => {
      const url = res.url();
      const isValid =
        url.includes("/_search_partition") &&
        url.includes("type=logs") &&
        res.status() === 200;

      if (isValid) {
        const body = await res.json().catch(() => null);
        return body?.streaming_aggs === true;
      }
      return false;
    });

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT kubernetes_container_name as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1',
        })
        .first()
    ).toBeVisible();

    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await dashboardPageActions.addPanelName(randomDashboardName);

    await dashboardPageActions.savePanel();

    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);
  });

  test("Should return a response containing 'streaming_aggs: false' when executing a query without aggregation..", async ({
    page,
  }) => {
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardPageActions = new DashboardactionPage(page);

    await dashboardPage.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await dashboardCreate.createDashboard(randomDashboardName);

    await dashboardCreate.addPanel();

    await chartTypeSelector.selectChartType("line");

    await chartTypeSelector.selectStreamType("logs");

    await chartTypeSelector.selectStream("e2e_automate");

    await chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");

    await dashboardPageActions.applyDashboardBtn();

    // Wait for response

    // Apply query and wait for response
    await dashboardPageActions.applyDashboardBtn();
    await page.waitForResponse(async (res) => {
      const url = res.url();
      const isValid =
        url.includes("/_search_partition") &&
        url.includes("type=logs") &&
        res.status() === 200;

      if (isValid) {
        const body = await res.json().catch(() => null);
        return body?.streaming_aggs === false;
      }
      return false;
    });

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        })
        .first()
    ).toBeVisible();

    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await dashboardPageActions.addPanelName(randomDashboardName);

    await dashboardPageActions.savePanel();

    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);
  });
});
