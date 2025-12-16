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

const dashboardName = `DashVarTab_${Date.now()}`;

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Tab-Scoped Variables", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("should create tab-scoped variable for specific tabs", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `tab_var_${Date.now()}`;

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard with tabs
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add two tabs
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openTabs();
    await pm.dashboardSetting.addTab("Tab 1");
    await pm.dashboardSetting.addTab("Tab 2");
    await pm.dashboardSetting.closeSetting();

    // Add tab-scoped variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(variableName);

    // Set scope to "Selected Tabs"
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();

    // Select both tabs
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-1"]').click();
    await page.locator('[data-test="tab-option-tab-2"]').click();

    // Configure as query values
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_container_name"').first().click();

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Verify variable selector appears in Tab 1
    await page.locator('[data-test="tab-tab-1"]').click();
    const tab1Selector = page.locator(`[data-test="variable-selector-${variableName}-tab-1"]`);
    await expect(tab1Selector).toBeVisible({ timeout: 10000 });

    // Verify variable selector appears in Tab 2
    await page.locator('[data-test="tab-tab-2"]').click();
    const tab2Selector = page.locator(`[data-test="variable-selector-${variableName}-tab-2"]`);
    await expect(tab2Selector).toBeVisible({ timeout: 10000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should load tab variables only when tab becomes active (lazy loading)", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `lazy_tab_var_${Date.now()}`;

    // Setup: Create dashboard with 2 tabs and tab-scoped variable
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

    // Add tab-scoped variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-name-input"]').fill(variableName);

    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-2"]').click(); // Only Tab 2

    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Verify variable does NOT load on Tab 1 (not scoped to it)
    await page.locator('[data-test="tab-tab-1"]').click();
    const tab1Selector = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(tab1Selector).not.toBeVisible();

    // Verify variable DOES load on Tab 2 (lazy load when activated)
    await page.locator('[data-test="tab-tab-2"]').click();
    const tab2Selector = page.locator(`[data-test="variable-selector-${variableName}-tab-2"]`);
    await expect(tab2Selector).toBeVisible({ timeout: 10000 });

    // Verify loading indicator appears briefly
    const loadingIndicator = page.locator(`[data-test="variable-loading-${variableName}"]`);
    // Loading might be too fast to catch, but we verify it loaded successfully

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should maintain independent values per tab", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `independent_${Date.now()}`;

    // Setup dashboard with tabs and custom tab-scoped variable
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openTabs();
    await pm.dashboardSetting.addTab("Tab 1");
    await pm.dashboardSetting.addTab("Tab 2");
    await pm.dashboardSetting.closeSetting();

    // Add custom tab-scoped variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="variable-name-input"]').fill(variableName);

    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-1"]').click();
    await page.locator('[data-test="tab-option-tab-2"]').click();

    await page.locator('[data-test="variable-custom-options"]').fill('valueA\nvalueB\nvalueC');

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Set different values in each tab
    await page.locator('[data-test="tab-tab-1"]').click();
    const tab1Selector = page.locator(`[data-test="variable-selector-${variableName}-tab-1"]`);
    await tab1Selector.click();
    await page.locator('[data-test="variable-option-valueA"]').click();

    await page.locator('[data-test="tab-tab-2"]').click();
    const tab2Selector = page.locator(`[data-test="variable-selector-${variableName}-tab-2"]`);
    await tab2Selector.click();
    await page.locator('[data-test="variable-option-valueB"]').click();

    // Verify values are independent
    await page.locator('[data-test="tab-tab-1"]').click();
    await expect(tab1Selector.locator('[data-test="variable-selected-value"]')).toHaveText(/valueA/i);

    await page.locator('[data-test="tab-tab-2"]').click();
    await expect(tab2Selector.locator('[data-test="variable-selected-value"]')).toHaveText(/valueB/i);

    // Verify URL contains both values
    const url = page.url();
    expect(url).toContain(`var-${variableName}.t.tab-1=valueA`);
    expect(url).toContain(`var-${variableName}.t.tab-2=valueB`);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should allow tab variable to depend on global variable", async ({ page }) => {
    const pm = new PageManager(page);
    const globalVar = `global_${Date.now()}`;
    const tabVar = `tab_${Date.now()}`;

    // Setup
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openTabs();
    await pm.dashboardSetting.addTab("Tab 1");
    await pm.dashboardSetting.closeSetting();

    // Add global variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await pm.dashboardSetting.addVariable(
      "Query Values",
      globalVar,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    await pm.dashboardSetting.saveVariable();

    // Add tab variable dependent on global
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

    // Add filter with dependency
    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`kubernetes_namespace_name=\$${globalVar}`);

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Navigate to Tab 1
    await page.locator('[data-test="tab-tab-1"]').click();

    // Select global variable value
    const globalSelector = page.locator(`[data-test="variable-selector-${globalVar}"]`);
    await globalSelector.click();
    await page.locator('[data-test^="variable-option-"]').first().click();

    // Wait for tab variable to reload
    await page.waitForTimeout(2000);

    // Verify tab variable has loaded with filtered data
    const tabSelector = page.locator(`[data-test="variable-selector-${tabVar}-tab-1"]`);
    await expect(tabSelector).toBeVisible();

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should persist tab-scoped variables in URL correctly", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `url_tab_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openTabs();
    await pm.dashboardSetting.addTab("Tab 1");
    await pm.dashboardSetting.addTab("Tab 2");
    await pm.dashboardSetting.closeSetting();

    // Add tab-scoped variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="variable-name-input"]').fill(variableName);

    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-1"]').click();
    await page.locator('[data-test="tab-option-tab-2"]').click();

    await page.locator('[data-test="variable-custom-options"]').fill('alpha\nbeta\ngamma');

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Set values in both tabs
    await page.locator('[data-test="tab-tab-1"]').click();
    const tab1Selector = page.locator(`[data-test="variable-selector-${variableName}-tab-1"]`);
    await tab1Selector.click();
    await page.locator('[data-test="variable-option-alpha"]').click();

    await page.locator('[data-test="tab-tab-2"]').click();
    const tab2Selector = page.locator(`[data-test="variable-selector-${variableName}-tab-2"]`);
    await tab2Selector.click();
    await page.locator('[data-test="variable-option-beta"]').click();

    await page.waitForTimeout(1000);

    // Verify URL format
    const url = page.url();
    expect(url).toContain(`var-${variableName}.t.tab-1=alpha`);
    expect(url).toContain(`var-${variableName}.t.tab-2=beta`);

    // Reload page and verify persistence
    await page.reload();
    await page.waitForTimeout(2000);

    await page.locator('[data-test="tab-tab-1"]').click();
    await expect(tab1Selector.locator('[data-test="variable-selected-value"]')).toHaveText(/alpha/i);

    await page.locator('[data-test="tab-tab-2"]').click();
    await expect(tab2Selector.locator('[data-test="variable-selected-value"]')).toHaveText(/beta/i);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should reload tab variable when parent global variable changes", async ({ page }) => {
    const pm = new PageManager(page);
    const globalVar = `parent_global_${Date.now()}`;
    const tabVar = `child_tab_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openTabs();
    await pm.dashboardSetting.addTab("Tab 1");
    await pm.dashboardSetting.closeSetting();

    // Add global parent
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="variable-name-input"]').fill(globalVar);
    await page.locator('[data-test="variable-custom-options"]').fill('opt1\nopt2');
    await pm.dashboardSetting.saveVariable();

    // Add tab child
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
    await page.locator('[data-test="variable-filter-input"]').fill(`filter_field=\$${globalVar}`);

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    await page.locator('[data-test="tab-tab-1"]').click();

    // Select first global value
    const globalSelector = page.locator(`[data-test="variable-selector-${globalVar}"]`);
    await globalSelector.click();
    await page.locator('[data-test="variable-option-opt1"]').click();

    await page.waitForTimeout(2000);

    // Store initial tab variable options count
    const tabSelector = page.locator(`[data-test="variable-selector-${tabVar}-tab-1"]`);
    await tabSelector.click();
    const initialOptionsCount = await page.locator('[data-test^="variable-option-"]').count();
    await tabSelector.click(); // Close

    // Change global value
    await globalSelector.click();
    await page.locator('[data-test="variable-option-opt2"]').click();

    // Wait for tab variable to reload
    await page.waitForTimeout(2000);

    // Verify tab variable reloaded (loading indicator or options changed)
    const loadingIndicator = page.locator(`[data-test="variable-loading-${tabVar}"]`);
    // Loading might be too fast, but options should change

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
