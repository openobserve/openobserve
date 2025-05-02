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

import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart.js";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list.js";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create.js";
import DateTimeHelper from "../../pages/dashboardPages/dashboard-time.js";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions.js";
import Dashboardvariables from "../../pages/dashboardPages/dashboard-variables.js";

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
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.waitForTimeout(3000);

    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();

    await page
      .locator('[data-test="dashboard-variable-name"]')
      .fill("variablename");

    await page
      .locator("label")
      .filter({ hasText: "Stream Type *arrow_drop_down" })
      .locator("i")
      .click();
    await page
      .getByRole("option", { name: "logs" })
      .locator("div")
      .nth(2)
      .click();

    await page
      .locator('[data-test="dashboard-variable-stream-select"]')
      .fill("geojson");
    await page
      .getByRole("option", { name: "geojson", exact: true })
      .locator("div")
      .nth(2)
      .click();

    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page
      .locator('[data-test="dashboard-variable-field-select"]')
      .fill("country");
    await page.getByText("country").click();

    await page.locator('[data-test="dashboard-variable-save-btn"]').click();

    await page.locator('[data-test="dashboard-settings-close-btn"]').click();

    const button = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    await expect(button).toBeVisible();
    await button.click();

    await page.locator('[data-test="selected-chart-geomap-item"] img').click();
    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="index-dropdown-stream"]').click();

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .press("Control+a");
    await page.locator('[data-test="index-dropdown-stream"]').fill("geojson");

    await page.getByRole("option", { name: "geojson", exact: true }).click();

    await page.waitForTimeout(2000);
    await page
      .locator(
        '[data-test="field-list-item-logs-geojson-lat"] [data-test="dashboard-add-latitude-data"]'
      )
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-geojson-lon"] [data-test="dashboard-add-longitude-data"]'
      )
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-geojson-country"] [data-test="dashboard-add-weight-data"]'
      )
      .click();

    const filterButton = page.locator(
      '[data-test="field-list-item-logs-geojson-country"] [data-test="dashboard-add-filter-geomap-data"]'
    );
    await expect(filterButton).toBeVisible();
    await filterButton.click();

    await page.locator('[data-test="dashboard-apply"]').click();

    await page.waitForTimeout(2000);

    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .click();
    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .fill("china");

    const option = await page.getByRole("option", { name: "china" });
    await option.click();

    await page
      .locator('[data-test="dashboard-add-condition-label-0-country"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-condition-0"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .click();

    await page.getByText("=", { exact: true }).click();
    await page.getByLabel("Value").click();
    await page.getByLabel("Value").fill("$variablename");

    await page.locator('[data-test="dashboard-apply"]').click();

    await page.waitForTimeout(3000);

    await page.locator("#chart-map canvas").click({
      position: {
        x: 643,
        y: 69,
      },
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

  test("Should display the correct location when manually entering latitude and longitude values", async ({
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

    await page.locator('[data-test="selected-chart-geomap-item"] img').click();
    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="index-dropdown-stream"]').click();

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .press("Control+a");
    await page.locator('[data-test="index-dropdown-stream"]').fill("geojson");

    await page.getByRole("option", { name: "geojson", exact: true }).click();

    await page.waitForTimeout(2000);
    await page
      .locator(
        '[data-test="field-list-item-logs-geojson-lat"] [data-test="dashboard-add-latitude-data"]'
      )
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-geojson-lon"] [data-test="dashboard-add-longitude-data"]'
      )
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-geojson-country"] [data-test="dashboard-add-weight-data"]'
      )
      .click();

    await page.locator('[data-test="dashboard-apply"]').click();

    await page.locator('[data-test="dashboard-sidebar"]').click();

    await page.locator('[data-test="dashboard-config-latitude"]').click();
    await page.locator('[data-test="dashboard-config-latitude"]').click();
    await page
      .locator('[data-test="dashboard-config-latitude"]')
      .fill("26.1206");

    await page.locator('[data-test="dashboard-config-longitude"]').click();
    await page
      .locator('[data-test="dashboard-config-longitude"]')
      .fill("091.6523");

    await page.locator('[data-test="dashboard-config-zoom"]').click();
    await page.locator('[data-test="dashboard-config-zoom"]').fill("12");
    await page.locator('[data-test="dashboard-apply"]').click();

    // Click on the map at the given position
    await page.locator("#chart-map canvas").click({
      position: { x: 26.1206, y: 91.6523 }, // Ensure this translates correctly to pixels
    });
    await page.waitForTimeout(5000);
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashboard_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);
  });

  test("1should correctly apply the filter conditions with different operators, and successfully apply them to the query", async ({
    page,
  }) => {
    // Navigate to Dashboards
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);

    // Add new dashboard
    await page.locator('[data-test="dashboard-add"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);
    await page.locator('[data-test="dashboard-add-submit"]').click();

    // Wait for settings button and open settings
    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    // Add variable
    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();
    await page
      .locator('[data-test="dashboard-variable-name"]')
      .fill("variablename");

    // Select Stream Type
    await page
      .locator('[data-test="dashboard-variable-stream-select"]')
      .click();
    await page
      .locator('[data-test="dashboard-variable-stream-select"]')
      .fill("geojson");
    await page.getByRole("option", { name: "geojson", exact: true }).click();

    // Select Field
    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page
      .locator('[data-test="dashboard-variable-field-select"]')
      .fill("country");
    await page.getByText("country").click();

    // Save Variable and Close Settings
    await page.locator('[data-test="dashboard-variable-save-btn"]').click();
    await page.locator('[data-test="dashboard-settings-close-btn"]').click();

    // Add new panel
    const addPanelButton = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    await expect(addPanelButton).toBeVisible();
    await addPanelButton.click();

    // Select Geo Map chart
    await page.locator('[data-test="selected-chart-geomap-item"] img').click();
    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });

    // Select stream "geojson"
    await page.locator('[data-test="index-dropdown-stream"]').fill("geojson");
    await page.getByRole("option", { name: "geojson", exact: true }).click();

    // Set Latitude, Longitude, and Weight fields
    await page
      .locator(
        '[data-test="field-list-item-logs-geojson-lat"] [data-test="dashboard-add-latitude-data"]'
      )
      .click();
    await page
      .locator(
        '[data-test="field-list-item-logs-geojson-lon"] [data-test="dashboard-add-longitude-data"]'
      )
      .click();
    await page
      .locator(
        '[data-test="field-list-item-logs-geojson-country"] [data-test="dashboard-add-weight-data"]'
      )
      .click();

    // Apply filter to "country"
    await page
      .locator(
        '[data-test="field-list-item-logs-geojson-country"] [data-test="dashboard-add-filter-geomap-data"]'
      )
      .click();
    await page.locator('[data-test="dashboard-apply"]').click();

    // Wait for response
    await page.waitForResponse(
      (response) =>
        response
          .url()
          .includes("/api/default/_search?type=logs&search_type=dashboards") &&
        response.status() === 200
    );

    // Apply variable to filter
    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .click();
    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .fill("china");
    await page.getByRole("option", { name: "china" }).click();

    // Apply filter conditions
    await page
      .locator('[data-test="dashboard-add-condition-label-0-country"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-condition-0"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .click();
    await page.getByText("=", { exact: true }).click();
    await page.getByLabel("Value").fill("$variablename");
    await page.locator('[data-test="dashboard-apply"]').click();

    // Wait for chart update
    await page.waitForResponse(
      (response) =>
        response
          .url()
          .includes("/api/default/_search?type=logs&search_type=dashboards") &&
        response.status() === 200
    );

    // Click specific position on map
    await page.locator("#chart-map canvas").click({
      position: { x: 643, y: 69 },
    });

    // Save panel
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashboard_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete Dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("111should correctly apply the filter conditions with different operators, and successfully apply them to the query", async ({
    page,
  }) => {
    // Navigate to Dashboards

    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dateTimeHelper = new DateTimeHelper(page);
    const dashboardPageActions = new DashboardactionPage(page);
    const dashboardVariables = new Dashboardvariables(page);

    // select dashboard
    await dashboardPage.menuItem("dashboards-item");

    // Wait for dashboard page
    await waitForDashboardPage(page);

    // Add new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);

    await page.waitForTimeout(3000);
    // Wait for settings button and open settings
    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    // Add variable
    await dashboardVariables.addDashboardVariable(
      "variablename1",
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

    await chartTypeSelector.addFilterCondition(
      "country",
      "country",
      ">=",
      "$variablename"
    );

    await dashboardPageActions.applyDashboardBtn();

    await dashboardPageActions.waitForChartToRender();

    // selct the variable and enter the value
    await dashboardVariables.selectValueFromVariableDropDown(
      "variablename1",
      "china"
    );

    // Apply filter conditions
    await chartTypeSelector.addFilterCondition(
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
    await page.waitForTimeout(4000);

    // Save panel

    await dashboardPageActions.addPanelName(randomDashboardName);
    await dashboardPageActions.savePanel();

    // Delete Dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("1111Should display the correct location when manually entering latitude and longitude values", async ({
    page,
  }) => {
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dateTimeHelper = new DateTimeHelper(page);
    const dashboardPageActions = new DashboardactionPage(page);
    const dashboardVariables = new Dashboardvariables(page);

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
    //  await chartTypeSelector.searchAndAddField("country", "filter");
    await page.waitForTimeout(2000);
    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-geojson-lat"] [data-test="dashboard-add-latitude-data"]'
    //   )
    //   .click();

    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-geojson-lon"] [data-test="dashboard-add-longitude-data"]'
    //   )
    //   .click();

    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-geojson-country"] [data-test="dashboard-add-weight-data"]'
    //   )
    //   .click();

    // await page.locator('[data-test="dashboard-apply"]').click();

    await dashboardPageActions.applyDashboardBtn();

    await dashboardPageActions.waitForChartToRender();

    await page.locator('[data-test="dashboard-sidebar"]').click();

    await page.locator('[data-test="dashboard-config-latitude"]').click();
    await page.locator('[data-test="dashboard-config-latitude"]').click();
    await page
      .locator('[data-test="dashboard-config-latitude"]')
      .fill("26.1206");

    await page.locator('[data-test="dashboard-config-longitude"]').click();
    await page
      .locator('[data-test="dashboard-config-longitude"]')
      .fill("091.6523");

    await page.locator('[data-test="dashboard-config-zoom"]').click();
    await page.locator('[data-test="dashboard-config-zoom"]').fill("12");
    await page.locator('[data-test="dashboard-apply"]').click();

    // Click on the map at the given position
    await page.locator("#chart-map canvas").click({
      position: { x: 26.1206, y: 91.6523 }, // Ensure this translates correctly to pixels
    });
    await page.waitForTimeout(5000);
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
