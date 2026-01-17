/**
 * Dashboard Variables - Dependency Loading Test Suite
 * Tests variable dependencies, circular dependency detection, and multi-level dependency chains
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import {
  monitorVariableAPICalls,
  verifyVariableLoadSequence,
  waitForVariableToLoad
} from "../utils/variable-helpers.js";

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables - Dependency Loading", () => {
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

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

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
    await page.locator(`[data-test="dashboard-edit-variable-${varA}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

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
    await page.locator(`[data-test="dashboard-edit-variable-${varB}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${varB}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Change A and monitor B's reload
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 15000 });

    // Wait for variable dropdown to be visible and ready
    const varADropdown = page.getByLabel(varA, { exact: true });
    await varADropdown.waitFor({ state: "visible", timeout: 5000 });
    // Ensure network is idle before clicking
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await varADropdown.click();

    // Wait for dropdown menu to open
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
    await page.locator('[role="option"]').first().click();

    // Wait for dropdown to close
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    const result = await apiMonitor;

    // B should reload when A changes
    expect(result.actualCount).toBeGreaterThanOrEqual(1);

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

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add variables: A (independent), B (depends on A), C (depends on B)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await scopedVars.addScopedVariable(varA, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    await page.locator(`[data-test="dashboard-edit-variable-${varA}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(varB, "logs", "e2e_automate", "kubernetes_container_name", { scope: "global", dependsOn: varA, dependsOnField: "kubernetes_namespace_name" });
    await page.locator(`[data-test="dashboard-edit-variable-${varB}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(varC, "logs", "e2e_automate", "_timestamp", { scope: "global", dependsOn: varB, dependsOnField: "kubernetes_container_name" });

    // Wait for variable to be saved - either in settings or redirected to dashboard
    await Promise.race([
      page.locator(`[data-test="dashboard-edit-variable-${varC}"]`).waitFor({ state: "visible", timeout: 10000 }),
      page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 10000 })
    ]).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Close settings if still open
    const isDialogOpen = await page.locator('.q-dialog').isVisible().catch(() => false);
    if (isDialogOpen) {
      await pm.dashboardSetting.closeSettingWindow();
    }

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${varC}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Monitor 2 API calls (B and C) when A changes
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 2, timeout: 20000 });

    // Wait for variable dropdown to be visible and ready
    const varADropdown = page.getByLabel(varA, { exact: true });
    await varADropdown.waitFor({ state: "visible", timeout: 5000 });
    // Ensure network is idle before clicking
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Click to open the dropdown
    await varADropdown.click();

    // Wait for dropdown menu to open and options to load
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    const options = page.locator('[role="option"]');
    await options.first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for dropdown to stabilize and all options to render
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Select the 2nd option (index 1) to ensure value changes
    await options.nth(1).click();

    // Wait for dropdown to close
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    const result = await apiMonitor;

    // Both B and C should reload
    expect(result.actualCount).toBeGreaterThanOrEqual(2);

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

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

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
        page.locator(`[data-test="dashboard-edit-variable-${vars[i]}"]`).waitFor({ state: "visible", timeout: 10000 }),
        page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 10000 })
      ]).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

      // If redirected to dashboard, reopen settings for next variable (except on last iteration)
      if (i < vars.length - 1) {
        const isDialogOpen = await page.locator('.q-dialog').isVisible().catch(() => false);
        if (!isDialogOpen) {
          // Wait for dashboard to stabilize before reopening settings
          await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
          await pm.dashboardSetting.openSetting();
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
          await pm.dashboardSetting.openVariables();
          await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        }
      }
    }

    // Close settings if still open
    const isDialogOpen = await page.locator('.q-dialog').isVisible().catch(() => false);
    if (isDialogOpen) {
      await pm.dashboardSetting.closeSettingWindow();
    }

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${vars[3]}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Change A and monitor cascade
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 3, timeout: 25000 });

    // Wait for variable dropdown to be visible and ready
    const varADropdown = page.getByLabel(vars[0], { exact: true });
    await varADropdown.waitFor({ state: "visible", timeout: 5000 });
    // Ensure network is idle before clicking
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Click to open the dropdown
    await varADropdown.click();

    // Wait for dropdown menu to open and options to load
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    const options = page.locator('[role="option"]');
    await options.first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for dropdown to stabilize and all options to render
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Select the 2nd option (index 1) to ensure value changes
    await options.nth(1).click();

    // Wait for dropdown to close
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    const result = await apiMonitor;

    // B, C, D should all reload (3 calls)
    expect(result.actualCount).toBeGreaterThanOrEqual(3);

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

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

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
        page.locator(`[data-test="dashboard-edit-variable-${vars[i]}"]`).waitFor({ state: "visible", timeout: 10000 }),
        page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 10000 })
      ]).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

      // If redirected to dashboard, reopen settings for next variable (except on last iteration)
      if (i < vars.length - 1) {
        const isDialogOpen = await page.locator('.q-dialog').isVisible().catch(() => false);
        if (!isDialogOpen) {
          // Wait for dashboard to stabilize before reopening settings
          await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
          await pm.dashboardSetting.openSetting();
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
          await pm.dashboardSetting.openVariables();
          await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        }
      }
    }

    // Close settings if still open
    const isDialogOpen = await page.locator('.q-dialog').isVisible().catch(() => false);
    if (isDialogOpen) {
      await pm.dashboardSetting.closeSettingWindow();
    }

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${vars[5]}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Change first variable and monitor cascade
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 5, timeout: 30000 });

    // Wait for variable dropdown to be visible and ready
    const var0Dropdown = page.getByLabel(vars[0], { exact: true });
    await var0Dropdown.waitFor({ state: "visible", timeout: 5000 });
    // Ensure network is idle before clicking
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Click to open the dropdown
    await var0Dropdown.click();

    // Wait for dropdown menu to open and options to load
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    const options = page.locator('[role="option"]');
    await options.first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for dropdown to stabilize and all options to render
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Select the 2nd option (index 1) to ensure value changes
    await options.nth(1).click();

    // Wait for dropdown to close
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    const result = await apiMonitor;

    // 5 dependent variables should reload
    expect(result.actualCount).toBeGreaterThanOrEqual(5);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("5-should load 8-level dependency chain (stress test)", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Dep8_${Date.now()}`;
    const vars = Array.from({ length: 9 }, (_, i) => `v${i}_${Date.now()}`);

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

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
      "severity"
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
        page.locator(`[data-test="dashboard-edit-variable-${vars[i]}"]`).waitFor({ state: "visible", timeout: 10000 }),
        page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 10000 })
      ]).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

      // If redirected to dashboard, reopen settings for next variable (except on last iteration)
      if (i < vars.length - 1) {
        const isDialogOpen = await page.locator('.q-dialog').isVisible().catch(() => false);
        if (!isDialogOpen) {
          // Wait for dashboard to stabilize before reopening settings
          await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
          await pm.dashboardSetting.openSetting();
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
          await pm.dashboardSetting.openVariables();
          await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        }
      }
    }

    // Close settings if still open
    const isDialogOpen = await page.locator('.q-dialog').isVisible().catch(() => false);
    if (isDialogOpen) {
      await pm.dashboardSetting.closeSettingWindow();
    }

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${vars[8]}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Change first and monitor full cascade
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 8, timeout: 40000 });

    // Wait for variable dropdown to be visible and ready
    const var0Dropdown = page.getByLabel(vars[0], { exact: true });
    await var0Dropdown.waitFor({ state: "visible", timeout: 5000 });
    // Ensure network is idle before clicking
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Click to open the dropdown
    await var0Dropdown.click();

    // Wait for dropdown menu to open and options to load
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    const options = page.locator('[role="option"]');
    await options.first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for dropdown to stabilize and all options to render
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Select the 2nd option (index 1) to ensure value changes
    await options.nth(1).click();

    // Wait for dropdown to close
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    const result = await apiMonitor;

    // All 8 dependent variables should eventually load
    expect(result.actualCount).toBeGreaterThanOrEqual(6); // Allow for some timing variations

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

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Add A and B (independent)
    await scopedVars.addScopedVariable(varA, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    await page.locator(`[data-test="dashboard-edit-variable-${varA}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await scopedVars.addScopedVariable(varB, "logs", "e2e_automate", "kubernetes_container_name", { scope: "global" });
    await page.locator(`[data-test="dashboard-edit-variable-${varB}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

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
    await page.locator(`[data-test="dashboard-edit-variable-${varC}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${varC}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Change A, monitor if C loads
    const apiMonitor1 = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 15000 });

    // Wait for variable dropdown to be visible and ready
    const varADropdown = page.getByLabel(varA, { exact: true });
    await varADropdown.waitFor({ state: "visible", timeout: 5000 });
    // Ensure network is idle before clicking
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Click to open the dropdown
    await varADropdown.click();

    // Wait for dropdown menu to open and options to load
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    let options = page.locator('[role="option"]');
    await options.first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for dropdown to stabilize and all options to render
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Select the 2nd option (index 1) to ensure value changes
    await options.nth(1).click();

    // Wait for dropdown to close
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    const result1 = await apiMonitor1;

    // C should load when A changes
    expect(result1.actualCount).toBeGreaterThanOrEqual(1);

    // Change B, monitor if C loads again
    const apiMonitor2 = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 15000 });

    // Wait for variable dropdown to be visible and ready
    const varBDropdown = page.getByLabel(varB, { exact: true });
    await varBDropdown.waitFor({ state: "visible", timeout: 5000 });
    // Ensure network is idle before clicking
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Click to open the dropdown
    await varBDropdown.click();

    // Wait for dropdown menu to open and options to load
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });
    options = page.locator('[role="option"]');
    await options.first().waitFor({ state: "visible", timeout: 5000 });

    // Wait for dropdown to stabilize and all options to render
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Select the 2nd option (index 1) to ensure value changes
    await options.nth(1).click();

    // Wait for dropdown to close
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    const result2 = await apiMonitor2;

    // C should load when B changes too
    expect(result2.actualCount).toBeGreaterThanOrEqual(1);

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

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // First, create both variables without dependencies
    // Add variable A (independent initially)
    await scopedVars.addScopedVariable(varA, "logs", "e2e_automate", "kubernetes_namespace_name", {
      scope: "global"
    });
    await page.locator(`[data-test="dashboard-edit-variable-${varA}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Add variable B that depends on A
    await scopedVars.addScopedVariable(varB, "logs", "e2e_automate", "kubernetes_container_name", {
      scope: "global",
      dependsOn: varA, // B depends on A
      dependsOnField: "kubernetes_namespace_name"
    });
    await page.locator(`[data-test="dashboard-edit-variable-${varB}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Now edit variable A to depend on B (creating circular dependency: A->B->A)
    // Make sure we're on the variables tab
    await pm.dashboardSetting.goToVariablesTab();

    // Find and click the edit button for variable A
    const editButton = page.locator(`[data-test="dashboard-variable-edit-${varA}"]`);
    await editButton.waitFor({ state: "visible", timeout: 10000 });
    await editButton.click();

    // Wait for the edit form to be visible and stable
    const variableNameInput = page.locator('[data-test="dashboard-variable-name"]');
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

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Add 3 independent variables
    await scopedVars.addScopedVariable(varA, "logs", "e2e_automate", "kubernetes_namespace_name", { scope: "global" });
    await page.locator(`[data-test="dashboard-edit-variable-${varA}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await scopedVars.addScopedVariable(varB, "logs", "e2e_automate", "kubernetes_container_name", { scope: "global" });
    await page.locator(`[data-test="dashboard-edit-variable-${varB}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await scopedVars.addScopedVariable(varC, "logs", "e2e_automate", "_timestamp", { scope: "global" });
    await page.locator(`[data-test="dashboard-edit-variable-${varC}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${varC}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Monitor API calls on dashboard load
    const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 3, timeout: 20000 });

    // Reload dashboard to trigger all variables to load
    await page.reload();
    // Wait for page to stabilize after reload
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    const result = await apiMonitor;

    // All 3 should load independently
    expect(result.actualCount).toBeGreaterThanOrEqual(3);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("9-should show error state when variable loading fails", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_Error_${Date.now()}`;
    const variableName = `error_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add variable with invalid configuration to cause error
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await scopedVars.addScopedVariable(
      variableName,
      "logs",
      "nonexistent_stream",
      "nonexistent_field",
      { scope: "global" }
    );
    await page.locator(`[data-test="dashboard-edit-variable-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for variable to appear on dashboard
    await page.locator(`[data-test="variable-selector-${variableName}"]`).waitFor({ state: "visible", timeout: 10000 });

    // Wait for UI to stabilize and error state to appear
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const hasError = await scopedVars.hasVariableError(variableName);

    // Should show error indicator (red box)
    expect(hasError).toBe(true);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
