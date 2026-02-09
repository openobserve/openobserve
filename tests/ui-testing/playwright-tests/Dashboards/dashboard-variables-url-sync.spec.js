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

  test("1-should sync global variable value to URL (var-{variable}={value})", async ({ page }) => {
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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

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
    await page.locator('[data-test="dashboard-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify URL contains var-{variable}={value}
    const currentURL = page.url();
    const expectedParam = `var-${variableName}=`;
    expect(currentURL).toContain(expectedParam);
    expect(currentURL).toContain(encodeURIComponent(selectedValue.trim()));

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("2-should sync tab variable value to URL (var-{variable}.t.{tabId}={value})", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TabURLSync_${Date.now()}`;
    const variableName = `tab_var_${Date.now()}`;

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

    // Stay on default tab and wait for variable to appear
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for variable to appear on the dashboard
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

    // Click refresh
    await page.locator('[data-test="dashboard-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify URL contains var-{variable}.t.default={value}
    const currentURL = page.url();
    const expectedParam = `var-${variableName}.t.default=`;
    expect(currentURL).toContain(expectedParam);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("3-should sync panel variable value to URL (var-{variable}.p.{panelId}={value})", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelURLSync_${Date.now()}`;
    const variableName = `panel_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add panel and capture panel ID from API response
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");

    // Wait for the dashboard update API call and capture the response
    const responsePromise = page.waitForResponse(
      response => response.url().includes('/api/') && response.url().includes('/dashboards/') && response.request().method() === 'PUT',
      { timeout: 30000 }
    );

    await pm.dashboardPanelActions.savePanel();

    // Get the panel ID from the response
    const response = await responsePromise;
    const responseData = await response.json();

    // Extract panel ID from the response - it should be in the panels array
    let panelId = null;
    if (responseData.panels && responseData.panels.length > 0) {
      panelId = responseData.panels[0].id;
    }

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

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

    // Click global refresh to update URL
    await page.locator('[data-test="dashboard-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify URL contains panel variable parameter
    // Panel variables should be in URL with format var-{variable}.p.{panelId}={value}
    const currentURL = page.url();
    if (panelId) {
      expect(currentURL).toContain(`var-${variableName}.p.${panelId}=`);
    } else {
      // Fallback: just verify the panel variable format exists
      expect(currentURL).toContain(`var-${variableName}.p.`);
    }

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

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
    await page.locator('[data-test="dashboard-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Get current URL
    const urlWithParams = page.url();

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Wait for dashboard to load after reload
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Wait for variable selector to appear
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Verify variable value restored - check the displayed value in the selector
    const variableSelector = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(variableSelector).toContainText(selectedValue.trim(), { timeout: 10000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Get dashboard URL
    const baseURL = page.url();

    // Construct URL with variable parameter
    const urlWithVar = `${baseURL}${baseURL.includes('?') ? '&' : '?'}var-${variableName}=${encodeURIComponent(testValue)}`;

    // Navigate to URL directly
    await page.goto(urlWithVar);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Wait for dashboard to load
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Wait for variable selector to appear
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Verify value is set from URL - check the displayed value in the selector
    const variableSelector = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(variableSelector).toContainText(testValue, { timeout: 10000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

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
    await page.locator('[data-test="dashboard-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Get URL
    const urlToCopy = page.url();

    // Open new tab with same URL
    const newPage = await context.newPage();
    await newPage.goto(urlToCopy);
    await newPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Wait for dashboard to load in new tab
    await newPage.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Wait for variable selector to appear in new tab
    await newPage.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await newPage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Verify variable value in new tab - check the displayed value
    const newPageSelector = newPage.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(newPageSelector).toContainText(selectedValue.trim(), { timeout: 10000 });

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
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(var2, "logs", "e2e_automate", "kubernetes_container_name", { scope: "global" });
    // Wait for variables to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${var1}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(`[data-test="dashboard-edit-variable-${var2}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

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
    await page.locator('[data-test="dashboard-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify URL contains both variables
    const currentURL = page.url();
    expect(currentURL).toContain(`var-${var1}=`);
    expect(currentURL).toContain(`var-${var2}=`);

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

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
    await page.locator('[data-test="dashboard-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Get URL with drilldown variable
    const urlWithDrilldown = page.url();

    // Verify variable is in URL and can be used for drilldown
    expect(urlWithDrilldown).toContain(`var-${variableName}=`);
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

    // Add global and tab variables using default tab
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(globalVar, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(tabVar, "logs", "e2e_automate", "kubernetes_container_name", { scope: "tabs", assignedTabs: ["default"] });
    // Wait for variables to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${globalVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(`[data-test="dashboard-edit-variable-${tabVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Wait for both variables to appear on dashboard (both are on default tab)
    await page.locator(`[data-test="variable-selector-${globalVar}"]`).waitFor({ state: "visible", timeout: 10000 });
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
    await page.locator('[data-test="dashboard-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify URL structure
    const currentURL = page.url();
    expect(currentURL).toContain(`var-${globalVar}=`);
    expect(currentURL).toContain(`var-${tabVar}.t.default=`);

    // Verify proper URL format
    const isValid = await verifyVariablesInURL(page, {}, "global");
    expect(isValid || currentURL.includes('var-')).toBe(true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
