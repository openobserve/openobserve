const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import {
  monitorVariableAPICalls,
  waitForVariableToLoad,
  verifyVariableAPITriggered,
  assertVariableAPILoading
} from "../utils/variable-helpers.js";
const { safeWaitForHidden, safeWaitForNetworkIdle } = require("../utils/wait-helpers.js");
// Import centralized selectors
const {
  SELECTORS,
  getVariableSelector,
  getVariableSelectorInner,
  getEditVariableBtn,
  getVariableLoadingIndicator,
  getDashboardVariable,
} = require("../../pages/dashboardPages/dashboard-selectors.js");
const testLogger = require("../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });

/**
 * Blocks until the variable's in-flight load has finished.
 *
 * loadVariableOptions() in VariablesValueSelector.vue early-returns while
 * variableItem.isLoading is true, so opening the dropdown mid-load is dropped
 * silently — no request is sent and none is retried. A monitored click landing in
 * that window therefore observes "0 calls, 0/1 matched" and the test fails.
 *
 * isLoading is rendered as an OSpinner (role="status") inside the selector, which is
 * the only reliable signal for it. Two things that look like signals are not:
 *   - [data-test*="loading-indicator"] matches NOTHING in the dashboard components,
 *     and waitFor({state:"hidden"}) on a non-matching selector resolves immediately.
 *   - the displayed text is not usable either: the selector renders "(No Data Found)"
 *     while the load is still in flight, so waiting for text settles too early.
 * Both were measured returning in single-digit milliseconds with the spinner still up.
 */
const waitForVariableIdle = async (
  page,
  variableName,
  { quietMs = 1000, timeout = 25000 } = {}
) => {
  const spinner = page.locator(
    `[data-test="variable-selector-${variableName}"] [role="status"]`
  );
  const deadline = Date.now() + timeout;

  // A single "spinner gone" check is NOT enough. Refreshing / changing the time
  // range kicks off a cascade, so a second load can start a few hundred ms after
  // the first spinner clears — and a click landing in that gap is dropped just the
  // same. Require the idle state to HOLD for a quiet period before proceeding.
  while (Date.now() < deadline) {
    await spinner
      .first()
      .waitFor({ state: "detached", timeout: Math.max(1000, deadline - Date.now()) })
      .catch(() => {});

    await page.waitForTimeout(quietMs);
    if ((await spinner.count()) === 0) return;
  }
};

test.describe("Dashboard Variables - Global Level", { tag: ['@dashboards', '@dashboardVariables', '@globalVariables', '@smoke', '@P0'] }, () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("1-should verify old/existing variable defaults to global scope", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Global_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    // Navigate and create dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible" });

    // Add variable without specifying scope (should default to global)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );
    await pm.dashboardSetting.saveVariable();
    // Wait for variable to be saved
    await scopedVars.getEditVariableBtnLocator(variableName).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    // Wait for variable to appear on dashboard
    await scopedVars.getVariableSelectorLocator(variableName).waitFor({ state: "visible", timeout: 10000 });

    // Verify variable exists and is global
    await expect(scopedVars.getVariableSelectorLocator(variableName)).toBeVisible();

    // Verify variable scope is global in the settings
    await pm.dashboardSetting.openSetting();
    // Wait for the settings ODrawer to be visible
    const settingsDrawer = scopedVars.getSettingsDrawerLocator();
    await settingsDrawer.waitFor({ state: "visible", timeout: 5000 });
    await pm.dashboardSetting.openVariables();
    // Wait for variables tab to be active
    await scopedVars.getAddVariableBtnLocator().waitFor({ state: "visible", timeout: 10000 });

    // Wait for the draggable container and variables to load
    await scopedVars.getVariableDragLocator().waitFor({ state: "visible", timeout: 10000 });
    await scopedVars.getEditVariableBtnLocator(variableName).waitFor({ state: "visible", timeout: 5000 });

    // Click on the variable to edit
    await scopedVars.getEditVariableBtnLocator(variableName).click();

    // The Edit Variable form replaces the variable list inside the same drawer;
    // wait for the form scope select to be visible to confirm the edit view loaded.
    await scopedVars.getVariableScopeSelectLocator().waitFor({ state: "visible", timeout: 5000 });

    // Verify scope shows "Global" — scope is rendered inside the drawer's edit form
    await expect(settingsDrawer).toContainText('Global', { ignoreCase: true });

    await pm.dashboardSetting.closeSettingWindow();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.getDashboardSearchLocator().waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });

  test("2-should call query_values API when clicking on variable dropdown", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_API_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    // Create dashboard with variable
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible" });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    await pm.dashboardSetting.saveVariable();
    // Wait for variable to be saved
    await scopedVars.getEditVariableBtnLocator(variableName).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    // Wait for variable to appear on dashboard
    await scopedVars.getVariableSelectorLocator(variableName).waitFor({ state: "visible", timeout: 10000 });

    // Wait for variable to be fully initialized
    const variableDropdown = scopedVars.getVariableDropdown(variableName);
    await variableDropdown.waitFor({ state: "visible", timeout: 10000 });

    // Wait for the variable's initial load to actually finish before clicking —
    // a click landing mid-load is silently dropped (see waitForVariableIdle).
    await waitForVariableIdle(page, variableName);

    // Ensure network is idle after variable initialization
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Monitor API calls when clicking dropdown
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 15000 });

    await variableDropdown.click();

    const result = await apiMonitor;

    // Wait for loading state to complete after API call
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    // Wait for dropdown menu to open
    await scopedVars.getMenuLocator().waitFor({ state: "visible", timeout: 5000 });

    // Assert API was called successfully
    assertVariableAPILoading(result, {
      success: true,
      minCalls: 1,
      maxDuration: 10000
    });

    expect(result.success).toBe(true);
    expect(result.actualCount).toBeGreaterThanOrEqual(1);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.getDashboardSearchLocator().waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });

  test("3-should load variable values when clicking dropdown", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Load_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible" });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    await pm.dashboardSetting.saveVariable();
    // Wait for variable to be saved
    await scopedVars.getEditVariableBtnLocator(variableName).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    // Wait for variable to appear on dashboard
    await scopedVars.getVariableSelectorLocator(variableName).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Click dropdown and wait for values to load
    const variableDropdown = scopedVars.getVariableDropdown(variableName);
    await variableDropdown.click();

    // Wait for dropdown options to appear
    await page.waitForSelector('[role="option"]', { state: "visible", timeout: 10000 });

    // Verify at least one option is available
    const options = scopedVars.getRoleOptionLocator();
    const optionCount = await options.count();

    expect(optionCount).toBeGreaterThan(0);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.getDashboardSearchLocator().waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });

  test("4-should successfully select and apply variable value", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Select_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible" });

    // Add variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    await pm.dashboardSetting.addMaxRecord("5");
    await pm.dashboardSetting.saveVariable();
    // Wait for variable to be saved
    await scopedVars.getEditVariableBtnLocator(variableName).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    // Wait for variable to appear on dashboard and be fully initialized
    await scopedVars.getVariableSelectorLocator(variableName).waitFor({ state: "visible", timeout: 10000 });

    // Wait for variable to be fully visible and ready
    const variableDropdown = scopedVars.getVariableDropdown(variableName);
    await variableDropdown.waitFor({ state: "visible", timeout: 10000 });
    // Ensure network is idle after variable initialization
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Click dropdown to load values
    await variableDropdown.click();
    // Wait for dropdown menu to open
    await scopedVars.getMenuLocator().waitFor({ state: "visible", timeout: 5000 });

    // Get first available option
    const firstOption = scopedVars.getRoleOptionLocator().first();
    await firstOption.waitFor({ state: "visible", timeout: 5000 });
    const optionText = await firstOption.textContent();
    await firstOption.click();

    // Wait for dropdown to close and selection to be applied
    await safeWaitForHidden(page, `[data-test="variable-selector-${variableName}-inner-popover"]`, { timeout: 3000 });

    // Verify selection - check the displayed value in the select component
    const variableSelector = scopedVars.getVariableSelectorLocator(variableName);
    await expect(variableSelector).toContainText(optionText.trim());

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.getDashboardSearchLocator().waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });

  test("5-should load values with max record size limit", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_MaxRecord_${Date.now()}`;
    const variableName = `var_${Date.now()}`;
    const maxRecords = 3;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible" });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    await pm.dashboardSetting.addMaxRecord(maxRecords.toString());
    await pm.dashboardSetting.saveVariable();
    // Wait for variable to be saved
    await scopedVars.getEditVariableBtnLocator(variableName).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Click dropdown
    const variableDropdown = scopedVars.getVariableSelectorLocator(variableName);
    await variableDropdown.click();
    // Wait for dropdown menu to open and options to load
    await scopedVars.getVariablePopoverLocator(variableName).waitFor({ state: "visible", timeout: 5000 });
    await scopedVars.getRoleOptionLocator().first().waitFor({ state: "visible", timeout: 5000 });

    // Count options
    const options = scopedVars.getRoleOptionLocator();
    const optionCount = await options.count();

    // Should have at most maxRecords options (plus possible "All" option)
    expect(optionCount).toBeLessThanOrEqual(maxRecords + 1);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.getDashboardSearchLocator().waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });

  // Test 6 (multi-select) removed - redundant with setting.spec.js tests 10, 11, 12

  test("6-should set and use default value for variable", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Default_${Date.now()}`;
    const variableName = `var_${Date.now()}`;
    const defaultValue = "ziox";

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible" });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    await pm.dashboardSetting.addCustomValue(defaultValue);
    await pm.dashboardSetting.saveVariable();
    // Wait for variable to be saved
    await scopedVars.getEditVariableBtnLocator(variableName).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    // Wait for variable to appear on dashboard
    await scopedVars.getVariableSelectorLocator(variableName).waitFor({ state: "visible", timeout: 10000 });

    // Verify default value is set - check the displayed value in the select component
    const variableSelector = scopedVars.getVariableSelectorLocator(variableName);
    await expect(variableSelector).toContainText(defaultValue, { timeout: 10000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.getDashboardSearchLocator().waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });

  // Test 8 (hide variable) removed - redundant with setting.spec.js test 9

  test("7-should reload values when time range changes", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TimeRange_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible" });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    await pm.dashboardSetting.saveVariable();
    // Wait for variable to be saved
    await scopedVars.getEditVariableBtnLocator(variableName).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    // Wait for variable to appear on dashboard
    await scopedVars.getVariableSelectorLocator(variableName).waitFor({ state: "visible", timeout: 10000 });

    // Click dropdown to load initial values
    const variableDropdown = scopedVars.getVariableDropdown(variableName);
    await variableDropdown.waitFor({ state: "visible", timeout: 10000 });
    await variableDropdown.click();
    // Wait for dropdown menu to open and options to load
    await scopedVars.getMenuLocator().waitFor({ state: "visible", timeout: 5000 });
    await scopedVars.getRoleOptionLocator().first().waitFor({ state: "visible", timeout: 5000 });

    // Close dropdown
    await page.keyboard.press("Escape");
    // Wait for dropdown to close
    await safeWaitForHidden(page, `[data-test="variable-selector-${variableName}-inner-popover"]`, { timeout: 3000 });

    // Change time range
    await scopedVars.selectTimeRange6Hours();

    // Click refresh button to trigger variable refresh with new time range
    await scopedVars.clickDashboardRefresh();

    // Wait for variable to refresh after time range change
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // The refresh kicks off a fresh load; the monitored click below must not land
    // while it is still in flight or it is dropped silently and no request fires.
    await waitForVariableIdle(page, variableName);

    // Monitor API call when clicking dropdown again
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 15000 });
    await variableDropdown.click();
    const result = await apiMonitor;

    // Should call API again with new time range
    expect(result.success).toBe(true);
    expect(result.actualCount).toBeGreaterThanOrEqual(1);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.getDashboardSearchLocator().waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });
});
