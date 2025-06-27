import { test, expect } from "../baseFixtures.js";
import { login } from "../utils/dashLogin.js";
import { ingestionForMaps } from "../utils/dashIngestion.js";

import {
  waitForDashboardPage,
  deleteDashboard,
} from "../utils/dashCreation.js";

import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart.js";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list.js";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create.js";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions.js";
import Dashboardvariables from "../../pages/dashboardPages/dashboard-variables.js";
import DashboardPanelConfigs from "../../pages/dashboardPages/dashboard-panel-configs.js";
import Dashboardfilter from "../../pages/dashboardPages/dashboard-filter.js";

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

  test("should correctly apply the filter conditions with different operators, and successfully apply them to the query", async ({
    page,
  }) => {
    // Navigate to Dashboards

    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardPageActions = new DashboardactionPage(page);
    const dashboardVariables = new Dashboardvariables(page);
    const dashboardFilter = new Dashboardfilter(page);

    // select dashboard
    await dashboardPage.menuItem("dashboards-item");

    // Wait for dashboard page
    await waitForDashboardPage(page);

    // Add new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    await page.waitForSelector('[data-test="dashboard-setting-btn"]', {
      state: "visible",
      timeout: 15000,
    });
    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await settingsButton.click();

    // Add variable
    await dashboardVariables.addDashboardVariable(
      "variablename",
      "logs",
      "geojson",
      "country"
    );

    await dashboardCreate.addPanel();

    await chartTypeSelector.selectChartType("geomap");

    // Add new dashboard
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("geojson");

    // Set Latitude, Longitude, and Weight fields

    await chartTypeSelector.searchAndAddField("lat", "latitude");
    await chartTypeSelector.searchAndAddField("lon", "longitude");
    await chartTypeSelector.searchAndAddField("country", "weight");
    await chartTypeSelector.searchAndAddField("country", "filter");

    // selct the variable and enter the value

    await dashboardFilter.addFilterCondition(
      0,
      "country",
      "country",
      ">=",
      "$variablename"
    );

    await dashboardPageActions.applyDashboardBtn();

    await dashboardPageActions.waitForChartToRender();

    // selct the variable and enter the value
    await dashboardVariables.selectValueFromVariableDropDown(
      "variablename",
      "china"
    );

    // apply the filter condition
    await dashboardFilter.addFilterCondition(
      0,
      "country",
      "country",
      "=",
      "$variablename"
    );

    await dashboardPageActions.applyDashboardBtn();

    // Wait for chart update

    await dashboardPageActions.waitForChartToRender();

    // Click specific position on map
    await page.locator("#chart-map canvas").click({
      position: { x: 643, y: 69 },
    });

    await dashboardPageActions.addPanelName(randomDashboardName);
    await dashboardPageActions.savePanel();

    // Delete Dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("Should display the correct location when manually entering latitude and longitude values", async ({
    page,
  }) => {
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardPageActions = new DashboardactionPage(page);
    const dashboardPanelConfigs = new DashboardPanelConfigs(page);

    // select dashboard
    await dashboardPage.menuItem("dashboards-item");

    // Wait for dashboard page
    await waitForDashboardPage(page);

    // Add new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();

    await chartTypeSelector.selectChartType("geomap");

    // Add new dashboard
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("geojson");

    // Set Latitude, Longitude, and Weight fields

    await chartTypeSelector.searchAndAddField("lat", "latitude");
    await chartTypeSelector.searchAndAddField("lon", "longitude");
    await chartTypeSelector.searchAndAddField("country", "weight");

    await dashboardPageActions.applyDashboardBtn();

    await dashboardPageActions.waitForChartToRender();

    await dashboardPanelConfigs.openConfigPanel();
    await dashboardPanelConfigs.selectLatitude("26.1206");
    await dashboardPanelConfigs.selectLongitude("091.6523");
    await dashboardPanelConfigs.selectZoom("12");

    await dashboardPageActions.applyDashboardBtn();
    await dashboardPageActions.waitForChartToRender();

    // Click on the map at the given position
    await page.locator("#chart-map canvas").click({
      position: { x: 26.1206, y: 91.6523 }, // Ensure this translates correctly to pixels
    });

    // Save panel

    await dashboardPageActions.addPanelName(randomDashboardName);
    await dashboardPageActions.savePanel();

    // Delete Dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });
});
