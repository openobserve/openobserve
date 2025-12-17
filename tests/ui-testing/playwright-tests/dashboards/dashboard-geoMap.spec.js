import { test, expect } from "../baseFixtures.js";
import { login } from "./utils/dashLogin.js";
import { ingestionForMaps } from "./utils/dashIngestion.js";

import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import PageManager from "../../pages/page-manager";
const testLogger = require('../utils/test-logger.js');

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard maps testcases", () => {
  test.beforeEach(async ({ page }) => {
    testLogger.debug("Test setup - beforeEach hook executing");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestionForMaps(page);
    await page.waitForTimeout(2000);
  });

  test("should correctly apply the filter conditions with different operators, and successfully apply them to the query", async ({
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

    await page.waitForSelector('[data-test="dashboard-setting-btn"]', {
      state: "visible",
      timeout: 15000,
    });
    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await settingsButton.click();

    // Add variable
    await pm.dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "geojson",
      "country"
    );

    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("geomap");

    // Add new dashboard
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("geojson");

    // Set Latitude, Longitude, and Weight fields

    await pm.chartTypeSelector.searchAndAddField("lat", "latitude");
    await pm.chartTypeSelector.searchAndAddField("lon", "longitude");
    await pm.chartTypeSelector.searchAndAddField("country", "weight");
    await pm.chartTypeSelector.searchAndAddField("country", "filter");

    // selct the variable and enter the value

    await pm.dashboardFilter.addFilterCondition(
      0,
      "country",
      "country",
      ">=",
      "$variablename"
    );

    await waitForDateTimeButtonToBeEnabled(page);
    await pm.dashboardTimeRefresh.setRelative("30", "m");
    // await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

    // selct the variable and enter the value
    await pm.dashboardVariables.selectValueFromVariableDropDown(
      "variablename",
      "china"
    );

    // apply the filter condition
    await pm.dashboardFilter.addFilterCondition(
      0,
      "country",
      "country",
      "=",
      "$variablename"
    );

    await pm.dashboardPanelActions.applyDashboardBtn();

    // Wait for chart update

    await pm.dashboardPanelActions.waitForChartToRender();

    // Click specific position on map
    await page.locator("#chart-map canvas").click({
      position: { x: 643, y: 69 },
    });

    await pm.dashboardPanelActions.addPanelName(randomDashboardName);
    await pm.dashboardPanelActions.savePanel();

    // Delete Dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("Should display the correct location when manually entering latitude and longitude values", async ({
    page,
  }) => {
    //instantiate PageManager with the current page
    const pm = new PageManager(page);

    // select dashboard
    await pm.dashboardList.menuItem("dashboards-item");

    // Wait for dashboard page
    await waitForDashboardPage(page);

    // Add new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();

    await pm.chartTypeSelector.selectChartType("geomap");

    // Add new dashboard
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("geojson");

    // Set Latitude, Longitude, and Weight fields

    await pm.chartTypeSelector.searchAndAddField("lat", "latitude");
    await pm.chartTypeSelector.searchAndAddField("lon", "longitude");
    await pm.chartTypeSelector.searchAndAddField("country", "weight");

    await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.selectLatitude("26.1206");
    await pm.dashboardPanelConfigs.selectLongitude("091.6523");
    await pm.dashboardPanelConfigs.selectZoom("12");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Click on the map at the given position
    await page.locator("#chart-map canvas").click({
      position: { x: 26.1206, y: 91.6523 }, // Ensure this translates correctly to pixels
    });

    // Save panel

    await pm.dashboardPanelActions.addPanelName(randomDashboardName);
    await pm.dashboardPanelActions.savePanel();

    // Delete Dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });
});
