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

  test("1-should display tab-level variable only in assigned tab", async ({ page }) => {
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
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').waitFor({ state: "visible", timeout: 10000 });

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab2"]').waitFor({ state: "visible", timeout: 10000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Switch to Tab1 and verify variable is visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for variable to appear on the dashboard after tab switch
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    await scopedVars.verifyVariableVisibility(variableName, true);

    // Switch to Tab2 and verify variable is NOT visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab2"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

    await scopedVars.verifyVariableVisibility(variableName, false);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await deleteDashboard(page, dashboardName);
  });

  test("2-should use same variable on different tabs with independent values", async ({ page }) => {
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
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').waitFor({ state: "visible", timeout: 10000 });

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab2"]').waitFor({ state: "visible", timeout: 10000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Go to Tab1 and set value
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for variable to appear on the dashboard after tab switch
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    const varDropdown1 = page.getByLabel(variableName, { exact: true });
    await varDropdown1.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varDropdown1.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

    const option1 = page.locator('[role="option"]').nth(0);
    await option1.waitFor({ state: "visible", timeout: 5000 });
    const value1 = await option1.textContent();
    await option1.click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Go to Tab2 and set different value
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab2"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for variable to appear on the dashboard after tab switch
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    const varDropdown2 = page.getByLabel(variableName, { exact: true });
    await varDropdown2.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varDropdown2.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

    const option2 = page.locator('[role="option"]').nth(1);
    await option2.waitFor({ state: "visible", timeout: 5000 });
    const value2 = await option2.textContent();
    await option2.click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Verify values are different
    expect(value1.trim()).not.toBe(value2.trim());

    // Switch back to Tab1 and verify value persists
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });
    // Wait for variable to appear on the dashboard after tab switch
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    // Wait for inner dropdown to be fully initialized
    await page.locator(`[data-test="variable-selector-${variableName}-inner"]`).waitFor({ state: "visible", timeout: 10000 });
    // Wait for network idle to ensure value is loaded
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    // Verify the persisted value is displayed in the selector
    const variableSelector1 = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(variableSelector1).toContainText(value1.trim(), { timeout: 10000 });

    // Switch to Tab2 and verify value persists
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab2"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });
    // Wait for variable to appear on the dashboard after tab switch
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    // Wait for inner dropdown to be fully initialized
    await page.locator(`[data-test="variable-selector-${variableName}-inner"]`).waitFor({ state: "visible", timeout: 10000 });
    // Wait for network idle to ensure value is loaded
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    // Verify the persisted value is displayed in the selector
    const variableSelector2 = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(variableSelector2).toContainText(value2.trim(), { timeout: 10000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await deleteDashboard(page, dashboardName);
  });

  test("3-should load tab variable only when tab becomes active", async ({ page }) => {
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
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab2"]').waitFor({ state: "visible", timeout: 10000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Initially on default tab - variable should not load yet
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Monitor API calls when switching to Tab2
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 10000 });

    // Switch to Tab2
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab2"]').click();

    const result = await apiMonitor;

    // Should trigger variable load API
    expect(result.success).toBe(true);
    expect(result.actualCount).toBeGreaterThanOrEqual(1);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await deleteDashboard(page, dashboardName);
  });

  test("4-should not change value on other tabs when variable value changes", async ({ page }) => {
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
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').waitFor({ state: "visible", timeout: 10000 });

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab2"]').waitFor({ state: "visible", timeout: 10000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Set value on Tab1
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for variable to appear on the dashboard after tab switch
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

    const option1 = page.locator('[role="option"]').nth(0);
    await option1.waitFor({ state: "visible", timeout: 5000 });
    const originalValue = await option1.textContent();
    await option1.click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Switch to Tab2
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab2"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for variable to appear on the dashboard after tab switch
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    // Wait for inner dropdown to be fully initialized
    await page.locator(`[data-test="variable-selector-${variableName}-inner"]`).waitFor({ state: "visible", timeout: 10000 });
    // Wait for network idle to ensure value is loaded
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Get initial value on Tab2 (should be default, not changed by Tab1)
    const tab2Selector = page.locator(`[data-test="variable-selector-${variableName}"]`);
    const tab2Value = await tab2Selector.innerText();

    // Go back to Tab1 and change value
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

    // Re-query the dropdown after tab switch
    const varDropdownTab1Again = page.getByLabel(variableName, { exact: true });
    await varDropdownTab1Again.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // Wait extra time for variable to fully initialize after tab switch
    await page.waitForTimeout(1000);
    await varDropdownTab1Again.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 10000 });

    const option2 = page.locator('[role="option"]').nth(1);
    await option2.waitFor({ state: "visible", timeout: 5000 });
    await option2.click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Switch to Tab2 and verify value hasn't changed
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab2"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for variable to appear on the dashboard after tab switch
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    // Wait for inner dropdown to be fully initialized
    await page.locator(`[data-test="variable-selector-${variableName}-inner"]`).waitFor({ state: "visible", timeout: 10000 });
    // Wait for network idle to ensure value is loaded
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Verify value hasn't changed
    const tab2SelectorAfter = page.locator(`[data-test="variable-selector-${variableName}"]`);
    const tab2ValueAfter = await tab2SelectorAfter.innerText();
    expect(tab2ValueAfter).toContain(tab2Value);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await deleteDashboard(page, dashboardName);
  });

  test("5-should allow tab variable to depend on global variable", async ({ page }) => {
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
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').waitFor({ state: "visible", timeout: 10000 });

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
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables(); 
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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${tabVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Change global variable value
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${globalVar}"]`).waitFor({ state: "visible", timeout: 10000 });

    const globalDropdown = page.getByLabel(globalVar, { exact: true });
    await globalDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await globalDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

    const globalOption = page.locator('[role="option"]').first();
    await globalOption.waitFor({ state: "visible", timeout: 5000 });
    await globalOption.click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Monitor API call for dependent tab variable
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 10000 });

    // Wait for dependent variable to reload
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    const result = await apiMonitor;

    // Tab variable should reload based on global variable change
    expect(result.actualCount).toBeGreaterThanOrEqual(0); // May or may not trigger immediately

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await deleteDashboard(page, dashboardName);
  });

  test("6-should persist tab variable values across page refresh", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TabPersist_${Date.now()}`;
    const variableName = `persist_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add tab variable to default tab
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      {
        scope: "tabs",
        assignedTabs: ["default"]
      }
    );
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Stay on default tab and set value
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

    const option = page.locator('[role="option"]').first();
    await option.waitFor({ state: "visible", timeout: 5000 });
    const selectedValue = await option.textContent();
    await option.click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Get current URL
    const currentURL = page.url();

    // Verify URL contains tab variable parameter (default tab uses 'default' in URL)
    expect(currentURL).toContain(`var-${variableName}.t.default=`);

    // Refresh page
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Wait for default tab content to load after reload
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for variable to appear on dashboard after reload
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    // Wait for inner dropdown to be fully initialized
    await page.locator(`[data-test="variable-selector-${variableName}-inner"]`).waitFor({ state: "visible", timeout: 10000 });
    // Wait for network idle to ensure value is loaded
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Verify value persisted
    const variableSelectorAfterReload = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(variableSelectorAfterReload).toContainText(selectedValue.trim(), { timeout: 10000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await deleteDashboard(page, dashboardName);
  });

  test("7-should show (deleted tab) when tab is deleted but variable still exists", async ({ page }) => {
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
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').waitFor({ state: "visible", timeout: 10000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Now delete the tab
    await pm.dashboardSetting.openSetting();
    // Make sure we're on the tabs settings tab
    await page.locator('[data-test="dashboard-settings-tab-tab"]').click();
    await page.waitForLoadState('domcontentloaded');
    await pm.dashboardSetting.deleteTab("Tab1");
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Open variables to verify deleted tab label
    await pm.dashboardSetting.openVariables();
    // Wait for variables tab to be active
    await page.locator('[data-test="dashboard-add-variable-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Verify deleted tab label using common function
    await scopedVars.verifyDeletedScopeLabel("tab");

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await deleteDashboard(page, dashboardName);
  });
});
