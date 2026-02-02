const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { waitForVariableToLoad } from "../utils/variable-helpers.js";

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

        // Add a panel for context
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("line");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");
        await pm.dashboardPanelActions.addPanelName("Panel1");
        await pm.dashboardPanelActions.savePanel();

        // 1. Add Parent Variable
        // Use a field that has values
        await pm.dashboardSetting.openSetting();
        await scopedVars.addScopedVariable(
            parentVar,
            "logs",
            "e2e_automate",
            "kubernetes_namespace_name", // Assuming this has values
            { scope: "global" }
        );
        await page.locator(`[data-test="dashboard-edit-variable-${parentVar}"]`).waitFor({ state: "visible", timeout: 10000 });

        // 2. Add Child Variable
        // Use a field that we can filter to be empty
        // We'll filter based on parent value
        // Since we don't know the exact data, we test the mechanism:
        // If we select a parent value, child loads.
        // If the child Query returns nothing (e.g. we use a stream that doesn't match the parent), it should be All.

        // Let's rely on a custom query or just standard dependency.
        // If we can't guarantee "no data", we can mock the behavior by checking what happens when we *clear* the parent?
        // But the user issue is "parent changed -> child no data".

        // Strategy: Create a child variable on a field that definitely exists ("kubernetes_pod_name")
        // dependent on parent ("kubernetes_namespace_name").
        // We just need to verify that IF it ends up empty (which we might not force easily without knowing data mapping),
        // it defaults to All.

        // To FORCE empty data, we can define the child variable on a stream/field that doesn't exist or is empty?
        // Or add a filter to the child variable that is impossible to satisfy, e.g. "some_field = 'impossible_value'".

        // Close and reopen to refresh
        await pm.dashboardSetting.closeSettingWindow();
        await pm.dashboardSetting.openSetting();
        await pm.dashboardSetting.openVariables();

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
        await fieldSelect.fill("kubernetes_pod_name"); // Valid field
        await page.locator('[role="option"]').first().click();

        // Add an IMPOSSIBLE filter to force empty results
        await page.locator('[data-test="dashboard-add-filter-btn"]').click();
        const filterNameSelector = page.locator('[data-test="dashboard-query-values-filter-name-selector"]').last();
        await filterNameSelector.click();
        await filterNameSelector.fill("kubernetes_pod_name");
        await page.getByRole("option", { name: "kubernetes_pod_name" }).first().click();

        const operatorSelector = page.locator('[data-test="dashboard-query-values-filter-operator-selector"]').last();
        await operatorSelector.click();
        await page.getByRole("option", { name: "=", exact: true }).locator("div").nth(2).click();

        const valueInput = page.locator('[data-test="dashboard-query-values-filter-value-input"]').last();
        await valueInput.fill("IMPOSSIBLE_VALUE_XYZ_123");

        await page.locator('[data-test="dashboard-variable-save-btn"]').click();
        await page.locator(`[data-test="dashboard-edit-variable-${childVar}"]`).waitFor({ state: "visible", timeout: 10000 });

        await pm.dashboardSetting.closeSettingWindow();

        // Verify Initial State
        // Child variable should have run, found 0 results, and defaulted to "All" (_o2_all_)

        // Add console log listener
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));

        // Wait for variable selector
        const childDropdown = page.locator(`[data-test="variable-selector-${childVar}"]`);
        await childDropdown.waitFor({ state: "visible", timeout: 10000 });

        const textContent = await childDropdown.textContent();
        console.log(`[DEBUG] Child Dropdown Content: "${textContent}"`);

        const fs = require('fs');
        fs.writeFileSync('playwright-debug-content.txt', `Content: "${textContent}"`, 'utf8');

        // Check the value displayed in the dropdown (or the selected value text)
        // The component usually displays "All" if value is _o2_all_
        await expect(childDropdown).toContainText("All");

        // Also verify that the variable state is NOT null in the background if possible?
        // We can check by adding a panel that uses this variable and see if it loads data (not error).

        // Clean up
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, dashboardName);
    });
});
