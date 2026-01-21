const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { waitForVariableToLoad } from "../utils/variable-helpers.js";

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Variables - Null Handling", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("1-should set child variable to All when parent variable causes empty options", async ({ page }) => {
    const pm = new PageManager(page);
    const scopedVars = new DashboardVariablesScoped(page);
    const dashboardName = `Dashboard_NullHandling_${Date.now()}`;
    const parentVar = `parent_var_${Date.now()}`;
    const childVar = `child_var_${Date.now()}`;

    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);

    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

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

    // Reopen settings to add child variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.openVariables();
    // Wait for variable to be saved and visible in settings
    await page.locator(`[data-test="dashboard-edit-variable-${parentVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Add Child Variable with an impossible filter to force empty results
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill(childVar);
    await page.locator('[data-test="dashboard-variable-stream-type-select"]').click();
    await page.getByRole("option", { name: "logs", exact: true }).click();

    const streamSelect = page.locator('[data-test="dashboard-variable-stream-select"]');
    await streamSelect.click();
    await streamSelect.fill("e2e_automate");
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();

    const fieldSelect = page.locator('[data-test="dashboard-variable-field-select"]');
    await fieldSelect.click();
    await page.keyboard.type("kubernetes_pod_name", { delay: 100 });
    await page.waitForFunction(
      () => document.querySelectorAll('[role="option"]').length > 0,
      { timeout: 10000, polling: 100 }
    );
    await page.locator('[role="option"]').first().click();

    // Add an IMPOSSIBLE filter to force empty results
    await page.locator('[data-test="dashboard-add-filter-btn"]').click();

    const filterNameSelector = page.locator('[data-test="dashboard-query-values-filter-name-selector"]').last();
    await filterNameSelector.waitFor({ state: "visible", timeout: 5000 });
    await filterNameSelector.click();
    await filterNameSelector.fill("kubernetes_pod_name");
    await page.getByRole("option", { name: "kubernetes_pod_name" }).first().click();

    const operatorSelector = page.locator('[data-test="dashboard-query-values-filter-operator-selector"]').last();
    await operatorSelector.click();
    await page.getByRole("option", { name: "=", exact: true }).locator("div").nth(2).click();

    // Use parent variable in the filter - this will cause child to have no matching data
    const valueInput = page.locator('[data-test="common-auto-complete"]').last();
    await valueInput.waitFor({ state: "visible", timeout: 5000 });
    await valueInput.fill(`$${parentVar}`);

    await page.locator('[data-test="dashboard-variable-save-btn"]').click();
    await page.locator(`[data-test="dashboard-edit-variable-${childVar}"]`).waitFor({ state: "visible", timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await pm.dashboardSetting.closeSettingWindow();

    // Wait for settings dialog to be fully closed
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Verify child variable appears on dashboard
    const childDropdown = page.locator(`[data-test="variable-selector-${childVar}"]`);
    await childDropdown.waitFor({ state: "visible", timeout: 10000 });

    // Wait for network to be idle before interacting with variable
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Click the variable dropdown to see options
    await childDropdown.click();

    // Wait for dropdown menu to appear
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

    // When a variable query returns no results, it should show "No Data Found"
    const noDataText = page.getByText("No Data Found", { exact: true });
    await expect(noDataText).toBeVisible({ timeout: 5000 });

    // Close the dropdown
    await page.keyboard.press('Escape');
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Create a panel and use the child variable in a filter
    // The variable should be replaced with _o2_all_ in the panel
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream("e2e_automate");
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
    await page.locator('[data-test*="dashboard-panel-"]').first().waitFor({ state: "visible", timeout: 15000 });

    // Verify panel renders without errors (despite the variable having no data)
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Open Query Inspector to verify child variable was replaced with _o2_all_
    // Hover over panel to make dropdown visible
    await page.locator('[data-test="dashboard-panel-container"]').first().hover();
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Use page object method to open query inspector
    await pm.dashboardPanelEdit.openQueryInspector("Panel1");

    // Wait for Query Inspector dialog to open and load content
    await page.locator('.q-dialog').waitFor({ state: "visible", timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Get all text from Query Inspector dialog
    // The Query Inspector shows variable substitution in multiple places:
    // 1. The "Query" row shows the executed query with _o2_all_ instead of the variable
    // 2. The "Variable(s)" row explicitly shows: child_var_xxx: _o2_all_
    const dialogContent = page.locator('.q-dialog').first();
    await dialogContent.waitFor({ state: "visible", timeout: 5000 });
    const fullText = await dialogContent.textContent();

    // Verify that the child variable was replaced with _o2_all_
    // When a variable has no data (null value), it should be replaced with _o2_all_ in the actual query
    expect(fullText).toContain("_o2_all_");

    // Close Query Inspector dialog
    await page.keyboard.press('Escape');
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

    // Clean up
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
