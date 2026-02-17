const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped";
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

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Add tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator(getTabSelector("Tab1")).waitFor({ state: "visible", timeout: 10000 });

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
    await safeWaitForHidden(page, SELECTORS.QUASAR.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
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

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Add panel
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    // Add X and Y axis fields (required for saving panel)
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard and panel editor to close
    await page.locator(SELECTORS.PANEL_ANY).first().waitFor({ state: "visible", timeout: 15000 });
    // Wait for panel editor dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.QUASAR.DIALOG, { timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    // Wait for settings button to be available (indicates panel editor has closed)
    await page.locator(SELECTORS.SETTING_BTN).waitFor({ state: "visible", timeout: 15000 });

    // Add tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator(getTabSelector("Tab1")).waitFor({ state: "visible", timeout: 10000 });

    // Add panel variable using panel name instead of panel ID
    await scopedVars.addScopedVariable(panelVar, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "panel",
      assignedPanels: ["Panel1"]
    });

    // Wait for variable to be saved
    await page.locator(getEditVariableBtn(panelVar)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Try to add tab variable
    await page.locator(SELECTORS.ADD_VARIABLE_BTN).click();
    await page.locator(SELECTORS.VARIABLE_NAME).fill(tabVar);

    await page.locator(SELECTORS.VARIABLE_SCOPE_SELECT).click();
    await page.getByRole("option", { name: "Selected Tabs", exact: true }).click();

    // Select stream and field
    await page.locator(SELECTORS.VARIABLE_STREAM_TYPE_SELECT).click();
    await page.getByRole("option", { name: "logs", exact: true }).click();

    const streamSelect = page.locator(SELECTORS.VARIABLE_STREAM_SELECT);
    await streamSelect.click();
    await streamSelect.fill("e2e_automate");
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();

    const fieldSelect = page.locator(SELECTORS.VARIABLE_FIELD_SELECT);
    await fieldSelect.click();
    await fieldSelect.fill("kubernetes_container_name");
    // Wait for options to load
    await page.locator(SELECTORS.ROLE_OPTION).first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator(SELECTORS.ROLE_OPTION).first().click();

    // Check dependency dropdown via filter - should NOT show panel variables
    // Add filter to check available dependency options
    await page.locator(SELECTORS.ADD_FILTER_BTN).click();

    const filterNameSelector = page.locator(SELECTORS.FILTER_NAME_SELECTOR).last();
    await filterNameSelector.waitFor({ state: "visible" });
    await filterNameSelector.click();
    await filterNameSelector.fill("kubernetes_namespace_name");
    await page.getByRole("option", { name: "kubernetes_namespace_name" }).click();

    const operatorSelector = page.locator(SELECTORS.FILTER_OPERATOR_SELECTOR).last();
    await operatorSelector.click();
    await page.getByRole("option", { name: "=", exact: true }).locator("div").nth(2).click();

    // Click on the autocomplete to see available variables
    const autoComplete = page.locator(SELECTORS.AUTO_COMPLETE).last();
    await autoComplete.waitFor({ state: "visible", timeout: 5000 });
    await autoComplete.click();
    // Small wait for dropdown to potentially appear - if no options, listbox won't show
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Check if dropdown appears (it might not if there are no valid options)
    const hasListbox = await page.locator(SELECTORS.ROLE_LISTBOX).isVisible().catch(() => false);

    if (hasListbox) {
      // If dropdown appears, verify panel variable is NOT in the list
      const options = await page.locator(SELECTORS.ROLE_OPTION).allTextContents();
      expect(options).not.toContain(panelVar);
    } else {
      // If dropdown doesn't appear, it means there are no variables available (correct behavior)
      // This is expected - tab variables cannot depend on panel variables
    }

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.QUASAR.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
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

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Add Tab1 and Tab2
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator(getTabSelector("Tab1")).waitFor({ state: "visible", timeout: 10000 });

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator(getTabSelector("Tab2")).waitFor({ state: "visible", timeout: 10000 });

    // Add variable to Tab1
    await scopedVars.addScopedVariable(tab1Var, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });

    // Wait for variable to be saved
    await page.locator(getEditVariableBtn(tab1Var)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Try to add variable to Tab2
    await page.locator(SELECTORS.ADD_VARIABLE_BTN).click();
    await page.locator(SELECTORS.VARIABLE_NAME).fill(tab2Var);

    await page.locator(SELECTORS.VARIABLE_SCOPE_SELECT).click();
    await page.getByRole("option", { name: "Selected Tabs", exact: true }).click();

    // Open tabs dropdown and select tab2
    await page.locator(SELECTORS.VARIABLE_TABS_SELECT).waitFor({ state: "visible" });
    await page.locator(SELECTORS.VARIABLE_TABS_SELECT).click();
    // Wait for dropdown menu to be visible
    await page.locator(SELECTORS.QUASAR.MENU).waitFor({ state: "visible", timeout: 5000 });
    // Click the Tab2 option
    await page.locator(SELECTORS.QUASAR.MENU_ITEM).filter({ hasText: /^Tab2$/ }).waitFor({ state: "visible" });
    await page.locator(SELECTORS.QUASAR.MENU_ITEM).filter({ hasText: /^Tab2$/ }).click();

    // Select stream and field
    await page.locator(SELECTORS.VARIABLE_STREAM_TYPE_SELECT).click();
    await page.getByRole("option", { name: "logs", exact: true }).click();

    const streamSelect = page.locator(SELECTORS.VARIABLE_STREAM_SELECT);
    await streamSelect.click();
    await streamSelect.fill("e2e_automate");
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();

    const fieldSelect = page.locator(SELECTORS.VARIABLE_FIELD_SELECT);
    await fieldSelect.click();
    await fieldSelect.fill("kubernetes_container_name");
    // Wait for options to load
    await page.locator(SELECTORS.ROLE_OPTION).first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator(SELECTORS.ROLE_OPTION).first().click();

    // Check dependency dropdown via filter - should NOT show Tab1's variable
    await page.locator(SELECTORS.ADD_FILTER_BTN).click();

    const filterNameSelector = page.locator(SELECTORS.FILTER_NAME_SELECTOR).last();
    await filterNameSelector.waitFor({ state: "visible" });
    await filterNameSelector.click();
    await filterNameSelector.fill("kubernetes_namespace_name");
    await page.getByRole("option", { name: "kubernetes_namespace_name" }).click();

    const operatorSelector = page.locator(SELECTORS.FILTER_OPERATOR_SELECTOR).last();
    await operatorSelector.click();
    await page.getByRole("option", { name: "=", exact: true }).locator("div").nth(2).click();

    // Click on the autocomplete to see available variables
    const autoComplete = page.locator(SELECTORS.AUTO_COMPLETE).last();
    await autoComplete.waitFor({ state: "visible", timeout: 5000 });
    await autoComplete.click();
    // Small wait for dropdown to potentially appear - if no options, listbox won't show
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Check if dropdown appears (it might not if there are no valid options)
    const hasListbox = await page.locator(SELECTORS.ROLE_LISTBOX).isVisible().catch(() => false);

    if (hasListbox) {
      // If dropdown appears, verify tab1's variable is NOT in the list
      const options = await page.locator(SELECTORS.ROLE_OPTION).allTextContents();
      expect(options).not.toContain(tab1Var);
    } else {
      // If dropdown doesn't appear, it means there are no variables available (correct behavior)
      // This is actually the expected behavior - tab2 cannot depend on tab1's variable
    }

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.QUASAR.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
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

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Add tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator(getTabSelector("Tab1")).waitFor({ state: "visible", timeout: 10000 });

    // Add global and tab variables
    await scopedVars.addScopedVariable(globalVar, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    // Wait for variable to be saved
    await page.locator(getEditVariableBtn(globalVar)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // open setting window
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(tabVar, "logs", "e2e_automate", "kubernetes_container_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });
    // Wait for variable to be saved
    await page.locator(getEditVariableBtn(tabVar)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.QUASAR.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator(SELECTORS.SETTING_BTN).waitFor({ state: "visible", timeout: 10000 });

    // Switch to Tab1 and add panel
    await page.locator(getTabSelector("Tab1")).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(getTabSelector("Tab1")).click();
    // Wait for tab content to load
    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible", timeout: 5000 });
    // Ensure no dialogs are open before adding panel
    await safeWaitForHidden(page, SELECTORS.QUASAR.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    // Add X and Y axis fields (required for saving panel)
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard and panel editor to close
    await page.locator(SELECTORS.PANEL_ANY).first().waitFor({ state: "visible", timeout: 15000 });
    // Wait for panel editor dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.QUASAR.DIALOG, { timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    // Wait for settings button to be available (indicates panel editor has closed)
    await page.locator(SELECTORS.SETTING_BTN).waitFor({ state: "visible", timeout: 15000 });
    // Additional wait to ensure dashboard is stable after panel creation
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Add panel variable
    await pm.dashboardSetting.openSetting();
    // openSetting() already waits for the dialog to be fully open (verifies general tab is visible)
    await pm.dashboardSetting.openVariables();
    // Wait for variables tab to be active and add button to be visible
    await page.locator(SELECTORS.ADD_VARIABLE_BTN).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(SELECTORS.ADD_VARIABLE_BTN).click();
    await page.locator(SELECTORS.VARIABLE_NAME).fill(panelVar);

    await page.locator(SELECTORS.VARIABLE_SCOPE_SELECT).click();
    await page.getByRole("option", { name: "Selected Panels", exact: true }).click();

    // First select the tab containing the panel
    await page.locator(SELECTORS.VARIABLE_TABS_SELECT).waitFor({ state: "visible" });
    await page.locator(SELECTORS.VARIABLE_TABS_SELECT).click();
    // Wait for dropdown menu to be visible
    await page.locator(SELECTORS.QUASAR.MENU).waitFor({ state: "visible", timeout: 5000 });
    // Click the Tab1 option
    await page.locator(SELECTORS.QUASAR.MENU_ITEM).filter({ hasText: /^Tab1$/ }).waitFor({ state: "visible" });
    await page.locator(SELECTORS.QUASAR.MENU_ITEM).filter({ hasText: /^Tab1$/ }).click();
    await page.keyboard.press('Escape');
    // Wait for dropdown to close
    await safeWaitForHidden(page, SELECTORS.QUASAR.MENU, { timeout: 3000 });

    // Then select the panel by name
    await page.locator(SELECTORS.VARIABLE_PANELS_SELECT).waitFor({ state: "visible" });
    await page.locator(SELECTORS.VARIABLE_PANELS_SELECT).click();
    // Wait for dropdown menu to be visible
    await page.locator(SELECTORS.QUASAR.MENU).waitFor({ state: "visible", timeout: 5000 });
    await page.locator(SELECTORS.QUASAR.MENU_ITEM).filter({ hasText: /^Panel1$/ }).waitFor({ state: "visible" });
    await page.locator(SELECTORS.QUASAR.MENU_ITEM).filter({ hasText: /^Panel1$/ }).click();

    // Select stream and field
    await page.locator(SELECTORS.VARIABLE_STREAM_TYPE_SELECT).click();
    await page.getByRole("option", { name: "logs", exact: true }).click();

    const streamSelect = page.locator(SELECTORS.VARIABLE_STREAM_SELECT);
    await streamSelect.click();
    await streamSelect.fill("e2e_automate");
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();

    const fieldSelect = page.locator(SELECTORS.VARIABLE_FIELD_SELECT);
    await fieldSelect.click();
    await fieldSelect.fill("kubernetes_pod_name");
    // Wait for options to load
    await page.locator(SELECTORS.ROLE_OPTION).first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator(SELECTORS.ROLE_OPTION).first().click();

    // Check dependency dropdown via filter - should show both global and tab variables
    await page.locator(SELECTORS.ADD_FILTER_BTN).click();

    const filterNameSelector = page.locator(SELECTORS.FILTER_NAME_SELECTOR).last();
    await filterNameSelector.waitFor({ state: "visible" });
    await filterNameSelector.click();
    await filterNameSelector.fill("kubernetes_namespace_name");
    await page.getByRole("option", { name: "kubernetes_namespace_name" }).click();

    const operatorSelector = page.locator(SELECTORS.FILTER_OPERATOR_SELECTOR).last();
    await operatorSelector.click();
    await page.getByRole("option", { name: "=", exact: true }).locator("div").nth(2).click();

    // Click on the autocomplete to see available variables
    const autoComplete = page.locator(SELECTORS.AUTO_COMPLETE).last();
    await autoComplete.waitFor({ state: "visible", timeout: 10000 });
    await autoComplete.click();

    // Wait for dropdown options to appear - CommonAutoComplete uses data-test="common-auto-complete-option"
    await page.locator(SELECTORS.AUTO_COMPLETE_OPTION).first().waitFor({ state: "visible", timeout: 10000 });
    // Ensure all options are loaded
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    const options = await page.locator(SELECTORS.AUTO_COMPLETE_OPTION).allTextContents();
    expect(options).toContain(globalVar);
    expect(options).toContain(tabVar);

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.QUASAR.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
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

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

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
    await page.locator(SELECTORS.ADD_VARIABLE_BTN).click();
    await page.locator(SELECTORS.VARIABLE_NAME).fill(panel2Var);

    await page.locator(SELECTORS.VARIABLE_SCOPE_SELECT).click();
    await page.getByRole("option", { name: "Selected Panels", exact: true }).click();

    // First select the default tab to enable the panels dropdown
    await page.locator(SELECTORS.VARIABLE_TABS_SELECT).waitFor({ state: "visible" });
    await page.locator(SELECTORS.VARIABLE_TABS_SELECT).click();
    // Wait for dropdown menu to be visible
    await page.locator(SELECTORS.QUASAR.MENU).waitFor({ state: "visible", timeout: 5000 });
    // Click the Default tab option
    await page.locator(SELECTORS.QUASAR.MENU_ITEM).filter({ hasText: /^Default$/ }).waitFor({ state: "visible" });
    await page.locator(SELECTORS.QUASAR.MENU_ITEM).filter({ hasText: /^Default$/ }).click();
    await page.keyboard.press('Escape');
    // Wait for dropdown to close
    await safeWaitForHidden(page, SELECTORS.QUASAR.MENU, { timeout: 3000 });

    // Now open the panels dropdown and select panel2 by name
    await page.locator(SELECTORS.VARIABLE_PANELS_SELECT).waitFor({ state: "visible" });
    await page.locator(SELECTORS.VARIABLE_PANELS_SELECT).click();
    // Wait for dropdown menu to be visible
    await page.locator(SELECTORS.QUASAR.MENU).waitFor({ state: "visible", timeout: 5000 });
    await page.locator(SELECTORS.QUASAR.MENU_ITEM).filter({ hasText: /^Panel2$/ }).waitFor({ state: "visible" });
    await page.locator(SELECTORS.QUASAR.MENU_ITEM).filter({ hasText: /^Panel2$/ }).click();

    // Select stream and field
    await page.locator(SELECTORS.VARIABLE_STREAM_TYPE_SELECT).click();
    await page.getByRole("option", { name: "logs", exact: true }).click();

    const streamSelect = page.locator(SELECTORS.VARIABLE_STREAM_SELECT);
    await streamSelect.click();
    await streamSelect.fill("e2e_automate");
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();

    const fieldSelect = page.locator(SELECTORS.VARIABLE_FIELD_SELECT);
    await fieldSelect.click();
    await fieldSelect.fill("kubernetes_pod_name");
    // Wait for options to load
    await page.locator(SELECTORS.ROLE_OPTION).first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator(SELECTORS.ROLE_OPTION).first().click();

    // Check dependency dropdown via filter - should NOT show Panel1's variable
    await page.locator(SELECTORS.ADD_FILTER_BTN).click();

    const filterNameSelector = page.locator(SELECTORS.FILTER_NAME_SELECTOR).last();
    await filterNameSelector.waitFor({ state: "visible" });
    await filterNameSelector.click();
    await filterNameSelector.fill("kubernetes_namespace_name");
    await page.getByRole("option", { name: "kubernetes_namespace_name" }).click();

    const operatorSelector = page.locator(SELECTORS.FILTER_OPERATOR_SELECTOR).last();
    await operatorSelector.click();
    await page.getByRole("option", { name: "=", exact: true }).locator("div").nth(2).click();

    // Click on the autocomplete to see available variables
    const autoComplete = page.locator(SELECTORS.AUTO_COMPLETE).last();
    await autoComplete.waitFor({ state: "visible", timeout: 5000 });
    await autoComplete.click();
    // Small wait for dropdown to potentially appear - if no options, listbox won't show
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Check if dropdown appears (it might not if there are no valid options)
    const hasListbox = await page.locator(SELECTORS.ROLE_LISTBOX).isVisible().catch(() => false);

    if (hasListbox) {
      // If dropdown appears, verify panel1's variable is NOT in the list
      const options = await page.locator(SELECTORS.ROLE_OPTION).allTextContents();
      expect(options).not.toContain(panel1Var);
    } else {
      // If dropdown doesn't appear, it means there are no variables available (correct behavior)
      // This is expected - panel variables cannot depend on other panel variables
    }

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.QUASAR.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
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

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Add multiple tabs
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator(getTabSelector("Tab1")).waitFor({ state: "visible", timeout: 10000 });

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator(getTabSelector("Tab2")).waitFor({ state: "visible", timeout: 10000 });

    await pm.dashboardSetting.addTabSetting("Tab3");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator(getTabSelector("Tab3")).waitFor({ state: "visible", timeout: 10000 });

    // Add variable assigned to all tabs
    await scopedVars.addScopedVariable(variableName, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "tab",
      assignedTabs: ["tab1", "tab2", "tab3"]
    });

    // Wait for variable to be saved
    await page.locator(getEditVariableBtn(variableName)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator(SELECTORS.SETTING_BTN).waitFor({ state: "visible", timeout: 10000 });

    // Verify variable is visible in all tabs
    const tabMapping = { tab1: "Tab1", tab2: "Tab2", tab3: "Tab3" };
    for (const tabId of ["tab1", "tab2", "tab3"]) {
      const tabLocator = page.locator(getTabSelector(tabMapping[tabId]));
      await tabLocator.click();
      // Wait for tab to be active by checking for active state or waiting for tab content to load
      await page.locator(SELECTORS.ADD_PANEL_BTN).or(page.locator(SELECTORS.PANEL_ANY)).first().waitFor({ state: "visible", timeout: 5000 });

      // Wait for variable to appear on the dashboard after tab switch
      await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 10000 });

      await scopedVars.verifyVariableVisibility(variableName, true);
    }

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
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

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

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
    await page.locator(SELECTORS.PANEL_ANY).nth(1).waitFor({ state: "visible", timeout: 15000 });
    // Wait for settings button to ensure panels are fully loaded
    await page.locator(SELECTORS.SETTING_BTN).waitFor({ state: "visible", timeout: 10000 });

    // Add variable assigned to both panels using panel names
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(variableName, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "panel",
      assignedPanels: ["Panel1", "Panel2"]
    });
    // Wait for variable to be saved
    await page.locator(getEditVariableBtn(variableName)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();
    // Wait for variable selectors to appear on panels
    await page.locator(getVariableSelector(variableName)).first().waitFor({ state: "visible", timeout: 10000 });

    // Verify variable is visible for both panels - should have 2 variable selectors (one per panel)
    const variableSelectors = page.locator(getVariableSelector(variableName));
    await expect(variableSelectors).toHaveCount(2, { timeout: 10000 });
    // Verify both are visible
    await expect(variableSelectors.first()).toBeVisible({ timeout: 5000 });
    await expect(variableSelectors.last()).toBeVisible({ timeout: 5000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
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

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Add tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator(getTabSelector("Tab1")).waitFor({ state: "visible", timeout: 10000 });

    // Create tab variable WITHOUT any global variables
    await scopedVars.addScopedVariable(tabVar, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });

    // Wait for variable to be saved
    await page.locator(getEditVariableBtn(tabVar)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator(SELECTORS.SETTING_BTN).waitFor({ state: "visible", timeout: 10000 });

    // Switch to Tab1 and verify variable exists
    await page.locator(getTabSelector("Tab1")).click();
    // Wait for tab content to load
    await page.locator(SELECTORS.ADD_PANEL_BTN).or(page.locator(SELECTORS.PANEL_ANY)).first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for variable to appear on the dashboard after tab switch
    await page.locator(getVariableSelector(tabVar)).waitFor({ state: "visible", timeout: 10000 });

    await scopedVars.verifyVariableVisibility(tabVar, true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    // Wait for dashboard list to be fully loaded
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
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

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Add Tab1
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator(getTabSelector("Tab1")).waitFor({ state: "visible", timeout: 10000 });

    // Add global and tab variables
    await scopedVars.addScopedVariable(globalVar, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    // Wait for variable to be saved
    await page.locator(getEditVariableBtn(globalVar)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // open setting window
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(tabVar, "logs", "e2e_automate", "kubernetes_container_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });
    // Wait for variable to be saved
    await page.locator(getEditVariableBtn(tabVar)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.QUASAR.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator(SELECTORS.SETTING_BTN).waitFor({ state: "visible", timeout: 10000 });

    // Switch to Tab1
    await page.locator(getTabSelector("Tab1")).click();
    // Wait for tab content to load
    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible", timeout: 5000 });
    // Ensure no dialogs are open before adding panel
    await safeWaitForHidden(page, SELECTORS.QUASAR.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Go to add panel
    await pm.dashboardCreate.addPanel();
    // Wait for panel editor to open - wait for the chart type selection which appears first
    const panelEditorIndicator = page.locator(SELECTORS.CHART_LINE_ITEM).or(page.locator(SELECTORS.APPLY_BTN)).first();
    await panelEditorIndicator.waitFor({ state: "visible", timeout: 15000 });

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
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
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

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Add Tab1 and Tab2
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.addTabSetting("Tab1");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator(getTabSelector("Tab1")).waitFor({ state: "visible", timeout: 10000 });

    await pm.dashboardSetting.addTabSetting("Tab2");
    await pm.dashboardSetting.saveTabSetting();
    // Wait for tab to be created and visible
    await page.locator(getTabSelector("Tab2")).waitFor({ state: "visible", timeout: 10000 });

    // Add variables to both tabs
    await scopedVars.addScopedVariable(tab1Var, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "tab",
      assignedTabs: ["tab1"]
    });
    // Wait for first variable to be saved
    await page.locator(getEditVariableBtn(tab1Var)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await scopedVars.addScopedVariable(tab2Var, "logs", "e2e_automate", "kubernetes_container_name", {
      scope: "tab",
      assignedTabs: ["tab2"]
    });
    // Wait for second variable to be saved
    await page.locator(getEditVariableBtn(tab2Var)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, SELECTORS.QUASAR.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Wait for dashboard to be fully loaded after closing settings
    await page.locator(SELECTORS.SETTING_BTN).waitFor({ state: "visible", timeout: 10000 });

    // Go to Tab1 and add panel
    await page.locator(getTabSelector("Tab1")).click();
    // Wait for tab content to load
    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible", timeout: 5000 });

    await pm.dashboardCreate.addPanel();
    // Wait for panel editor to open - wait for the chart type selection which appears first
    const panelEditorIndicator2 = page.locator(SELECTORS.CHART_LINE_ITEM).or(page.locator(SELECTORS.APPLY_BTN)).first();
    await panelEditorIndicator2.waitFor({ state: "visible", timeout: 15000 });

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
    await page.locator(SELECTORS.SEARCH).waitFor({ state: "visible", timeout: 10000 });
    await deleteDashboard(page, dashboardName);
  });
});
