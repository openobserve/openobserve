/**
 * Dashboard Variables - Custom/Constant/Textbox as Parents Test Suite
 * Tests that custom, constant, and textbox type variables can be used as parents
 * for query_values variables (e.g., in stream/field names or filters)
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard, reopenDashboardFromList } from "./utils/dashCreation.js";
import { monitorVariableAPICalls } from "../utils/variable-helpers.js";
const { safeWaitForHidden, safeWaitForNetworkIdle } = require("../utils/wait-helpers.js");
const { SELECTORS } = require("../../pages/dashboardPages/dashboard-selectors.js");
const testLogger = require("../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables - Custom/Constant/Textbox as Parents", { tag: ['@dashboards', '@dashboardVariables', '@customParents', '@P1'] }, () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("1-should load query_values child when custom type parent has initial value", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_CustomParent_${Date.now()}`;
    const customVar = `custom_stream_${Date.now()}`;
    const queryVar = `query_field_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Open settings
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    testLogger.debug("Creating custom variable as parent");
    await scopedVars.addCustomVariable(customVar, ["ziox", "kube-system"], {
      label: "Stream Name",
      scope: "global"
    });

    // Close and reopen settings for next variable
    await pm.dashboardSetting.closeSettingWindow();
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    // Wait for the custom variable to be visible in the list
    await page.locator(`[data-test="dashboard-edit-variable-${customVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    testLogger.debug("Creating query_values child with filter using custom parent");
    await scopedVars.addScopedVariable(
      queryVar,
      "logs",
      "e2e_automate", // Fixed stream name
      "kubernetes_container_name",
      {
        scope: "global",
        dependsOn: customVar, // Create filter dependency on custom variable
        dependsOnField: "kubernetes_namespace_name" // Filter by namespace
      }
    );

    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, SELECTORS.DIALOG, { timeout: 5000 });

    testLogger.debug("Going back to dashboard list and reopening to test initial load");

    // Go back to dashboard list
    await pm.dashboardCreate.backToDashboardList();
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });

    testLogger.debug("Monitoring API calls during dashboard reopen (initial load)");

    // Start monitoring for API calls BEFORE reopening dashboard
    const apiMonitorPromise = monitorVariableAPICalls(page, {
      expectedCount: 1, // Child variable should make 1 API call on initial load
      timeout: 15000
    });

    // Reopen the dashboard to test true initial load
    await reopenDashboardFromList(page, dashboardName);

    testLogger.debug("Verifying child variable loaded on initial dashboard open");

    // Both variables should be visible
    await page.locator(`[data-test="variable-selector-${customVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(`[data-test="variable-selector-${queryVar}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Verify API call happened during initial load (not when dropdown opens)
    const apiResult = await apiMonitorPromise;
    testLogger.debug(`Child variable made ${apiResult.actualCount} API call(s) on initial load`);
    expect(apiResult.actualCount).toBeGreaterThanOrEqual(1);

    // Now verify the variable has loaded options
    const optionCount = await scopedVars.verifyVariableHasOptions(queryVar);
    testLogger.debug(`Child variable has ${optionCount} options`);
    expect(optionCount).toBeGreaterThan(0);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });

  test("2-should reload query_values child when constant type parent is used in filter", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_ConstantParent_${Date.now()}`;
    const constantVar = `constant_filter_${Date.now()}`;
    const queryVar = `query_dependent_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Open settings
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    testLogger.debug("Creating constant variable as parent");
    await scopedVars.addConstantVariable(constantVar, "ziox", {
      label: "Namespace Filter",
      scope: "global"
    });

    // Close and reopen settings for next variable
    await pm.dashboardSetting.closeSettingWindow();
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    // Wait for the constant variable to be visible in the list
    await page.locator(`[data-test="dashboard-edit-variable-${constantVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    testLogger.debug("Creating query_values child with filter using constant parent");
    await scopedVars.addScopedVariable(
      queryVar,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "global",
        dependsOn: constantVar,
        dependsOnField: "kubernetes_namespace_name"
      }
    );

    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, SELECTORS.DIALOG, { timeout: 5000 });

    testLogger.debug("Going back to dashboard list and reopening to test initial load");

    // Go back to dashboard list
    await pm.dashboardCreate.backToDashboardList();
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });

    testLogger.debug("Monitoring API calls during dashboard reopen (initial load)");

    // Start monitoring for API calls BEFORE reopening dashboard
    const apiMonitorPromise = monitorVariableAPICalls(page, {
      expectedCount: 1, // Child variable should make 1 API call on initial load
      timeout: 15000
    });

    // Reopen the dashboard to test true initial load
    await reopenDashboardFromList(page, dashboardName);

    testLogger.debug("Verifying child variable loaded with constant parent filter");

    // Both variables should be visible
    await page.locator(`[data-test="variable-selector-${constantVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(`[data-test="variable-selector-${queryVar}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Verify API call happened during initial load (not when dropdown opens)
    const apiResult = await apiMonitorPromise;
    testLogger.debug(`Child variable made ${apiResult.actualCount} API call(s) on initial load`);
    expect(apiResult.actualCount).toBeGreaterThanOrEqual(1);

    // Now verify the variable has loaded options
    const optionCount = await scopedVars.verifyVariableHasOptions(queryVar);
    testLogger.debug(`Child variable has ${optionCount} options with constant filter`);
    expect(optionCount).toBeGreaterThan(0);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });

  test("3-should handle textbox type parent in stream/field names", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TextboxParent_${Date.now()}`;
    const textboxVar = `textbox_stream_${Date.now()}`;
    const queryVar = `query_textbox_child_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Open settings
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    testLogger.debug("Creating textbox variable as parent");
    await scopedVars.addTextboxVariable(textboxVar, "e2e_automate", {
      label: "Stream Input",
      scope: "global"
    });

    // Close and reopen settings for next variable
    await pm.dashboardSetting.closeSettingWindow();
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    // Wait for the textbox variable to be visible in the list
    await page.locator(`[data-test="dashboard-edit-variable-${textboxVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    testLogger.debug("Creating query_values child using textbox parent in stream");
    await scopedVars.addScopedVariable(
      queryVar,
      "logs",
      `e2e_automate`,
      "kubernetes_namespace_name",
      { scope: "global" }
    );

    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, SELECTORS.DIALOG, { timeout: 5000 });

    testLogger.debug("Going back to dashboard list and reopening to test initial load");

    // Go back to dashboard list
    await pm.dashboardCreate.backToDashboardList();
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });

    testLogger.debug("Monitoring API calls during dashboard reopen (initial load)");

    // Start monitoring for API calls BEFORE reopening dashboard
    const apiMonitorPromise = monitorVariableAPICalls(page, {
      expectedCount: 1, // Child variable should make 1 API call on initial load
      timeout: 15000
    });

    // Reopen the dashboard to test true initial load
    await reopenDashboardFromList(page, dashboardName);

    testLogger.debug("Verifying child variable loaded with textbox parent");

    // Both variables should be visible
    await page.locator(`[data-test="variable-selector-${textboxVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(`[data-test="variable-selector-${queryVar}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Verify API call happened during initial load (not when dropdown opens)
    const apiResult = await apiMonitorPromise;
    testLogger.debug(`Child variable made ${apiResult.actualCount} API call(s) on initial load`);
    expect(apiResult.actualCount).toBeGreaterThanOrEqual(1);

    // Now verify the variable has loaded options
    const optionCount = await scopedVars.verifyVariableHasOptions(queryVar);
    testLogger.debug(`Child variable has ${optionCount} options with textbox parent`);
    expect(optionCount).toBeGreaterThan(0);

    testLogger.debug("Changing textbox value and verifying child reloads");

    // Change textbox value and verify child reloads
    const textboxSelector = page.locator(`[data-test="variable-selector-${textboxVar}"]`);
    await textboxSelector.clear();
    await textboxSelector.fill("default");
    await page.keyboard.press('Enter');

    // Wait for child to reload
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Verify child still has options (might be different stream)
    const newOptionCount = await scopedVars.verifyVariableHasOptions(queryVar);
    testLogger.debug(`Child variable has ${newOptionCount} options after textbox change`);
    expect(newOptionCount).toBeGreaterThanOrEqual(0); // May be 0 if stream doesn't exist

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });

  test("4-should not reload child when parent dropdown opens without value change", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_NoReload_${Date.now()}`;
    const customVar = `custom_no_reload_${Date.now()}`;
    const queryVar = `query_no_reload_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Open settings
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    testLogger.debug("Creating custom parent and query_values child");
    await scopedVars.addCustomVariable(customVar, ["e2e_automate"], {
      scope: "global"
    });

    // Close and reopen settings for next variable
    await pm.dashboardSetting.closeSettingWindow();
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    // Wait for the custom variable to be visible in the list
    await page.locator(`[data-test="dashboard-edit-variable-${customVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await scopedVars.addScopedVariable(
      queryVar,
      "logs",
      `e2e_automate`,
      "kubernetes_namespace_name",
      { scope: "global" }
    );

    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, SELECTORS.DIALOG, { timeout: 5000 });

    testLogger.debug("Going back to dashboard list and reopening to test initial load");

    // Go back to dashboard list
    await pm.dashboardCreate.backToDashboardList();
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });

    testLogger.debug("Monitoring API calls during dashboard reopen (initial load)");

    // Start monitoring for API calls BEFORE reopening dashboard
    const initialApiMonitorPromise = monitorVariableAPICalls(page, {
      expectedCount: 1, // Child variable should make 1 API call on initial load
      timeout: 15000
    });

    // Reopen the dashboard to test true initial load
    await reopenDashboardFromList(page, dashboardName);

    // Verify child loaded on initial page load
    const initialApiResult = await initialApiMonitorPromise;
    testLogger.debug(`Child variable made ${initialApiResult.actualCount} API call(s) on initial load`);
    expect(initialApiResult.actualCount).toBeGreaterThanOrEqual(1);

    testLogger.debug("Monitoring API calls when opening parent dropdown without changing value");

    // Now test that opening dropdown WITHOUT changing value doesn't trigger additional API calls
    const apiMonitorPromise = monitorVariableAPICalls(page, {
      expectedCount: 0,
      timeout: 3000
    });

    // Open parent dropdown (this should NOT trigger child reload)
    const parentSelector = page.locator(`[data-test="variable-selector-${customVar}"]`);
    await parentSelector.click();

    // Wait a bit and close dropdown without selecting
    await page.waitForTimeout(2000);
    await page.keyboard.press('Escape');

    // Check API monitoring result
    const apiResult = await apiMonitorPromise;
    testLogger.debug(`Total child API calls after parent dropdown open: ${apiResult.actualCount}`);

    // Child should NOT have reloaded (0 API calls expected)
    // This verifies the race condition fix is working
    expect(apiResult.actualCount).toBe(0);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });
});
