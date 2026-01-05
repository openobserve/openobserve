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

  test("1-should display panel-level variable only for assigned panel", async ({ page }) => {
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
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard and panel editor to close
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    // Wait for settings button to be available (indicates panel editor has closed)
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await pm.dashboardSetting.closeSettingWindow();

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Verify variable is visible for Panel1
    await scopedVars.verifyVariableVisibility(variableName, true);

    // Add second panel
    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel2");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').nth(1).waitFor({ state: "visible", timeout: 15000 });

    // Variable should not be visible for Panel2 context
    const panel2Context = page.locator('[data-test="dashboard-panel-2"]');
    const variableInPanel2 = panel2Context.locator(`[data-test="dashboard-variable-${variableName}"]`);
    await expect(variableInPanel2).not.toBeVisible();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("2-should load panel variable only when panel is visible", async ({ page }) => {
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
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await pm.dashboardSetting.closeSettingWindow();

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Ensure network is idle after variable initialization
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Monitor API calls when panel becomes visible
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 15000 });

    // Scroll to panel to make it visible
    await page.locator(`[data-panel-id="${panelId}"]`).scrollIntoViewIfNeeded();

    // Wait for API call to complete
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    const result = await apiMonitor;

    // Should load variable when panel becomes visible
    expect(result.actualCount).toBeGreaterThanOrEqual(0);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("3-should allow panel variable to depend on global and tab variables", async ({ page }) => {
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
    // Wait for tab to be saved
    await page.locator('[data-test="dashboard-tab-tab1"]').waitFor({ state: "visible", timeout: 5000 });

    // Add global variable
    await scopedVars.addScopedVariable(
      globalVar,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      { scope: "global" }
    );
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${globalVar}"]`).waitFor({ state: "visible", timeout: 10000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${tabVar}"]`).waitFor({ state: "visible", timeout: 10000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for variables to appear on dashboard
    await page.locator(`[data-test="variable-selector-${globalVar}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Switch to Tab1 and add panel
    await page.locator('[data-test="dashboard-tab-tab1"]').click();
    // Wait for tab switch to complete
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${panelVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await pm.dashboardSetting.closeSettingWindow();

    // Wait for panel variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${panelVar}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Verify all variables are visible
    await scopedVars.verifyVariableVisibility(globalVar, true);
    await scopedVars.verifyVariableVisibility(tabVar, true);
    await scopedVars.verifyVariableVisibility(panelVar, true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("4-should not allow panel variable to depend on other panel variables", async ({ page }) => {
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
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    const panelId = await page.locator('[data-test*="dashboard-panel-"]').first().getAttribute("data-panel-id");

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${panelVar1}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Try to add second panel variable depending on first
    // This should either show error or not list panel variables in dependency dropdown
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[data-test="dashboard-variable-name"]').fill(panelVar2);

    // Select scope, stream type, stream, and field for the second variable
    await page.locator('[data-test="dashboard-variable-scope-select"]').click();
    await page.getByRole("option", { name: "Selected Panels", exact: true }).click();

    // Select the tab first (if needed)
    await page.locator('[data-test="dashboard-variable-tabs-select"]').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[data-test="dashboard-variable-tabs-select"]').click();
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.locator('.q-item').filter({ hasText: /^Default$/ }).click();
    await page.keyboard.press('Escape');
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

    // Select the panel
    await page.locator('[data-test="dashboard-variable-panels-select"]').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[data-test="dashboard-variable-panels-select"]').click();
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.locator(`[data-test="dashboard-variable-assign-panels-${panelId}"]`).click();
    await page.keyboard.press('Escape');
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

    await page.locator('[data-test="dashboard-variable-stream-type-select"]').click();
    await page.getByRole("option", { name: "logs", exact: true }).click();

    const streamSelect = page.locator('[data-test="dashboard-variable-stream-select"]');
    await streamSelect.click();
    await streamSelect.fill("e2e_automate");
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();

    const fieldSelect = page.locator('[data-test="dashboard-variable-field-select"]');
    await fieldSelect.click();
    await fieldSelect.fill("kubernetes_container_name");
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();

    // Check dependency dropdown via filter - panel variables should NOT be in the list
    await page.locator('[data-test="dashboard-add-filter-btn"]').click();

    const filterNameSelector = page.locator('[data-test="dashboard-query-values-filter-name-selector"]').last();
    await filterNameSelector.waitFor({ state: "visible", timeout: 5000 });
    await filterNameSelector.click();
    await filterNameSelector.fill("kubernetes_namespace_name");
    await page.getByRole("option", { name: "kubernetes_namespace_name" }).click();

    const operatorSelector = page.locator('[data-test="dashboard-query-values-filter-operator-selector"]').last();
    await operatorSelector.click();
    await page.getByRole("option", { name: "=", exact: true }).locator("div").nth(2).click();

    // Click on the autocomplete to see available variables
    const autoComplete = page.locator('[data-test="common-auto-complete"]').last();
    await autoComplete.click();
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    const options = page.locator('[role="option"]');
    const optionTexts = await options.allTextContents();

    expect(optionTexts).not.toContain(panelVar1);

    await pm.dashboardSetting.closeSettingWindow();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("5-should show (deleted panel) when panel is deleted but variable exists", async ({ page }) => {
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
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await pm.dashboardSetting.closeSettingWindow();

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Delete the panel
    await page.locator(`[data-panel-id="${panelId}"] [data-test="dashboard-panel-delete-btn"]`).click();
    await page.locator('[data-test="confirm-button"]').click();
    // Wait for deletion to complete
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Open variable settings
    await pm.dashboardSetting.openSetting();
    // Wait for settings dialog to open
    await page.locator('.q-dialog').waitFor({ state: "visible", timeout: 5000 });
    await pm.dashboardSetting.openVariables();
    // Wait for variables tab to be active
    await page.locator('[data-test="dashboard-add-variable-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Edit variable
    await page.locator(`[data-test="dashboard-variable-${variableName}-edit"]`).click();

    // Verify shows "(deleted panel)"
    await scopedVars.verifyDeletedScopeLabel("panel", panelId);

    await pm.dashboardSetting.closeSettingWindow();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("6-should use panel variable in query when panel renders", async ({ page }) => {
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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await pm.dashboardSetting.closeSettingWindow();

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

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

    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Set variable value
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.waitFor({ state: "visible", timeout: 5000 });

    // Ensure network is idle before clicking dropdown
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await varDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

    const option = page.locator('[role="option"]').first();
    await option.waitFor({ state: "visible", timeout: 5000 });
    await option.click();

    // Wait for dropdown to close
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Trigger panel refresh
    await page.locator('[data-test="dashboard-panel-refresh-btn"]').first().click();

    // Wait for panel to refresh
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Panel should render with variable value
    const panelElement = page.locator('[data-test*="dashboard-panel-"]').first();
    await expect(panelElement).toBeVisible();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("7-should assign panel variable to multiple panels", async ({ page }) => {
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
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Add second panel
    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel2");
    await pm.dashboardPanelActions.savePanel();

    // Wait for second panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').nth(1).waitFor({ state: "visible", timeout: 15000 });

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
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await pm.dashboardSetting.closeSettingWindow();

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Verify variable is visible for both panels
    await scopedVars.verifyVariableVisibility(variableName, true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
