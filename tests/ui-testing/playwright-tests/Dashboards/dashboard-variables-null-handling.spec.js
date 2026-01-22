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

    // // Get all text from Query Inspector dialog
    // The Query Inspector shows variable substitution in multiple places:
    // 1. The "Query" row shows the executed query with _o2_all_ instead of the variable
    // 2. The "Variable(s)" row explicitly shows: child_var_xxx: _o2_all_
    // const dialogContent = page.locator('.q-dialog').first();
    // await dialogContent.waitFor({ state: "visible", timeout: 5000 });
    // const fullText = await dialogContent.textContent();

    // // Verify that the child variable was replaced with _o2_all_
    // // When a variable has no data (null value), it should be replaced with _o2_all_ in the actual query
    // expect(fullText).toContain("_o2_all_");

    // await page
    // .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
    // .click();

  await expect(
    page.getByRole("cell", {
      name: 'SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_pod_name) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_pod_name = \'_o2_all_\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
      exact: true,
    })
  ).toBeVisible();

    // Close Query Inspector dialog
    await page.keyboard.press('Escape');
    await page.locator('.q-dialog').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

    // Clean up
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
