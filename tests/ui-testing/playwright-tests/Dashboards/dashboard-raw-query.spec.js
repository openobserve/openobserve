const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import logData from "../../fixtures/log.json";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";

const RAW_QUERY = "COUNT(DISTINCT kubernetes_container_name)";
const STREAM_NAME = "e2e_automate";
const Y_AXIS_ALIAS = "y_axis_1";

test.describe("Dashboard Raw Query testcases", () => {
  test.describe.configure({ mode: "serial" });

  let dashboardName;
  let pm;
  let panelName;

  test.beforeEach(async ({ page }) => {
    testLogger.info("Setting up test - navigating to base");
    dashboardName = "RawQuery_" + Math.random().toString(36).substring(2, 11);
    await navigateToBase(page);
    await ingestion(page);
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    pm = new PageManager(page);
  });

  test("should open Y-axis popup with Build and Raw tabs visible", {
    tag: ["@dashboard-raw-query", "@smoke", "@P0"],
  }, async ({ page }) => {
    testLogger.info("Testing Y-axis popup opens with Build/Raw tabs");

    // Navigate to dashboards and create one
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add a panel and select stream + Y-axis field
    await pm.dashboardCreate.addPanel();
    panelName = pm.dashboardPanelActions.generateUniquePanelName("raw-query-test");
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectStream(STREAM_NAME);
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Open Y-axis popup and verify tabs
    await pm.chartTypeSelector.openYAxisFunctionPopup(Y_AXIS_ALIAS);
    await pm.chartTypeSelector.verifyBuildRawTabsVisible(expect);

    testLogger.info("Build and Raw tabs are visible in Y-axis popup");

    // Close popup
    await page.keyboard.press("Escape");

    // Clean up: save panel, go back, delete dashboard
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should enter raw query in textarea after switching to Raw tab", {
    tag: ["@dashboard-raw-query", "@smoke", "@P0"],
  }, async ({ page }) => {
    testLogger.info("Testing raw query entry in Raw tab textarea");

    // Navigate and create dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add panel with Y-axis field
    await pm.dashboardCreate.addPanel();
    panelName = pm.dashboardPanelActions.generateUniquePanelName("raw-query-test");
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectStream(STREAM_NAME);
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Open popup, switch to Raw tab, enter query
    await pm.chartTypeSelector.openYAxisFunctionPopup(Y_AXIS_ALIAS);
    await pm.chartTypeSelector.switchToRawTab();
    await pm.chartTypeSelector.enterRawQuery(RAW_QUERY);

    // Verify query was entered
    const enteredQuery = await pm.chartTypeSelector.getRawQueryValue();
    expect(enteredQuery).toBe(RAW_QUERY);

    testLogger.info("Raw query entered and verified", { enteredQuery });

    // Close popup
    await page.keyboard.press("Escape");

    // Clean up
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should persist raw query after save and reload", {
    tag: ["@dashboard-raw-query", "@smoke", "@P0"],
  }, async ({ page }) => {
    testLogger.info("Testing raw query persistence after save and reload (core bug fix)");

    // Navigate and create dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add panel with Y-axis field
    await pm.dashboardCreate.addPanel();
    panelName = pm.dashboardPanelActions.generateUniquePanelName("raw-query-test");
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectStream(STREAM_NAME);
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Configure raw query on Y-axis
    await pm.chartTypeSelector.configureYAxisRawQuery(Y_AXIS_ALIAS, RAW_QUERY);

    // Apply and save
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Panel saved with raw query");

    // Go back to dashboard list
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardPanelActions.waitForDashboardSearchVisible();

    // Search and re-open the dashboard (with panels)
    await pm.dashboardCreate.searchDashboard(dashboardName);
    const dashboardRow = pm.dashboardPanelActions.getDashboardRow(dashboardName);
    await expect(dashboardRow).toBeVisible({ timeout: 10000 });
    await dashboardRow.click();
    await page.waitForURL(/\/dashboards\/view/, { timeout: 15000 });
    testLogger.info("Dashboard reopened from list");

    // Edit the panel
    await pm.dashboardPanelEdit.editPanel(panelName);
    await page.waitForURL(/edit_panel|add_panel/, { timeout: 15000 });
    testLogger.info("Panel opened for editing");

    // Open Y-axis popup and verify raw query is preserved
    await pm.chartTypeSelector.openYAxisFunctionPopup(Y_AXIS_ALIAS);

    // Verify Raw tab is active by checking the textarea is visible
    await pm.chartTypeSelector.verifyRawTextareaVisible(expect);

    // Verify the raw query content is preserved
    const preservedQuery = await pm.chartTypeSelector.getRawQueryValue();
    expect(preservedQuery).toBe(RAW_QUERY);

    testLogger.info("Raw query persisted after save and reload", { preservedQuery });

    // Close popup and exit panel editor
    await page.keyboard.press("Escape");
    await pm.dashboardPanelActions.savePanel();

    // Clean up - now we're back at dashboard view
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should not remove raw query when editing a saved panel", {
    tag: ["@dashboard-raw-query", "@smoke", "@P0"],
  }, async ({ page }) => {
    testLogger.info("Testing raw query is not removed on panel edit (regression test)");

    // Navigate and create dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add panel with Y-axis field and configure raw query
    await pm.dashboardCreate.addPanel();
    panelName = pm.dashboardPanelActions.generateUniquePanelName("raw-query-test");
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectStream(STREAM_NAME);
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await pm.chartTypeSelector.configureYAxisRawQuery(Y_AXIS_ALIAS, RAW_QUERY);

    // Apply and save the panel
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Panel saved with raw query - first save");

    // --- First edit: verify raw query is preserved ---
    await pm.dashboardPanelEdit.editPanel(panelName);
    await page.waitForURL(/edit_panel|add_panel/, { timeout: 15000 });
    testLogger.info("Panel opened for first edit");

    await pm.chartTypeSelector.openYAxisFunctionPopup(Y_AXIS_ALIAS);
    await pm.chartTypeSelector.verifyRawTextareaVisible(expect);
    let preservedQuery = await pm.chartTypeSelector.getRawQueryValue();
    expect(preservedQuery).toBe(RAW_QUERY);
    testLogger.info("First edit: raw query preserved", { preservedQuery });

    // Close popup and save again without changes
    await page.keyboard.press("Escape");
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Panel saved after first edit - second save");

    // --- Second edit: verify raw query still persists after re-save ---
    await pm.dashboardPanelEdit.editPanel(panelName);
    await page.waitForURL(/edit_panel|add_panel/, { timeout: 15000 });
    testLogger.info("Panel opened for second edit");

    await pm.chartTypeSelector.openYAxisFunctionPopup(Y_AXIS_ALIAS);
    await pm.chartTypeSelector.verifyRawTextareaVisible(expect);
    preservedQuery = await pm.chartTypeSelector.getRawQueryValue();
    expect(preservedQuery).toBe(RAW_QUERY);
    testLogger.info("Second edit: raw query still preserved", { preservedQuery });

    // Close popup and save
    await page.keyboard.press("Escape");
    await pm.dashboardPanelActions.savePanel();

    // Clean up
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should reset state correctly when switching between Build and Raw tabs", {
    tag: ["@dashboard-raw-query", "@functional", "@P1"],
  }, async ({ page }) => {
    testLogger.info("Testing tab switch state reset behavior");

    // Navigate and create dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add panel with Y-axis field
    await pm.dashboardCreate.addPanel();
    panelName = pm.dashboardPanelActions.generateUniquePanelName("raw-query-test");
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectStream(STREAM_NAME);
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Open popup
    await pm.chartTypeSelector.openYAxisFunctionPopup(Y_AXIS_ALIAS);

    // Switch to Raw tab and enter query
    await pm.chartTypeSelector.switchToRawTab();
    await pm.chartTypeSelector.enterRawQuery(RAW_QUERY);

    // Verify query is present
    let queryValue = await pm.chartTypeSelector.getRawQueryValue();
    expect(queryValue).toBe(RAW_QUERY);

    // Switch back to Build tab - this should clear rawQuery
    await pm.chartTypeSelector.switchToBuildTab();

    // Switch to Raw tab again - rawQuery should be empty (cleared on Build->Raw switch)
    await pm.chartTypeSelector.switchToRawTab();
    queryValue = await pm.chartTypeSelector.getRawQueryValue();
    expect(queryValue).toBe("");

    testLogger.info("Tab switching correctly resets raw query state");

    // Switch back to Build tab for valid field state before saving
    await pm.chartTypeSelector.switchToBuildTab();

    // Close popup
    await page.keyboard.press("Escape");

    // Clean up - navigate to dashboard list and delete
    // (Panel was never saved in this test - we only tested tab switching behavior)
    // Use direct navigation since we're in an unsaved panel editor
    await page.goto(
      `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}`
    );
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 30000 });
    await pm.dashboardCreate.searchDashboard(dashboardName);
    await page.locator('[data-test="dashboard-table"]').waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });

  test("should render chart after applying panel with raw query", {
    tag: ["@dashboard-raw-query", "@functional", "@P1"],
  }, async ({ page }) => {
    testLogger.info("Testing chart renders with raw query configuration");

    // Navigate and create dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);

    // Add panel with Y-axis field
    await pm.dashboardCreate.addPanel();
    panelName = pm.dashboardPanelActions.generateUniquePanelName("raw-query-test");
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectStream(STREAM_NAME);
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Configure raw query
    await pm.chartTypeSelector.configureYAxisRawQuery(Y_AXIS_ALIAS, RAW_QUERY);

    // Apply the query
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Wait for chart render and verify no errors
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartRenders(expect);

    testLogger.info("Chart rendered successfully with raw query");

    // Save and clean up
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
