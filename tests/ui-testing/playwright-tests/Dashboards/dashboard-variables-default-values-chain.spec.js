/**
 * Dashboard Variables - Default Values in Dependency Chain Test Suite
 * Tests that variables with "all" and "custom" defaults maintain their values
 * when parent variables change, and that dependent children load properly.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require('../utils/test-logger.js');
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
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
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

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

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

    await scopedVars.getVariableSelectorLocator(varA).waitFor({ state: "visible", timeout: 10000 });
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
    const varBSelector = scopedVars.getVariableSelectorLocator(varB);
    await varBSelector.waitFor({ state: "visible", timeout: 10000 });
    const varBValue = await varBSelector.locator('[data-test$="-inner-value"]').textContent();
    expect(varBValue).toContain("ALL");

    // B has an "all" default so it does NOT re-query; an API count here would only be
    // satisfied by A's own request. Assert A genuinely changed, else "B kept its
    // default" is vacuous.
    const varAValueBefore = await scopedVars.getVariableInnerValueLocator(varA).textContent();

    await scopedVars.changeVariableValueAndMonitorDependencies(varA, {
      optionIndex: 1,
      expectedAPICalls: 1,
      timeout: 15000
    });

    const varAValueAfter = await scopedVars.getVariableInnerValueLocator(varA).textContent();
    expect(varAValueAfter).not.toBe(varAValueBefore);

    // Verify B still has "All" value after A changes
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    const varBValueAfter = await varBSelector.locator('[data-test$="-inner-value"]').textContent();
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

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

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

    await scopedVars.getVariableSelectorLocator(varA).waitFor({ state: "visible", timeout: 10000 });
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
    const varBSelector = scopedVars.getVariableSelectorLocator(varB);
    await varBSelector.waitFor({ state: "visible", timeout: 10000 });
    const varBValue = await varBSelector.locator('[data-test$="-inner-value"]').textContent();
    expect(varBValue).toContain(customValue1);

    // B has a custom default so it does not re-query; assert A actually changed rather
    // than on a count only A's own request satisfies.
    const varAValueBefore = await scopedVars.getVariableInnerValueLocator(varA).textContent();

    await scopedVars.changeVariableValueAndMonitorDependencies(varA, {
      optionIndex: 1,
      expectedAPICalls: 1,
      timeout: 15000
    });

    const varAValueAfter = await scopedVars.getVariableInnerValueLocator(varA).textContent();
    expect(varAValueAfter).not.toBe(varAValueBefore);

    // Verify B still has custom values after A changes
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    const varBValueAfter = await varBSelector.locator('[data-test$="-inner-value"]').textContent();
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

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

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
    await scopedVars.getVariableSelectorLocator(varA).waitFor({ state: "visible", timeout: 10000 });
    await scopedVars.getVariableSelectorLocator(varB).waitFor({ state: "visible", timeout: 10000 });
    await scopedVars.getVariableSelectorLocator(varC).waitFor({ state: "visible", timeout: 10000 });

    // Verify B has "All" value
    const varBSelector = scopedVars.getVariableSelectorLocator(varB);
    const varBValue = await varBSelector.locator('[data-test$="-inner-value"]').textContent();
    expect(varBValue).toContain("ALL");

    // Verify C has a value (not null)
    const varCSelector = scopedVars.getVariableSelectorLocator(varC);
    const varCValue = await varCSelector.locator('[data-test$="-inner-value"]').textContent();
    expect(varCValue).toBeTruthy();
    expect(varCValue.length).toBeGreaterThan(0);

    // B holds "all" without re-querying, so C (_timestamp) is the only expected reload;
    // dependentFields scopes the tally to C's own request.
    const result = await scopedVars.changeVariableValueAndMonitorDependencies(varA, {
      optionIndex: 1,
      expectedAPICalls: 1, // C reloads; B keeps "all" without an API call
      dependentFields: ["_timestamp"],
      timeout: 30000
    });

    expect(result.matchedCount).toBeGreaterThanOrEqual(1);
    expect(result.success).toBe(true);

    // Verify B still has "All"
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    const varBValueAfter = await varBSelector.locator('[data-test$="-inner-value"]').textContent();
    expect(varBValueAfter).toContain("ALL");

    // Verify C still has a value (not null)
    const varCValueAfter = await varCSelector.locator('[data-test$="-inner-value"]').textContent();
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

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

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
    // Note: Use "IN" operator because B is multi-select
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
        dependsOnOperator: "IN",
        showMultipleValues: true,
        defaultValueType: "custom",
        customValues: ["custom_pod_1", "custom_pod_2"]
      }
    );
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Add D (depends on C, first value default)
    // Note: Use "IN" operator because C is multi-select
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
        dependsOnField: "kubernetes_pod_name",
        dependsOnOperator: "IN"
      }
    );
    await pm.dashboardSetting.closeSettingWindow();

    // Verify all variables are visible
    await scopedVars.getVariableSelectorLocator(varA).waitFor({ state: "visible", timeout: 10000 });
    await scopedVars.getVariableSelectorLocator(varB).waitFor({ state: "visible", timeout: 10000 });
    await scopedVars.getVariableSelectorLocator(varC).waitFor({ state: "visible", timeout: 10000 });
    await scopedVars.getVariableSelectorLocator(varD).waitFor({ state: "visible", timeout: 10000 });

    // Verify initial values
    const varBValue = await scopedVars.getVariableInnerValueLocator(varB).textContent();
    expect(varBValue).toContain("ALL");

    const varCValue = await scopedVars.getVariableInnerValueLocator(varC).textContent();
    expect(varCValue).toContain("custom_pod");

    const varDValue = await scopedVars.getVariableInnerValueLocator(varD).textContent();
    expect(varDValue).toBeTruthy();

    // B keeps "all" and C its custom values without re-querying, so D (_timestamp) is
    // the only expected reload — scoping the tally asserts the chain's tail fired.
    const result = await scopedVars.changeVariableValueAndMonitorDependencies(varA, {
      optionIndex: 1,
      expectedAPICalls: 1, // D reloads; B and C hold their defaults without an API call
      dependentFields: ["_timestamp"],
      timeout: 45000
    });

    expect(result.matchedCount).toBeGreaterThanOrEqual(1);
    expect(result.success).toBe(true);

    // Verify all values are maintained/loaded properly
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    const varBValueAfter = await scopedVars.getVariableInnerValueLocator(varB).textContent();
    expect(varBValueAfter).toContain("ALL");

    const varCValueAfter = await scopedVars.getVariableInnerValueLocator(varC).textContent();
    expect(varCValueAfter).toContain("custom_pod");

    const varDValueAfter = await scopedVars.getVariableInnerValueLocator(varD).textContent();
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

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

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

    await scopedVars.getVariableSelectorLocator(varA).waitFor({ state: "visible", timeout: 10000 });
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
    const varBSelector = scopedVars.getVariableSelectorLocator(varB);
    await varBSelector.waitFor({ state: "visible", timeout: 10000 });
    const varBValue = await varBSelector.locator('[data-test$="-inner-value"]').textContent();
    expect(varBValue).toContain(customValue);

    // B has a custom default so it does not re-query; assert A actually changed rather
    // than on a count only A's own request satisfies.
    const varAValueBefore = await scopedVars.getVariableInnerValueLocator(varA).textContent();

    await scopedVars.changeVariableValueAndMonitorDependencies(varA, {
      optionIndex: 1,
      expectedAPICalls: 1,
      timeout: 15000
    });

    const varAValueAfter = await scopedVars.getVariableInnerValueLocator(varA).textContent();
    expect(varAValueAfter).not.toBe(varAValueBefore);

    // Verify B still has custom value after A changes
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    const varBValueAfter = await varBSelector.locator('[data-test$="-inner-value"]').textContent();
    expect(varBValueAfter).toContain(customValue);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

});
