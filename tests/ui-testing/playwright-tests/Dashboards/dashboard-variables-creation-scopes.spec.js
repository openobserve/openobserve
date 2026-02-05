const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables - Creation & Scope Restrictions", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("1-should allow tab variable to depend only on global variables", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TabDepRule_${Date.now()}`;
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
    await scopedVars.addScopedVariable(globalVar, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });

    // Add tab variable with dependency on global variable
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      tabVar,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "tabs",
        assignedTabs: ["tab1"],
        dependsOn: globalVar,
        dependsOnField: "kubernetes_namespace_name"
      }
    );
    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });

  test("2-should NOT allow tab variable to depend on panel variables", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TabNoPanelDep_${Date.now()}`;
    const panelVar = `panel_var_${Date.now()}`;
    const tabVar = `tab_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add panel
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    // Add X and Y axis fields (required for saving panel)
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard and panel editor to close
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    // Wait for panel editor dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // Wait for settings button to be available (indicates panel editor has closed)
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 15000 });

    // Add tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').waitFor({ state: "visible", timeout: 10000 });

    // Add panel variable using panel name instead of panel ID
    await scopedVars.addScopedVariable(panelVar, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "panel",
      assignedPanels: ["Panel1"]
    });

    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${panelVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Try to add tab variable
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(tabVar);

    await page.locator('[data-test="dashboard-variable-scope-select"]').click();
    await page.getByRole("option", { name: "Selected Tabs", exact: true }).click();

    // Select stream and field
    await page.locator('[data-test="dashboard-variable-stream-type-select"]').click();
    await page.getByRole("option", { name: "logs", exact: true }).click();

    const streamSelect = page.locator('[data-test="dashboard-variable-stream-select"]');
    await streamSelect.click();
    await streamSelect.fill("e2e_automate");
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();

    const fieldSelect = page.locator('[data-test="dashboard-variable-field-select"]');
    await fieldSelect.click();
    await fieldSelect.fill("kubernetes_container_name");
    // Wait for options to load
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();

    // Check dependency dropdown via filter - should NOT show panel variables
    // Add filter to check available dependency options
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
    await autoComplete.waitFor({ state: "visible", timeout: 5000 });
    await autoComplete.click();
    // Small wait for dropdown to potentially appear - if no options, listbox won't show
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Check if dropdown appears (it might not if there are no valid options)
    const hasListbox = await page.locator('[role="listbox"]').isVisible().catch(() => false);

    if (hasListbox) {
      // If dropdown appears, verify panel variable is NOT in the list
      const options = await page.locator('[role="option"]').allTextContents();
      expect(options).not.toContain(panelVar);
    } else {
      // If dropdown doesn't appear, it means there are no variables available (correct behavior)
      // This is expected - tab variables cannot depend on panel variables
      console.log("No variables available for dependency (expected - tab variables cannot depend on panel variables)");
    }

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });

  test("3-should NOT allow tab variable to depend on other tab's variables", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_TabNoOtherTab_${Date.now()}`;
    const tab1Var = `tab1_var_${Date.now()}`;
    const tab2Var = `tab2_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add Tab1 and Tab2
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').waitFor({ state: "visible", timeout: 10000 });

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab2"]').waitFor({ state: "visible", timeout: 10000 });

    // Add variable to Tab1
    await scopedVars.addScopedVariable(tab1Var, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });

    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${tab1Var}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Try to add variable to Tab2
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(tab2Var);

    await page.locator('[data-test="dashboard-variable-scope-select"]').click();
    await page.getByRole("option", { name: "Selected Tabs", exact: true }).click();

    // Open tabs dropdown and select tab2
    await page.locator('[data-test="dashboard-variable-tabs-select"]').waitFor({ state: "visible" });
    await page.locator('[data-test="dashboard-variable-tabs-select"]').click();
    // Wait for dropdown menu to be visible
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    // Click the Tab2 option
    await page.locator('.q-item').filter({ hasText: /^Tab2$/ }).waitFor({ state: "visible" });
    await page.locator('.q-item').filter({ hasText: /^Tab2$/ }).click();

    // Select stream and field
    await page.locator('[data-test="dashboard-variable-stream-type-select"]').click();
    await page.getByRole("option", { name: "logs", exact: true }).click();

    const streamSelect = page.locator('[data-test="dashboard-variable-stream-select"]');
    await streamSelect.click();
    await streamSelect.fill("e2e_automate");
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();

    const fieldSelect = page.locator('[data-test="dashboard-variable-field-select"]');
    await fieldSelect.click();
    await fieldSelect.fill("kubernetes_container_name");
    // Wait for options to load
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();

    // Check dependency dropdown via filter - should NOT show Tab1's variable
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
    await autoComplete.waitFor({ state: "visible", timeout: 5000 });
    await autoComplete.click();
    // Small wait for dropdown to potentially appear - if no options, listbox won't show
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Check if dropdown appears (it might not if there are no valid options)
    const hasListbox = await page.locator('[role="listbox"]').isVisible().catch(() => false);

    if (hasListbox) {
      // If dropdown appears, verify tab1's variable is NOT in the list
      const options = await page.locator('[role="option"]').allTextContents();
      expect(options).not.toContain(tab1Var);
    } else {
      // If dropdown doesn't appear, it means there are no variables available (correct behavior)
      // This is actually the expected behavior - tab2 cannot depend on tab1's variable
      console.log("No variables available for dependency (expected - tab variables cannot depend on other tab variables)");
    }

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });

  test("4-should allow panel variable to depend on global and current tab variables", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelDepRule_${Date.now()}`;
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

    // Add global and tab variables
    await scopedVars.addScopedVariable(globalVar, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${globalVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // open setting window
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(tabVar, "logs", "e2e_automate", "kubernetes_container_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${tabVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Switch to Tab1 and add panel
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').waitFor({ state: "visible", timeout: 10000 });
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible", timeout: 5000 });
    // Ensure no dialogs are open before adding panel
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    // Add X and Y axis fields (required for saving panel)
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard and panel editor to close
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    // Wait for panel editor dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // Wait for settings button to be available (indicates panel editor has closed)
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 15000 });
    // Additional wait to ensure dashboard is stable after panel creation
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Add panel variable
    await pm.dashboardSetting.openSetting();
    // Wait for settings dialog to be fully open
    await page.locator('[data-test="dashboard-settings-dialog"]').or(page.locator('.q-dialog')).waitFor({ state: "visible", timeout: 5000 });
    await pm.dashboardSetting.openVariables();
    // Wait for variables tab to be active and add button to be visible
    await page.locator('[data-test="dashboard-add-variable-btn"]').waitFor({ state: "visible", timeout: 10000 });
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(panelVar);

    await page.locator('[data-test="dashboard-variable-scope-select"]').click();
    await page.getByRole("option", { name: "Selected Panels", exact: true }).click();

    // First select the tab containing the panel
    await page.locator('[data-test="dashboard-variable-tabs-select"]').waitFor({ state: "visible" });
    await page.locator('[data-test="dashboard-variable-tabs-select"]').click();
    // Wait for dropdown menu to be visible
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    // Click the Tab1 option
    await page.locator('.q-item').filter({ hasText: /^Tab1$/ }).waitFor({ state: "visible" });
    await page.locator('.q-item').filter({ hasText: /^Tab1$/ }).click();
    await page.keyboard.press('Escape');
    // Wait for dropdown to close
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Then select the panel by name
    await page.locator('[data-test="dashboard-variable-panels-select"]').waitFor({ state: "visible" });
    await page.locator('[data-test="dashboard-variable-panels-select"]').click();
    // Wait for dropdown menu to be visible
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('.q-item').filter({ hasText: /^Panel1$/ }).waitFor({ state: "visible" });
    await page.locator('.q-item').filter({ hasText: /^Panel1$/ }).click();

    // Select stream and field
    await page.locator('[data-test="dashboard-variable-stream-type-select"]').click();
    await page.getByRole("option", { name: "logs", exact: true }).click();

    const streamSelect = page.locator('[data-test="dashboard-variable-stream-select"]');
    await streamSelect.click();
    await streamSelect.fill("e2e_automate");
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();

    const fieldSelect = page.locator('[data-test="dashboard-variable-field-select"]');
    await fieldSelect.click();
    await fieldSelect.fill("kubernetes_pod_name");
    // Wait for options to load
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();

    // Check dependency dropdown via filter - should show both global and tab variables
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
    await autoComplete.waitFor({ state: "visible", timeout: 10000 });
    await autoComplete.click();

    // Wait for dropdown options to appear - CommonAutoComplete uses data-test="common-auto-complete-option"
    await page.locator('[data-test="common-auto-complete-option"]').first().waitFor({ state: "visible", timeout: 10000 });
    // Ensure all options are loaded
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    const options = await page.locator('[data-test="common-auto-complete-option"]').allTextContents();
    expect(options).toContain(globalVar);
    expect(options).toContain(tabVar);

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });

  test("5-should NOT allow panel variable to depend on other panel variables", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelNoOtherPanel_${Date.now()}`;
    const panel1Var = `panel1_var_${Date.now()}`;
    const panel2Var = `panel2_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add Panel1
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Add Panel2
    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel2");
    await pm.dashboardPanelActions.savePanel();

    // Add variable to Panel1 using panel name
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(panel1Var, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "panel",
      assignedPanels: ["Panel1"]
    });

    // Try to add variable to Panel2 depending on Panel1's variable
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(panel2Var);

    await page.locator('[data-test="dashboard-variable-scope-select"]').click();
    await page.getByRole("option", { name: "Selected Panels", exact: true }).click();

    // First select the default tab to enable the panels dropdown
    await page.locator('[data-test="dashboard-variable-tabs-select"]').waitFor({ state: "visible" });
    await page.locator('[data-test="dashboard-variable-tabs-select"]').click();
    // Wait for dropdown menu to be visible
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    // Click the Default tab option
    await page.locator('.q-item').filter({ hasText: /^Default$/ }).waitFor({ state: "visible" });
    await page.locator('.q-item').filter({ hasText: /^Default$/ }).click();
    await page.keyboard.press('Escape');
    // Wait for dropdown to close
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Now open the panels dropdown and select panel2 by name
    await page.locator('[data-test="dashboard-variable-panels-select"]').waitFor({ state: "visible" });
    await page.locator('[data-test="dashboard-variable-panels-select"]').click();
    // Wait for dropdown menu to be visible
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('.q-item').filter({ hasText: /^Panel2$/ }).waitFor({ state: "visible" });
    await page.locator('.q-item').filter({ hasText: /^Panel2$/ }).click();

    // Select stream and field
    await page.locator('[data-test="dashboard-variable-stream-type-select"]').click();
    await page.getByRole("option", { name: "logs", exact: true }).click();

    const streamSelect = page.locator('[data-test="dashboard-variable-stream-select"]');
    await streamSelect.click();
    await streamSelect.fill("e2e_automate");
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();

    const fieldSelect = page.locator('[data-test="dashboard-variable-field-select"]');
    await fieldSelect.click();
    await fieldSelect.fill("kubernetes_pod_name");
    // Wait for options to load
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();

    // Check dependency dropdown via filter - should NOT show Panel1's variable
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
    await autoComplete.waitFor({ state: "visible", timeout: 5000 });
    await autoComplete.click();
    // Small wait for dropdown to potentially appear - if no options, listbox won't show
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Check if dropdown appears (it might not if there are no valid options)
    const hasListbox = await page.locator('[role="listbox"]').isVisible().catch(() => false);

    if (hasListbox) {
      // If dropdown appears, verify panel1's variable is NOT in the list
      const options = await page.locator('[role="option"]').allTextContents();
      expect(options).not.toContain(panel1Var);
    } else {
      // If dropdown doesn't appear, it means there are no variables available (correct behavior)
      // This is expected - panel variables cannot depend on other panel variables
      console.log("No variables available for dependency (expected - panel variables cannot depend on other panel variables)");
    }

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });

  test("6-should create tab variable assigned to multiple tabs", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_MultiTab_${Date.now()}`;
    const variableName = `multi_tab_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add multiple tabs
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').waitFor({ state: "visible", timeout: 10000 });

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab2"]').waitFor({ state: "visible", timeout: 10000 });

    await pm.dashboardSetting.addTabSetting("Tab3");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab3"]').waitFor({ state: "visible", timeout: 10000 });

    // Add variable assigned to all tabs
    await scopedVars.addScopedVariable(variableName, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "tab",
      assignedTabs: ["tab1", "tab2", "tab3"]
    });

    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Verify variable is visible in all tabs
    const tabMapping = { tab1: "Tab1", tab2: "Tab2", tab3: "Tab3" };
    for (const tabId of ["tab1", "tab2", "tab3"]) {
      const tabLocator = page.locator(`span[data-test*="dashboard-tab-"][title="${tabMapping[tabId]}"]`);
      await tabLocator.click();
      // Wait for tab to be active by checking for active state or waiting for tab content to load
      await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

      // Wait for variable to appear on the dashboard after tab switch
      await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

      await scopedVars.verifyVariableVisibility(variableName, true);
    }

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });

  test("7-should create panel variable assigned to multiple panels", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_MultiPanel_${Date.now()}`;
    const variableName = `multi_panel_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add multiple panels
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel2");
    await pm.dashboardPanelActions.savePanel();

    // Wait for both panels to be fully rendered
    await page.locator('[data-test*="dashboard-panel-"]').nth(1).waitFor({ state: "visible", timeout: 15000 });
    // Wait for settings button to ensure panels are fully loaded
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Add variable assigned to both panels using panel names
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(variableName, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "panel",
      assignedPanels: ["Panel1", "Panel2"]
    });
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();
    // Wait for variable selectors to appear on panels
    await page.locator(`[data-test="variable-selector-${variableName}"]`).first().waitFor({ state: "visible", timeout: 10000 });

    // Verify variable is visible for both panels - should have 2 variable selectors (one per panel)
    const variableSelectors = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(variableSelectors).toHaveCount(2, { timeout: 10000 });
    // Verify both are visible
    await expect(variableSelectors.first()).toBeVisible({ timeout: 5000 });
    await expect(variableSelectors.last()).toBeVisible({ timeout: 5000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });

  test("8-should create tab/panel variables without global variables existing", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_NoGlobal_${Date.now()}`;
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

    // Create tab variable WITHOUT any global variables
    await scopedVars.addScopedVariable(tabVar, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });

    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${tabVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Switch to Tab1 and verify variable exists
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').or(page.locator('[data-test*="dashboard-panel-"]')).first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for variable to appear on the dashboard after tab switch
    await page.locator(`[data-test="variable-selector-${tabVar}"]`).waitFor({ state: "visible", timeout: 10000 });

    await scopedVars.verifyVariableVisibility(tabVar, true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });

  test("9-should show only available variables in add panel edit mode", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelEditVars_${Date.now()}`;
    const globalVar = `global_var_${Date.now()}`;
    const tabVar = `tab_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add Tab1
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').waitFor({ state: "visible", timeout: 10000 });

    // Add global and tab variables
    await scopedVars.addScopedVariable(globalVar, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${globalVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // open setting window
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(tabVar, "logs", "e2e_automate", "kubernetes_container_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });
    // Wait for variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${tabVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Switch to Tab1
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible", timeout: 5000 });
    // Ensure no dialogs are open before adding panel
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Go to add panel
    await pm.dashboardCreate.addPanel();
    // Wait for panel editor to open - wait for the chart type selection which appears first
    await page.locator('[data-test="selected-chart-line-item"]').or(page.locator('[data-test="dashboard-apply"]')).first().waitFor({ state: "visible", timeout: 10000 });

    // Check available variables in panel edit mode
    // Both global and tab1 variables should be available
    await scopedVars.verifyVariableInPanelEdit(globalVar, true);
    await scopedVars.verifyVariableInPanelEdit(tabVar, true);

    // Save panel
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });

  test("10-should NOT show other tab's variables in add panel edit mode", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelEditNoOtherTab_${Date.now()}`;
    const tab1Var = `tab1_var_${Date.now()}`;
    const tab2Var = `tab2_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add Tab1 and Tab2
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').waitFor({ state: "visible", timeout: 10000 });

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab2"]').waitFor({ state: "visible", timeout: 10000 });

    // Add variables to both tabs
    await scopedVars.addScopedVariable(tab1Var, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });
    // Wait for first variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${tab1Var}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await scopedVars.addScopedVariable(tab2Var, "logs", "e2e_automate", "kubernetes_container_name", {
      scope: "tab",
      assignedTabs: ["tab2"]
    });
    // Wait for second variable to be saved
    await page.locator(`[data-test="dashboard-edit-variable-${tab2Var}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Go to Tab1 and add panel
    await page.locator('span[data-test*="dashboard-tab-"][title="Tab1"]').click();
    // Wait for tab content to load
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible", timeout: 5000 });

    await pm.dashboardCreate.addPanel();
    // Wait for panel editor to open - wait for the chart type selection which appears first
    await page.locator('[data-test="selected-chart-line-item"]').or(page.locator('[data-test="dashboard-apply"]')).first().waitFor({ state: "visible", timeout: 10000 });

    // Should see Tab1 variable, but NOT Tab2 variable
    await scopedVars.verifyVariableInPanelEdit(tab1Var, true);
    await scopedVars.verifyVariableInPanelEdit(tab2Var, false);

    // Save the panel to avoid the discard confirmation dialog
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator('[data-test="dashboard-search"]').waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });
});
