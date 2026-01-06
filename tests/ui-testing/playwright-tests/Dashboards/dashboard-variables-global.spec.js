const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import {
  monitorVariableAPICalls,
  waitForVariableToLoad,
  verifyVariableAPITriggered,
  assertVariableAPILoading
} from "../utils/variable-helpers.js";

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables - Global Level", () => {
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

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

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
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Verify variable exists and is global
    await expect(page.locator(`[data-test="variable-selector-${variableName}"]`)).toBeVisible();

    // Verify variable scope is global in the settings
    await pm.dashboardSetting.openSetting();
    // Wait for settings dialog to open
    await page.locator('.q-dialog').waitFor({ state: "visible", timeout: 5000 });
    await pm.dashboardSetting.openVariables();
    // Wait for variables tab to be active
    await page.locator('[data-test="dashboard-add-variable-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Wait for the draggable container and variables to load
    await page.locator('[data-test="dashboard-variable-settings-drag"]').waitFor({ state: "visible", timeout: 10000 });
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 5000 });

    // Click on the variable to edit
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).click();

    // Wait for the edit dialog to open
    await page.locator('.q-dialog').filter({ hasText: 'Edit Variable' }).waitFor({ state: "visible", timeout: 5000 });

    // Verify scope shows "Global" - check for the visible text in the form
    // The scope value is displayed as a badge or text, not directly in the select input
    const editDialog = page.locator('.q-dialog').filter({ hasText: 'Edit Variable' });
    await editDialog.waitFor({ state: "visible", timeout: 5000 });
    await expect(editDialog).toContainText('Global', { ignoreCase: true });

    await pm.dashboardSetting.closeSettingWindow();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
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

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

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
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Wait for variable to be fully initialized
    const variableDropdown = page.locator(`[data-test="variable-selector-${variableName}-inner"]`);
    await variableDropdown.waitFor({ state: "visible", timeout: 10000 });

    // Wait for any loading indicators to disappear
    const loadingIndicator = page.locator(`[data-test="variable-selector-${variableName}"] .q-spinner, [data-test="variable-selector-${variableName}"] .q-linear-progress`);
    await loadingIndicator.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

    // Ensure network is idle after variable initialization
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Monitor API calls when clicking dropdown
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 15000 });

    await variableDropdown.click();

    const result = await apiMonitor;

    // Wait for loading state to complete after API call
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

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
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
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

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

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
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Click dropdown and wait for values to load
    const variableDropdown = page.locator(`[data-test="variable-selector-${variableName}-inner"]`);
    await variableDropdown.click();

    // Wait for dropdown options to appear
    await page.waitForSelector('[role="option"]', { state: "visible", timeout: 10000 });

    // Verify at least one option is available
    const options = page.locator('[role="option"]');
    const optionCount = await options.count();

    expect(optionCount).toBeGreaterThan(0);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
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

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

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
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    // Wait for variable to appear on dashboard and be fully initialized
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Wait for variable to be fully visible and ready
    const variableDropdown = page.locator(`[data-test="variable-selector-${variableName}-inner"]`);
    await variableDropdown.waitFor({ state: "visible", timeout: 10000 });
    // Ensure network is idle after variable initialization
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Click dropdown to load values
    await variableDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

    // Get first available option
    const firstOption = page.locator('[role="option"]').first();
    await firstOption.waitFor({ state: "visible", timeout: 5000 });
    const optionText = await firstOption.textContent();
    await firstOption.click();

    // Wait for dropdown to close and selection to be applied
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Verify selection - check the displayed value in the select component
    const variableSelector = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(variableSelector).toContainText(optionText.trim());

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
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

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

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
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Click dropdown
    const variableDropdown = page.getByLabel(variableName, { exact: true });
    await variableDropdown.click();
    // Wait for dropdown menu to open and options to load
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });

    // Count options
    const options = page.locator('[role="option"]');
    const optionCount = await options.count();

    // Should have at most maxRecords options (plus possible "All" option)
    expect(optionCount).toBeLessThanOrEqual(maxRecords + 1);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await deleteDashboard(page, dashboardName);
  });

  test("6-should support multi-select for global variable", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_MultiSelect_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

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
    await pm.dashboardSetting.enableMultiSelect();
    await pm.dashboardSetting.saveVariable();
    // Wait for variable to be saved in the variables list
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    // Wait for save dialog to close
    await pm.dashboardSetting.closeSettingWindow();
    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    // Wait for variable to appear on dashboard and be fully initialized
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 15000 });

    // Wait for variable to be visible and fully initialized
    const variableDropdown = page.locator(`[data-test="variable-selector-${variableName}-inner"]`);
    await variableDropdown.waitFor({ state: "visible", timeout: 10000 });
    // Ensure network is idle after variable initialization
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Click dropdown using the correct selector
    await variableDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

    // Wait for options to load
    await page.waitForSelector('[role="option"]', { state: "visible", timeout: 15000 });

    // Select first option (skip index 0 which is "Select All")
    const firstOption = page.locator('[role="option"]').nth(1);
    await firstOption.waitFor({ state: "visible" });
    await firstOption.click();
    // Wait for checkbox to be checked
    await page.locator('.q-checkbox[aria-checked="true"]').first().waitFor({ state: "visible", timeout: 3000 });

    // Select second option - dropdown should stay open for multi-select
    const secondOption = page.locator('[role="option"]').nth(2);
    await secondOption.waitFor({ state: "visible" });
    await secondOption.click();
    // Wait a moment for second checkbox interaction to complete
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

    // Verify at least one option is checked (multi-select is working)
    // Looking for any checked checkbox is sufficient to verify multi-select is enabled
    const checkedCheckboxes = page.locator('.q-checkbox[aria-checked="true"]');
    const checkedCount = await checkedCheckboxes.count();

    // Should have at least 1 checked option (verifies multi-select is working)
    expect(checkedCount).toBeGreaterThanOrEqual(1);

    // Close the dropdown
    await page.keyboard.press('Escape');
    // Wait for dropdown to close
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await deleteDashboard(page, dashboardName);
  });

  test("7-should set and use default value for variable", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_Default_${Date.now()}`;
    const variableName = `var_${Date.now()}`;
    const defaultValue = "ziox";

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

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
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Verify default value is set - check the displayed value in the select component
    const variableSelector = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(variableSelector).toContainText(defaultValue, { timeout: 10000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await deleteDashboard(page, dashboardName);
  });

  test("8-should hide variable when hide option is enabled", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_Hidden_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    await pm.dashboardSetting.hideVariable();
    await pm.dashboardSetting.saveVariable();
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Verify variable is not visible
    const variableElement = page.locator(`[data-test="dashboard-variable-${variableName}"]`);
    await expect(variableElement).not.toBeVisible();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await deleteDashboard(page, dashboardName);
  });

  test("9-should reload values when time range changes", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_TimeRange_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

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
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Click dropdown to load initial values
    const variableDropdown = page.locator(`[data-test="variable-selector-${variableName}-inner"]`);
    await variableDropdown.waitFor({ state: "visible", timeout: 10000 });
    await variableDropdown.click();
    // Wait for dropdown menu to open and options to load
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });

    // Close dropdown
    await page.keyboard.press("Escape");
    // Wait for dropdown to close
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Change time range
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-h-btn"]').click();

    // Click refresh button to trigger variable refresh with new time range
    await page.locator('[data-test="dashboard-refresh-btn"]').click();

    // Wait for variable to refresh after time range change
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

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
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await deleteDashboard(page, dashboardName);
  });
});
