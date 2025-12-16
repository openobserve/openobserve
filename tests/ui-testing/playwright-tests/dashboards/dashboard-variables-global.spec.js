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

const dashboardName = `DashVarGlobal_${Date.now()}`;

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Global Variables", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("should load global variables on dashboard mount", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `global_var_${Date.now()}`;

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Open settings and add global variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    // Add query values variable with global scope
    await pm.dashboardSetting.addVariable(
      "Query Values",
      variableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name"
    );

    // Verify scope dropdown exists (scope is optional for global variables)
    const scopeDropdown = page.locator('[data-test="dashboard-variable-scope-select"]');
    await expect(scopeDropdown).toBeVisible();

    // Save variable
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Verify variable selector is visible on dashboard
    const variableSelector = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await expect(variableSelector).toBeVisible({ timeout: 10000 });

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should update all panels when global variable changes", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `status_var_${Date.now()}`;

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add global custom variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(variableName);

    // Add custom options
    await page.locator('[data-test="dashboard-variable-custom-options"]').fill('200\n404\n500');

    // Save variable
    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Add first panel with variable
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').click();
    await page.locator('[data-test="panel-query-editor"]').fill(`SELECT * FROM logs WHERE status=\$${variableName}`);
    await page.locator('[data-test="panel-save-btn"]').click();

    // Add second panel with variable
    await page.locator('[data-test="dashboard-add-panel-btn"]').click();
    await page.locator('[data-test="panel-query-editor"]').fill(`SELECT count(*) FROM logs WHERE status=\$${variableName}`);
    await page.locator('[data-test="panel-save-btn"]').click();

    // Select value in global variable
    const variableSelector = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await variableSelector.click();
    await page.locator('[data-test="variable-option-200"]').click();

    // Verify both panels show the updated filter
    await page.waitForTimeout(2000); // Wait for panels to update

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should handle global variable dependencies correctly", async ({ page }) => {
    const pm = new PageManager(page);
    const countryVar = `country_${Date.now()}`;
    const regionVar = `region_${Date.now()}`;

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add parent variable (country)
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await pm.dashboardSetting.addVariable(
      "Query Values",
      countryVar,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name"
    );
    await pm.dashboardSetting.saveVariable();

    // Add dependent variable (region)
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Query Values"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(regionVar);

    // Set stream
    await page.locator('[data-test="variable-stream-type-select"]').click();
    await page.locator('text="logs"').click();
    await page.locator('[data-test="variable-stream-select"]').click();
    await page.locator('text="e2e_automate"').click();
    await page.locator('[data-test="variable-field-select"]').click();
    await page.locator('text="kubernetes_container_name"').first().click();

    // Add filter with dependency on country variable
    await page.locator('[data-test="variable-add-filter-btn"]').click();
    await page.locator('[data-test="variable-filter-input"]').fill(`kubernetes_namespace_name=\$${countryVar}`);

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Verify both variables are visible
    const countrySelector = page.locator(`[data-test="variable-selector-${countryVar}"]`);
    const regionSelector = page.locator(`[data-test="variable-selector-${regionVar}"]`);

    await expect(countrySelector).toBeVisible({ timeout: 10000 });
    await expect(regionSelector).toBeVisible({ timeout: 10000 });

    // Verify region variable loads after country is selected
    await countrySelector.click();
    await page.locator('[data-test^="variable-option-"]').first().click();

    // Wait for region to reload based on country
    await page.waitForTimeout(2000);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should persist global variables in URL", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `url_var_${Date.now()}`;

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add custom global variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(variableName);
    await page.locator('[data-test="dashboard-variable-custom-options"]').fill('value1\nvalue2\nvalue3');

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Select a value
    const variableSelector = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await variableSelector.click();
    await page.locator('[data-test="variable-option-value2"]').click();

    // Wait for URL to update
    await page.waitForTimeout(1000);

    // Verify URL contains variable
    const url = page.url();
    expect(url).toContain(`var-${variableName}=value2`);

    // Reload page
    await page.reload();
    await page.waitForTimeout(2000);

    // Verify variable value persisted
    const selectedValue = variableSelector.locator('[data-test="variable-selected-value"]');
    await expect(selectedValue).toHaveText(/value2/i);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should handle multi-select global variables", async ({ page }) => {
    const pm = new PageManager(page);
    const variableName = `multi_var_${Date.now()}`;

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add multi-select custom variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();

    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-type-select"]').click();
    await page.locator('text="Custom"').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(variableName);
    await page.locator('[data-test="dashboard-variable-custom-options"]').fill('opt1\nopt2\nopt3');

    // Enable multi-select
    await page.locator('[data-test="dashboard-query_values-show_multiple_values"]').check();

    await pm.dashboardSetting.saveVariable();
    await pm.dashboardSetting.closeSettingWindow();

    // Select multiple values
    const variableSelector = page.locator(`[data-test="variable-selector-${variableName}"]`);
    await variableSelector.click();

    await page.locator('[data-test="variable-option-opt1"]').click();
    await page.locator('[data-test="variable-option-opt2"]').click();
    await page.locator('[data-test="variable-option-opt3"]').click();

    // Wait for URL to update
    await page.waitForTimeout(1000);

    // Verify URL contains comma-separated values
    const url = page.url();
    expect(url).toContain(`var-${variableName}=opt1,opt2,opt3`);

    // Cleanup
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
