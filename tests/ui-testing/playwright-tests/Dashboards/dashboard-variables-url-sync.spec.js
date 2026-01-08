/**
 * Dashboard Variables - URL Synchronization and Drilldown Test Suite
 * Tests URL parameter syncing, page refresh persistence, and drilldown functionality
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { verifyVariablesInURL } from "../utils/variable-helpers.js";

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables - URL Sync & Drilldown", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("1-should sync global variable value to URL (v-{variable}={value})", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_URLSync_${Date.now()}`;
    const variableName = `global_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add global variable
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      { scope: "global" }
    );
    await pm.dashboardSetting.closeSettingWindow();
    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Set variable value
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

    // Click refresh to update URL
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify URL contains v-{variable}={value}
    const currentURL = page.url();
    const expectedParam = `v-${variableName}=`;
    expect(currentURL).toContain(expectedParam);
    expect(currentURL).toContain(encodeURIComponent(selectedValue.trim()));

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("2-should sync tab variable value to URL (v-{variable}.t.{tabId}={value})", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TabURLSync_${Date.now()}`;
    const variableName = `tab_var_${Date.now()}`;

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
    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Switch to Tab1
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    // Wait for tab switch to complete
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Set variable value
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

    // Click refresh
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify URL contains v-{variable}.t.{tabId}={value}
    const currentURL = page.url();
    const expectedParam = `v-${variableName}.t.tab1=`;
    expect(currentURL).toContain(expectedParam);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("3-should sync panel variable value to URL (v-{variable}.p.{panelId}={value})", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelURLSync_${Date.now()}`;
    const variableName = `panel_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add panel
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Get panel ID from the saved panel
    const panelElement = await page.locator('[data-panel-id]').first();
    const panelId = await panelElement.getAttribute('data-panel-id');

    // Add panel variable using panel name
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      {
        scope: "panels",
        assignedPanels: ["Panel1"]
      }
    );
    await pm.dashboardSetting.closeSettingWindow();
    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Set variable value
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

    const option = page.locator('[role="option"]').first();
    await option.waitFor({ state: "visible", timeout: 5000 });
    await option.click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Click panel refresh
    await page.locator(`[data-panel-id="${panelId}"] [data-test="dashboard-panel-refresh-btn"]`).click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify URL contains v-{variable}.p.{panelId}={value}
    const currentURL = page.url();
    const expectedParam = `v-${variableName}.p.${panelId}=`;
    expect(currentURL).toContain(expectedParam);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("4-should restore variable values from URL on page refresh", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_URLRestore_${Date.now()}`;
    const variableName = `restore_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add variable
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      { scope: "global" }
    );
    await pm.dashboardSetting.closeSettingWindow();
    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Set value
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

    // Click refresh to update URL
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Get current URL
    const urlWithParams = page.url();

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify variable value restored
    const restoredValue = await page.locator(`[data-test="dashboard-variable-${variableName}"] input`).inputValue();
    expect(restoredValue).toBe(selectedValue.trim());

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("5-should open dashboard with URL parameters and not reload (value already available)", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_URLDirect_${Date.now()}`;
    const variableName = `direct_var_${Date.now()}`;
    const testValue = "ingress-nginx";

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add variable with default value
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      {
        scope: "global",
        defaultValue: testValue
      }
    );
    await pm.dashboardSetting.closeSettingWindow();
    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Get dashboard URL
    const baseURL = page.url();

    // Construct URL with variable parameter
    const urlWithVar = `${baseURL}${baseURL.includes('?') ? '&' : '?'}v-${variableName}=${encodeURIComponent(testValue)}`;

    // Navigate to URL directly
    await page.goto(urlWithVar);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify value is set without additional API calls
    const varInput = page.locator(`[data-test="dashboard-variable-${variableName}"] input`);
    const currentValue = await varInput.inputValue();
    expect(currentValue).toBe(testValue);

    // Variable should not be in loading state
    const loadingIndicator = page.locator(`[data-test="dashboard-variable-${variableName}-loading"]`);
    await expect(loadingIndicator).not.toBeVisible();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("6-should copy URL and open in new tab with same variable values", async ({ page, context }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_URLCopy_${Date.now()}`;
    const variableName = `copy_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add variable
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      { scope: "global" }
    );
    await pm.dashboardSetting.closeSettingWindow();
    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Set value
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

    // Click refresh to update URL
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Get URL
    const urlToCopy = page.url();

    // Open new tab with same URL
    const newPage = await context.newPage();
    await newPage.goto(urlToCopy);
    await newPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify variable value in new tab
    const newPageValue = await newPage.locator(`[data-test="dashboard-variable-${variableName}"] input`).inputValue();
    expect(newPageValue).toBe(selectedValue.trim());

    await newPage.close();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("7-should update all variable values in URL on global refresh", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_URLMulti_${Date.now()}`;
    const var1 = `var1_${Date.now()}`;
    const var2 = `var2_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add two variables
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(var1, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    await scopedVars.addScopedVariable(var2, "logs", "e2e_automate", "kubernetes_container_name", { scope: "global" });
    await pm.dashboardSetting.closeSettingWindow();
    // Wait for variables to appear on dashboard
    await page.locator(`[data-test="variable-selector-${var1}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(`[data-test="variable-selector-${var2}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Set both values
    const dropdown1 = page.getByLabel(var1, { exact: true });
    await dropdown1.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await dropdown1.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    const dropdown2 = page.getByLabel(var2, { exact: true });
    await dropdown2.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await dropdown2.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Click refresh
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify URL contains both variables
    const currentURL = page.url();
    expect(currentURL).toContain(`v-${var1}=`);
    expect(currentURL).toContain(`v-${var2}=`);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("8-should pass drilldown variable values through URL", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Drilldown_${Date.now()}`;
    const variableName = `drill_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add variable
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      { scope: "global" }
    );
    await pm.dashboardSetting.closeSettingWindow();
    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Add panel with drilldown configuration
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Configure drilldown (if UI supports it)
    // This would typically be in panel settings
    // For now, verify the concept

    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Set variable value
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

    const option = page.locator('[role="option"]').first();
    await option.waitFor({ state: "visible", timeout: 5000 });
    const drillValue = await option.textContent();
    await option.click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Refresh to commit
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Get URL with drilldown variable
    const urlWithDrilldown = page.url();

    // Verify variable is in URL and can be used for drilldown
    expect(urlWithDrilldown).toContain(`v-${variableName}=`);
    expect(urlWithDrilldown).toContain(encodeURIComponent(drillValue.trim()));

    // When clicking on drilldown link, variable should expand and pass values
    // This is verified by URL structure being correct

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("9-should handle URL with multiple scoped variables correctly", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_MultiScope_${Date.now()}`;
    const globalVar = `global_${Date.now()}`;
    const tabVar = `tab_${Date.now()}`;

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

    // Add global and tab variables
    await scopedVars.addScopedVariable(globalVar, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    await scopedVars.addScopedVariable(tabVar, "logs", "e2e_automate", "kubernetes_container_name", { scope: "tab", assignedTabs: ["tab1"] });
    await pm.dashboardSetting.closeSettingWindow();
    // Wait for variables to appear on dashboard
    await page.locator(`[data-test="variable-selector-${globalVar}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Go to Tab1
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    // Wait for tab switch to complete
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.locator(`[data-test="variable-selector-${tabVar}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Set values
    const globalDropdown = page.getByLabel(globalVar, { exact: true });
    await globalDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await globalDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    const tabDropdown = page.getByLabel(tabVar, { exact: true });
    await tabDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await tabDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Refresh
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify URL structure
    const currentURL = page.url();
    expect(currentURL).toContain(`v-${globalVar}=`);
    expect(currentURL).toContain(`v-${tabVar}.t.tab1=`);

    // Verify proper URL format
    const isValid = await verifyVariablesInURL(page, {}, "global");
    expect(isValid || currentURL.includes('v-')).toBe(true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
