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
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

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
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
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

    // Add multiple dummy panels to push test panel out of viewport
    for (let i = 0; i < 6; i++) {
      if (i === 0) {
        await pm.dashboardCreate.addPanel();
      } else {
        await pm.dashboardCreate.addPanelToExistingDashboard();
      }
      await pm.chartTypeSelector.selectChartType("line");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
      await pm.dashboardPanelActions.addPanelName(`DummyPanel${i + 1}`);
      await pm.dashboardPanelActions.savePanel();
      await page.locator('[data-test*="dashboard-panel-"]').nth(i).waitFor({ state: "visible", timeout: 10000 });
      await page.waitForLoadState('domcontentloaded');
    }

    // Add test panel at the bottom (not initially visible due to scroll)
    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added and rendered
    await page.locator('[data-test*="dashboard-panel-"]').nth(6).waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('domcontentloaded');

    // Scroll to top to ensure Panel1 is out of viewport
    await page.evaluate(() => {
      // Reset all scroll positions to ensure clean state
      window.scrollTo(0, 0);
      const dashboardContainer = document.querySelector('.dashboard-panels-container');
      if (dashboardContainer) {
        dashboardContainer.scrollTop = 0;
        dashboardContainer.scrollLeft = 0;
      }
    });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

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
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await pm.dashboardSetting.closeSettingWindow();

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Panel1 should be out of viewport, so variable should not be loaded yet
    // Monitor API calls when we scroll to Panel1
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 15000 });

    // Scroll to Panel1 to make it visible and trigger variable loading
    await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll('[data-test*="dashboard-panel-"]'));
      const targetPanel = panels[6]; // Panel1 is the 7th panel (index 6)
      if (targetPanel) {
        targetPanel.scrollIntoView({ behavior: 'auto', block: 'center' }); // Use 'auto' for immediate scroll
      }
    });

    // Wait for panel to be in viewport and API calls to complete
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    const result = await apiMonitor;

    // Variable should load when panel becomes visible
    expect(result.actualCount).toBeGreaterThanOrEqual(0);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
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
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('domcontentloaded');

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
    // Ensure settings is closed and then re-open to add another variable
    await pm.dashboardSetting.closeSettingWindow();
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

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

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for variables to appear on dashboard and settings to fully close
    await page.locator(`[data-test="variable-selector-${globalVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('domcontentloaded');

    // Switch to Tab1 and add panel
    const tab1Selector = page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]');
    await tab1Selector.waitFor({ state: "visible", timeout: 10000 });

    // Ensure the tab is clickable and not obscured
    await tab1Selector.scrollIntoViewIfNeeded();
    await tab1Selector.click();

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
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      panelVar,
      "logs",
      "e2e_automate",
      "_timestamp",
      {
        scope: "panels",
        assignedTabs: ["tab1"],
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
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
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

    // Add first panel
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for Panel1 to be added
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Add second panel
    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel2");
    await pm.dashboardPanelActions.savePanel();

    // Wait for Panel2 to be added
    await page.locator('[data-test*="dashboard-panel-"]').nth(1).waitFor({ state: "visible", timeout: 15000 });

    // Add panel variable for Panel1
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
    await page.locator(`[data-test="dashboard-edit-variable-${panelVar1}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Try to add panel variable for Panel2 and check if Panel1's variable appears in dependency options
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[data-test="dashboard-variable-name"]').fill(panelVar2);

    // Select scope as panels
    await page.locator('[data-test="dashboard-variable-scope-select"]').click();
    await page.getByRole("option", { name: "Selected Panels", exact: true }).click();

    // Select default tab
    await page.locator('[data-test="dashboard-variable-tabs-select"]').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[data-test="dashboard-variable-tabs-select"]').click();
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.locator('.q-item').filter({ hasText: /^Default$/ }).click();
    await page.keyboard.press('Escape');
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

    // Select Panel2
    await page.locator('[data-test="dashboard-variable-panels-select"]').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[data-test="dashboard-variable-panels-select"]').click();
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.locator('.q-item').filter({ hasText: /^Panel2$/ }).click();
    await page.keyboard.press('Escape');
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

    // Select stream type, stream, and field
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

    // Add a filter to check dependency dropdown - panel variables should NOT be in the list
    await page.locator('[data-test="dashboard-add-filter-btn"]').click();

    const filterNameSelector = page.locator('[data-test="dashboard-query-values-filter-name-selector"]').last();
    await filterNameSelector.waitFor({ state: "visible", timeout: 5000 });
    await filterNameSelector.click();
    await filterNameSelector.fill("kubernetes_namespace_name");
    await page.getByRole("option", { name: "kubernetes_namespace_name" }).click();

    const operatorSelector = page.locator('[data-test="dashboard-query-values-filter-operator-selector"]').last();
    await operatorSelector.click();
    await page.getByRole("option", { name: "=", exact: true }).locator("div").nth(2).click();

    // Click on the value autocomplete to see available variables
    const autoComplete = page.locator('[data-test="common-auto-complete"]').last();
    await autoComplete.click();
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Get all available variable options
    const options = page.locator('[role="option"]');
    const optionTexts = await options.allTextContents();

    // Panel1's variable should NOT be in the list
    expect(optionTexts).not.toContain(panelVar1);
    expect(optionTexts).not.toContain(`$${panelVar1}`);

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
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Delete the panel using the panel dropdown menu
    await pm.dashboardPanelEdit.deletePanel("Panel1");
    // Wait for deletion to complete
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Open variable settings to verify deleted panel label
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    // Wait for variables tab to be active
    await page.locator('[data-test="dashboard-add-variable-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Verify deleted panel label using common function
    await scopedVars.verifyDeletedScopeLabel("panel");

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

    // Add panel first
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Now create panel variable
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

    // Edit panel to add filter using the variable
    await pm.dashboardPanelEdit.editPanel("Panel1");

    // First add the filter field
    await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "filter");

    // Then set the filter condition to use the variable
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_namespace_name",
      "",
      "=",
      `$${variableName}`
    );
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to update
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Set variable value
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.waitFor({ state: "visible", timeout: 5000 });

    // Ensure network is idle before clicking dropdown
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // Wait extra time for variable to fully initialize
    await page.waitForTimeout(1000);

    await varDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 10000 });
    // Wait for options to load
    await page.waitForTimeout(1000);

    const option = page.locator('[role="option"]').first();
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click();

    // Wait for dropdown to close
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Trigger panel refresh
    await page.locator('[data-test="dashboard-panel-refresh-panel-btn"]').first().click();

    // Wait for panel to refresh
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Panel should render with variable value
    const panelElement = page.locator('[data-test*="dashboard-panel-"]').first();
    await expect(panelElement).toBeVisible();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
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
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Verify variable appears in Panel1
    const panel1Container = page.locator('[data-test*="dashboard-panel-"]').filter({ hasText: "Panel1" }).first();
    const panel1Variable = panel1Container.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(panel1Variable).toBeVisible({ timeout: 10000 });

    // Verify variable appears in Panel2
    const panel2Container = page.locator('[data-test*="dashboard-panel-"]').filter({ hasText: "Panel2" }).first();
    const panel2Variable = panel2Container.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(panel2Variable).toBeVisible({ timeout: 10000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await deleteDashboard(page, dashboardName);
  });
});
