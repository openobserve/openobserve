import { test, expect } from "../baseFixtures.js";
import { login } from "./utils/dashLogin.js";
import { ingestionForMaps } from "./utils/dashIngestion.js";

import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

import PageManager from "../../pages/page-manager";
const testLogger = require('../utils/test-logger.js');

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard maps testcases", () => {
  test.beforeEach(async ({ page }) => {
    testLogger.debug("Test setup - beforeEach hook executing");
    await login(page);
    await ingestionForMaps(page);
  });

  test("Should display the correct location when entering latitude and longitude values", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // select dashboard
    await pm.dashboardList.menuItem("dashboards-item");

    // Wait for dashboard page
    await waitForDashboardPage(page);

    // Add new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();

    await pm.chartTypeSelector.selectChartType("maps");

    // Add new dashboard
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("geojson");

    await pm.chartTypeSelector.searchAndAddField("country", "x");
    await pm.chartTypeSelector.searchAndAddField("ip", "y");
    await pm.chartTypeSelector.searchAndAddField("country", "filter");

    // Apply Country Filter
    const conditionLabel = page.locator(
      '[data-test="dashboard-add-condition-label-0-country"]'
    );
    await conditionLabel.click();
    const conditionList = page.locator('[data-test="dashboard-add-condition-list-tab"]');
    await conditionList.click();
    // Fill the search input inside the OSelect popover
    const conditionSearch = page.locator('[data-test="dashboard-add-condition-list-tab-search"]');
    await conditionSearch.waitFor({ state: "visible", timeout: 5000 });
    await conditionSearch.fill("India");
    // Select the matching option via data-test-value
    const indiaOption = page.locator('[data-test="dashboard-add-condition-list-tab-option"][data-test-value="India"]');
    await indiaOption.waitFor({ state: "visible", timeout: 5000 });
    await indiaOption.click();

    // Apply Dashboard Changes

    await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

    // Click on Map at Specific Position
    await page
      .locator("#chart-map canvas")
      .click({ position: { x: 19.0748, y: 72.8856 } });

    // Save panel

    await pm.dashboardPanelActions.addPanelName(randomDashboardName);
    await pm.dashboardPanelActions.savePanel();

    // Delete Dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });
});
