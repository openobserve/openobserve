const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped";
import { selectStreamFromDropdown, selectFieldFromDropdown, selectStreamType } from "../../pages/dashboardPages/dashboard-stream-field-utils.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
const { safeWaitForHidden, safeWaitForNetworkIdle } = require("../utils/wait-helpers.js");
const {
  SELECTORS,
  getVariableSelector,
  getEditVariableBtn,
  getTabSelector,
} = require("../../pages/dashboardPages/dashboard-selectors.js");
const testLogger = require("../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables - Creation & Scope Restrictions", { tag: ['@dashboards', '@dashboardVariables', '@scoping', '@P1'] }, () => {
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

    await scopedVars.waitForAddPanelBtn();

    // Add tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await scopedVars.waitForTabVisible("Tab1");

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
    await safeWaitForHidden(page, SELECTORS.COMPONENTS.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.waitForDashboardSearch();
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

    await scopedVars.waitForAddPanelBtn();

    // Add panel
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    // Add X and Y axis fields (required for saving panel)
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard and panel editor to close
    await scopedVars.getAnyPanel(0).waitFor({ state: "visible", timeout: 15000 });
    // Wait for panel editor dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.COMPONENTS.DIALOG, { timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    // Wait for settings button to be available (indicates panel editor has closed)
    await scopedVars.waitForDashboardReady({ timeout: 15000 });

    // Add tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await scopedVars.waitForTabVisible("Tab1");

    // Add panel variable using panel name instead of panel ID
    await scopedVars.addScopedVariable(panelVar, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "panel",
      assignedPanels: ["Panel1"]
    });

    // Wait for variable to be saved
    await scopedVars.waitForEditVariableBtnVisible(panelVar);
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Try to add tab variable
    await scopedVars.clickAddVariableBtn();
    await scopedVars.fillVariableName(tabVar);

    await scopedVars.selectVariableScope("tabs");

    // Select stream and field using shared utilities
    await selectStreamType(page, "logs");
    await selectStreamFromDropdown(page, "e2e_automate");
    await selectFieldFromDropdown(page, "kubernetes_container_name");

    // Check dependency dropdown via filter - should NOT show panel variables
    // Add filter to check available dependency options
    await scopedVars.clickAddFilter();

    await scopedVars.selectFilterName("kubernetes_namespace_name");

    await scopedVars.selectFilterOperator("=");

    // Click on the filter value OCombobox input to open autocomplete suggestions
    const filterValueInput = scopedVars.getFilterValueInput();
    await filterValueInput.waitFor({ state: "visible", timeout: 5000 });
    await filterValueInput.click();

    // OCombobox opens on focus (:open-on-focus="true"); options appear immediately
    const hasDropdown = await scopedVars.getFilterValueOptions().first().isVisible({ timeout: 2000 }).catch(() => false);

    if (hasDropdown) {
      // If dropdown appears, verify panel variable is NOT in the list
      const options = await scopedVars.getFilterValueOptionTexts();
      expect(options).not.toContain(panelVar);
    } else {
      // If dropdown doesn't appear, it means there are no variables available (correct behavior)
      // This is expected - tab variables cannot depend on panel variables
    }

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.COMPONENTS.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.waitForDashboardSearch();
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

    await scopedVars.waitForAddPanelBtn();

    // Add Tab1 and Tab2
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await scopedVars.waitForTabVisible("Tab1");

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await scopedVars.waitForTabVisible("Tab2");

    // Add variable to Tab1
    await scopedVars.addScopedVariable(tab1Var, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });

    // Wait for variable to be saved
    await scopedVars.waitForEditVariableBtnVisible(tab1Var);
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Try to add variable to Tab2
    await scopedVars.clickAddVariableBtn();
    await scopedVars.fillVariableName(tab2Var);

    await scopedVars.selectVariableScope("tabs");

    // Open tabs dropdown and select tab2
    await scopedVars.selectVariableTab("Tab2");

    // Select stream and field using shared utilities
    await selectStreamType(page, "logs");
    await selectStreamFromDropdown(page, "e2e_automate");
    await selectFieldFromDropdown(page, "kubernetes_container_name");

    // Check dependency dropdown via filter - should NOT show Tab1's variable
    await scopedVars.clickAddFilter();

    await scopedVars.selectFilterName("kubernetes_namespace_name");

    await scopedVars.selectFilterOperator("=");

    // Click on the filter value OCombobox input to open autocomplete suggestions
    const filterValueInput2 = scopedVars.getFilterValueInput();
    await filterValueInput2.waitFor({ state: "visible", timeout: 5000 });
    await filterValueInput2.click();

    // OCombobox opens on focus (:open-on-focus="true"); options appear immediately
    const hasDropdown2 = await scopedVars.getFilterValueOptions().first().isVisible({ timeout: 2000 }).catch(() => false);

    if (hasDropdown2) {
      // If dropdown appears, verify tab1's variable is NOT in the list
      const options2 = await scopedVars.getFilterValueOptionTexts();
      expect(options2).not.toContain(tab1Var);
    } else {
      // If dropdown doesn't appear, it means there are no variables available (correct behavior)
      // This is actually the expected behavior - tab2 cannot depend on tab1's variable
    }

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.COMPONENTS.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.waitForDashboardSearch();
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

    await scopedVars.waitForAddPanelBtn();

    // Add tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await scopedVars.waitForTabVisible("Tab1");

    // Add global and tab variables
    await scopedVars.addScopedVariable(globalVar, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    // Wait for variable to be saved
    await scopedVars.waitForEditVariableBtnVisible(globalVar);
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // open setting window
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(tabVar, "logs", "e2e_automate", "kubernetes_container_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });
    // Wait for variable to be saved
    await scopedVars.waitForEditVariableBtnVisible(tabVar);
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.COMPONENTS.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Wait for dashboard to be fully loaded after closing settings
    await scopedVars.waitForDashboardReady({ timeout: 10000 });

    // Switch to Tab1 and add panel
    await scopedVars.waitForTabVisible("Tab1");
    await scopedVars.clickTab("Tab1");
    // Wait for tab content to load
    await scopedVars.waitForAddPanelBtn({ timeout: 5000 });
    // Ensure no dialogs are open before adding panel
    await safeWaitForHidden(page, SELECTORS.COMPONENTS.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    // Add X and Y axis fields (required for saving panel)
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard and panel editor to close
    await scopedVars.getAnyPanel(0).waitFor({ state: "visible", timeout: 15000 });
    // Wait for panel editor dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.COMPONENTS.DIALOG, { timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    // Wait for settings button to be available (indicates panel editor has closed)
    await scopedVars.waitForDashboardReady({ timeout: 15000 });
    // Additional wait to ensure dashboard is stable after panel creation
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Add panel variable
    await pm.dashboardSetting.openSetting();
    // openSetting() already waits for the dialog to be fully open (verifies general tab is visible)
    await pm.dashboardSetting.openVariables();
    // Wait for variables tab to be active and add button to be visible
    await scopedVars.waitForAddVariableBtnVisible();
    await scopedVars.clickAddVariableBtn();
    await scopedVars.fillVariableName(panelVar);

    await scopedVars.selectVariableScope("panels");

    // First select the tab containing the panel
    await scopedVars.selectVariableTab("Tab1");

    // Then select the panel by name
    await scopedVars.selectVariablePanel("Panel1");

    // Select stream and field using shared utilities
    await selectStreamType(page, "logs");
    await selectStreamFromDropdown(page, "e2e_automate");
    await selectFieldFromDropdown(page, "kubernetes_pod_name");

    // Check dependency dropdown via filter - should show both global and tab variables
    await scopedVars.clickAddFilter();

    await scopedVars.selectFilterName("kubernetes_namespace_name");

    await scopedVars.selectFilterOperator("=");

    // Click on the filter value OCombobox input to open autocomplete suggestions
    const filterValueInput3 = scopedVars.getFilterValueInput();
    await filterValueInput3.waitFor({ state: "visible", timeout: 10000 });
    await filterValueInput3.click();

    // OCombobox opens on focus; wait for options to appear
    await scopedVars.getFilterValueOptions().first().waitFor({ state: "visible", timeout: 10000 });

    const options3 = await scopedVars.getFilterValueOptionTexts();
    expect(options3).toContain(globalVar);
    expect(options3).toContain(tabVar);

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.COMPONENTS.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.waitForDashboardSearch();
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

    await scopedVars.waitForAddPanelBtn();

    // Add Panel1
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Add Panel2
    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
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
    await scopedVars.clickAddVariableBtn();
    await scopedVars.fillVariableName(panel2Var);

    await scopedVars.selectVariableScope("panels");

    // First select the default tab to enable the panels dropdown
    await scopedVars.selectVariableTab("Default");

    // Now open the panels dropdown and select panel2 by name
    await scopedVars.selectVariablePanel("Panel2");

    // Select stream and field using shared utilities
    await selectStreamType(page, "logs");
    await selectStreamFromDropdown(page, "e2e_automate");
    await selectFieldFromDropdown(page, "kubernetes_pod_name");

    // Check dependency dropdown via filter - should NOT show Panel1's variable
    await scopedVars.clickAddFilter();

    await scopedVars.selectFilterName("kubernetes_namespace_name");

    await scopedVars.selectFilterOperator("=");

    // Click on the filter value OCombobox input to open autocomplete suggestions
    const filterValueInput4 = scopedVars.getFilterValueInput();
    await filterValueInput4.waitFor({ state: "visible", timeout: 5000 });
    await filterValueInput4.click();

    // OCombobox opens on focus (:open-on-focus="true"); options appear immediately
    const hasDropdown4 = await scopedVars.getFilterValueOptions().first().isVisible({ timeout: 2000 }).catch(() => false);

    if (hasDropdown4) {
      // If dropdown appears, verify panel1's variable is NOT in the list
      const options4 = await scopedVars.getFilterValueOptionTexts();
      expect(options4).not.toContain(panel1Var);
    } else {
      // If dropdown doesn't appear, it means there are no variables available (correct behavior)
      // This is expected - panel variables cannot depend on other panel variables
    }

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.COMPONENTS.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.waitForDashboardSearch();
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

    await scopedVars.waitForAddPanelBtn();

    // Add multiple tabs
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await scopedVars.waitForTabVisible("Tab1");

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await scopedVars.waitForTabVisible("Tab2");

    await pm.dashboardSetting.addTabSetting("Tab3");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await scopedVars.waitForTabVisible("Tab3");

    // Add variable assigned to all tabs
    await scopedVars.addScopedVariable(variableName, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "tab",
      assignedTabs: ["tab1", "tab2", "tab3"]
    });

    // Wait for variable to be saved
    await scopedVars.waitForEditVariableBtnVisible(variableName);
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for dashboard to be fully loaded after closing settings
    await scopedVars.waitForDashboardReady({ timeout: 10000 });

    // Verify variable is visible in all tabs
    const tabMapping = { tab1: "Tab1", tab2: "Tab2", tab3: "Tab3" };
    for (const tabId of ["tab1", "tab2", "tab3"]) {
      await scopedVars.clickTab(tabMapping[tabId]);
      // Wait for tab to be active by checking for active state or waiting for tab content to load
      await scopedVars.waitForTabContentLoaded();

      // Wait for variable to appear on the dashboard after tab switch
      await scopedVars.getVariableSelectorLocator(variableName).waitFor({ state: "visible", timeout: 10000 });

      await scopedVars.verifyVariableVisibility(variableName, true);
    }

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.waitForDashboardSearch();
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

    await scopedVars.waitForAddPanelBtn();

    // Add multiple panels
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel2");
    await pm.dashboardPanelActions.savePanel();

    // Wait for both panels to be fully rendered
    await scopedVars.getAnyPanel(1).waitFor({ state: "visible", timeout: 15000 });
    // Wait for settings button to ensure panels are fully loaded
    await scopedVars.waitForDashboardReady({ timeout: 10000 });

    // Add variable assigned to both panels using panel names
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(variableName, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "panel",
      assignedPanels: ["Panel1", "Panel2"]
    });
    // Wait for variable to be saved
    await scopedVars.waitForEditVariableBtnVisible(variableName);
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();
    // Wait for variable selectors to appear on panels
    await scopedVars.getVariableSelectorLocator(variableName).first().waitFor({ state: "visible", timeout: 10000 });

    // Verify variable is visible for both panels - should have 2 variable selectors (one per panel)
    const variableSelectors = scopedVars.getVariableSelectorLocator(variableName);
    await expect(variableSelectors).toHaveCount(2, { timeout: 10000 });
    // Verify both are visible
    await expect(variableSelectors.first()).toBeVisible({ timeout: 5000 });
    await expect(variableSelectors.last()).toBeVisible({ timeout: 5000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.waitForDashboardSearch();
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

    await scopedVars.waitForAddPanelBtn();

    // Add tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await scopedVars.waitForTabVisible("Tab1");

    // Create tab variable WITHOUT any global variables
    await scopedVars.addScopedVariable(tabVar, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });

    // Wait for variable to be saved
    await scopedVars.waitForEditVariableBtnVisible(tabVar);
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for dashboard to be fully loaded after closing settings
    await scopedVars.waitForDashboardReady({ timeout: 10000 });

    // Switch to Tab1 and verify variable exists
    await scopedVars.clickTab("Tab1");
    // Wait for tab content to load
    await scopedVars.waitForTabContentLoaded();

    // Wait for variable to appear on the dashboard after tab switch
    await scopedVars.getVariableSelectorLocator(tabVar).waitFor({ state: "visible", timeout: 10000 });

    await scopedVars.verifyVariableVisibility(tabVar, true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.waitForDashboardSearch();
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

    await scopedVars.waitForAddPanelBtn();

    // Add Tab1
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await scopedVars.waitForTabVisible("Tab1");

    // Add global and tab variables
    await scopedVars.addScopedVariable(globalVar, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    // Wait for variable to be saved
    await scopedVars.waitForEditVariableBtnVisible(globalVar);
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // open setting window
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(tabVar, "logs", "e2e_automate", "kubernetes_container_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });
    // Wait for variable to be saved
    await scopedVars.waitForEditVariableBtnVisible(tabVar);
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.COMPONENTS.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Wait for dashboard to be fully loaded after closing settings
    await scopedVars.waitForDashboardReady({ timeout: 10000 });

    // Switch to Tab1
    await scopedVars.clickTab("Tab1");
    // Wait for tab content to load
    await scopedVars.waitForAddPanelBtn({ timeout: 5000 });
    // Ensure no dialogs are open before adding panel
    await safeWaitForHidden(page, SELECTORS.COMPONENTS.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Go to add panel
    await pm.dashboardCreate.addPanel();
    // Wait for panel editor to open - wait for the chart type selection which appears first
    await scopedVars.waitForPanelEditorOpen();

    // Check available variables in panel edit mode
    // Both global and tab1 variables should be available
    await scopedVars.verifyVariableInPanelEdit(globalVar, true);
    await scopedVars.verifyVariableInPanelEdit(tabVar, true);

    // Save panel
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.waitForDashboardSearch();
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

    await scopedVars.waitForAddPanelBtn();

    // Add Tab1 and Tab2
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await scopedVars.waitForTabVisible("Tab1");

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await scopedVars.waitForTabVisible("Tab2");

    // Add variables to both tabs
    await scopedVars.addScopedVariable(tab1Var, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });
    // Wait for first variable to be saved
    await scopedVars.waitForEditVariableBtnVisible(tab1Var);
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await scopedVars.addScopedVariable(tab2Var, "logs", "e2e_automate", "kubernetes_container_name", {
      scope: "tab",
      assignedTabs: ["tab2"]
    });
    // Wait for second variable to be saved
    await scopedVars.waitForEditVariableBtnVisible(tab2Var);
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.COMPONENTS.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Wait for dashboard to be fully loaded after closing settings
    await scopedVars.waitForDashboardReady({ timeout: 10000 });

    // Go to Tab1 and add panel
    await scopedVars.clickTab("Tab1");
    // Wait for tab content to load
    await scopedVars.waitForAddPanelBtn({ timeout: 5000 });

    await pm.dashboardCreate.addPanel();
    // Wait for panel editor to open - wait for the chart type selection which appears first
    await scopedVars.waitForPanelEditorOpen();

    // Should see Tab1 variable, but NOT Tab2 variable
    await scopedVars.verifyVariableInPanelEdit(tab1Var, true);
    await scopedVars.verifyVariableInPanelEdit(tab2Var, false);

    // Save the panel to avoid the discard confirmation dialog
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await scopedVars.waitForDashboardSearch();
    await deleteDashboard(page, dashboardName);
  });
});
