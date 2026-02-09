/**
 * Dashboard Variables - Refresh Indicators and Panel Reload Test Suite
 * Tests global refresh button indicators, panel refresh indicators, and reload behavior
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard, addSimplePanel } from "./utils/dashCreation.js";
import {
  hasRefreshIndicator,
  monitorVariableAPICalls,
  trackPanelReload,
  waitForAllPanelsToLoad
} from "../utils/variable-helpers.js";
const { safeWaitForHidden, safeWaitForNetworkIdle } = require("../utils/wait-helpers.js");
// Import centralized selectors
const {
  SELECTORS,
  getVariableSelector,
  getEditVariableBtn,
  getPanelRefreshBtn,
} = require("../../pages/dashboardPages/dashboard-selectors.js");
const testLogger = require("../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables - Refresh Indicators & Panel Reload", { tag: ['@dashboards', '@dashboardVariables', '@refresh', '@P1'] }, () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("1-should show global refresh indicator when variable value changes", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_RefreshInd_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.waitForAddPanelBtn();

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
    // Wait for settings dialog to be fully closed and network idle
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    // Wait for variable to appear on dashboard
    await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 15000 });

    // Add panel using consolidated helper
    await addSimplePanel(pm, "Panel1");

    // Wait for panel to be added to dashboard
    await page.locator(SELECTORS.PANEL_ANY).first().waitFor({ state: "visible", timeout: 15000 });
    await scopedVars.waitForDashboardReady();

    // Change variable value - select a DIFFERENT value than current
    await scopedVars.changeVariableValue(variableName, { monitorApi: true });

    // Wait for any loading to complete before checking refresh indicator
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Check global refresh button shows indicator
    const globalRefreshBtn = page.locator(SELECTORS.REFRESH_BTN);
    await globalRefreshBtn.waitFor({ state: "visible", timeout: 10000 });

    // Wait for the refresh indicator to appear (button should change from outline to filled warning color)
    // The button should have bg-warning class when variables change
    await expect(globalRefreshBtn).toHaveClass(/bg-warning/, { timeout: 10000 });

    // Check for visual indicator using helper function
    const hasIndicator = await hasRefreshIndicator(page, "global");
    expect(hasIndicator).toBe(true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("2-should show panel refresh indicator when dependent variable changes", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelRefreshInd_${Date.now()}`;
    const varA = `var_a_${Date.now()}`;
    const varB = `var_b_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.waitForAddPanelBtn();

    // Add variables
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(varA, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    await pm.dashboardSetting.closeSettingWindow();

    // Reopen settings to add second variable
    await pm.dashboardSetting.openSetting();
    // await pm.dashboardSetting.openVariables();
    // // Wait for variable to be saved and visible in settings
    // await page.locator(`[data-test="dashboard-edit-variable-${varA}"]`).waitFor({ state: "visible", timeout: 15000 });
    // await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await scopedVars.addScopedVariable(varB, "logs", "e2e_automate", "kubernetes_container_name", {
      scope: "global",
      dependsOn: varA,
      dependsOnField: "kubernetes_namespace_name"
    });

    // Wait for variable to be saved
    await page.locator(getEditVariableBtn(varB)).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Wait for variable to appear on dashboard
    await page.locator(getVariableSelector(varB)).waitFor({ state: "visible", timeout: 15000 });

    // Add panel using variable B with filter
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "filter");
    // Add filter using varB
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_container_name",
      "",
      "=",
      `$${varB}`
    );

    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator(SELECTORS.PANEL_ANY).first().waitFor({ state: "visible", timeout: 15000 });
    await scopedVars.waitForDashboardReady();

    // Wait for panel to fully render and both variables to be visible and ready
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Wait for both variable selectors to be fully visible and stable
    await page.locator(getVariableSelector(varA)).waitFor({ state: "visible", timeout: 15000 });
    await page.locator(getVariableSelector(varB)).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Change variable A (which affects B) - select a DIFFERENT value than current
    await scopedVars.changeVariableValue(varA, { monitorApi: true });

    // Wait for any loading to complete before checking refresh indicator
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Check the panel refresh button for warning indicator
    // When a variable changes that affects a panel, the panel's refresh button should show warning color
    const panelRefreshBtn = page.locator(SELECTORS.PANEL_REFRESH_BTN);
    await panelRefreshBtn.waitFor({ state: "visible", timeout: 10000 });

    // Wait for the panel refresh button to get warning color
    // Quasar applies text-warning class for flat buttons with :color="warning"
    await expect(panelRefreshBtn).toHaveClass(/text-warning/, { timeout: 10000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("3-should reload all panels when clicking global refresh button", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_GlobalReload_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.waitForAddPanelBtn();

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
    // Wait for settings dialog to be fully closed and network idle
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    // Wait for variable to appear on dashboard
    await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 15000 });

    // Add two panels
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator(SELECTORS.PANEL_ANY).first().waitFor({ state: "visible", timeout: 15000 });
    await scopedVars.waitForDashboardReady();

    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel2");
    await pm.dashboardPanelActions.savePanel();

    // Wait for second panel to be added to dashboard
    await page.locator(SELECTORS.PANEL_ANY).nth(1).waitFor({ state: "visible", timeout: 15000 });

    // Change variable
    await scopedVars.changeVariableValue(variableName, { monitorApi: true });

    // Click global refresh and track reloads
    const reloadTracker = trackPanelReload(
      page,
      null,
      async () => {
        await page.locator(SELECTORS.REFRESH_BTN).click();
      },
      15000
    );

    const result = await reloadTracker;

    // Both panels should reload
    expect(result.reloaded).toBe(true);
    expect(result.queryCount).toBeGreaterThanOrEqual(2);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("4-should reload only specific panel when clicking panel refresh button", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelReload_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.waitForAddPanelBtn();

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
    // Wait for settings dialog to be fully closed and network idle
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    // Wait for variable to appear on dashboard
    await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 15000 });

    // Add Panel1 with filter using the variable - only this panel will be affected by variable changes
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "filter");
    // Add filter using the variable
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_namespace_name",
      "",
      "=",
      `$${variableName}`
    );
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard and get panel container with data-test-panel-id
    await page.locator(SELECTORS.PANEL_ANY).first().waitFor({ state: "visible", timeout: 15000 });
    await scopedVars.waitForDashboardReady();

    // Wait a bit for the panel ID to be set in the DOM
    await page.waitForTimeout(1000);

    // Get the panel container that has data-test-panel-id attribute
    const panelContainer1 = page.locator(SELECTORS.PANEL_CONTAINER).first();
    await panelContainer1.waitFor({ state: "attached", timeout: 5000 });
    const panelId1 = await panelContainer1.getAttribute("data-test-panel-id");

    // Add Panel2 WITHOUT using the variable - this panel should not be affected
    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel2");
    await pm.dashboardPanelActions.savePanel();

    // Wait for second panel to be added to dashboard
    await page.locator(SELECTORS.PANEL_ANY).nth(1).waitFor({ state: "visible", timeout: 15000 });

    // Wait for panels to fully render
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Change variable - this should only affect Panel1
    await scopedVars.changeVariableValue(variableName, { monitorApi: true });

    // Wait for any loading to complete
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Check Panel1's refresh button for warning indicator - scope to specific panel using data-test-panel-id
    const panel1RefreshBtn = page.locator(getPanelRefreshBtn(panelId1));
    await panel1RefreshBtn.waitFor({ state: "visible", timeout: 10000 });

    // Panel1's refresh button should have warning color since it uses the variable
    await expect(panel1RefreshBtn).toHaveClass(/text-warning/, { timeout: 10000 });

    // Click refresh on Panel1 only
    const reloadTracker = trackPanelReload(
      page,
      panelId1,
      async () => {
        await panel1RefreshBtn.click();
      },
      10000
    );

    const result = await reloadTracker;

    // Only Panel1 should reload (1 query)
    expect(result.reloaded).toBe(true);
    expect(result.queryCount).toBe(1);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("5-should pass updated variables and time to panels on global refresh", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_VarTime_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.waitForAddPanelBtn();

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

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Wait for variable to appear on dashboard with increased timeout using page object helper
    await scopedVars.waitForVariableSelectorVisible(variableName, { timeout: 20000 });

    // Add panel with filter using the variable
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "filter");
    // Add filter using the variable
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_namespace_name",
      "",
      "=",
      `$${variableName}`
    );
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator(SELECTORS.PANEL_ANY).first().waitFor({ state: "visible", timeout: 15000 });
    await scopedVars.waitForDashboardReady();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Capture the initial query inspector content before making changes
    // Hover over panel to make dropdown visible
    await page.locator(SELECTORS.PANEL_CONTAINER).first().hover();
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Use page object method to open query inspector
    await pm.dashboardPanelEdit.openQueryInspector("Panel1");

    // Wait for Query Inspector dialog to open and load content
    await page.locator(SELECTORS.DIALOG).waitFor({ state: "visible", timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Get all text from Query Inspector dialog (includes query, time, variables)
    const dialogContent = page.locator(SELECTORS.DIALOG).first();
    await dialogContent.waitFor({ state: "visible", timeout: 5000 });
    const queryInspectorBeforeRefresh = await dialogContent.textContent();

    // Close Query Inspector dialog
    await page.keyboard.press('Escape');
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });

    // Change variable
    await scopedVars.changeVariableValue(variableName, { monitorApi: true });

    // Change time range
    await page.locator(SELECTORS.DATE_TIME_BTN).click();
    await page.locator(SELECTORS.DATE_TIME_RELATIVE_6H).click();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Click global refresh
    await page.locator(SELECTORS.REFRESH_BTN).click();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Wait for panels to finish loading
    await waitForAllPanelsToLoad(page, 1, 10000);

    // Capture the query inspector content after refresh
    // Hover over panel to make dropdown visible
    await page.locator(SELECTORS.PANEL_CONTAINER).first().hover();
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Use page object method to open query inspector
    await pm.dashboardPanelEdit.openQueryInspector("Panel1");

    // Wait for Query Inspector dialog to open and load content
    await page.locator(SELECTORS.DIALOG).waitFor({ state: "visible", timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Get all text from Query Inspector dialog (includes query, time, variables)
    const queryInspectorAfterRefresh = await dialogContent.textContent();

    // Close Query Inspector dialog
    await page.keyboard.press('Escape');
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });

    // Verify query inspector content is different - both variable value and time range should have changed
    expect(queryInspectorBeforeRefresh).not.toBe(queryInspectorAfterRefresh);

    // Verify the query after refresh contains the variable filter
    // The query should have the kubernetes_namespace_name filter
    expect(queryInspectorAfterRefresh).toContain("kubernetes_namespace_name");

    // Verify panel reloaded with new data
    const panelElement = page.locator(SELECTORS.PANEL_ANY).first();
    await expect(panelElement).toBeVisible();

    // Verify panel is loaded (not in loading state)
    const loadingState = await panelElement.getAttribute("data-state");
    expect(loadingState).not.toBe("loading");

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("6-should clear refresh indicator after global refresh completes", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_ClearInd_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.waitForAddPanelBtn();

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
    // Wait for settings dialog to be fully closed and network idle
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    // Wait for variable to appear on dashboard
    await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 15000 });

    // Add panel using consolidated helper
    await addSimplePanel(pm, "Panel1");

    // Wait for panel to be added to dashboard
    await page.locator(SELECTORS.PANEL_ANY).first().waitFor({ state: "visible", timeout: 15000 });
    await scopedVars.waitForDashboardReady();

    // Change variable
    await scopedVars.changeVariableValue(variableName, { monitorApi: true });

    // Wait for any loading to complete before checking refresh indicator
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Wait for the refresh indicator to appear
    const globalRefreshBtn = page.locator(SELECTORS.REFRESH_BTN);
    await expect(globalRefreshBtn).toHaveClass(/bg-warning/, { timeout: 10000 });

    // Verify indicator shows
    let hasIndicator = await hasRefreshIndicator(page, "global");
    expect(hasIndicator).toBe(true);

    // Click global refresh
    await page.locator(SELECTORS.REFRESH_BTN).click();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Wait for panels to finish loading
    await waitForAllPanelsToLoad(page, 1, 10000);

    // Verify indicator cleared
    hasIndicator = await hasRefreshIndicator(page, "global");
    expect(hasIndicator).toBe(false);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("7-should clear panel refresh indicator after panel refresh completes", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_PanelClearInd_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.waitForAddPanelBtn();

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
    // Wait for settings dialog to be fully closed and network idle
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    // Wait for variable to appear on dashboard
    await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 15000 });

    // Add panel with filter using the variable
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "filter");
    // Add filter using the variable
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_namespace_name",
      "",
      "=",
      `$${variableName}`
    );
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard and get panel ID
    await page.locator(SELECTORS.PANEL_ANY).first().waitFor({ state: "visible", timeout: 15000 });
    await scopedVars.waitForDashboardReady();

    await page.waitForTimeout(1000);
    const panelContainer = page.locator(SELECTORS.PANEL_CONTAINER).first();
    await panelContainer.waitFor({ state: "attached", timeout: 5000 });
    const panelId = await panelContainer.getAttribute("data-test-panel-id");

    // Change variable
    await scopedVars.changeVariableValue(variableName, { monitorApi: true });

    // Wait for any loading to complete before checking refresh indicator
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Wait for panel refresh button to show warning color
    const panelRefreshBtn = page.locator(getPanelRefreshBtn(panelId));
    await panelRefreshBtn.waitFor({ state: "visible", timeout: 10000 });
    await expect(panelRefreshBtn).toHaveClass(/text-warning/, { timeout: 10000 });

    // Click panel refresh
    await panelRefreshBtn.click();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Verify indicator cleared - button should no longer have warning class
    await expect(panelRefreshBtn).not.toHaveClass(/text-warning/, { timeout: 10000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("8-should not trigger other panels when clicking panel refresh", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_IsolateRefresh_${Date.now()}`;
    const variableName = `var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.waitForAddPanelBtn();

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
    // Wait for settings dialog to be fully closed and network idle
    await safeWaitForHidden(page, '.q-dialog', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    // Wait for variable to appear on dashboard
    await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 15000 });

    // Add Panel1 with filter using the variable
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "filter");
    // Add filter using the variable
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_namespace_name",
      "",
      "=",
      `$${variableName}`
    );
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard and get panel ID
    await page.locator(SELECTORS.PANEL_ANY).first().waitFor({ state: "visible", timeout: 15000 });
    await scopedVars.waitForDashboardReady();

    await page.waitForTimeout(1000);
    const panelContainer1 = page.locator(SELECTORS.PANEL_CONTAINER).first();
    await panelContainer1.waitFor({ state: "attached", timeout: 5000 });
    const panelId1 = await panelContainer1.getAttribute("data-test-panel-id");

    // Add Panel2 also with filter using the variable
    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "filter");
    // Add filter using the variable
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_namespace_name",
      "",
      "=",
      `$${variableName}`
    );
    await pm.dashboardPanelActions.addPanelName("Panel2");
    await pm.dashboardPanelActions.savePanel();

    // Wait for second panel to be added to dashboard and get panel ID
    await page.locator(SELECTORS.PANEL_ANY).nth(1).waitFor({ state: "visible", timeout: 15000 });

    await page.waitForTimeout(1000);
    const panelContainer2 = page.locator(SELECTORS.PANEL_CONTAINER).nth(1);
    await panelContainer2.waitFor({ state: "attached", timeout: 5000 });
    const panelId2 = await panelContainer2.getAttribute("data-test-panel-id");

    // Change variable - both panels should be affected
    await scopedVars.changeVariableValue(variableName, { monitorApi: true });

    // Wait for any loading to complete before checking refresh indicator
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Wait for both panel refresh buttons to show warning color
    const panel1RefreshBtn = page.locator(getPanelRefreshBtn(panelId1));
    const panel2RefreshBtn = page.locator(getPanelRefreshBtn(panelId2));

    await panel1RefreshBtn.waitFor({ state: "visible", timeout: 10000 });
    await panel2RefreshBtn.waitFor({ state: "visible", timeout: 10000 });

    await expect(panel1RefreshBtn).toHaveClass(/text-warning/, { timeout: 10000 });
    await expect(panel2RefreshBtn).toHaveClass(/text-warning/, { timeout: 10000 });

    // Click refresh only on Panel1
    await panel1RefreshBtn.click();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Panel1 indicator should clear, Panel2 should remain
    await expect(panel1RefreshBtn).not.toHaveClass(/text-warning/, { timeout: 10000 });
    await expect(panel2RefreshBtn).toHaveClass(/text-warning/, { timeout: 10000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
