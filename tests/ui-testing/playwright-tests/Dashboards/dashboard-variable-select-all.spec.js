/**
 * Dashboard Variable Select All
 * Tests the "Select All" / "All" master row in a dashboard query_values variable
 * dropdown: multi-select shows a checkbox + "Select All" above the separator,
 * single-select shows a plain "All" that closes the popover immediately.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require('../utils/test-logger.js');
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";

/**
 * Create a per-test dashboard and a query_values variable over the shared
 * e2e_automate stream, ready for its dropdown to be exercised.
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} options - Options
 * @param {boolean} options.multiSelect - Enable "Show multiple values" (default true)
 */
async function setupSelectAllVariable(page, { multiSelect = true } = {}) {
  const pm = new PageManager(page);
  const scopedVars = new DashboardVariablesScoped(page);
  const dashboardName = `Dashboard_SelectAll_${Date.now()}`;
  const varName = `sel_all_${Date.now()}`;

  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();
  await pm.dashboardCreate.createDashboard(dashboardName);

  await scopedVars.getAddPanelBtnLocator().waitFor({ state: "visible", timeout: 30000 });

  await pm.dashboardSetting.openSetting();
  await pm.dashboardSetting.openVariables();
  await scopedVars.addScopedVariable(
    varName,
    "logs",
    "e2e_automate",
    "kubernetes_namespace_name",
    { scope: "global", ...(multiSelect ? { showMultipleValues: true } : {}) }
  );
  await pm.dashboardSetting.closeSettingWindow();

  await scopedVars.getVariableSelectorLocator(varName).waitFor({ state: "visible", timeout: 10000 });

  return { pm, scopedVars, dashboardName, varName };
}

test.describe("Dashboard Variable Select All testcases", { tag: ['@dashboard-variable-select-all', '@dashboards', '@dashboardVariables', '@all'] }, () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
  });

  test("should render the multi-select 'Select All' master row and select all values", async ({ page }) => {
    const { pm, scopedVars, dashboardName, varName } = await setupSelectAllVariable(page);

    await scopedVars.openVariableSelectAllDropdown(varName);
    await expect(scopedVars.getVariableSelectAllSeparatorLocator(varName)).toBeVisible();

    await scopedVars.toggleVariableSelectAll(varName);

    await expect(scopedVars.getVariableSelectAllCheckboxLocator(varName)).toHaveAttribute("aria-checked", "true");
    await expect(scopedVars.getVariableInnerValueLocator(varName)).toContainText("ALL");
    // Multi-select "Select All" does not close the popover.
    await expect(scopedVars.getVariablePopoverLocator(varName)).toBeVisible();

    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should clear the selection when 'Select All' is toggled off", async ({ page }) => {
    const { pm, scopedVars, dashboardName, varName } = await setupSelectAllVariable(page);

    await scopedVars.openVariableSelectAllDropdown(varName);
    await scopedVars.toggleVariableSelectAll(varName);
    await expect(scopedVars.getVariableSelectAllCheckboxLocator(varName)).toHaveAttribute("aria-checked", "true");

    await scopedVars.toggleVariableSelectAll(varName);

    await expect(scopedVars.getVariableSelectAllCheckboxLocator(varName)).toHaveAttribute("aria-checked", "false");
    await expect(scopedVars.getVariableInnerValueLocator(varName)).not.toContainText("ALL");

    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should select all and close the popover via the single-select 'All' row", async ({ page }) => {
    const { pm, scopedVars, dashboardName, varName } = await setupSelectAllVariable(page, { multiSelect: false });

    await scopedVars.openVariableSelectAllDropdown(varName);
    await expect(scopedVars.getVariableAllTextLocator(varName)).toBeVisible();
    await expect(scopedVars.getVariableSelectAllCheckboxLocator(varName)).toHaveCount(0);

    await scopedVars.clickVariableAll(varName);

    await expect(scopedVars.getVariableInnerValueLocator(varName)).toContainText("ALL");
    // Single-select closes the popover immediately after setting the value.
    await scopedVars.waitForVariablePopoverHidden(varName);

    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should auto-check 'Select All' when every option is hand-ticked", async ({ page }) => {
    const { pm, scopedVars, dashboardName, varName } = await setupSelectAllVariable(page);

    await scopedVars.openVariableSelectAllDropdown(varName);
    await scopedVars.selectEveryOptionIndividually(varName);

    await expect(scopedVars.getVariableSelectAllCheckboxLocator(varName)).toHaveAttribute("aria-checked", "true");

    await pm.dashboardVariables.closeVariableDropdown(varName);
    // Hand-ticking keeps an explicit value list, never the "<ALL>" sentinel.
    await expect(scopedVars.getVariableInnerValueLocator(varName)).not.toContainText("ALL");

    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should uncheck 'Select All' when one option is unticked", async ({ page }) => {
    const { pm, scopedVars, dashboardName, varName } = await setupSelectAllVariable(page);

    await scopedVars.openVariableSelectAllDropdown(varName);
    await scopedVars.selectEveryOptionIndividually(varName);
    await expect(scopedVars.getVariableSelectAllCheckboxLocator(varName)).toHaveAttribute("aria-checked", "true");

    await scopedVars.clickVariableOptionByIndex(varName, 0);

    await expect(scopedVars.getVariableSelectAllCheckboxLocator(varName)).toHaveAttribute("aria-checked", "false");

    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
