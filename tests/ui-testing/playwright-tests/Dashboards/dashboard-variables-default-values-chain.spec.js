/**
 * Dashboard Variables - Default Values in Dependency Chain Test Suite
 * Tests that variables with "all" and "custom" defaults maintain their values
 * when parent variables change, and that dependent children load properly.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { monitorVariableAPICalls } from "../utils/variable-helpers.js";
const { safeWaitForHidden, safeWaitForNetworkIdle, safeWaitForDOMContentLoaded } = require("../utils/wait-helpers.js");
// Import centralized selectors
const {
  SELECTORS,
  getVariableSelector,
} = require("../../pages/dashboardPages/dashboard-selectors.js");

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables - Default Values in Dependency Chain", { tag: ['@dashboards', '@dashboardVariables', '@defaultValues', '@P1'] }, () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("1-should maintain 'all' default value when parent changes - single-select (A -> B[all, single])", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_AllDefault_${Date.now()}`;
    const varA = `var_a_${Date.now()}`;
    const varB = `var_b_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Add variable A (independent)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      varA,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      { scope: "global" }
    );
    await pm.dashboardSetting.closeSettingWindow();

    await page.locator(getVariableSelector(varA)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Add variable B (depends on A, with "all" default, single-select)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      varB,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "global",
        dependsOn: varA,
        dependsOnField: "kubernetes_namespace_name",
        defaultValueType: "all"
      }
    );
    await pm.dashboardSetting.closeSettingWindow();

    // Verify B has "All" value
    const varBSelector = page.locator(getVariableSelector(varB));
    await varBSelector.waitFor({ state: "visible", timeout: 10000 });
    const varBValue = await varBSelector.locator('span.ellipsis').textContent();
    expect(varBValue).toContain("ALL");

    // Change A and verify B still has "All"
    const result = await scopedVars.changeVariableValueAndMonitorDependencies(varA, {
      optionIndex: 1,
      expectedAPICalls: 1,
      timeout: 15000
    });

    expect(result.success).toBe(true);

    // Verify B still has "All" value after A changes
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    const varBValueAfter = await varBSelector.locator('span.ellipsis').textContent();
    expect(varBValueAfter).toContain("ALL");

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("2-should maintain custom default value when parent changes - multi-select (A -> B[custom, multi])", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_CustomDefault_${Date.now()}`;
    const varA = `var_a_${Date.now()}`;
    const varB = `var_b_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Add variable A (independent)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      varA,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      { scope: "global" }
    );
    await pm.dashboardSetting.closeSettingWindow();

    await page.locator(getVariableSelector(varA)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Add variable B (depends on A, with custom default, multi-select)
    const customValue1 = "custom_value_1";
    const customValue2 = "custom_value_2";
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      varB,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "global",
        dependsOn: varA,
        dependsOnField: "kubernetes_namespace_name",
        showMultipleValues: true,
        defaultValueType: "custom",
        customValues: [customValue1, customValue2]
      }
    );
    await pm.dashboardSetting.closeSettingWindow();


    // Verify B has custom values
    const varBSelector = page.locator(getVariableSelector(varB));
    await varBSelector.waitFor({ state: "visible", timeout: 10000 });
    const varBValue = await varBSelector.locator('span.ellipsis').textContent();
    expect(varBValue).toContain(customValue1);

    // Change A and verify B still has custom values
    const result = await scopedVars.changeVariableValueAndMonitorDependencies(varA, {
      optionIndex: 1,
      expectedAPICalls: 1,
      timeout: 15000
    });

    expect(result.success).toBe(true);

    // Verify B still has custom values after A changes
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    const varBValueAfter = await varBSelector.locator('span.ellipsis').textContent();
    expect(varBValueAfter).toContain(customValue1);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("3-should load grandchild with first value when parent has 'all' default (A -> B[all, multi] -> C[first, single])", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_GrandchildFirst_${Date.now()}`;
    const varA = `var_a_${Date.now()}`;
    const varB = `var_b_${Date.now()}`;
    const varC = `var_c_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Add variable A (independent)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      varA,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      { scope: "global" }
    );
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Add variable B (depends on A, with "all" default, multi-select)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      varB,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "global",
        dependsOn: varA,
        dependsOnField: "kubernetes_namespace_name",
        showMultipleValues: true,
        defaultValueType: "all"
      }
    );
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Add variable C (depends on B, first value default - no custom or all)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      varC,
      "logs",
      "e2e_automate",
      "_timestamp",
      {
        scope: "global",
        dependsOn: varB,
        dependsOnField: "kubernetes_container_name"
      }
    );

    await pm.dashboardSetting.closeSettingWindow();

    // Verify all variables are visible
    await page.locator(getVariableSelector(varA)).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(getVariableSelector(varB)).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(getVariableSelector(varC)).waitFor({ state: "visible", timeout: 10000 });

    // Verify B has "All" value
    const varBSelector = page.locator(getVariableSelector(varB));
    const varBValue = await varBSelector.locator('span.ellipsis').textContent();
    expect(varBValue).toContain("ALL");

    // Verify C has a value (not null)
    const varCSelector = page.locator(getVariableSelector(varC));
    const varCValue = await varCSelector.locator('span.ellipsis').textContent();
    expect(varCValue).toBeTruthy();
    expect(varCValue.length).toBeGreaterThan(0);

    // Change A and verify C still loads properly
    const result = await scopedVars.changeVariableValueAndMonitorDependencies(varA, {
      optionIndex: 1,
      expectedAPICalls: 2, // B stays as "all", C reloads
      timeout: 20000
    });

    expect(result.success).toBe(true);

    // Verify B still has "All"
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    const varBValueAfter = await varBSelector.locator('span.ellipsis').textContent();
    expect(varBValueAfter).toContain("ALL");

    // Verify C still has a value (not null)
    const varCValueAfter = await varCSelector.locator('span.ellipsis').textContent();
    expect(varCValueAfter).toBeTruthy();
    expect(varCValueAfter.length).toBeGreaterThan(0);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("4-should handle full chain: A -> B[all, multi] -> C[custom, multi] -> D[first, single]", async ({ page }) => {
    test.setTimeout(120000); // 2 minutes for this complex test

    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_FullChain_${Date.now()}`;
    const varA = `a_${Date.now()}`;
    const varB = `b_${Date.now()}`;
    const varC = `c_${Date.now()}`;
    const varD = `d_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Add A (independent)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(varA, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Add B (depends on A, "all" default, multi-select)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      varB,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "global",
        dependsOn: varA,
        dependsOnField: "kubernetes_namespace_name",
        showMultipleValues: true,
        defaultValueType: "all"
      }
    );
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Add C (depends on B, custom default, multi-select)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      varC,
      "logs",
      "e2e_automate",
      "kubernetes_pod_name",
      {
        scope: "global",
        dependsOn: varB,
        dependsOnField: "kubernetes_container_name",
        showMultipleValues: true,
        defaultValueType: "custom",
        customValues: ["custom_pod_1", "custom_pod_2"]
      }
    );
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Add D (depends on C, first value default)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      varD,
      "logs",
      "e2e_automate",
      "_timestamp",
      {
        scope: "global",
        dependsOn: varC,
        dependsOnField: "kubernetes_pod_name"
      }
    );
    await pm.dashboardSetting.closeSettingWindow();

    // Verify all variables are visible
    await page.locator(getVariableSelector(varA)).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(getVariableSelector(varB)).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(getVariableSelector(varC)).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(getVariableSelector(varD)).waitFor({ state: "visible", timeout: 10000 });

    // Verify initial values
    const varBValue = await page.locator(getVariableSelector(varB)).locator('span.ellipsis').textContent();
    expect(varBValue).toContain("ALL");

    const varCValue = await page.locator(getVariableSelector(varC)).locator('span.ellipsis').textContent();
    expect(varCValue).toContain("custom_pod");

    const varDValue = await page.locator(getVariableSelector(varD)).locator('span.ellipsis').textContent();
    expect(varDValue).toBeTruthy();

    // Change A and verify the entire chain
    const result = await scopedVars.changeVariableValueAndMonitorDependencies(varA, {
      optionIndex: 1,
      expectedAPICalls: 2, // B keeps "all", C keeps custom, D reloads
      timeout: 30000
    });

    expect(result.success).toBe(true);

    // Verify all values are maintained/loaded properly
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    const varBValueAfter = await page.locator(getVariableSelector(varB)).locator('span.ellipsis').textContent();
    expect(varBValueAfter).toContain("ALL");

    const varCValueAfter = await page.locator(getVariableSelector(varC)).locator('span.ellipsis').textContent();
    expect(varCValueAfter).toContain("custom_pod");

    const varDValueAfter = await page.locator(getVariableSelector(varD)).locator('span.ellipsis').textContent();
    expect(varDValueAfter).toBeTruthy();
    expect(varDValueAfter.length).toBeGreaterThan(0);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("5-should maintain custom default value with single-select (A -> B[custom, single])", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_CustomDefaultSingle_${Date.now()}`;
    const varA = `var_a_${Date.now()}`;
    const varB = `var_b_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

    // Add variable A (independent)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      varA,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      { scope: "global" }
    );
    await pm.dashboardSetting.closeSettingWindow();

    await page.locator(getVariableSelector(varA)).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Add variable B (depends on A, with custom default, single-select)
    const customValue = "custom_single_value";
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      varB,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "global",
        dependsOn: varA,
        dependsOnField: "kubernetes_namespace_name",
        defaultValueType: "custom",
        customValues: [customValue]
      }
    );
    await pm.dashboardSetting.closeSettingWindow();

    // Verify B has custom value
    const varBSelector = page.locator(getVariableSelector(varB));
    await varBSelector.waitFor({ state: "visible", timeout: 10000 });
    const varBValue = await varBSelector.locator('span.ellipsis').textContent();
    expect(varBValue).toContain(customValue);

    // Change A and verify B still has custom value
    const result = await scopedVars.changeVariableValueAndMonitorDependencies(varA, {
      optionIndex: 1,
      expectedAPICalls: 1,
      timeout: 15000
    });

    expect(result.success).toBe(true);

    // Verify B still has custom value after A changes
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    const varBValueAfter = await varBSelector.locator('span.ellipsis').textContent();
    expect(varBValueAfter).toContain(customValue);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

});
