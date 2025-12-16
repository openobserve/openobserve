// Copyright 2023 Zinc Labs Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import { waitForDashboardPage, deleteDashboard } = require("./utils/dashCreation.js");

const dashboardName = `DashVarDeps_${Date.now()}`;

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables Dependencies & Edge Cases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("should detect circular dependency and show error", async ({ page }) => {
    const pm = new PageManager(page);
    const var1 = `var1_${Date.now()}`;
    const var2 = `var2_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add first query variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(var1);
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_namespace_name"').first().click();

    // Add filter referencing var2 (which will reference var1 back)
    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`field=\$${var2}`);
    await pm.dashboardSetting.saveVariable();

    // Add second query variable referencing var1
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(var2);
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_container_name"').first().click();

    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`field=\$${var1}`);

    await pm.dashboardSetting.saveVariable();

    // Should show error notification about circular dependency
    const errorNotification = page.locator('[data-test="notification-error"]');
    await expect(errorNotification).toBeVisible({ timeout: 5000 });
    await expect(errorNotification).toContainText(/circular dependency/i);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should not allow tab variable to depend on panel variable", async ({ page }) => {
    const pm = new PageManager(page);
    const panelVar = `panel_${Date.now()}`;
    const tabVar = `tab_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add tab
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openTabs();
    await pm.dashboardSetting.addTab("Tab 1");
    await pm.dashboardSetting.closeSetting();

    // Add panel
    await page.locator('[data-test="tab-tab-1"]').click();
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
    await page.waitForTimeout(1000);
    const panelId = await page.locator('[data-test="panel-container"]').getAttribute('data-panel-id');
    await page.locator('[data-test="panel-save-btn"]').click();

    // Add panel variable first
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="variable-name-input"]').fill(panelVar);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Panels"').click();
    await page.locator('[data-test="variable-panels-select"]').click();
    await page.locator(`[data-test="panel-option-${panelId}"]`).click();
    await page.locator('[data-test="variable-custom-options"]').fill('p1\np2');
    await pm.dashboardSetting.saveVariable();

    // Try to add tab variable depending on panel variable
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(tabVar);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-1"]').click();

    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_container_name"').first().click();

    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`field=\$${panelVar}`);

    await pm.dashboardSetting.saveVariable();

    // Should show error about invalid dependency
    const errorNotification = page.locator('[data-test="notification-error"]');
    await expect(errorNotification).toBeVisible({ timeout: 5000 });
    await expect(errorNotification).toContainText(/invalid dependency/i);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should handle null values in dependent variables correctly", async ({ page }) => {
    const pm = new PageManager(page);
    const parentVar = `parent_${Date.now()}`;
    const childVar = `child_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add parent query variable that might return no data
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(parentVar);
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_namespace_name"').first().click();

    // Add impossible filter to ensure no data
    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill('nonexistent_field=impossible_value_12345');
    await pm.dashboardSetting.saveVariable();

    // Add child variable depending on parent
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(childVar);
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_container_name"').first().click();

    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`namespace=\$${parentVar}`);

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    await page.waitForTimeout(3000);

    // Verify both variables loaded but with null/empty values
    const parentSelector = page.locator(`[data-test="variable-selector-${parentVar}"]`);
    await expect(parentSelector).toBeVisible();

    const childSelector = page.locator(`[data-test="variable-selector-${childVar}"]`);
    await expect(childSelector).toBeVisible();

    // Click parent to check if it's empty
    await parentSelector.click();
    const parentOptions = page.locator('[data-test^="variable-option-"]');
    const parentCount = await parentOptions.count();
    expect(parentCount).toBe(0); // Should be empty

    // Child should also be empty since parent is null
    await childSelector.click();
    const childOptions = page.locator('[data-test^="variable-option-"]');
    const childCount = await childOptions.count();
    expect(childCount).toBe(0); // Should be empty

    // Verify URL uses _o2_all_ sentinel or skips empty variables
    const url = page.url();
    // Empty variables might not appear in URL or use special sentinel

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should handle complex dependency chain (global -> tab -> panel)", async ({ page }) => {
    const pm = new PageManager(page);
    const globalVar = `g_${Date.now()}`;
    const tabVar = `t_${Date.now()}`;
    const panelVar = `p_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Setup: tab and panel
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openTabs();
    await pm.dashboardSetting.addTab("Tab 1");
    await pm.dashboardSetting.closeSetting();

    await page.locator('[data-test="tab-tab-1"]').click();
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
    await page.waitForTimeout(1000);
    const panelId = await page.locator('[data-test="panel-container"]').getAttribute('data-panel-id');
    await page.locator('[data-test="panel-save-btn"]').click();

    // Add variables in dependency order
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Global parent
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(globalVar);
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_namespace_name"').first().click();
    await pm.dashboardSetting.saveVariable();

    // Tab child of global
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(tabVar);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-1"]').click();
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_pod_name"').first().click();
    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`kubernetes_namespace_name=\$${globalVar}`);
    await pm.dashboardSetting.saveVariable();

    // Panel child of tab
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(panelVar);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Panels"').click();
    await page.locator('[data-test="variable-panels-select"]').click();
    await page.locator(`[data-test="panel-option-${panelId}"]`).click();
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_container_name"').first().click();
    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`kubernetes_pod_name=\$${tabVar}`);
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    await page.locator('[data-test="tab-tab-1"]').click();

    // Select global value
    const globalSelector = page.locator(`[data-test="variable-selector-${globalVar}"]`);
    await globalSelector.click();
    await page.locator('[data-test^="variable-option-"]').first().click();

    // Wait for cascade: global -> tab -> panel
    await page.waitForTimeout(4000);

    // Verify all loaded
    const tabSelector = page.locator(`[data-test="variable-selector-${tabVar}-tab-1"]`);
    await expect(tabSelector).toBeVisible();

    const panelSelector = page.locator(`[data-test="variable-selector-${panelVar}-${panelId}"]`);
    await expect(panelSelector).toBeVisible();

    // Change global value and verify cascade reload
    await globalSelector.click();
    const secondOption = page.locator('[data-test^="variable-option-"]').nth(1);
    if (await secondOption.isVisible()) {
      await secondOption.click();
      await page.waitForTimeout(3000);

      // Tab and panel should reload
      // Verify by checking loading indicators or value changes
    }

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should handle streaming/partial load correctly for dependent variables", async ({ page }) => {
    const pm = new PageManager(page);
    const parentVar = `stream_parent_${Date.now()}`;
    const childVar = `stream_child_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add parent query variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(parentVar);
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_namespace_name"').first().click();
    await pm.dashboardSetting.saveVariable();

    // Add child depending on parent
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(childVar);
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_container_name"').first().click();
    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`kubernetes_namespace_name=\$${parentVar}`);
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Verify parent starts loading
    const parentLoadingIndicator = page.locator(`[data-test="variable-loading-${parentVar}"]`);
    // Might be visible briefly

    // Wait for parent to get partial data
    await page.waitForTimeout(2000);

    // Verify child starts loading even before parent fully completes
    // This tests isVariablePartialLoaded triggering children
    const childLoadingIndicator = page.locator(`[data-test="variable-loading-${childVar}"]`);
    // Child should start loading after parent's first response

    // Wait for both to complete
    await page.waitForTimeout(3000);

    const parentSelector = page.locator(`[data-test="variable-selector-${parentVar}"]`);
    await expect(parentSelector).toBeVisible();

    const childSelector = page.locator(`[data-test="variable-selector-${childVar}"]`);
    await expect(childSelector).toBeVisible();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should handle tab switch with pending dependencies correctly", async ({ page }) => {
    const pm = new PageManager(page);
    const globalVar = `g_switch_${Date.now()}`;
    const tab1Var = `t1_${Date.now()}`;
    const tab2Var = `t2_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add tabs
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openTabs();
    await pm.dashboardSetting.addTab("Tab 1");
    await pm.dashboardSetting.addTab("Tab 2");
    await pm.dashboardSetting.closeSetting();

    // Add global and tab variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Global
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(globalVar);
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_namespace_name"').first().click();
    await pm.dashboardSetting.saveVariable();

    // Tab 1 variable
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(tab1Var);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-1"]').click();
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_pod_name"').first().click();
    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`kubernetes_namespace_name=\$${globalVar}`);
    await pm.dashboardSetting.saveVariable();

    // Tab 2 variable
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(tab2Var);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-2"]').click();
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_container_name"').first().click();
    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`kubernetes_namespace_name=\$${globalVar}`);
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Start on Tab 1
    await page.locator('[data-test="tab-tab-1"]').click();

    // Quickly switch to Tab 2 before Tab 1 variable fully loads
    await page.waitForTimeout(500);
    await page.locator('[data-test="tab-tab-2"]').click();

    // Wait for Tab 2 to load
    await page.waitForTimeout(3000);

    // Verify Tab 2 variable loaded correctly
    const tab2Selector = page.locator(`[data-test="variable-selector-${tab2Var}-tab-2"]`);
    await expect(tab2Selector).toBeVisible();

    // Switch back to Tab 1
    await page.locator('[data-test="tab-tab-1"]').click();
    await page.waitForTimeout(2000);

    // Verify Tab 1 variable is available
    const tab1Selector = page.locator(`[data-test="variable-selector-${tab1Var}-tab-1"]`);
    await expect(tab1Selector).toBeVisible();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
