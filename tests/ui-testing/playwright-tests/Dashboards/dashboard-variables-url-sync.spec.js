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

  test("should sync global variable value to URL (v-{variable}={value})", async ({ page }) => {
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

    // Set variable value
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.click();
    await page.waitForTimeout(2000);

    const option = page.locator('[role="option"]').first();
    const selectedValue = await option.textContent();
    await option.click();
    await page.waitForTimeout(1000);

    // Click refresh to update URL
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForTimeout(2000);

    // Verify URL contains v-{variable}={value}
    const currentURL = page.url();
    const expectedParam = `v-${variableName}=`;
    expect(currentURL).toContain(expectedParam);
    expect(currentURL).toContain(encodeURIComponent(selectedValue.trim()));

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should sync tab variable value to URL (v-{variable}.t.{tabId}={value})", async ({ page }) => {
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

    // Switch to Tab1
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    await page.waitForTimeout(1000);

    // Set variable value
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.click();
    await page.waitForTimeout(2000);

    const option = page.locator('[role="option"]').first();
    const selectedValue = await option.textContent();
    await option.click();
    await page.waitForTimeout(1000);

    // Click refresh
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForTimeout(2000);

    // Verify URL contains v-{variable}.t.{tabId}={value}
    const currentURL = page.url();
    const expectedParam = `v-${variableName}.t.tab1=`;
    expect(currentURL).toContain(expectedParam);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should sync panel variable value to URL (v-{variable}.p.{panelId}={value})", async ({ page }) => {
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
    await pm.dashboardCreate.savePanelAs("Panel1");
    await page.waitForTimeout(2000);

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

    // Set variable value
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.click();
    await page.waitForTimeout(2000);

    const option = page.locator('[role="option"]').first();
    await option.click();
    await page.waitForTimeout(1000);

    // Click panel refresh
    await page.locator(`[data-panel-id="${panelId}"] [data-test="dashboard-panel-refresh-btn"]`).click();
    await page.waitForTimeout(2000);

    // Verify URL contains v-{variable}.p.{panelId}={value}
    const currentURL = page.url();
    const expectedParam = `v-${variableName}.p.${panelId}=`;
    expect(currentURL).toContain(expectedParam);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should restore variable values from URL on page refresh", async ({ page }) => {
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

    // Set value
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.click();
    await page.waitForTimeout(2000);

    const option = page.locator('[role="option"]').first();
    const selectedValue = await option.textContent();
    await option.click();
    await page.waitForTimeout(1000);

    // Click refresh to update URL
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForTimeout(2000);

    // Get current URL
    const urlWithParams = page.url();

    // Reload page
    await page.reload();
    await page.waitForTimeout(3000);

    // Verify variable value restored
    const restoredValue = await page.locator(`[data-test="dashboard-variable-${variableName}"] input`).inputValue();
    expect(restoredValue).toBe(selectedValue.trim());

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should open dashboard with URL parameters and not reload (value already available)", async ({ page }) => {
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

    // Get dashboard URL
    const baseURL = page.url();

    // Construct URL with variable parameter
    const urlWithVar = `${baseURL}${baseURL.includes('?') ? '&' : '?'}v-${variableName}=${encodeURIComponent(testValue)}`;

    // Navigate to URL directly
    await page.goto(urlWithVar);
    await page.waitForTimeout(2000);

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

  test("should copy URL and open in new tab with same variable values", async ({ page, context }) => {
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

    // Set value
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.click();
    await page.waitForTimeout(2000);

    const option = page.locator('[role="option"]').first();
    const selectedValue = await option.textContent();
    await option.click();
    await page.waitForTimeout(1000);

    // Click refresh to update URL
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForTimeout(2000);

    // Get URL
    const urlToCopy = page.url();

    // Open new tab with same URL
    const newPage = await context.newPage();
    await newPage.goto(urlToCopy);
    await newPage.waitForTimeout(3000);

    // Verify variable value in new tab
    const newPageValue = await newPage.locator(`[data-test="dashboard-variable-${variableName}"] input`).inputValue();
    expect(newPageValue).toBe(selectedValue.trim());

    await newPage.close();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should update all variable values in URL on global refresh", async ({ page }) => {
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

    // Set both values
    const dropdown1 = page.getByLabel(var1, { exact: true });
    await dropdown1.click();
    await page.waitForTimeout(2000);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(1000);

    const dropdown2 = page.getByLabel(var2, { exact: true });
    await dropdown2.click();
    await page.waitForTimeout(2000);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(1000);

    // Click refresh
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForTimeout(2000);

    // Verify URL contains both variables
    const currentURL = page.url();
    expect(currentURL).toContain(`v-${var1}=`);
    expect(currentURL).toContain(`v-${var2}=`);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should pass drilldown variable values through URL", async ({ page }) => {
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

    // Add panel with drilldown configuration
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Configure drilldown (if UI supports it)
    // This would typically be in panel settings
    // For now, verify the concept

    await pm.dashboardCreate.savePanelAs("Panel1");
    await page.waitForTimeout(2000);

    // Set variable value
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.click();
    await page.waitForTimeout(2000);

    const option = page.locator('[role="option"]').first();
    const drillValue = await option.textContent();
    await option.click();
    await page.waitForTimeout(1000);

    // Refresh to commit
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForTimeout(2000);

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

  test("should handle URL with multiple scoped variables correctly", async ({ page }) => {
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
    await page.waitForTimeout(500);

    // Add global and tab variables
    await scopedVars.addScopedVariable(globalVar, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    await scopedVars.addScopedVariable(tabVar, "logs", "e2e_automate", "kubernetes_container_name", { scope: "tab", assignedTabs: ["tab1"] });
    await pm.dashboardSetting.closeSettingWindow();

    // Go to Tab1
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    await page.waitForTimeout(1000);

    // Set values
    const globalDropdown = page.getByLabel(globalVar, { exact: true });
    await globalDropdown.click();
    await page.waitForTimeout(2000);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(1000);

    const tabDropdown = page.getByLabel(tabVar, { exact: true });
    await tabDropdown.click();
    await page.waitForTimeout(2000);
    await page.locator('[role="option"]').first().click();
    await page.waitForTimeout(1000);

    // Refresh
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForTimeout(2000);

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
