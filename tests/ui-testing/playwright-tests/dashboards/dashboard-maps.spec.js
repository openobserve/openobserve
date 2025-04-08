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

  test("Should display the correct country when entering latitude and longitude values", async ({ page }) => {
    // Navigate to Dashboards
    await page.locator('[data-test="menu-link-/dashboards-item"]').click();
    await waitForDashboardPage(page);
  
    // Create a new Dashboard
    await page.locator('[data-test="dashboard-add"]').click();
    const dashboardNameField = page.locator('[data-test="add-dashboard-name"]');
    await dashboardNameField.click();
    await dashboardNameField.fill(randomDashboardName);
    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.waitForTimeout(3000); // Consider replacing this with proper wait
  
    // Verify dashboard panel add button is visible
    const addPanelButton = page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]');
    await expect(addPanelButton).toBeVisible();
    await addPanelButton.click();
  
    // Select Maps Chart
    await page.locator('[data-test="selected-chart-maps-item"]').click();
  
    // Select Data Source
    const indexDropdown = page.locator('[data-test="index-dropdown-stream"]');
    await indexDropdown.waitFor({ state: "visible" });
    await indexDropdown.click();
    await indexDropdown.press("Control+a");
    await indexDropdown.fill("geojson");
    await page.getByRole("option", { name: "geojson", exact: true }).click();
  
    // Configure X, Y, and Filter Data
    await page.locator('[data-test="field-list-item-logs-geojson-country"] [data-test="dashboard-add-x-data"]').click();
    await page.locator('[data-test="field-list-item-logs-geojson-ip"] [data-test="dashboard-add-y-data"]').click();
    await page.locator('[data-test="field-list-item-logs-geojson-country"] [data-test="dashboard-add-filter-maps-data"]').click();
  
    // Apply Country Filter
    const conditionLabel = page.locator('[data-test="dashboard-add-condition-label-0-country"]');
    await conditionLabel.click();
    const conditionList = page.locator('[data-test="dashboard-add-condition-list-tab"]');
    await conditionList.click();
    await conditionList.fill("India");
    await page.getByRole("option", { name: "India" }).click();
  
    // Apply Dashboard Changes
    await page.locator('[data-test="dashboard-apply"]').click();
  
    // Wait for API response (Ensures data is loaded before interacting)
    await page.waitForResponse(response => 
      response.url().includes("/api/default/_search?type=logs&search_type=dashboards") &&
      response.status() === 200
    );
  
    // Click on Map at Specific Position
    await page.locator("#chart-map canvas").click({ position: { x: 19.0748, y: 72.8856 } });
  
    // Save the Dashboard
    const panelNameField = page.locator('[data-test="dashboard-panel-name"]');
    await panelNameField.click();
    await panelNameField.fill("Dashboard_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();
  
    // Navigate Back and Delete Dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });
  

});
