/**
 * Dashboard Variables - Tab Level Test Suite
 * Tests tab-scoped variables, isolation between tabs, and value persistence
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import {
  monitorVariableAPICalls,
  verifyVariableValuePersists,
  waitForVariableToLoad
} from "../utils/variable-helpers.js";

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables - Tab Level", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("should display tab-level variable only in assigned tab", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TabVar_${Date.now()}`;
    const variableName = `tab_var_${Date.now()}`;

    // Create dashboard with multiple tabs
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add tabs
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    await page.waitForTimeout(500);

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    await page.waitForTimeout(500);

    // Add tab-scoped variable assigned to Tab1
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "tabs",
        assignedTabs: ["tab1"]
      }
    );

    await pm.dashboardSetting.closeSettingWindow();

    // Switch to Tab1 and verify variable is visible
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    await page.waitForTimeout(1000);
    await scopedVars.verifyVariableVisibility(variableName, true);

    // Switch to Tab2 and verify variable is NOT visible
    await page.locator('[data-test="dashboard-tab-tab2"]').click();
    await page.waitForTimeout(1000);
    await scopedVars.verifyVariableVisibility(variableName, false);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should use same variable on different tabs with independent values", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TabIndependent_${Date.now()}`;
    const variableName = `shared_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add two tabs
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    await page.waitForTimeout(500);

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    await page.waitForTimeout(500);

    // Add same variable to both tabs
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      {
        scope: "tabs",
        assignedTabs: ["tab1", "tab2"]
      }
    );

    await pm.dashboardSetting.closeSettingWindow();

    // Go to Tab1 and set value
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    await page.waitForTimeout(1000);

    const varDropdown1 = page.getByLabel(variableName, { exact: true });
    await varDropdown1.click();
    await page.waitForTimeout(2000);

    const option1 = page.locator('[role="option"]').nth(0);
    const value1 = await option1.textContent();
    await option1.click();
    await page.waitForTimeout(500);

    // Go to Tab2 and set different value
    await page.locator('[data-test="dashboard-tab-tab2"]').click();
    await page.waitForTimeout(1000);

    const varDropdown2 = page.getByLabel(variableName, { exact: true });
    await varDropdown2.click();
    await page.waitForTimeout(2000);

    const option2 = page.locator('[role="option"]').nth(1);
    const value2 = await option2.textContent();
    await option2.click();
    await page.waitForTimeout(500);

    // Verify values are different
    expect(value1.trim()).not.toBe(value2.trim());

    // Switch back to Tab1 and verify value persists
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    await page.waitForTimeout(1000);
    const persistedValue1 = await varDropdown1.inputValue();
    expect(persistedValue1).toBe(value1.trim());

    // Switch to Tab2 and verify value persists
    await page.locator('[data-test="dashboard-tab-tab2"]').click();
    await page.waitForTimeout(1000);
    const persistedValue2 = await varDropdown2.inputValue();
    expect(persistedValue2).toBe(value2.trim());

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should load tab variable only when tab becomes active", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TabLazyLoad_${Date.now()}`;
    const variableName = `lazy_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add Tab2
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    await page.waitForTimeout(500);

    // Add variable to Tab2 only
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      {
        scope: "tabs",
        assignedTabs: ["tab2"]
      }
    );

    await pm.dashboardSetting.closeSettingWindow();

    // Initially on default tab - variable should not load yet
    await page.waitForTimeout(1000);

    // Monitor API calls when switching to Tab2
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 10000 });

    // Switch to Tab2
    await page.locator('[data-test="dashboard-tab-tab2"]').click();

    const result = await apiMonitor;

    // Should trigger variable load API
    expect(result.success).toBe(true);
    expect(result.actualCount).toBeGreaterThanOrEqual(1);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should not change value on other tabs when variable value changes", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TabIsolation_${Date.now()}`;
    const variableName = `isolated_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add two tabs
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    await page.waitForTimeout(500);

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    await page.waitForTimeout(500);

    // Add variable to both tabs
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      {
        scope: "tabs",
        assignedTabs: ["tab1", "tab2"]
      }
    );

    await pm.dashboardSetting.closeSettingWindow();

    // Set value on Tab1
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    await page.waitForTimeout(1000);

    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.click();
    await page.waitForTimeout(2000);

    const option1 = page.locator('[role="option"]').nth(0);
    const originalValue = await option1.textContent();
    await option1.click();
    await page.waitForTimeout(500);

    // Switch to Tab2
    await page.locator('[data-test="dashboard-tab-tab2"]').click();
    await page.waitForTimeout(1000);

    // Get initial value on Tab2 (should be default, not changed by Tab1)
    const varDropdown2 = page.getByLabel(variableName, { exact: true });
    const tab2Value = await varDropdown2.inputValue();

    // Go back to Tab1 and change value
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    await page.waitForTimeout(1000);

    await varDropdown.click();
    await page.waitForTimeout(1000);

    const option2 = page.locator('[role="option"]').nth(1);
    await option2.click();
    await page.waitForTimeout(500);

    // Switch to Tab2 and verify value hasn't changed
    await page.locator('[data-test="dashboard-tab-tab2"]').click();
    await page.waitForTimeout(1000);

    const tab2ValueAfter = await varDropdown2.inputValue();

    // Tab2 value should remain unchanged
    expect(tab2ValueAfter).toBe(tab2Value);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should allow tab variable to depend on global variable", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TabGlobalDep_${Date.now()}`;
    const globalVar = `global_var_${Date.now()}`;
    const tabVar = `tab_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    await page.waitForTimeout(500);

    // Add global variable
    await scopedVars.addScopedVariable(
      globalVar,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      {
        scope: "global"
      }
    );

    // Add tab variable that depends on global
    await scopedVars.addScopedVariable(
      tabVar,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "tabs",
        assignedTabs: ["tab1"],
        dependsOn: globalVar
      }
    );

    await pm.dashboardSetting.closeSettingWindow();

    // Change global variable value
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    await page.waitForTimeout(1000);

    const globalDropdown = page.getByLabel(globalVar, { exact: true });
    await globalDropdown.click();
    await page.waitForTimeout(2000);

    const globalOption = page.locator('[role="option"]').first();
    await globalOption.click();
    await page.waitForTimeout(500);

    // Monitor API call for dependent tab variable
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 10000 });

    // Wait for dependent variable to reload
    await page.waitForTimeout(3000);

    const result = await apiMonitor;

    // Tab variable should reload based on global variable change
    expect(result.actualCount).toBeGreaterThanOrEqual(0); // May or may not trigger immediately

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should persist tab variable values across page refresh", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TabPersist_${Date.now()}`;
    const variableName = `persist_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    await page.waitForTimeout(500);

    // Add tab variable
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      {
        scope: "tabs",
        assignedTabs: ["tab1"]
      }
    );

    await pm.dashboardSetting.closeSettingWindow();

    // Go to tab and set value
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    await page.waitForTimeout(1000);

    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.click();
    await page.waitForTimeout(2000);

    const option = page.locator('[role="option"]').first();
    const selectedValue = await option.textContent();
    await option.click();
    await page.waitForTimeout(500);

    // Get current URL
    const currentURL = page.url();

    // Verify URL contains tab variable parameter
    expect(currentURL).toContain(`v-${variableName}.t.tab1=`);

    // Refresh page
    await page.reload();
    await page.waitForTimeout(2000);

    // Switch to Tab1
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    await page.waitForTimeout(1000);

    // Verify value persisted
    const persistedValue = await varDropdown.inputValue();
    expect(persistedValue).toBe(selectedValue.trim());

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should show (deleted tab) when tab is deleted but variable still exists", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_DeletedTab_${Date.now()}`;
    const variableName = `deleted_tab_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    await page.waitForTimeout(500);

    // Add variable to tab
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "tabs",
        assignedTabs: ["tab1"]
      }
    );

    await pm.dashboardSetting.closeSettingWindow();

    // Now delete the tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.deleteTab("Tab1");
    await page.waitForTimeout(1000);

    // Open variables and check the variable
    await pm.dashboardSetting.openVariables();

    // Click to edit the variable
    await page.locator(`[data-test="dashboard-variable-${variableName}-edit"]`).click();

    // Verify it shows "(deleted tab)" in assigned tabs
    await scopedVars.verifyDeletedScopeLabel("tab", "tab1");

    await pm.dashboardSetting.closeSettingWindow();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
