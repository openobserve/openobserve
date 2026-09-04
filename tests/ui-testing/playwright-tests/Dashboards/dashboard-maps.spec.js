const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestionForMaps } from "./utils/dashIngestion.js";

import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

import PageManager from "../../pages/page-manager";
const testLogger = require('../utils/test-logger.js');

// Each test runs in parallel (mode: "parallel" below), so the name must be
// generated fresh per test — a single shared name causes cross-test races
// where one test's create/delete collides with another's mid-flight.
const generateDashboardName = () =>
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard maps testcases", () => {
  test.beforeEach(async ({ page }) => {
    testLogger.debug("Test setup - beforeEach hook executing");
    await navigateToBase(page);
    await page.waitForTimeout(1000);
    await ingestionForMaps(page);
    await page.waitForTimeout(2000);

    // navigateToBase() alone can land on the wrong org's page on cloud (the
    // stored session's "last active org" wins over the org_identifier query
    // param on a bare root load) — force the correct org context with an
    // explicit navigation to a real feature page, same as dashboard.spec.js's
    // beforeEach does via its post-ingestion page.goto(logsUrl).
    await page.goto(
      `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}&folder=default`
    );
    await page.waitForLoadState("domcontentloaded");
  });

  test("Should display the correct location when entering latitude and longitude values", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);
    const randomDashboardName = generateDashboardName();

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
    await pm.dashboardFilter.applyListConditionBySearch(0, "country", "India", "India");

    // Apply Dashboard Changes

    await pm.dashboardPanelActions.applyDashboardBtn();

    await pm.dashboardPanelActions.waitForChartToRender();

    // Click on Map at Specific Position
    await pm.chartTypeSelector.clickMapCanvas({ x: 19.0748, y: 72.8856 });

    // Save panel

    await pm.dashboardPanelActions.addPanelName(randomDashboardName);
    await pm.dashboardPanelActions.savePanel();

    // Delete Dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});
