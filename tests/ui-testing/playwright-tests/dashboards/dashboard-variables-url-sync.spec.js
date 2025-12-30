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

const dashboardName = `DashVarURL_${Date.now()}`;

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables URL Synchronization", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("should correctly format global variables in URL", async ({ page }) => {
    const pm = new PageManager(page);
    const singleVar = `single_${Date.now()}`;
    const multiVar = `multi_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add single-select global variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(singleVar);
    await page.locator('[data-test="variable-custom-options"]').fill('value1\nvalue2');
    await pm.dashboardSetting.saveVariable();

    // Add multi-select global variable
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(multiVar);
    await page.locator('[data-test="variable-custom-options"]').fill('optA\noptB\noptC');
    await page.locator('[data-test="variable-multiselect-checkbox"]').check();
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Select single value
    const singleSelector = page.locator(`[data-test="variable-selector-${singleVar}"]`);
    await singleSelector.click();
    await page.locator('[data-test="variable-option-value1"]').click();

    // Select multiple values
    const multiSelector = page.locator(`[data-test="variable-selector-${multiVar}"]`);
    await multiSelector.click();
    await page.locator('[data-test="variable-option-optA"]').click();
    await page.locator('[data-test="variable-option-optB"]').click();

    await page.waitForTimeout(1000);

    // Verify URL format
    const url = page.url();
    // Single: var-name=value
    expect(url).toContain(`var-${singleVar}=value1`);
    // Multi: var-name=val1,val2
    expect(url).toContain(`var-${multiVar}=optA,optB`);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should correctly format tab-scoped variables in URL", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `tab_url_var_${Date.now()}`;

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
    const tab1Id = await page.locator('[data-test="tab-tab-1"]').getAttribute('data-tab-id');
    const tab2Id = await page.locator('[data-test="tab-tab-2"]').getAttribute('data-tab-id');
    await pm.dashboardSetting.closeSetting();

    // Add tab-scoped variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(variableName);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-1"]').click();
    await page.locator('[data-test="tab-option-tab-2"]').click();
    await page.locator('[data-test="variable-custom-options"]').fill('alpha\nbeta\ngamma');

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Set different values in each tab
    await page.locator('[data-test="tab-tab-1"]').click();
    const tab1Selector = page.locator(`[data-test="variable-selector-${variableName}-tab-1"]`);
    await tab1Selector.click();
    await page.locator('[data-test="variable-option-alpha"]').click();

    await page.locator('[data-test="tab-tab-2"]').click();
    const tab2Selector = page.locator(`[data-test="variable-selector-${variableName}-tab-2"]`);
    await tab2Selector.click();
    await page.locator('[data-test="variable-option-beta"]').click();

    await page.waitForTimeout(1000);

    // Verify URL format: var-name.t.tabId=value
    const url = page.url();
    expect(url).toContain(`var-${variableName}.t.${tab1Id}=alpha`);
    expect(url).toContain(`var-${variableName}.t.${tab2Id}=beta`);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should correctly format panel-scoped variables in URL", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `panel_url_var_${Date.now()}`;

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
    await page.locator('[data-test="variable-custom-options"]').fill('x\ny\nz');

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Set different values in each panel
    const panel1Selector = page.locator(`[data-test="variable-selector-${variableName}-${panel1Id}"]`);
    await panel1Selector.click();
    await page.locator('[data-test="variable-option-x"]').click();

    await page.locator(`[data-panel-id="${panel2Id}"]`).scrollIntoViewIfNeeded();
    const panel2Selector = page.locator(`[data-test="variable-selector-${variableName}-${panel2Id}"]`);
    await panel2Selector.click();
    await page.locator('[data-test="variable-option-y"]').click();

    await page.waitForTimeout(1000);

    // Verify URL format: var-name.p.panelId=value
    const url = page.url();
    expect(url).toContain(`var-${variableName}.p.${panel1Id}=x`);
    expect(url).toContain(`var-${variableName}.p.${panel2Id}=y`);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should restore all variable values from URL on page reload", async ({ page }) => {
    const pm = new PageManager(page);
    const globalVar = `global_${Date.now()}`;
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

    // Add global and tab variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(globalVar);
    await page.locator('[data-test="variable-custom-options"]').fill('g1\ng2\ng3');
    await pm.dashboardSetting.saveVariable();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(tabVar);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-1"]').click();
    await page.locator('[data-test="variable-custom-options"]').fill('t1\nt2\nt3');
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Set values
    const globalSelector = page.locator(`[data-test="variable-selector-${globalVar}"]`);
    await globalSelector.click();
    await page.locator('[data-test="variable-option-g2"]').click();

    await page.locator('[data-test="tab-tab-1"]').click();
    const tabSelector = page.locator(`[data-test="variable-selector-${tabVar}-tab-1"]`);
    await tabSelector.click();
    await page.locator('[data-test="variable-option-t3"]').click();

    await page.waitForTimeout(1000);

    // Store URL
    const urlBeforeReload = page.url();

    // Reload page
    await page.reload();
    await page.waitForTimeout(2000);

    // Verify values restored
    await expect(globalSelector.locator('[data-test="variable-selected-value"]')).toHaveText(/g2/i);

    await page.locator('[data-test="tab-tab-1"]').click();
    await expect(tabSelector.locator('[data-test="variable-selected-value"]')).toHaveText(/t3/i);

    // Verify URL unchanged
    expect(page.url()).toBe(urlBeforeReload);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should apply unscoped URL variable to all instances (drilldown behavior)", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `drilldown_var_${Date.now()}`;

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

    // Add tab-scoped variable to both tabs
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(variableName);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-1"]').click();
    await page.locator('[data-test="tab-option-tab-2"]').click();
    await page.locator('[data-test="variable-custom-options"]').fill('drill1\ndrill2\ndrill3');

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Get current URL and manually add unscoped variable parameter (simulating drilldown)
    const currentUrl = page.url();
    const drilldownUrl = `${currentUrl}&var-${variableName}=drill2`;

    // Navigate to drilldown URL
    await page.goto(drilldownUrl);
    await page.waitForTimeout(2000);

    // Verify BOTH tabs get the same value
    await page.locator('[data-test="tab-tab-1"]').click();
    const tab1Selector = page.locator(`[data-test="variable-selector-${variableName}-tab-1"]`);
    await expect(tab1Selector.locator('[data-test="variable-selected-value"]')).toHaveText(/drill2/i);

    await page.locator('[data-test="tab-tab-2"]').click();
    const tab2Selector = page.locator(`[data-test="variable-selector-${variableName}-tab-2"]`);
    await expect(tab2Selector.locator('[data-test="variable-selected-value"]')).toHaveText(/drill2/i);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should handle mixed global and scoped variables in URL", async ({ page }) => {
    const pm = new PageManager(page);
    const globalVar = `g_${Date.now()}`;
    const tabVar = `t_${Date.now()}`;
    const panelVar = `p_${Date.now()}`;

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

    // Add all three types of variables
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Global
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(globalVar);
    await page.locator('[data-test="variable-custom-options"]').fill('g1\ng2');
    await pm.dashboardSetting.saveVariable();

    // Tab
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(tabVar);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Tabs"').click();
    await page.locator('[data-test="variable-tabs-select"]').click();
    await page.locator('[data-test="tab-option-tab-1"]').click();
    await page.locator('[data-test="variable-custom-options"]').fill('t1\nt2');
    await pm.dashboardSetting.saveVariable();

    // Panel
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(panelVar);
    await page.locator('[data-test="variable-scope-select"]').click();
    await page.locator('text="Selected Panels"').click();
    await page.locator('[data-test="variable-panels-select"]').click();
    await page.locator(`[data-test="panel-option-${panelId}"]`).click();
    await page.locator('[data-test="variable-custom-options"]').fill('p1\np2');
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Set all values
    const globalSelector = page.locator(`[data-test="variable-selector-${globalVar}"]`);
    await globalSelector.click();
    await page.locator('[data-test="variable-option-g1"]').click();

    await page.locator('[data-test="tab-tab-1"]').click();
    const tabSelector = page.locator(`[data-test="variable-selector-${tabVar}-tab-1"]`);
    await tabSelector.click();
    await page.locator('[data-test="variable-option-t2"]').click();

    const panelSelector = page.locator(`[data-test="variable-selector-${panelVar}-${panelId}"]`);
    await panelSelector.click();
    await page.locator('[data-test="variable-option-p1"]').click();

    await page.waitForTimeout(1000);

    // Verify URL contains all three with correct format
    const url = page.url();
    expect(url).toContain(`var-${globalVar}=g1`); // Global: var-name=value
    expect(url).toMatch(new RegExp(`var-${tabVar}\\.t\\..+=t2`)); // Tab: var-name.t.id=value
    expect(url).toContain(`var-${panelVar}.p.${panelId}=p1`); // Panel: var-name.p.id=value

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should handle special characters in variable names and values", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `var_with-dash_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add variable with special characters
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(variableName);
    await page.locator('[data-test="variable-custom-options"]').fill('value with space\nvalue-with-dash\nvalue_with_underscore');
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Select value with space
    const variableSelector = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await variableSelector.click();
    await page.locator('[data-test="variable-option-value with space"]').click();

    await page.waitForTimeout(1000);

    // Verify URL encoding
    const url = page.url();
    expect(url).toContain(`var-${variableName}=`);
    // Value with space should be URL encoded
    expect(url).toMatch(/value[\s%]?with[\s%]?space/);

    // Reload and verify persistence
    await page.reload();
    await page.waitForTimeout(2000);

    await expect(variableSelector.locator('[data-test="variable-selected-value"]')).toHaveText(/value with space/i);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
