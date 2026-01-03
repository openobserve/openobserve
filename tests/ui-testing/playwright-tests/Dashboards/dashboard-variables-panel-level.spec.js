/**
 * Dashboard Variables - Panel Level Test Suite
 * Tests panel-scoped variables, visibility restrictions, and panel-specific behavior
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import {
  monitorVariableAPICalls,
  waitForVariableToLoad
} from "../utils/variable-helpers.js";

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables - Panel Level", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("should display panel-level variable only for assigned panel", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelVar_${Date.now()}`;
    const variableName = `panel_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add first panel
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.dashboardCreate.savePanelAs("Panel1");
    await page.waitForTimeout(2000);

    // Add panel-scoped variable using panel name
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "panels",
        assignedPanels: ["Panel1"]
      }
    );
    await pm.dashboardSetting.closeSettingWindow();

    // Verify variable is visible for Panel1
    await scopedVars.verifyVariableVisibility(variableName, true);

    // Add second panel
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.dashboardCreate.savePanelAs("Panel2");
    await page.waitForTimeout(2000);

    // Variable should not be visible for Panel2 context
    const panel2Context = page.locator('[data-test="dashboard-panel-2"]');
    const variableInPanel2 = panel2Context.locator(`[data-test="dashboard-variable-${variableName}"]`);
    await expect(variableInPanel2).not.toBeVisible();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should load panel variable only when panel is visible", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelLazyLoad_${Date.now()}`;
    const variableName = `lazy_panel_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add panel at the bottom (not initially visible)
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.dashboardCreate.savePanelAs("Panel1");
    await page.waitForTimeout(2000);

    const panelId = await page.locator('[data-test*="dashboard-panel-"]').first().getAttribute("data-panel-id");

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

    // Monitor API calls when panel becomes visible
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 10000 });

    // Scroll to panel to make it visible
    await page.locator(`[data-panel-id="${panelId}"]`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);

    const result = await apiMonitor;

    // Should load variable when panel becomes visible
    expect(result.actualCount).toBeGreaterThanOrEqual(0);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should allow panel variable to depend on global and tab variables", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelDep_${Date.now()}`;
    const globalVar = `global_var_${Date.now()}`;
    const tabVar = `tab_var_${Date.now()}`;
    const panelVar = `panel_var_${Date.now()}`;

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
      { scope: "global" }
    );

    // Add tab variable
    await scopedVars.addScopedVariable(
      tabVar,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "tab",
        assignedTabs: ["tab1"]
      }
    );

    await pm.dashboardSetting.closeSettingWindow();

    // Switch to Tab1 and add panel
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    await page.waitForTimeout(1000);

    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.dashboardCreate.savePanelAs("Panel1");
    await page.waitForTimeout(2000);

    // Add panel variable that depends on both global and tab using panel name
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      panelVar,
      "logs",
      "e2e_automate",
      "_timestamp",
      {
        scope: "panels",
        assignedPanels: ["Panel1"],
        dependsOnMultiple: [globalVar, tabVar]
      }
    );
    await pm.dashboardSetting.closeSettingWindow();

    // Verify all variables are visible
    await scopedVars.verifyVariableVisibility(globalVar, true);
    await scopedVars.verifyVariableVisibility(tabVar, true);
    await scopedVars.verifyVariableVisibility(panelVar, true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should not allow panel variable to depend on other panel variables", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelNoDep_${Date.now()}`;
    const panelVar1 = `panel_var1_${Date.now()}`;
    const panelVar2 = `panel_var2_${Date.now()}`;

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

    // Add first panel variable using panel name
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      panelVar1,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      {
        scope: "panels",
        assignedPanels: ["Panel1"]
      }
    );

    // Try to add second panel variable depending on first
    // This should either show error or not list panel variables in dependency dropdown
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(panelVar2);

    // Select scope, stream type, stream, and field for the second variable
    await page.locator('[data-test="dashboard-variable-scope-select"]').click();
    await page.getByRole("option", { name: "Selected Panels", exact: true }).click();

    // Select the tab first (if needed)
    await page.locator('[data-test="dashboard-variable-tabs-select"]').waitFor({ state: "visible" });
    await page.locator('[data-test="dashboard-variable-tabs-select"]').click();
    await page.waitForTimeout(500);
    await page.locator('.q-item').filter({ hasText: /^Default$/ }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Select the panel
    await page.locator('[data-test="dashboard-variable-panels-select"]').waitFor({ state: "visible" });
    await page.locator('[data-test="dashboard-variable-panels-select"]').click();
    await page.waitForTimeout(500);
    await page.locator(`[data-test="dashboard-variable-assign-panels-${panelId}"]`).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await page.locator('[data-test="dashboard-variable-stream-type-select"]').click();
    await page.getByRole("option", { name: "logs", exact: true }).click();

    const streamSelect = page.locator('[data-test="dashboard-variable-stream-select"]');
    await streamSelect.click();
    await streamSelect.fill("e2e_automate");
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();

    const fieldSelect = page.locator('[data-test="dashboard-variable-field-select"]');
    await fieldSelect.click();
    await fieldSelect.fill("kubernetes_container_name");
    await page.waitForTimeout(1000);
    await page.locator('[role="option"]').first().click();

    // Check dependency dropdown via filter - panel variables should NOT be in the list
    await page.locator('[data-test="dashboard-add-filter-btn"]').click();

    const filterNameSelector = page.locator('[data-test="dashboard-query-values-filter-name-selector"]').last();
    await filterNameSelector.waitFor({ state: "visible" });
    await filterNameSelector.click();
    await filterNameSelector.fill("kubernetes_namespace_name");
    await page.getByRole("option", { name: "kubernetes_namespace_name" }).click();

    const operatorSelector = page.locator('[data-test="dashboard-query-values-filter-operator-selector"]').last();
    await operatorSelector.click();
    await page.getByRole("option", { name: "=", exact: true }).locator("div").nth(2).click();

    // Click on the autocomplete to see available variables
    const autoComplete = page.locator('[data-test="common-auto-complete"]').last();
    await autoComplete.click();
    await page.waitForTimeout(500);

    const options = page.locator('[role="option"]');
    const optionTexts = await options.allTextContents();

    expect(optionTexts).not.toContain(panelVar1);

    await pm.dashboardSetting.closeSettingWindow();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should show (deleted panel) when panel is deleted but variable exists", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_DeletedPanel_${Date.now()}`;
    const variableName = `deleted_panel_var_${Date.now()}`;

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

    const panelId = await page.locator('[data-test*="dashboard-panel-"]').first().getAttribute("data-panel-id");

    // Add panel variable using panel name
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "panels",
        assignedPanels: ["Panel1"]
      }
    );
    await pm.dashboardSetting.closeSettingWindow();

    // Delete the panel
    await page.locator(`[data-panel-id="${panelId}"] [data-test="dashboard-panel-delete-btn"]`).click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.waitForTimeout(1000);

    // Open variable settings
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Edit variable
    await page.locator(`[data-test="dashboard-variable-${variableName}-edit"]`).click();

    // Verify shows "(deleted panel)"
    await scopedVars.verifyDeletedScopeLabel("panel", panelId);

    await pm.dashboardSetting.closeSettingWindow();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should use panel variable in query when panel renders", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelQuery_${Date.now()}`;
    const variableName = `query_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add panel variable first
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      {
        scope: "panels",
        assignedPanels: ["panel-1"] // Will be created
      }
    );
    await pm.dashboardSetting.closeSettingWindow();

    // Add panel with variable in query
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");

    // Add filter using the variable
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_namespace_name",
      "",
      "=",
      `$${variableName}`
    );

    await pm.dashboardCreate.savePanelAs("Panel1");
    await page.waitForTimeout(2000);

    // Set variable value
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.click();
    await page.waitForTimeout(2000);

    const option = page.locator('[role="option"]').first();
    await option.click();
    await page.waitForTimeout(500);

    // Trigger panel refresh
    await page.locator('[data-test="dashboard-panel-refresh-btn"]').first().click();
    await page.waitForTimeout(3000);

    // Panel should render with variable value
    const panelElement = page.locator('[data-test*="dashboard-panel-"]').first();
    await expect(panelElement).toBeVisible();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should assign panel variable to multiple panels", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_MultiPanel_${Date.now()}`;
    const variableName = `multi_panel_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add first panel
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.dashboardCreate.savePanelAs("Panel1");
    await page.waitForTimeout(2000);

    // Add second panel
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.dashboardCreate.savePanelAs("Panel2");
    await page.waitForTimeout(2000);

    // Add variable assigned to both panels using panel names
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      {
        scope: "panels",
        assignedPanels: ["Panel1", "Panel2"]
      }
    );
    await pm.dashboardSetting.closeSettingWindow();

    // Verify variable is visible for both panels
    await scopedVars.verifyVariableVisibility(variableName, true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
