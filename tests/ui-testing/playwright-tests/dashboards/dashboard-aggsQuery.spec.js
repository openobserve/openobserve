import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "./utils/dashLogin.js";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

import PageManager from "../../pages/page-manager";

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

    // Ensure Streaming is disabled for consistent test behaviour
    const pm = new PageManager(page);
    await pm.managementPage.ensureStreamingDisabled();

    const orgNavigation = page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await orgNavigation;
  });
  test("Should return a response containing 'streaming_aggs: true' when executing a query with aggregation enabled.", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await pm.dashboardCreate.createDashboard(randomDashboardName);

    await pm.dashboardCreate.addPanel();

    await pm.chartTypeSelector.selectChartType("line");

    await pm.chartTypeSelector.selectStreamType("logs");

    await pm.chartTypeSelector.selectStream("e2e_automate");

    await page.waitForTimeout(2000);
    // await page
    //   .locator('[data-test="dashboard-x-item-x_axis_1-remove"]')
    //   .click();
    await page
      .locator('[data-test="dashboard-x-item-_timestamp-remove"]')
      .click();

    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_namespace_name",
      "y"
    );

    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_container_name",
      "x"
    );

    await pm.dateTimeHelper.setRelativeTimeRange("6-w");

    await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

    // Wait for response

    // Apply query and wait for response
    await pm.dashboardPanelActions.applyDashboardBtn();
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

    await pm.dashboardPanelActions.addPanelName(randomDashboardName);

    await pm.dashboardPanelActions.savePanel();

    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);
  });

  test("Should return a response containing 'streaming_aggs: false' when executing a query without aggregation..", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.dashboardList.menuItem("dashboards-item");

    await waitForDashboardPage(page);

    await pm.dashboardCreate.createDashboard(randomDashboardName);

    await pm.dashboardCreate.addPanel();

    await pm.chartTypeSelector.selectChartType("line");

    await pm.chartTypeSelector.selectStreamType("logs");

    await pm.chartTypeSelector.selectStream("e2e_automate");

    await pm.chartTypeSelector.searchAndAddField(
      "kubernetes_namespace_name",
      "y"
    );

    await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

    // Wait for response

    // Apply query and wait for response
    await pm.dashboardPanelActions.applyDashboardBtn();
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

    await pm.dashboardPanelActions.addPanelName(randomDashboardName);

    await pm.dashboardPanelActions.savePanel();

    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);
  });
});
