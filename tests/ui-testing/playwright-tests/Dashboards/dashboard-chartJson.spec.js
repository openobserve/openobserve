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

  test("Should display data as JSON when the 'Render Data as JSON/Array' option is selected", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-test");

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

    // Close the field options popover so it doesn't block Apply
    await page.keyboard.press('Escape');

    // Set date-time and timezone for table chart
    await pm.dateTimeHelper.setRelativeTimeRange("6-w");
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Verify the table chart is visible
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify JSON data is rendered in the table
    await expect(page.locator('.json-field-renderer').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.json-key:has-text("domain")').first()).toBeVisible();
    await expect(page.locator('.json-value:has-text("service.local")').first()).toBeVisible();

    // Edit the panel name
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();

    // Delete the panel
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, randomDashboardName);
  });
});

// Custom query mode tests for "Mark this field as non-timestamp" and "Render Data as JSON / Array"
test.describe("dashboard custom query mode field options testcases", () => {
  test.beforeEach(async ({ page }) => {
    testLogger.debug("Test setup - beforeEach hook executing for custom mode tests");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestionForDashboardChartJson(page);
    await page.waitForTimeout(2000);
  });

  test("Should show 'Mark this field as non-timestamp' checkbox in custom query mode for table chart", {
    tag: ['@dashboardChartJson', '@customMode', '@P0']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashName = "Dashboard_" + Math.random().toString(36).substr(2, 9);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("custom-nontimestamp");

    testLogger.info('Testing non-timestamp checkbox visibility in custom query mode');

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashName);
    await pm.dashboardCreate.addPanel();

    // Select table chart type and switch to custom query mode
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("kubernetes");
    await pm.chartTypeSelector.switchToCustomQueryMode();

    // Enter a custom SQL query
    await pm.chartTypeSelector.enterCustomSQL('SELECT * FROM "kubernetes"');
    await page.waitForTimeout(1000);

    // Set date-time range
    await pm.dateTimeHelper.setRelativeTimeRange("6-w");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Click on the first x-axis field to open property popup
    await pm.chartTypeSelector.openFieldPropertyPopup("x_axis_1", "x");

    // Verify "Mark this field as non-timestamp" checkbox is visible in custom mode
    await expect(pm.chartTypeSelector.treatAsNonTimestampCheckbox).toBeVisible({ timeout: 10000 });

    // Toggle the checkbox and verify it can be checked
    const isCheckedBefore = await pm.chartTypeSelector.treatAsNonTimestampCheckbox.isChecked();
    await pm.chartTypeSelector.toggleTreatAsNonTimestamp();
    const isCheckedAfter = await pm.chartTypeSelector.treatAsNonTimestampCheckbox.isChecked();
    expect(isCheckedAfter).not.toBe(isCheckedBefore);

    testLogger.info('Non-timestamp checkbox is visible and toggleable in custom mode');

    // Close the popup
    await page.keyboard.press('Escape');

    // Save and cleanup
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashName);
  });

  test("Should show 'Render Data as JSON / Array' checkbox in custom query mode for table chart", {
    tag: ['@dashboardChartJson', '@customMode', '@P0']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashName = "Dashboard_" + Math.random().toString(36).substr(2, 9);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("custom-json");

    testLogger.info('Testing JSON/Array checkbox visibility in custom query mode');

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashName);
    await pm.dashboardCreate.addPanel();

    // Select table chart type and switch to custom query mode
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("kubernetes");
    await pm.chartTypeSelector.switchToCustomQueryMode();

    // Enter a custom SQL query
    await pm.chartTypeSelector.enterCustomSQL('SELECT * FROM "kubernetes"');
    await page.waitForTimeout(1000);

    // Set date-time range
    await pm.dateTimeHelper.setRelativeTimeRange("6-w");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Click on the first x-axis field to open property popup
    await pm.chartTypeSelector.openFieldPropertyPopup("x_axis_1", "x");

    // Verify "Render Data as JSON / Array" checkbox is visible in custom mode
    await expect(pm.chartTypeSelector.showFieldAsJsonCheckbox).toBeVisible({ timeout: 10000 });

    // Toggle the checkbox and verify it can be checked
    const isCheckedBefore = await pm.chartTypeSelector.showFieldAsJsonCheckbox.isChecked();
    await pm.chartTypeSelector.toggleShowFieldAsJson();
    const isCheckedAfter = await pm.chartTypeSelector.showFieldAsJsonCheckbox.isChecked();
    expect(isCheckedAfter).not.toBe(isCheckedBefore);

    testLogger.info('JSON/Array checkbox is visible and toggleable in custom mode');

    // Close the popup
    await page.keyboard.press('Escape');

    // Save and cleanup
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashName);
  });

  test("Should render JSON data in table when 'Render Data as JSON / Array' is enabled in custom query mode", {
    tag: ['@dashboardChartJson', '@customMode', '@P1']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashName = "Dashboard_" + Math.random().toString(36).substr(2, 9);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("custom-json-render");

    testLogger.info('Testing JSON rendering in custom query mode');

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashName);
    await pm.dashboardCreate.addPanel();

    // Select table chart type and switch to custom query mode
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("kubernetes");
    await pm.chartTypeSelector.switchToCustomQueryMode();

    // Enter a custom SQL query that includes the dns_records JSON field
    await pm.chartTypeSelector.enterCustomSQL('SELECT dns_records, load_times_ms FROM "kubernetes" WHERE dns_records IS NOT NULL');
    await page.waitForTimeout(1000);

    // Set date-time range
    await pm.dateTimeHelper.setRelativeTimeRange("6-w");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Click on the first x-axis field (dns_records) and enable JSON rendering
    await pm.chartTypeSelector.openFieldPropertyPopup("x_axis_1", "x");
    await pm.chartTypeSelector.toggleShowFieldAsJson();

    // Close the popup before applying. The popup is a q-menu portaled outside the
    // axis-item button, so Escape must dismiss it before clicking Apply — otherwise
    // CI runs occasionally see Apply intercepted by the still-mounted menu.
    // Wait for the JSON-toggle checkbox (which only renders inside the open popup)
    // to detach before continuing, so the menu is guaranteed gone.
    await page.keyboard.press('Escape');
    await page
      .locator('[data-test="dynamic-function-popup-show-field-as-json"]')
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {});
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify JSON data is rendered in the table (element may be in overflow, check DOM presence)
    const jsonRenderers = page.locator('.json-field-renderer');
    await jsonRenderers.first().waitFor({ state: 'attached', timeout: 30000 });
    const jsonCount = await jsonRenderers.count();
    expect(jsonCount).toBeGreaterThan(0);

    testLogger.info('JSON data rendered successfully in custom query mode', { jsonCount });

    // Save and cleanup
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashName);
  });

  test("Should hide Build/Raw tabs but show checkboxes in custom query mode for table chart", {
    tag: ['@dashboardChartJson', '@customMode', '@P2']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashName = "Dashboard_" + Math.random().toString(36).substr(2, 9);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("custom-tabs-hidden");

    testLogger.info('Testing Build/Raw tabs hidden and checkboxes visible in custom mode');

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashName);
    await pm.dashboardCreate.addPanel();

    // Select table chart type and switch to custom query mode
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("kubernetes");
    await pm.chartTypeSelector.switchToCustomQueryMode();

    // Enter a custom SQL query
    await pm.chartTypeSelector.enterCustomSQL('SELECT * FROM "kubernetes"');
    await page.waitForTimeout(1000);

    // Set date-time range
    await pm.dateTimeHelper.setRelativeTimeRange("6-w");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Click on the first x-axis field to open property popup
    await pm.chartTypeSelector.openFieldPropertyPopup("x_axis_1", "x");

    // Verify Build/Raw tabs are NOT visible in custom query mode
    await pm.chartTypeSelector.verifyBuildRawTabsNotVisible(expect);

    // Verify both checkboxes ARE visible
    await expect(pm.chartTypeSelector.treatAsNonTimestampCheckbox).toBeVisible({ timeout: 10000 });
    await expect(pm.chartTypeSelector.showFieldAsJsonCheckbox).toBeVisible({ timeout: 10000 });

    testLogger.info('Build/Raw tabs hidden, checkboxes visible in custom mode');

    // Close the popup
    await page.keyboard.press('Escape');

    // Save and cleanup
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashName);
  });

  test("Should allow enabling both checkboxes simultaneously in custom query mode", {
    tag: ['@dashboardChartJson', '@customMode', '@P2']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashName = "Dashboard_" + Math.random().toString(36).substr(2, 9);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("custom-both-opts");

    testLogger.info('Testing both checkboxes enabled simultaneously in custom mode');

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);

    // Create a new dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashName);
    await pm.dashboardCreate.addPanel();

    // Select table chart type and switch to custom query mode
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("kubernetes");
    await pm.chartTypeSelector.switchToCustomQueryMode();

    // Enter a custom SQL query
    await pm.chartTypeSelector.enterCustomSQL('SELECT * FROM "kubernetes"');
    await page.waitForTimeout(1000);

    // Set date-time range
    await pm.dateTimeHelper.setRelativeTimeRange("6-w");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Click on the first x-axis field to open property popup
    await pm.chartTypeSelector.openFieldPropertyPopup("x_axis_1", "x");

    // Read initial states of both checkboxes
    const nonTimestampBefore = await pm.chartTypeSelector.treatAsNonTimestampCheckbox.isChecked();
    const jsonBefore = await pm.chartTypeSelector.showFieldAsJsonCheckbox.isChecked();

    // Toggle "Mark this field as non-timestamp" and verify state changed
    await pm.chartTypeSelector.toggleTreatAsNonTimestamp();
    const nonTimestampAfter = await pm.chartTypeSelector.treatAsNonTimestampCheckbox.isChecked();
    expect(nonTimestampAfter).not.toBe(nonTimestampBefore);

    // Toggle "Render Data as JSON / Array" and verify state changed
    await pm.chartTypeSelector.toggleShowFieldAsJson();
    const jsonAfter = await pm.chartTypeSelector.showFieldAsJsonCheckbox.isChecked();
    expect(jsonAfter).not.toBe(jsonBefore);

    // Verify both remain in their toggled state simultaneously
    const nonTimestampFinal = await pm.chartTypeSelector.treatAsNonTimestampCheckbox.isChecked();
    const jsonFinal = await pm.chartTypeSelector.showFieldAsJsonCheckbox.isChecked();
    expect(nonTimestampFinal).toBe(nonTimestampAfter);
    expect(jsonFinal).toBe(jsonAfter);

    testLogger.info('Both checkboxes enabled simultaneously in custom mode');

    // Close the popup
    await page.keyboard.press('Escape');

    // Save and cleanup
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashName);
  });
});