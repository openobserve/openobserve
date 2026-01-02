/**
 * Dashboard Variables - Global Level Test Suite
 * Tests global-scoped variables, API loading, backward compatibility with old/existing variables
 */

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

    // Verify variable exists and is global
    await expect(page.locator(`[data-test="dashboard-variable-${variableName}"]`)).toBeVisible();

    // Verify variable scope is global in the settings
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Click on the variable to edit
    await page.locator(`[data-test="dashboard-variable-${variableName}-edit"]`).click();

    // Verify scope selector shows "global"
    const scopeValue = await page.locator('[data-test="dashboard-variable-scope-select"]').textContent();
    expect(scopeValue.toLowerCase()).toContain("global");

    await pm.dashboardSetting.closeSettingWindow();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
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
    await pm.dashboardSetting.closeSettingWindow();

    // Monitor API calls when clicking dropdown
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 10000 });

    const variableDropdown = page.getByLabel(variableName, { exact: true });
    await variableDropdown.waitFor({ state: "visible" });
    await variableDropdown.click();

    const result = await apiMonitor;

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
    await pm.dashboardSetting.closeSettingWindow();

    // Click dropdown and wait for values to load
    const variableDropdown = page.getByLabel(variableName, { exact: true });
    await variableDropdown.click();

    // Wait for dropdown options to appear
    await page.waitForSelector('[role="option"]', { state: "visible", timeout: 10000 });

    // Verify at least one option is available
    const options = page.locator('[role="option"]');
    const optionCount = await options.count();

    expect(optionCount).toBeGreaterThan(0);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
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
    await pm.dashboardSetting.closeSettingWindow();

    // Click dropdown to load values
    const variableDropdown = page.getByLabel(variableName, { exact: true });
    await variableDropdown.click();
    await page.waitForTimeout(2000);

    // Get first available option
    const firstOption = page.locator('[role="option"]').first();
    await firstOption.waitFor({ state: "visible", timeout: 5000 });
    const optionText = await firstOption.textContent();
    await firstOption.click();

    // Verify selection
    const selectedValue = await variableDropdown.inputValue();
    expect(selectedValue).toBe(optionText.trim());

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
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
    await pm.dashboardSetting.closeSettingWindow();

    // Click dropdown
    const variableDropdown = page.getByLabel(variableName, { exact: true });
    await variableDropdown.click();
    await page.waitForTimeout(2000);

    // Count options
    const options = page.locator('[role="option"]');
    const optionCount = await options.count();

    // Should have at most maxRecords options (plus possible "All" option)
    expect(optionCount).toBeLessThanOrEqual(maxRecords + 1);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
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
    await pm.dashboardSetting.closeSettingWindow();

    // Click dropdown
    const variableDropdown = page.getByLabel(variableName, { exact: true });
    await variableDropdown.click();
    await page.waitForTimeout(2000);

    // Select first option
    const firstOption = page.locator('[role="option"]').nth(0);
    await firstOption.click();
    await page.waitForTimeout(500);

    // Select second option (should allow multiple)
    await variableDropdown.click();
    const secondOption = page.locator('[role="option"]').nth(1);
    await secondOption.click();

    // Verify multiple selections are shown
    const chipElements = page.locator('[data-test*="dashboard-variable-chip"]');
    const chipCount = await chipElements.count();

    expect(chipCount).toBeGreaterThanOrEqual(2);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("7-should set and use default value for variable", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_Default_${Date.now()}`;
    const variableName = `var_${Date.now()}`;
    const defaultValue = "ingress-nginx";

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
    await pm.dashboardSetting.closeSettingWindow();

    // Verify default value is set
    const variableInput = page.locator(`[data-test="dashboard-variable-${variableName}"] input`);
    const value = await variableInput.inputValue();

    expect(value).toBe(defaultValue);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
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
    await pm.dashboardSetting.closeSettingWindow();

    // Verify variable is not visible
    const variableElement = page.locator(`[data-test="dashboard-variable-${variableName}"]`);
    await expect(variableElement).not.toBeVisible();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
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
    await pm.dashboardSetting.closeSettingWindow();

    // Click dropdown to load initial values
    const variableDropdown = page.getByLabel(variableName, { exact: true });
    await variableDropdown.click();
    await page.waitForTimeout(1000);

    // Close dropdown
    await page.keyboard.press("Escape");

    // Change time range
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-h-btn"]').click();

    // Monitor API call when clicking dropdown again
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 10000 });
    await variableDropdown.click();
    const result = await apiMonitor;

    // Should call API again with new time range
    expect(result.success).toBe(true);
    expect(result.actualCount).toBeGreaterThanOrEqual(1);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
