import { test, expect } from "../baseFixtures.js";
import { login } from "./utils/dashLogin.js";
import { ingestionForMaps } from "./utils/dashIngestion.js";

import {
  waitForDashboardPage,
  deleteDashboard,
} from "./utils/dashCreation.js";

import ChartTypeSelector from "../../pages/dashboardPages/dashboard-chart.js";
import DashboardListPage from "../../pages/dashboardPages/dashboard-list.js";
import DashboardCreate from "../../pages/dashboardPages/dashboard-create.js";
import DashboardactionPage from "../../pages/dashboardPages/dashboard-panel-actions.js";

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

  test("Should display the correct location when entering latitude and longitude values", async ({
    page,
  }) => {
    const chartTypeSelector = new ChartTypeSelector(page);
    const dashboardPage = new DashboardListPage(page);
    const dashboardCreate = new DashboardCreate(page);
    const dashboardPageActions = new DashboardactionPage(page);

    // select dashboard
    await dashboardPage.menuItem("dashboards-item");

    // Wait for dashboard page
    await waitForDashboardPage(page);

    // Add new dashboard
    await dashboardCreate.createDashboard(randomDashboardName);
    await dashboardCreate.addPanel();

    await chartTypeSelector.selectChartType("maps");

    // Add new dashboard
    await chartTypeSelector.selectStreamType("logs");
    await chartTypeSelector.selectStream("geojson");

    await chartTypeSelector.searchAndAddField("country", "x");
    await chartTypeSelector.searchAndAddField("ip", "y");
    await chartTypeSelector.searchAndAddField("country", "filter");

    // Apply Country Filter
    const conditionLabel = page.locator(
      '[data-test="dashboard-add-condition-label-0-country"]'
    );
    await conditionLabel.click();
    const conditionList = page.locator(
      '[data-test="dashboard-add-condition-list-tab"]'
    );
    await conditionList.click();
    await conditionList.fill("India");
    await page.getByRole("option", { name: "India" }).click();

    // Apply Dashboard Changes

    await dashboardPageActions.applyDashboardBtn();

    await dashboardPageActions.waitForChartToRender();

    // Click on Map at Specific Position
    await page
      .locator("#chart-map canvas")
      .click({ position: { x: 19.0748, y: 72.8856 } });

    // Save panel

    await dashboardPageActions.addPanelName(randomDashboardName);
    await dashboardPageActions.savePanel();

    // Delete Dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });
});
