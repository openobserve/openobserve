import { test, expect } from "../baseFixtures.js";
import { login } from "./utils/dashLogin.js";
import { ingestionForDashboardChartJson } from "./utils/dashIngestion.js";

import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import PageManager from "../../pages/page-manager";
const testLogger = require('../utils/test-logger.js');

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

// Refactored test cases using Page Object Model

test.describe("dashboard UI testcases", () => {
  test.beforeEach(async ({ page }) => {
    testLogger.debug("Test setup - beforeEach hook executing");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestionForDashboardChartJson(page);
    await page.waitForTimeout(2000);
  });

  test("Should display data as JSON when the ‘Render Data as JSON/Array’ option is selected", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");
    // const dateTimeHelper = new DateTimeHelper(page);

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(randomDashboardName);
    await pm.dashboardCreate.addPanel();

    // Select a stream
    await pm.chartTypeSelector.selectChartType("table");


    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("kubernetes");

    await pm.chartTypeSelector.removeField("x_axis_1", "x");

    await pm.chartTypeSelector.searchAndAddField(
      "dns_records",
      "x"
    );
    await pm.chartTypeSelector.searchAndAddField( 
      "load_times_ms",
      "x"
    );

    await pm.chartTypeSelector.searchAndAddField(
      "dns_records",
      "filter"
    );

    await pm.dashboardFilter.addFilterCondition(
      0,
      "dns_records",
      "",
      "Is Not Null",
      ""
    );



    await page.locator('[data-test="dashboard-x-item-x_axis_1"]').click();
    await page.getByRole('checkbox', { name: 'Render Data as JSON / Array' }).click();

    // Set date-time and timezone for table chart
    await pm.dateTimeHelper.setRelativeTimeRange("6-w");
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Verify the table chart is visible
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify JSON data is rendered in the table
    await expect(page.locator('.json-field-renderer').first()).toBeVisible();
    await expect(page.locator('.json-key:has-text("domain")').first()).toBeVisible();
    await expect(page.locator('.json-value:has-text("service.local")').first()).toBeVisible();

    // Edit the panel name
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Delete the panel
    await pm.dashboardCreate.backToDashboardList();
    // await waitForDashboardPage(page);
    await deleteDashboard(page, randomDashboardName);
  });
});