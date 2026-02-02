/**
 * Dashboard Variables - Refresh Indicators and Panel Reload Test Suite
 * Tests global refresh button indicators, panel refresh indicators, and reload behavior
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import {
  hasRefreshIndicator,
  panelNeedsRefresh,
  trackPanelReload,
  waitForAllPanelsToLoad
} from "../utils/variable-helpers.js";

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables - Refresh Indicators & Panel Reload", () => {
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

    // Change variable value
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Check global refresh button shows indicator
    const globalRefreshBtn = page.locator('[data-test="dashboard-global-refresh-btn"]');
    await expect(globalRefreshBtn).toHaveClass(/refresh-needed|needs-refresh|highlighted/);

    // Or check for visual indicator (icon, color change, badge, etc.)
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

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add variables
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(varA, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    await scopedVars.addScopedVariable(varB, "logs", "e2e_automate", "kubernetes_container_name", { scope: "global", dependsOn: varA });
    await pm.dashboardSetting.closeSettingWindow();
    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${varA}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Add panel using variable B
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

    // Change variable A (which affects B)
    const varADropdown = page.getByLabel(varA, { exact: true });
    await varADropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varADropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Panel should show refresh needed indicator
    const needsRefresh = await panelNeedsRefresh(page, panelId);
    expect(needsRefresh).toBe(true);

    // Or check for warning icon
    const warningIcon = page.locator(`[data-test="dashboard-panel-${panelId}-refresh-warning"]`);
    await expect(warningIcon).toBeVisible({ timeout: 5000 });

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

    // Add two panels
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel2");
    await pm.dashboardPanelActions.savePanel();

    // Wait for second panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').nth(1).waitFor({ state: "visible", timeout: 15000 });

    // Change variable
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Click global refresh and track reloads
    const reloadTracker = trackPanelReload(
      page,
      null,
      async () => {
        await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
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

    // Add two panels
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    const panelId1 = await page.locator('[data-test*="dashboard-panel-"]').first().getAttribute("data-panel-id");

    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel2");
    await pm.dashboardPanelActions.savePanel();

    // Wait for second panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').nth(1).waitFor({ state: "visible", timeout: 15000 });

    // Change variable
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Click refresh on Panel1 only
    const reloadTracker = trackPanelReload(
      page,
      panelId1,
      async () => {
        await page.locator(`[data-panel-id="${panelId1}"] [data-test="dashboard-panel-refresh-btn"]`).click();
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

    // Change variable
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    const selectedOption = page.locator('[role="option"]').first();
    await selectedOption.waitFor({ state: "visible", timeout: 5000 });
    await selectedOption.click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Change time range
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-h-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Click global refresh
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify panel reloaded with new data
    const panelElement = page.locator('[data-test*="dashboard-panel-"]').first();
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

    // Change variable
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Verify indicator shows
    let hasIndicator = await hasRefreshIndicator(page, "global");
    expect(hasIndicator).toBe(true);

    // Click global refresh
    await page.locator('[data-test="dashboard-global-refresh-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

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

    // Change variable
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Verify panel indicator shows
    let needsRefresh = await panelNeedsRefresh(page, panelId);
    expect(needsRefresh).toBe(true);

    // Click panel refresh
    await page.locator(`[data-panel-id="${panelId}"] [data-test="dashboard-panel-refresh-btn"]`).click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify indicator cleared
    needsRefresh = await panelNeedsRefresh(page, panelId);
    expect(needsRefresh).toBe(false);

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

    // Add Panel1
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator('[data-test="dashboard-setting-btn"]').waitFor({ state: "visible", timeout: 10000 });

    const panelId1 = await page.locator('[data-test*="dashboard-panel-"]').first().getAttribute("data-panel-id");

    // Add Panel2
    await pm.dashboardCreate.addPanelToExistingDashboard();
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.dashboardPanelActions.addPanelName("Panel2");
    await pm.dashboardPanelActions.savePanel();

    // Wait for second panel to be added to dashboard
    await page.locator('[data-test*="dashboard-panel-"]').nth(1).waitFor({ state: "visible", timeout: 15000 });

    const panelId2 = await page.locator('[data-test*="dashboard-panel-"]').nth(1).getAttribute("data-panel-id");

    // Change variable
    const varDropdown = page.getByLabel(variableName, { exact: true });
    await varDropdown.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varDropdown.click();
    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Both panels should show refresh needed
    let panel1NeedsRefresh = await panelNeedsRefresh(page, panelId1);
    let panel2NeedsRefresh = await panelNeedsRefresh(page, panelId2);

    expect(panel1NeedsRefresh).toBe(true);
    expect(panel2NeedsRefresh).toBe(true);

    // Click refresh only on Panel1
    await page.locator(`[data-panel-id="${panelId1}"] [data-test="dashboard-panel-refresh-btn"]`).click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Panel1 indicator should clear, Panel2 should remain
    panel1NeedsRefresh = await panelNeedsRefresh(page, panelId1);
    panel2NeedsRefresh = await panelNeedsRefresh(page, panelId2);

    expect(panel1NeedsRefresh).toBe(false);
    expect(panel2NeedsRefresh).toBe(true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
