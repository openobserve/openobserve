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

test.describe("Dashboard Variables - Global Level", { tag: ['@dashboards', '@dashboardVariables', '@globalVariables', '@smoke', '@P0'] }, () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("1-should verify old/existing variable defaults to global scope", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_Global_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    // Navigate and create dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

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
    await page.locator(getEditVariableBtn(variableName)).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    // Wait for variable to appear on dashboard
    await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 10000 });

    // Verify variable exists and is global
    await expect(page.locator(getVariableSelector(variableName))).toBeVisible();

    // Verify variable scope is global in the settings
    await pm.dashboardSetting.openSetting();
    // Wait for settings dialog to open
    await page.locator(SELECTORS.DIALOG).waitFor({ state: "visible", timeout: 5000 });
    await pm.dashboardSetting.openVariables();
    // Wait for variables tab to be active
    await page.locator(SELECTORS.ADD_VARIABLE_BTN).waitFor({ state: "visible", timeout: 10000 });

    // Wait for the draggable container and variables to load
    await page.locator(SELECTORS.VARIABLE_DRAG).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(getEditVariableBtn(variableName)).waitFor({ state: "visible", timeout: 5000 });

    // Click on the variable to edit
    await page.locator(getEditVariableBtn(variableName)).click();

    // Wait for the edit dialog to open
    await page.locator(SELECTORS.DIALOG).filter({ hasText: 'Edit Variable' }).waitFor({ state: "visible", timeout: 5000 });

    // Verify scope shows "Global" - check for the visible text in the form
    // The scope value is displayed as a badge or text, not directly in the select input
    const editDialog = page.locator(SELECTORS.DIALOG).filter({ hasText: 'Edit Variable' });
    await editDialog.waitFor({ state: "visible", timeout: 5000 });
    await expect(editDialog).toContainText('Global', { ignoreCase: true });

    await pm.dashboardSetting.closeSettingWindow();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });

  test("2-should call query_values API when clicking on variable dropdown", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_API_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    // Create dashboard with variable
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

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
    await page.locator(getEditVariableBtn(variableName)).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    // Wait for variable to appear on dashboard
    await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 10000 });

    // Wait for variable to be fully initialized
    const variableDropdown = page.locator(getVariableSelectorInner(variableName));
    await variableDropdown.waitFor({ state: "visible", timeout: 10000 });

    // Wait for any loading indicators to disappear
    const loadingIndicator = page.locator(getVariableLoadingIndicator(variableName));
    await loadingIndicator.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

    // Ensure network is idle after variable initialization
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Monitor API calls when clicking dropdown
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 15000 });

    await variableDropdown.click();

    const result = await apiMonitor;

    // Wait for loading state to complete after API call
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    // Wait for dropdown menu to open
    await page.locator(SELECTORS.MENU).waitFor({ state: "visible", timeout: 5000 });

    // Assert API was called successfully
    assertVariableAPILoading(result, {
      success: true,
      minCalls: 1,
      maxDuration: 10000
    });

    expect(result.success).toBe(true);
    expect(result.actualCount).toBeGreaterThanOrEqual(1);
    expect(result.calls[0].status).toBe(200);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });

  test("3-should load variable values when clicking dropdown", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_Load_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

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
    await page.locator(getEditVariableBtn(variableName)).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    // Wait for variable to appear on dashboard
    await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Click dropdown and wait for values to load
    const variableDropdown = page.locator(getVariableSelectorInner(variableName));
    await variableDropdown.click();

    // Wait for dropdown options to appear
    await page.waitForSelector('[role="option"]', { state: "visible", timeout: 10000 });

    // Verify at least one option is available
    const options = page.locator(SELECTORS.ROLE_OPTION);
    const optionCount = await options.count();

    expect(optionCount).toBeGreaterThan(0);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });

  test("4-should successfully select and apply variable value", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_Select_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

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
    await page.locator(getEditVariableBtn(variableName)).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    // Wait for variable to appear on dashboard and be fully initialized
    await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 10000 });

    // Wait for variable to be fully visible and ready
    const variableDropdown = page.locator(getVariableSelectorInner(variableName));
    await variableDropdown.waitFor({ state: "visible", timeout: 10000 });
    // Ensure network is idle after variable initialization
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Click dropdown to load values
    await variableDropdown.click();
    // Wait for dropdown menu to open
    await page.locator(SELECTORS.MENU).waitFor({ state: "visible", timeout: 5000 });

    // Get first available option
    const firstOption = page.locator(SELECTORS.ROLE_OPTION).first();
    await firstOption.waitFor({ state: "visible", timeout: 5000 });
    const optionText = await firstOption.textContent();
    await firstOption.click();

    // Wait for dropdown to close and selection to be applied
    await safeWaitForHidden(page, '.q-menu', { timeout: 3000 });

    // Verify selection - check the displayed value in the select component
    const variableSelector = page.locator(getVariableSelector(variableName));
    await expect(variableSelector).toContainText(optionText.trim());

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });

  test("5-should load values with max record size limit", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_MaxRecord_${Date.now()}`;
    const variableName = `var_${Date.now()}`;
    const maxRecords = 3;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

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
    await page.locator(getEditVariableBtn(variableName)).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Click dropdown
    const variableDropdown = page.getByLabel(variableName, { exact: true });
    await variableDropdown.click();
    // Wait for dropdown menu to open and options to load
    await page.locator(SELECTORS.MENU).waitFor({ state: "visible", timeout: 5000 });
    await page.locator(SELECTORS.ROLE_OPTION).first().waitFor({ state: "visible", timeout: 5000 });

    // Count options
    const options = page.locator(SELECTORS.ROLE_OPTION);
    const optionCount = await options.count();

    // Should have at most maxRecords options (plus possible "All" option)
    expect(optionCount).toBeLessThanOrEqual(maxRecords + 1);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });

  // Test 6 (multi-select) removed - redundant with setting.spec.js tests 10, 11, 12

  test("6-should set and use default value for variable", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_Default_${Date.now()}`;
    const variableName = `var_${Date.now()}`;
    const defaultValue = "ziox";

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

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
    await page.locator(getEditVariableBtn(variableName)).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    // Wait for variable to appear on dashboard
    await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 10000 });

    // Verify default value is set - check the displayed value in the select component
    const variableSelector = page.locator(getVariableSelector(variableName));
    await expect(variableSelector).toContainText(defaultValue, { timeout: 10000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });

  // Test 8 (hide variable) removed - redundant with setting.spec.js test 9

  test("7-should reload values when time range changes", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_TimeRange_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

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
    await page.locator(getEditVariableBtn(variableName)).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    // Wait for variable to appear on dashboard
    await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 10000 });

    // Click dropdown to load initial values
    const variableDropdown = page.locator(getVariableSelectorInner(variableName));
    await variableDropdown.waitFor({ state: "visible", timeout: 10000 });
    await variableDropdown.click();
    // Wait for dropdown menu to open and options to load
    await page.locator(SELECTORS.MENU).waitFor({ state: "visible", timeout: 5000 });
    await page.locator(SELECTORS.ROLE_OPTION).first().waitFor({ state: "visible", timeout: 5000 });

    // Close dropdown
    await page.keyboard.press("Escape");
    // Wait for dropdown to close
    await safeWaitForHidden(page, '.q-menu', { timeout: 3000 });

    // Change time range
    await page.locator(SELECTORS.DATE_TIME_BTN).click();
    await page.locator(SELECTORS.DATE_TIME_RELATIVE_6H).click();

    // Click refresh button to trigger variable refresh with new time range
    await page.locator(SELECTORS.REFRESH_BTN).click();

    // Wait for variable to refresh after time range change
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

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
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await deleteDashboard(page, dashboardName);
  });
});
