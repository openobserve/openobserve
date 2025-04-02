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

import { Dash_create } from "../utils/dashboard_commFun.js";

export const randomDashboardName =
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

  test("Should update the query when adding different types of aggregations and verify that the query is updated correctly.", async ({
    page,
  }) => {
    // Navigate to dashboards
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);

    // Create a new dashboard
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);
    await page.locator('[data-test="dashboard-add-submit"]').click();

    // Add panel to the dashboard
    await page
      .locator('[data-test="dashboard-if-no-panel-add-panel-btn"]')
      .click();


    await page
      .locator("label")
      .filter({ hasText: "Streamarrow_drop_down" })
      .locator("i")
      .click();


    await page.getByRole("option", { name: "e2e_automate" }).click();

    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', {
      timeout: 5000,
    });
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="date-time-apply-btn"]').click();
    await page.locator('[data-test="dashboard-apply"]').click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_namespace_name"] [data-test="dashboard-add-y-data"]'
      )
      .click();

    await page
      .locator('[data-test="dashboard-y-item-kubernetes_namespace_name"]')
      .click();
    await page.locator('[data-test="dashboard-y-item-dropdown"]').click();
    await page.getByRole("option", { name: "Count (Distinct)" }).click();

    /// Apply button
    const applyButton = page.locator('[data-test="dashboard-apply"]');
    await applyButton.waitFor({ timeout: 15000 });
    await applyButton.click();

    await page.getByText("arrow_rightQueryAutoPromQLCustom SQL").click();
    await expect(
      page
        .locator('[data-test="dashboard-panel-query-editor"]')
        .getByText("distinct")
    ).toBeVisible();

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(_timestamp) as "x_axis_1", count(distinct(kubernetes_namespace_name)) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
          exact: true,
        })
        .first()
    ).toBeVisible();

    await page.locator('[data-test="query-inspector-close-btn"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashbaord_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });


  test("1Should update the query when adding different types of aggregations and verify that the query is updated correctly.", async ({
    page,
  }) => {
    // Navigate to dashboards
    const dashboard = new Dash_create(page);
     await dashboard.createDashbaord();
    await dashboard.streamSelect(page);
    await dashboard.


    
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_namespace_name"] [data-test="dashboard-add-y-data"]'
      )
      .click();

    await page
      .locator('[data-test="dashboard-y-item-kubernetes_namespace_name"]')
      .click();
    await page.locator('[data-test="dashboard-y-item-dropdown"]').click();
    await page.getByRole("option", { name: "Count (Distinct)" }).click();

    /// Apply button
    const applyButton = page.locator('[data-test="dashboard-apply"]');
    await applyButton.waitFor({ timeout: 15000 });
    await applyButton.click();

    await page.getByText("arrow_rightQueryAutoPromQLCustom SQL").click();
    await expect(
      page
        .locator('[data-test="dashboard-panel-query-editor"]')
        .getByText("distinct")
    ).toBeVisible();

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(_timestamp) as "x_axis_1", count(distinct(kubernetes_namespace_name)) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
          exact: true,
        })
        .first()
    ).toBeVisible();

    await page.locator('[data-test="query-inspector-close-btn"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashbaord_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });
});
