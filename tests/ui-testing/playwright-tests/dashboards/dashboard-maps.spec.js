import { test, expect } from "../baseFixtures.js";
import { login } from "../utils/dashLogin.js";
import geoMapdata from "../../../test-data/geo_map.json";
import {
  ingestionForMaps,
  getAuthTokenformaps,
  removeUTFCharacters1,
} from "../utils/dashIngestion.js";

import {
  waitForDashboardPage,
  deleteDashboard,
} from "../utils/dashCreation.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard maps testcases", () => {
  test.beforeEach(async ({ page }) => {
    console.log("running before each");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestionForMaps(page);
    await page.waitForTimeout(2000);
  });

  test("Should display the correct country when entering latitude and longitude values", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.waitForTimeout(3000);

    const button = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    await expect(button).toBeVisible();
    await button.click();

    await page.locator('[data-test="selected-chart-maps-item"]').click();
    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="index-dropdown-stream"]').click();

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .press("Control+a");
    await page.locator('[data-test="index-dropdown-stream"]').fill("geojson");

    await page.getByRole("option", { name: "geojson", exact: true }).click();

    await page
      .locator(
        '[data-test="field-list-item-logs-geojson-country"] [data-test="dashboard-add-x-data"]'
      )
      .click();
    await page
      .locator(
        '[data-test="field-list-item-logs-geojson-ip"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page
      .locator(
        '[data-test="field-list-item-logs-geojson-country"] [data-test="dashboard-add-filter-maps-data"]'
      )
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-label-0-country"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-list-tab"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-list-tab"]')
      .fill("India");
    await page.getByRole("option", { name: "India" }).click();

    // await page.locator('[data-test="dashboard-add-condition-list-item"]').click();
    await page.locator('[data-test="dashboard-apply"]').click();
    await page.waitForTimeout(2000);

    // Wait for the canvas to be visible
    await page.locator("#chart-map canvas").waitFor({ state: "visible" });

    // Click at the specific position on the canvas
    await page.locator("#chart-map canvas").click({
      position: { x: 19.0748, y: 72.8856 },
    });

    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashboard_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);
  });
});
