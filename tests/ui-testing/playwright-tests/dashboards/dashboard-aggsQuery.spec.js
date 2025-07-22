import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import dashboardAggriData from "../../../test-data/dashboardAggri.json";
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
    await ingestion(page, "orders", dashboardAggriData);
    await page.waitForTimeout(2000);

    // 1️⃣  Force-disable both streaming and websocket at runtime
    await page.addInitScript(() => {
      // Available globally in the frontend; see zincutils.ts
      window.use_streaming = false;
      window.use_web_socket = false;
      window.use_aggregation_cache = false;
    });

    // You can keep the UI toggle for streaming if you like
    const pm = new PageManager(page);
    // await pm.managementPage.ensureStreamingDisabled();

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

    await pm.chartTypeSelector.selectStream("orders");

    await page.waitForTimeout(2000);
    // await page
    //   .locator('[data-test="dashboard-x-item-x_axis_1-remove"]')
    //   .click();
    await page
      .locator('[data-test="dashboard-x-item-_timestamp-remove"]')
      .click();

    await pm.chartTypeSelector.searchAndAddField("order_date", "x");

    await pm.chartTypeSelector.searchAndAddField("product", "y");

    await pm.dateTimeHelper.setRelativeTimeRange("10-m");

    // await pm.dashboardPanelActions.applyDashboardBtn();

    await page.waitForTimeout(2000);

    //  Start listening BEFORE triggering the search
    const [partitionResp] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/_search_partition") &&
          res.url().includes("type=logs") &&
          res.status() === 200,
        { timeout: 15_000 } // tighten if you like
      ),
      pm.dashboardPanelActions.applyDashboardBtn(), // this fires the query
    ]);

    const body = await partitionResp.json();
    expect(body.streaming_aggs).toBe(false);

    // Wait for response

    await pm.dashboardPanelActions.waitForChartToRender();

    await pm.dashboardPanelActions.applyDashboardBtn();

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT order_date as "x_axis_1", count(product) as "y_axis_1" FROM "orders" GROUP BY x_axis_1',
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

    await pm.chartTypeSelector.selectStream("orders");

    await pm.chartTypeSelector.searchAndAddField("product", "y");

    await pm.dashboardPanelActions.applyDashboardBtn();

    await page.waitForResponse(async (res) => {
      console.log("response", res);

      const url = res.url();
      console.log("url", url);
      const isValid = url.includes("/_search_partition");
      console.log("isValid", isValid);
      if (isValid) {
        const body = await res.json().catch(() => null);
        console.log("body", body);

        return body?.streaming_aggs === false;
      }
      return false;
    });

    await pm.dashboardPanelActions.waitForChartToRender();

    // Wait for response

    // Apply query and wait for response
    await pm.dashboardPanelActions.applyDashboardBtn();

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(_timestamp) as "x_axis_1", count(product) as "y_axis_1" FROM "orders" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
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
