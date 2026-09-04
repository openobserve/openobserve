/**
 * Dashboard Variables - Dependency Loading Test Suite
 * Tests variable dependencies, circular dependency detection, and multi-level dependency chains
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard, setupTestDashboard, cleanupTestDashboard } from "./utils/dashCreation.js";
import {
  monitorVariableAPICalls,
  verifyVariableLoadSequence,
  waitForVariableToLoad,
  waitForVariableSelector
} from "../utils/variable-helpers.js";
const { safeWaitForHidden, safeWaitForNetworkIdle, safeWaitForDOMContentLoaded } = require("../utils/wait-helpers.js");
// Import centralized selectors
const {
  SELECTORS,
  getVariableSelector,
  getEditVariableBtn,
} = require("../../pages/dashboardPages/dashboard-selectors.js");
const testLogger = require("../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables - Dependency Loading", { tag: ['@dashboards', '@dashboardVariables', '@dependency', '@P1'] }, () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("1-should load simple 1-level dependency (A -> B)", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Dep1_${Date.now()}`;
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
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    // Wait for variable to be saved
    await scopedVars.getEditVariableBtnLocator(varA).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Add variable B (depends on A)
    await scopedVars.addScopedVariable(
      varB,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      {
        scope: "global",
        dependsOn: varA,
        dependsOnField: "kubernetes_namespace_name"
      }
    );

    // Wait for variable to be saved
    await scopedVars.getEditVariableBtnLocator(varB).waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Wait for variable to appear on dashboard
    await scopedVars.getVariableSelectorLocator(varB).waitFor({ state: "visible", timeout: 10000 });

    // dependentFields scopes the tally to B's own field, so A's dropdown-open request
    // is not miscounted as a dependency reload.
    const result = await scopedVars.changeVariableValueAndMonitorDependencies(varA, {
      optionIndex: 1, // Select second option so the value actually changes
      expectedAPICalls: 1, // B is the only dependent variable
      dependentFields: ["kubernetes_container_name"],
      timeout: 30000
    });

    // B should reload when A changes
    expect(result.matchedCount).toBeGreaterThanOrEqual(1);
    expect(result.success).toBe(true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("2-should load 2-level dependency chain (A -> B -> C)", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Dep2_${Date.now()}`;
    const varA = `var_a_${Date.now()}`;
    const varB = `var_b_${Date.now()}`;
    const varC = `var_c_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

    // Add variables: A (independent), B (depends on A), C (depends on B)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await scopedVars.addScopedVariable(varA, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });

    // Wait for variable to be saved
    await Promise.race([
      scopedVars.getEditVariableBtnLocator(varA).waitFor({ state: "visible", timeout: 10000 }),
      scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
    ]).catch(() => {});
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Close settings and reopen fresh for next variable
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    await pm.dashboardSetting.openSetting();
    await safeWaitForDOMContentLoaded(page, { timeout: 5000 });
    await pm.dashboardSetting.openVariables();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    await scopedVars.getAddVariableBtnLocator().waitFor({ state: "visible", timeout: 10000 });

    await scopedVars.addScopedVariable(varB, "logs", "e2e_automate", "kubernetes_container_name", { scope: "global", dependsOn: varA, dependsOnField: "kubernetes_namespace_name" });

    // Wait for variable to be saved
    await Promise.race([
      scopedVars.getEditVariableBtnLocator(varB).waitFor({ state: "visible", timeout: 10000 }),
      scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
    ]).catch(() => {});
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Close settings and reopen fresh for next variable
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    await pm.dashboardSetting.openSetting();
    await safeWaitForDOMContentLoaded(page, { timeout: 5000 });
    await pm.dashboardSetting.openVariables();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    await scopedVars.getAddVariableBtnLocator().waitFor({ state: "visible", timeout: 10000 });

    await scopedVars.addScopedVariable(varC, "logs", "e2e_automate", "_timestamp", { scope: "global", dependsOn: varB, dependsOnField: "kubernetes_container_name" });

    // Wait for variable to be saved - either in settings or redirected to dashboard
    await Promise.race([
      scopedVars.getEditVariableBtnLocator(varC).waitFor({ state: "visible", timeout: 10000 }),
      scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
    ]).catch(() => {});
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Close settings if still open
    const isDialogOpen = await scopedVars.isDialogVisible();
    if (isDialogOpen) {
      await pm.dashboardSetting.closeSettingWindow();
    }

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Wait for variable to appear on dashboard
    await scopedVars.getVariableSelectorLocator(varC).waitFor({ state: "visible", timeout: 10000 });

    // Cascade is sequential (C starts only once B finishes), so budget two round trips.
    const result = await scopedVars.changeVariableValueAndMonitorDependencies(varA, {
      optionIndex: 1, // Select second option to ensure value changes
      expectedAPICalls: 2, // B and C
      dependentFields: ["kubernetes_container_name", "_timestamp"],
      timeout: 45000
    });

    // Both B and C should reload
    expect(result.matchedCount).toBeGreaterThanOrEqual(2);
    expect(result.success).toBe(true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("3-should load 3-level dependency chain (A -> B -> C -> D)", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Dep3_${Date.now()}`;
    const vars = [`a_${Date.now()}`, `b_${Date.now()}`, `c_${Date.now()}`, `d_${Date.now()}`];

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Create chain: A -> B -> C -> D
    const fields = ["kubernetes_namespace_name", "kubernetes_container_name", "_timestamp", "log"];
    for (let i = 0; i < vars.length; i++) {
      await scopedVars.addScopedVariable(
        vars[i],
        "logs",
        "e2e_automate",
        fields[i],
        {
          scope: "global",
          dependsOn: i > 0 ? vars[i - 1] : null,
          dependsOnField: i > 0 ? fields[i - 1] : null
        }
      );

      // Wait for variable to be saved - either in settings or redirected to dashboard
      await Promise.race([
        scopedVars.getEditVariableBtnLocator(vars[i]).waitFor({ state: "visible", timeout: 10000 }),
        scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
      ]).catch(() => {});
      await safeWaitForNetworkIdle(page, { timeout: 3000 });

      // Prepare for next variable (except on last iteration)
      if (i < vars.length - 1) {
        // Always close settings and reopen fresh to ensure clean state
        await pm.dashboardSetting.closeSettingWindow();

        // Wait for dialog to close completely
        await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
        await safeWaitForNetworkIdle(page, { timeout: 5000 });

        // Reopen settings for next variable
        await pm.dashboardSetting.openSetting();
        await safeWaitForDOMContentLoaded(page, { timeout: 5000 });
        await pm.dashboardSetting.openVariables();
        await safeWaitForNetworkIdle(page, { timeout: 5000 });

        // Wait for Add Variable button to be visible and ready
        await scopedVars.getAddVariableBtnLocator().waitFor({ state: "visible", timeout: 10000 });
      }
    }

    // Close settings if still open
    const isDialogOpen = await scopedVars.isDialogVisible();
    if (isDialogOpen) {
      await pm.dashboardSetting.closeSettingWindow();
    }

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Check if we're actually on the dashboard view by looking for the add panel button or variable selector
    // If not visible, we may have been redirected to the dashboard list, so navigate back
    const isDashboardView = await scopedVars.getAddPanelBtnLocator().isVisible().catch(() => false);
    if (!isDashboardView) {
      // Not on dashboard, navigate back to it
      await pm.dashboardList.clickOnDashboard(dashboardName);
      await waitForDashboardPage(page);
      await safeWaitForNetworkIdle(page, { timeout: 3000 });
    }

    // Wait for variable to appear on dashboard
    await scopedVars.getVariableSelectorLocator(vars[3]).waitFor({ state: "visible", timeout: 10000 });

    // Three sequential round trips (B -> C -> D).
    const result = await scopedVars.changeVariableValueAndMonitorDependencies(vars[0], {
      optionIndex: 1, // Select second option to ensure value changes
      expectedAPICalls: 3, // B, C and D
      dependentFields: fields.slice(1), // every field below the root of the chain
      timeout: 60000
    });

    // B, C, D should all reload (3 calls)
    expect(result.matchedCount).toBeGreaterThanOrEqual(3);
    expect(result.success).toBe(true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("4-should load 5-level dependency chain", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Dep5_${Date.now()}`;
    const vars = Array.from({ length: 6 }, (_, i) => `var${i}_${Date.now()}`);

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    const fields = [
      "kubernetes_namespace_name",
      "kubernetes_container_name",
      "kubernetes_pod_name",
      "_timestamp",
      "log",
      "code"
    ];

    // Create 6-variable chain (0->1->2->3->4->5 = 5 levels of dependency)
    for (let i = 0; i < vars.length; i++) {
      await scopedVars.addScopedVariable(
        vars[i],
        "logs",
        "e2e_automate",
        fields[i],
        {
          scope: "global",
          dependsOn: i > 0 ? vars[i - 1] : null,
          dependsOnField: i > 0 ? fields[i - 1] : null
        }
      );

      // Wait for variable to be saved - either in settings or redirected to dashboard
      await Promise.race([
        scopedVars.getEditVariableBtnLocator(vars[i]).waitFor({ state: "visible", timeout: 10000 }),
        scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
      ]).catch(() => {});
      await safeWaitForNetworkIdle(page, { timeout: 3000 });

      // Prepare for next variable (except on last iteration)
      if (i < vars.length - 1) {
        // Always close settings and reopen fresh to ensure clean state
        await pm.dashboardSetting.closeSettingWindow();

        // Wait for dialog to close completely
        await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
        await safeWaitForNetworkIdle(page, { timeout: 5000 });

        // Reopen settings for next variable
        await pm.dashboardSetting.openSetting();
        await safeWaitForDOMContentLoaded(page, { timeout: 5000 });
        await pm.dashboardSetting.openVariables();
        await safeWaitForNetworkIdle(page, { timeout: 5000 });

        // Wait for Add Variable button to be visible and ready
        await scopedVars.getAddVariableBtnLocator().waitFor({ state: "visible", timeout: 10000 });
      }
    }

    // Close settings if still open
    const isDialogOpen = await scopedVars.isDialogVisible();
    if (isDialogOpen) {
      await pm.dashboardSetting.closeSettingWindow();
    }

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Check if we're actually on the dashboard view by looking for the add panel button or variable selector
    // If not visible, we may have been redirected to the dashboard list, so navigate back
    const isDashboardView = await scopedVars.getAddPanelBtnLocator().isVisible().catch(() => false);
    if (!isDashboardView) {
      // Not on dashboard, navigate back to it
      await pm.dashboardList.clickOnDashboard(dashboardName);
      await waitForDashboardPage(page);
      await safeWaitForNetworkIdle(page, { timeout: 3000 });
    }

    // Wait for variable to appear on dashboard
    await scopedVars.getVariableSelectorLocator(vars[5]).waitFor({ state: "visible", timeout: 10000 });

    // Via the shared helper so the monitor starts once the parent's options are up,
    // leaving the budget below for the cascade alone.
    const result = await scopedVars.changeVariableValueAndMonitorDependencies(vars[0], {
      optionIndex: 1, // Select second option to ensure value changes
      expectedAPICalls: 5, // the 5 variables below the root of the chain
      dependentFields: fields.slice(1),
      timeout: 90000
    });

    // 5 dependent variables should reload
    expect(result.matchedCount).toBeGreaterThanOrEqual(5);
    expect(result.success).toBe(true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("5-should load 8-level dependency chain (stress test)", async ({ page }) => {
    test.setTimeout(600000); // 10 minutes for this complex test with 9 variables

    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Dep8_${Date.now()}`;
    const vars = Array.from({ length: 9 }, (_, i) => `v${i}_${Date.now()}`);

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    const fields = [
      "kubernetes_namespace_name",
      "kubernetes_container_name",
      "kubernetes_pod_name",
      "kubernetes_host",
      "_timestamp",
      "log",
      "code",
      "stream",
      "kubernetes_annotations_kubectl_kubernetes_io_default_container"
    ];

    // Create 9-variable chain (8 levels of dependency)
    for (let i = 0; i < vars.length; i++) {
      await scopedVars.addScopedVariable(
        vars[i],
        "logs",
        "e2e_automate",
        fields[i] || "_timestamp",
        {
          scope: "global",
          dependsOn: i > 0 ? vars[i - 1] : null,
          dependsOnField: i > 0 ? (fields[i - 1] || "_timestamp") : null
        }
      );

      // Wait for variable to be saved - either in settings or redirected to dashboard
      await Promise.race([
        scopedVars.getEditVariableBtnLocator(vars[i]).waitFor({ state: "visible", timeout: 10000 }),
        scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
      ]).catch(() => {});
      await safeWaitForNetworkIdle(page, { timeout: 3000 });

      // Prepare for next variable (except on last iteration)
      if (i < vars.length - 1) {
        // Always close settings and reopen fresh to ensure clean state
        await pm.dashboardSetting.closeSettingWindow();

        // Wait for dialog to close completely
        await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
        await safeWaitForNetworkIdle(page, { timeout: 5000 });

        // Reopen settings for next variable
        await pm.dashboardSetting.openSetting();
        await safeWaitForDOMContentLoaded(page, { timeout: 5000 });
        await pm.dashboardSetting.openVariables();
        await safeWaitForNetworkIdle(page, { timeout: 5000 });

        // Wait for Add Variable button to be visible and ready
        await scopedVars.getAddVariableBtnLocator().waitFor({ state: "visible", timeout: 10000 });
      }
    }

    // Close settings if still open
    const isDialogOpen = await scopedVars.isDialogVisible();
    if (isDialogOpen) {
      await pm.dashboardSetting.closeSettingWindow();
    }

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Check if we're actually on the dashboard view by looking for the add panel button or variable selector
    // If not visible, we may have been redirected to the dashboard list, so navigate back
    const isDashboardView = await scopedVars.getAddPanelBtnLocator().isVisible().catch(() => false);
    if (!isDashboardView) {
      // Not on dashboard, navigate back to it
      await pm.dashboardList.clickOnDashboard(dashboardName);
      await waitForDashboardPage(page);
      await safeWaitForNetworkIdle(page, { timeout: 3000 });
    }

    // Wait for all variables to appear on dashboard - especially important for 9 variables
    await scopedVars.getVariableSelectorLocator(vars[8]).waitFor({ state: "visible", timeout: 10000 });

    // Wait for all variables to fully load
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Scroll the first variable into view before changing it
    const var0Dropdown = scopedVars.getVariableSelectorLocator(vars[0]);
    await var0Dropdown.waitFor({ state: "visible", timeout: 60000 });
    await var0Dropdown.scrollIntoViewIfNeeded();

    // Only 6 of 8 required: each level filters on the one above, so deep predicates can
    // return nothing, and a variable with no value marks its children loaded-with-null
    // without firing (onVariablePartiallyLoaded). The point is that a long chain
    // cascades rather than stalling at the first hop.
    const result = await scopedVars.changeVariableValueAndMonitorDependencies(vars[0], {
      optionIndex: 1,                   // Select second option to ensure value changes
      expectedAPICalls: 6,              // 6 of the 8 dependent variables
      dependentFields: fields.slice(1), // every field below the root of the chain
      timeout: 300000                   // 5 minute budget for this stress test
    });

    expect(result.matchedCount).toBeGreaterThanOrEqual(6);
    expect(result.success).toBe(true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("6-should handle multi-dependency (C depends on both A and B)", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_MultiDep_${Date.now()}`;
    const varA = `var_a_${Date.now()}`;
    const varB = `var_b_${Date.now()}`;
    const varC = `var_c_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Add A and B (independent)
    await scopedVars.addScopedVariable(varA, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });

    // Wait for variable to be saved - either in settings or redirected to dashboard
    await Promise.race([
      scopedVars.getEditVariableBtnLocator(varA).waitFor({ state: "visible", timeout: 10000 }),
      scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
    ]).catch(() => {});
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Close settings and reopen fresh for next variable
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    await pm.dashboardSetting.openSetting();
    await safeWaitForDOMContentLoaded(page, { timeout: 5000 });
    await pm.dashboardSetting.openVariables();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    await scopedVars.getAddVariableBtnLocator().waitFor({ state: "visible", timeout: 10000 });

    await scopedVars.addScopedVariable(varB, "logs", "e2e_automate", "kubernetes_container_name", { scope: "global" });

    // Wait for variable to be saved
    await Promise.race([
      scopedVars.getEditVariableBtnLocator(varB).waitFor({ state: "visible", timeout: 10000 }),
      scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
    ]).catch(() => {});
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Close settings and reopen fresh for next variable
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    await pm.dashboardSetting.openSetting();
    await safeWaitForDOMContentLoaded(page, { timeout: 5000 });
    await pm.dashboardSetting.openVariables();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    await scopedVars.getAddVariableBtnLocator().waitFor({ state: "visible", timeout: 10000 });

    // Add C depending on both A and B
    await scopedVars.addScopedVariable(
      varC,
      "logs",
      "e2e_automate",
      "_timestamp",
      {
        scope: "global",
        dependsOnMultiple: [varA, varB],
        dependencyFieldMap: {
          [varA]: "kubernetes_namespace_name",
          [varB]: "kubernetes_container_name"
        }
      }
    );

    // Wait for variable to be saved
    await Promise.race([
      scopedVars.getEditVariableBtnLocator(varC).waitFor({ state: "visible", timeout: 10000 }),
      scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
    ]).catch(() => {});
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Wait for variable to appear on dashboard
    await scopedVars.getVariableSelectorLocator(varC).waitFor({ state: "visible", timeout: 10000 });

    // C is the only dependent, and _timestamp is the field it queries.
    const result1 = await scopedVars.changeVariableValueAndMonitorDependencies(varA, {
      optionIndex: 1, // Select second option to ensure value changes
      expectedAPICalls: 1, // C is the only dependent variable
      dependentFields: ["_timestamp"],
      // C sits behind two parents, so it queues only once BOTH settle — past 30s on CI.
      timeout: 45000
    });

    // C should load when A changes
    expect(result1.matchedCount).toBeGreaterThanOrEqual(1);
    expect(result1.success).toBe(true);

    // Change B, monitor if C loads again using the new helper function
    const result2 = await scopedVars.changeVariableValueAndMonitorDependencies(varB, {
      optionIndex: 1, // Select second option to ensure value changes
      expectedAPICalls: 1, // C is the only dependent variable
      dependentFields: ["_timestamp"],
      // C sits behind two parents, so it queues only once BOTH settle — past 30s on CI.
      timeout: 45000
    });

    // C should load when B changes too
    expect(result2.matchedCount).toBeGreaterThanOrEqual(1);
    expect(result2.success).toBe(true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("7-should detect circular dependency and show error", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Circular_${Date.now()}`;
    const varA = `var_a_${Date.now()}`;
    const varB = `var_b_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // First, create both variables without dependencies
    // Add variable A (independent initially)
    await scopedVars.addScopedVariable(varA, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "global"
    });

    // Wait for variable to be saved
    await Promise.race([
      scopedVars.getEditVariableBtnLocator(varA).waitFor({ state: "visible", timeout: 10000 }),
      scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
    ]).catch(() => {});
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Close settings and reopen fresh for next variable
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    await pm.dashboardSetting.openSetting();
    await safeWaitForDOMContentLoaded(page, { timeout: 5000 });
    await pm.dashboardSetting.openVariables();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    await scopedVars.getAddVariableBtnLocator().waitFor({ state: "visible", timeout: 10000 });

    // Add variable B that depends on A
    await scopedVars.addScopedVariable(varB, "logs", "e2e_automate", "kubernetes_container_name", {
      scope: "global",
      dependsOn: varA, // B depends on A
      dependsOnField: "kubernetes_namespace_name"
    });

    // Wait for variable to be saved
    await Promise.race([
      scopedVars.getEditVariableBtnLocator(varB).waitFor({ state: "visible", timeout: 10000 }),
      scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
    ]).catch(() => {});
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Now edit variable A to depend on B (creating circular dependency: A->B->A)
    // Close settings and reopen fresh to ensure clean state
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Reopen settings and navigate to variables tab
    await pm.dashboardSetting.openSetting();
    // Wait for the settings ODrawer to be visible (replaced the legacy dialog selector)
    await scopedVars.getSettingsDrawerLocator().waitFor({ state: "visible", timeout: 5000 });
    await pm.dashboardSetting.openVariables();
    await scopedVars.getAddVariableBtnLocator().waitFor({ state: "visible", timeout: 10000 });

    // Wait for the draggable container and variables to load
    await scopedVars.getVariableDragLocator().waitFor({ state: "visible", timeout: 10000 });
    await scopedVars.getEditVariableBtnLocator(varA).waitFor({ state: "visible", timeout: 10000 });

    // Find and click the edit button for variable A
    const editButton = scopedVars.getEditVariableBtnLocator(varA);
    await editButton.click();

    // Wait for the edit form to be visible and stable
    const variableNameInput = scopedVars.getVariableNameLocator();
    await variableNameInput.waitFor({ state: "visible", timeout: 10000 });
    await variableNameInput.waitFor({ state: "attached", timeout: 5000 });

    // Add dependency on B using filter mechanism (this completes the circular dependency)
    await scopedVars.addDependency(varB, "kubernetes_namespace_name", "=");

    // Try to save - this should trigger validation error for circular dependency
    await scopedVars.clickSaveButton();

    // Check for circular dependency error
    const hasError = await scopedVars.hasCircularDependencyError();
    expect(hasError).toBe(true);

    await pm.dashboardSetting.closeSettingWindow();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("8-should load independent variables in parallel", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Parallel_${Date.now()}`;
    const varA = `var_a_${Date.now()}`;
    const varB = `var_b_${Date.now()}`;
    const varC = `var_c_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Add 3 independent variables
    await scopedVars.addScopedVariable(varA, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });

    // Wait for variable to be saved
    await Promise.race([
      scopedVars.getEditVariableBtnLocator(varA).waitFor({ state: "visible", timeout: 10000 }),
      scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
    ]).catch(() => {});
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Close settings and reopen fresh for next variable
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    await pm.dashboardSetting.openSetting();
    await safeWaitForDOMContentLoaded(page, { timeout: 5000 });
    await pm.dashboardSetting.openVariables();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    await scopedVars.getAddVariableBtnLocator().waitFor({ state: "visible", timeout: 10000 });

    await scopedVars.addScopedVariable(varB, "logs", "e2e_automate", "kubernetes_container_name", { scope: "global" });

    // Wait for variable to be saved
    await Promise.race([
      scopedVars.getEditVariableBtnLocator(varB).waitFor({ state: "visible", timeout: 10000 }),
      scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
    ]).catch(() => {});
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Close settings and reopen fresh for next variable
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    await pm.dashboardSetting.openSetting();
    await safeWaitForDOMContentLoaded(page, { timeout: 5000 });
    await pm.dashboardSetting.openVariables();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    await scopedVars.getAddVariableBtnLocator().waitFor({ state: "visible", timeout: 10000 });

    await scopedVars.addScopedVariable(varC, "logs", "e2e_automate", "_timestamp", { scope: "global" });

    // Wait for variable to be saved
    await Promise.race([
      scopedVars.getEditVariableBtnLocator(varC).waitFor({ state: "visible", timeout: 10000 }),
      scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
    ]).catch(() => {});
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Go back to dashboard list to ensure clean state
    await pm.dashboardCreate.backToDashboardList();
    await scopedVars.getDashboardSearchLocator().waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Scope the tally to these three fields so unrelated dashboard traffic is excluded.
    const apiMonitor = monitorVariableAPICalls(page, {
      expectedCount: 3,
      timeout: 45000,
      matchFn: (call) =>
        ["kubernetes_namespace_name", "kubernetes_container_name", "_timestamp"].includes(call.field)
    });

    // Reopen the dashboard to trigger all independent variables to load in parallel
    await pm.dashboardList.clickOnDashboard(dashboardName);
    await waitForDashboardPage(page);
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Wait for all variables to appear on dashboard
    await scopedVars.getVariableSelectorLocator(varA).waitFor({ state: "visible", timeout: 10000 });
    await scopedVars.getVariableSelectorLocator(varB).waitFor({ state: "visible", timeout: 10000 });
    await scopedVars.getVariableSelectorLocator(varC).waitFor({ state: "visible", timeout: 10000 });

    const result = await apiMonitor;

    // All 3 should load independently in parallel
    expect(result.matchedCount).toBeGreaterThanOrEqual(3);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test.skip("9-should show error state when variable loading fails", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Error_${Date.now()}`;
    const variableName = `error_var`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

    // Create a variable with a valid stream but add an impossible filter to cause error during value loading
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Add variable with filter that will cause no results/error
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      {
        scope: "global",
        filterConfig: {
          filterName: "kubernetes_namespace_name",
          operator: "=",
          value: "impossible_nonexistent_value_that_will_never_match_12345"
        }
      }
    );

    // Wait for variable to be saved
    await Promise.race([
      scopedVars.getEditVariableBtnLocator(variableName).waitFor({ state: "visible", timeout: 10000 }),
      scopedVars.getDialogLocator().waitFor({ state: "hidden", timeout: 10000 })
    ]).catch(() => {});
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await safeWaitForHidden(page, '[data-test="dashboard-settings-drawer"]', { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 30000 });

    // Wait for variable to appear on dashboard
    await scopedVars.getVariableSelectorLocator(variableName).waitFor({ state: "visible", timeout: 30000 });

    // Wait for UI to stabilize - variable should show empty/no data state
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Check if variable shows error or empty state
    // Since the filter returns no results, the variable should be visible but may show as empty
    const variableSelector = scopedVars.getVariableSelectorLocator(variableName);
    await expect(variableSelector).toBeVisible();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("10-should set child variable to All when parent variable causes empty options", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_NullHandling_${Date.now()}`;
    const parentVar = `parent_var_${Date.now()}`;
    const childVar = `child_var_${Date.now()}`;

    // Setup test dashboard using consolidated helper
    await setupTestDashboard(page, pm, dashboardName);

    // Add Parent Variable - use a field that has values
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      parentVar,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      { scope: "global" }
    );
    await pm.dashboardSetting.closeSettingWindow();

    // Add Child Variable with a dependency filter that forces empty results
    // By using dependsOn with a field mismatch (parent is namespace, child is pod but filtered by namespace value)
    // This creates an impossible condition where we're looking for pods where pod_name = namespace_name value
    await pm.dashboardSetting.openSetting();
    await scopedVars.addScopedVariable(
      childVar,
      "logs",
      "e2e_automate",
      "kubernetes_pod_name",
      {
        scope: "global",
        dependsOn: parentVar,
        dependsOnField: "kubernetes_pod_name" // This creates the impossible filter: WHERE kubernetes_pod_name = $parent_var (namespace value)
      }
    );
    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed using page object helper
    await scopedVars.waitForDialogHidden({ timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Verify child variable appears on dashboard using page object helper
    const childDropdown = await scopedVars.waitForVariableSelectorVisible(childVar);

    // Wait for network to be idle before interacting with variable
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Click the variable dropdown to see options
    await childDropdown.click();

    // Wait for dropdown menu to appear using page object helper
    await scopedVars.waitForMenuVisible({ timeout: 5000 });

    // When a variable query returns no results, it should show "No Data Found"
    const noDataText = scopedVars.getVariableNoDataLocator();
    await expect(noDataText).toBeVisible({ timeout: 5000 });

    // Close the dropdown
    await page.keyboard.press('Escape');
    await scopedVars.waitForMenuHidden({ timeout: 3000 });

    // Create a panel and use the child variable in a filter
    // The variable should be replaced with _o2_all_ in the panel
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "filter");

    // Add filter using the child variable
    await pm.dashboardFilter.addFilterCondition(
      0,
      "kubernetes_pod_name",
      "",
      "=",
      `$${childVar}`
    );

    await pm.dashboardPanelActions.addPanelName("Panel1");
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be added
    await scopedVars.getAnyPanel().waitFor({ state: "visible", timeout: 15000 });

    // Verify panel renders without errors (despite the variable having no data)
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Open Query Inspector to verify child variable was replaced with _o2_all_
    // Hover over panel to make dropdown visible - use page object helper
    await scopedVars.getFirstPanelContainer().hover();
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Use page object method to open query inspector
    await pm.dashboardPanelEdit.openQueryInspector("Panel1");

    // Wait for Query Inspector dialog to open and load content using page object helper
    await scopedVars.waitForDialogVisible({ timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Verify the query is displayed in the Query Inspector (Executed Query section)
    // Using SELECTORS constant instead of raw selector
    await expect(
      scopedVars.getQueryEditorLocator().filter({
        hasText: 'SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_pod_name) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_pod_name = \'_o2_all_\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
      }).last()
    ).toBeVisible();

    // Close Query Inspector dialog — QueryInspector uses ODialog (Reka UI), whose
    // escape-key-down only fires when focus is inside the dialog. Auto-focus is
    // suppressed by handleOpenAutoFocus, so a page-level `keyboard.press('Escape')`
    // does nothing and the overlay stays mounted, intercepting later clicks
    // (e.g. dashboard-back-btn during cleanup). Click the dialog's explicit
    // close button instead — matches the pattern used by other dashboard specs.
    await scopedVars.getQueryInspectorCloseBtn().click();
    await scopedVars.waitForDialogHidden({ timeout: 5000 });

    // Clean up using consolidated helper
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
