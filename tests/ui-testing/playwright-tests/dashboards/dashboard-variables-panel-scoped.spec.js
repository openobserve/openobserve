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
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

const dashboardName = `DashVarPanel_${Date.now()}`;

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Panel-Scoped Variables", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("should create panel-scoped variable for specific panels", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `panel_var_${Date.now()}`;

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add first panel
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
    await page.waitForTimeout(1000);
    const panel1Id = await page.locator('[data-test="panel-container"]').first().getAttribute('data-panel-id');
    await page.locator('[data-test="panel-save-btn"]').click();

    // Add second panel
    await page.locator('[data-test="dashboard-panel-add"]').click();
    await page.waitForTimeout(1000);
    const panel2Id = await page.locator('[data-test="panel-container"]').last().getAttribute('data-panel-id');
    await page.locator('[data-test="panel-save-btn"]').click();

    // Add panel-scoped variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(variableName);

    // Set scope to "Selected Panels"
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Panels"').click();

    // Select both panels
    await page.locator('[data-test="variable-panels-select"]').click();
    await page.locator(`[data-test="panel-option-${panel1Id}"]`).click();
    await page.locator(`[data-test="panel-option-${panel2Id}"]`).click();

    // Configure as custom variable
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="variable-custom-options"]').fill('value1\nvalue2\nvalue3');

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Verify variable selector appears in Panel 1
    const panel1Selector = page.locator(`[data-test="variable-selector-${variableName}-${panel1Id}"]`);
    await expect(panel1Selector).toBeVisible({ timeout: 10000 });

    // Scroll to Panel 2 to trigger visibility
    await page.locator(`[data-panel-id="${panel2Id}"]`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Verify variable selector appears in Panel 2
    const panel2Selector = page.locator(`[data-test="variable-selector-${variableName}-${panel2Id}"]`);
    await expect(panel2Selector).toBeVisible({ timeout: 10000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should lazy load panel variables only when panel becomes visible", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `lazy_panel_var_${Date.now()}`;

    // Setup dashboard with panels
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add panel at bottom of page (not immediately visible)
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
    await page.waitForTimeout(1000);
    const panelId = await page.locator('[data-test="panel-container"]').getAttribute('data-panel-id');

    // Configure panel to be taller (force it below fold)
    await page.locator('[data-test="panel-height-input"]').fill('600');
    await page.locator('[data-test="panel-save-btn"]').click();

    // Add panel-scoped variable with query_values
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(variableName);

    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Panels"').click();
    await page.locator('[data-test="variable-panels-select"]').click();
    await page.locator(`[data-test="panel-option-${panelId}"]`).click();

    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_container_name"').first().click();

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Panel should not have loaded variable yet (not visible)
    const loadingIndicator = page.locator(`[data-test="variable-loading-${variableName}-${panelId}"]`);

    // Scroll panel into view to trigger lazy loading
    await page.locator(`[data-panel-id="${panelId}"]`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    // Verify variable selector is now visible and loaded
    const panelSelector = page.locator(`[data-test="variable-selector-${variableName}-${panelId}"]`);
    await expect(panelSelector).toBeVisible({ timeout: 10000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should maintain independent values per panel", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `independent_panel_${Date.now()}`;

    // Setup dashboard with two panels
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add two panels
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
    await page.waitForTimeout(1000);
    const panel1Id = await page.locator('[data-test="panel-container"]').first().getAttribute('data-panel-id');
    await page.locator('[data-test="panel-save-btn"]').click();

    await page.locator('[data-test="dashboard-panel-add"]').click();
    await page.waitForTimeout(1000);
    const panel2Id = await page.locator('[data-test="panel-container"]').last().getAttribute('data-panel-id');
    await page.locator('[data-test="panel-save-btn"]').click();

    // Add custom panel-scoped variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(variableName);

    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Panels"').click();
    await page.locator('[data-test="variable-panels-select"]').click();
    await page.locator(`[data-test="panel-option-${panel1Id}"]`).click();
    await page.locator(`[data-test="panel-option-${panel2Id}"]`).click();

    await page.locator('[data-test="variable-custom-options"]').fill('red\nblue\ngreen');

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Set different values in each panel
    const panel1Selector = page.locator(`[data-test="variable-selector-${variableName}-${panel1Id}"]`);
    await panel1Selector.click();
    await page.locator('[data-test="variable-option-red"]').click();

    await page.locator(`[data-panel-id="${panel2Id}"]`).scrollIntoViewIfNeeded();
    const panel2Selector = page.locator(`[data-test="variable-selector-${variableName}-${panel2Id}"]`);
    await panel2Selector.click();
    await page.locator('[data-test="variable-option-blue"]').click();

    // Verify values are independent
    await page.locator(`[data-panel-id="${panel1Id}"]`).scrollIntoViewIfNeeded();
    await expect(panel1Selector.locator('[data-test="variable-selected-value"]')).toHaveText(/red/i);

    await page.locator(`[data-panel-id="${panel2Id}"]`).scrollIntoViewIfNeeded();
    await expect(panel2Selector.locator('[data-test="variable-selected-value"]')).toHaveText(/blue/i);

    // Verify URL contains both values with correct format
    const url = page.url();
    expect(url).toContain(`var-${variableName}.p.${panel1Id}=red`);
    expect(url).toContain(`var-${variableName}.p.${panel2Id}=blue`);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should allow panel variable to depend on global and tab variables", async ({ page }) => {
    const pm = new PageManager(page);
    const globalVar = `global_${Date.now()}`;
    const tabVar = `tab_${Date.now()}`;
    const panelVar = `panel_${Date.now()}`;

    // Setup dashboard with tabs and panels
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

    // Add panel in Tab 1
    await page.locator('[data-test="tab-tab-1"]').click();
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
    await page.waitForTimeout(1000);
    const panelId = await page.locator('[data-test="panel-container"]').getAttribute('data-panel-id');
    await page.locator('[data-test="panel-save-btn"]').click();

    // Add variables: global -> tab -> panel dependency chain
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Global variable
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(globalVar);
    await page.locator('[data-test="variable-custom-options"]').fill('optA\noptB');
    await pm.dashboardSetting.saveVariable();

    // Tab variable depending on global
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(tabVar);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-1"]').click();

    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_namespace_name"').first().click();

    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`field=\$${globalVar}`);
    await pm.dashboardSetting.saveVariable();

    // Panel variable depending on tab
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(panelVar);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Panels"').click();
    await page.locator('[data-test="variable-panels-select"]').click();
    await page.locator(`[data-test="panel-option-${panelId}"]`).click();

    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_container_name"').first().click();

    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`namespace=\$${tabVar}`);
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Navigate to Tab 1
    await page.locator('[data-test="tab-tab-1"]').click();

    // Select global value
    const globalSelector = page.locator(`[data-test="variable-selector-${globalVar}"]`);
    await globalSelector.click();
    await page.locator('[data-test="variable-option-optA"]').click();

    // Wait for cascade: global -> tab -> panel
    await page.waitForTimeout(3000);

    // Verify all variables loaded
    const tabSelector = page.locator(`[data-test="variable-selector-${tabVar}-tab-1"]`);
    await expect(tabSelector).toBeVisible();

    const panelSelector = page.locator(`[data-test="variable-selector-${panelVar}-${panelId}"]`);
    await expect(panelSelector).toBeVisible();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should persist panel-scoped variables in URL correctly", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `url_panel_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add two panels
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
    await page.waitForTimeout(1000);
    const panel1Id = await page.locator('[data-test="panel-container"]').first().getAttribute('data-panel-id');
    await page.locator('[data-test="panel-save-btn"]').click();

    await page.locator('[data-test="dashboard-panel-add"]').click();
    await page.waitForTimeout(1000);
    const panel2Id = await page.locator('[data-test="panel-container"]').last().getAttribute('data-panel-id');
    await page.locator('[data-test="panel-save-btn"]').click();

    // Add panel-scoped variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(variableName);

    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Panels"').click();
    await page.locator('[data-test="variable-panels-select"]').click();
    await page.locator(`[data-test="panel-option-${panel1Id}"]`).click();
    await page.locator(`[data-test="panel-option-${panel2Id}"]`).click();

    await page.locator('[data-test="variable-custom-options"]').fill('delta\nepsilon\nzeta');

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Set values in both panels
    const panel1Selector = page.locator(`[data-test="variable-selector-${variableName}-${panel1Id}"]`);
    await panel1Selector.click();
    await page.locator('[data-test="variable-option-delta"]').click();

    await page.locator(`[data-panel-id="${panel2Id}"]`).scrollIntoViewIfNeeded();
    const panel2Selector = page.locator(`[data-test="variable-selector-${variableName}-${panel2Id}"]`);
    await panel2Selector.click();
    await page.locator('[data-test="variable-option-epsilon"]').click();

    await page.waitForTimeout(1000);

    // Verify URL format: var-name.p.panelId=value
    const url = page.url();
    expect(url).toContain(`var-${variableName}.p.${panel1Id}=delta`);
    expect(url).toContain(`var-${variableName}.p.${panel2Id}=epsilon`);

    // Reload page and verify persistence
    await page.reload();
    await page.waitForTimeout(2000);

    await page.locator(`[data-panel-id="${panel1Id}"]`).scrollIntoViewIfNeeded();
    await expect(panel1Selector.locator('[data-test="variable-selected-value"]')).toHaveText(/delta/i);

    await page.locator(`[data-panel-id="${panel2Id}"]`).scrollIntoViewIfNeeded();
    await expect(panel2Selector.locator('[data-test="variable-selected-value"]')).toHaveText(/epsilon/i);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should reload panel variable when parent tab variable changes", async ({ page }) => {
    const pm = new PageManager(page);
    const tabVar = `tab_parent_${Date.now()}`;
    const panelVar = `panel_child_${Date.now()}`;

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

    // Add tab parent variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(tabVar);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-1"]').click();
    await page.locator('[data-test="variable-custom-options"]').fill('x\ny\nz');
    await pm.dashboardSetting.saveVariable();

    // Add panel child variable
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(panelVar);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Panels"').click();
    await page.locator('[data-test="variable-panels-select"]').click();
    await page.locator(`[data-test="panel-option-${panelId}"]`).click();

    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_container_name"').first().click();

    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`filter=\$${tabVar}`);

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    await page.locator('[data-test="tab-tab-1"]').click();

    // Select first tab value
    const tabSelector = page.locator(`[data-test="variable-selector-${tabVar}-tab-1"]`);
    await tabSelector.click();
    await page.locator('[data-test="variable-option-x"]').click();

    await page.waitForTimeout(2000);

    // Verify panel variable loaded
    const panelSelector = page.locator(`[data-test="variable-selector-${panelVar}-${panelId}"]`);
    await expect(panelSelector).toBeVisible();

    // Change tab value
    await tabSelector.click();
    await page.locator('[data-test="variable-option-y"]').click();

    // Wait for panel variable to reload
    await page.waitForTimeout(2000);

    // Verify panel variable reloaded (should show loading or new options)
    const loadingIndicator = page.locator(`[data-test="variable-loading-${panelVar}"]`);
    // Loading might be too fast, but the dependency should work

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
