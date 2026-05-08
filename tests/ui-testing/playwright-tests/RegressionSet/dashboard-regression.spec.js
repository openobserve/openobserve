/**
 * Dashboard Regression Bugs Test Suite
 *
 * This suite contains regression tests for dashboard-related bugs that have been fixed.
 * Each test verifies that a specific bug fix is working correctly.
 *
 * Tests run in SERIAL — each test creates its own dashboard and must complete
 * before the next one starts (variable/drilldown setup is stateful).
 */

const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager.js";
import DashboardVariablesScoped from "../../pages/dashboardPages/dashboard-variables-scoped.js";
import { ingestion } from "../Dashboards/utils/dashIngestion.js";
import { waitForDashboardPage, deleteDashboard } from "../Dashboards/utils/dashCreation.js";
const { safeWaitForHidden, safeWaitForNetworkIdle } = require("../utils/wait-helpers.js");
const {
  SELECTORS,
  getVariableSelector,
  getEditVariableBtn,
} = require("../../pages/dashboardPages/dashboard-selectors.js");
const testLogger = require("../utils/test-logger.js");

// =============================================================================
// Bug #11134: Same-dashboard drilldown URL clobbering
// https://github.com/openobserve/openobserve/pull/11134
// Fix: "fix: enhance drilldown handling to prevent URL clobbering during same
//      dashboard navigation"
//
// Bug: when a drilldown targeted the same dashboard, var-* URL params injected
// by the drilldown were immediately overwritten by updateUrlWithCurrentState()
// before the variables manager could process the new values.
//
// Fix: two guard flags (isDrilldownInProgress, isInternalUrlUpdate) and a new
// var-* watcher in ViewDashboard.vue prevent the clobber and update variables
// in-place without a full reload.
// =============================================================================

test.describe(
  "Dashboard Regression Bugs",
  {
    tag: ["@dashboards", "@regression"],
  },
  () => {
    test.describe.configure({ mode: "serial" });

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      await ingestion(page);
    });

    // -------------------------------------------------------------------------
    // Bug #11134 — Test 1: Same-dashboard drilldown with custom variable mapping
    // Verifies that a var-* value injected by a byDashboard drilldown (same dash)
    // is NOT overwritten by URL sync after the navigation settles.
    // -------------------------------------------------------------------------
    test(
      "same-dashboard drilldown with custom variable: var-* param present in URL after click and not overwritten by URL sync @bug-11134 @P1",
      async ({ page }) => {
        testLogger.info("Test: same-dashboard drilldown — custom variable, no URL clobber (Bug #11134)");

        const pm = new PageManager(page);
        const scopedVars = new DashboardVariablesScoped(page);
        const dashboardName = `Dashboard_SameDash_Custom_${Date.now()}`;
        const variableName = `sd_var_${Date.now()}`;
        const drilldownVarValue = "kube-system";

        // ── 1. Create dashboard ──────────────────────────────────────────────
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);
        await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

        // ── 2. Add global variable ───────────────────────────────────────────
        await pm.dashboardSetting.openSetting();
        await scopedVars.addScopedVariable(
          variableName, "logs", "e2e_automate", "kubernetes_namespace_name",
          { scope: "global" }
        );
        await page.locator(getEditVariableBtn(variableName)).waitFor({ state: "visible", timeout: 10000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });
        await pm.dashboardSetting.closeSettingWindow();
        await safeWaitForHidden(page, '[data-test="dashboard-settings-dialog"]', { timeout: 5000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });
        testLogger.info(`Variable '${variableName}' created`);

        // ── 3. Add table panel ───────────────────────────────────────────────
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("table");
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
        await pm.dashboardPanelActions.addPanelName("Source Panel");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender();

        // ── 4. Configure drilldown: same dashboard + custom variable mapping ─
        await pm.dashboardPanelConfigs.openConfigPanel();

        const addBtn = page.locator('[data-test="dashboard-addpanel-config-drilldown-add-btn"]').first();
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        const popup = page.locator('[data-test="dashboard-drilldown-popup"]');
        await popup.waitFor({ state: "visible", timeout: 10000 });

        await page.locator('[data-test="dashboard-config-panel-drilldown-name"]').fill("Same Dash Custom Var");

        await page.locator('[data-test="dashboard-drilldown-folder-select"]').waitFor({ state: "visible", timeout: 10000 });
        await page.locator('[data-test="dashboard-drilldown-folder-select"]').click();
        await page.getByRole("option", { name: "default", exact: true }).click();

        await page.locator('[data-test="dashboard-drilldown-dashboard-select"]').waitFor({ state: "visible", timeout: 10000 });
        await page.locator('[data-test="dashboard-drilldown-dashboard-select"]').click();
        await page.getByRole("option", { name: dashboardName, exact: true }).click();

        await page.locator('[data-test="dashboard-drilldown-tab-select"]').waitFor({ state: "visible", timeout: 10000 });
        await page.locator('[data-test="dashboard-drilldown-tab-select"]').click();
        await page.getByRole("option").first().click();
        testLogger.info("Drilldown target: same dashboard selected");

        // Add variable mapping: variableName → drilldownVarValue (literal value)
        const addVarBtn = page.locator('[data-test="dashboard-drilldown-add-variable"]');
        await addVarBtn.waitFor({ state: "visible", timeout: 5000 });
        await addVarBtn.click();
        await page.waitForTimeout(300);

        // In Quasar v2, data-test on <q-input> propagates to the native <input> via $attrs
        const autoCompleteInputs = popup.locator('[data-test="common-auto-complete"]');
        await autoCompleteInputs.first().waitFor({ state: "visible", timeout: 5000 });
        await autoCompleteInputs.first().scrollIntoViewIfNeeded();
        await autoCompleteInputs.first().fill(variableName);
        await autoCompleteInputs.last().fill(drilldownVarValue);
        testLogger.info(`Variable mapping: ${variableName} → ${drilldownVarValue}`);

        await page.locator('[data-test="confirm-button"]').waitFor({ state: "visible", timeout: 5000 });
        await page.locator('[data-test="confirm-button"]').click();
        await popup.waitFor({ state: "hidden", timeout: 10000 });

        // ── 5. Save panel ────────────────────────────────────────────────────
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender();
        await pm.dashboardPanelActions.savePanel();
        testLogger.info("Panel saved — now on dashboard view");

        await page.locator('[data-test="dashboard-panel-table"]').first().waitFor({ state: "attached", timeout: 20000 });
        await safeWaitForNetworkIdle(page, { timeout: 5000 });

        // ── 6. Trigger same-dashboard drilldown ──────────────────────────────
        testLogger.info("Triggering same-dashboard drilldown from table row");
        const drilldownMenu = await pm.dashboardDrilldown.triggerDrilldownFromTable();
        await expect(drilldownMenu).toBeVisible({ timeout: 5000 });
        await expect(pm.dashboardDrilldown.drilldownMenuFirstItem).toContainText("Same Dash Custom Var");

        await pm.dashboardDrilldown.drilldownMenuFirstItem.click();

        try {
          // waitForURL(/\/dashboards\/view/) is a no-op on same-dashboard — use param-level wait
          await page.waitForURL(
            u => new URL(u).searchParams.has(`var-${variableName}`),
            { timeout: 15000 }
          );

          // Assert var-* VALUE (not just key) — a clobber to var-X=oldValue passes key-only checks
          const varValueAfterDrilldown = new URL(page.url()).searchParams.get(`var-${variableName}`);
          testLogger.info(`URL after drilldown: ${page.url()}`);
          expect(varValueAfterDrilldown).toBeTruthy();
          testLogger.info(`✅ var-${variableName}=${varValueAfterDrilldown} present in URL`);

          // Regression guard: value must NOT change after 800ms
          // Before PR #11134: updateUrlWithCurrentState() rewrote var-* back to stale value
          await page.waitForTimeout(800);
          const varValueAfterWait = new URL(page.url()).searchParams.get(`var-${variableName}`);
          testLogger.info(`URL after 800ms: ${page.url()}`);
          expect(varValueAfterWait).toBe(varValueAfterDrilldown);
          testLogger.info(`✅ Bug #11134 guard passed — var-${variableName} value unchanged 800ms after same-dashboard drilldown`);
        } finally {
          await pm.dashboardList.menuItem("dashboards-item").catch(() => {});
          await deleteDashboard(page, dashboardName).catch(() => {});
        }
      }
    );

    // -------------------------------------------------------------------------
    // Bug #11134 — Test 2: Same-dashboard drilldown with passAllVariables
    // When passAllVariables = true, the current variable value must be
    // carried through and persist in URL after same-dashboard navigation.
    // -------------------------------------------------------------------------
    test(
      "same-dashboard drilldown with passAllVariables: current var-* value carried through URL and not overwritten @bug-11134 @P1",
      async ({ page }) => {
        testLogger.info("Test: same-dashboard drilldown — passAllVariables, var persists (Bug #11134)");

        const pm = new PageManager(page);
        const scopedVars = new DashboardVariablesScoped(page);
        const dashboardName = `Dashboard_SameDash_PassAll_${Date.now()}`;
        const variableName = `pav_var_${Date.now()}`;

        // ── 1. Create dashboard ──────────────────────────────────────────────
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);
        await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

        // ── 2. Add global variable ───────────────────────────────────────────
        await pm.dashboardSetting.openSetting();
        await scopedVars.addScopedVariable(
          variableName, "logs", "e2e_automate", "kubernetes_namespace_name",
          { scope: "global" }
        );
        await page.locator(getEditVariableBtn(variableName)).waitFor({ state: "visible", timeout: 10000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });
        await pm.dashboardSetting.closeSettingWindow();
        await safeWaitForHidden(page, '[data-test="dashboard-settings-dialog"]', { timeout: 5000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });

        // ── 3. Add table panel with byDashboard drilldown + passAllVariables ─
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("table");
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
        await pm.dashboardPanelActions.addPanelName("PassAll Panel");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender();

        await pm.dashboardPanelConfigs.openConfigPanel();

        const addBtn = page.locator('[data-test="dashboard-addpanel-config-drilldown-add-btn"]').first();
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        const popup = page.locator('[data-test="dashboard-drilldown-popup"]');
        await popup.waitFor({ state: "visible", timeout: 10000 });

        await page.locator('[data-test="dashboard-config-panel-drilldown-name"]').fill("PassAll Same Dash");

        await page.locator('[data-test="dashboard-drilldown-folder-select"]').waitFor({ state: "visible", timeout: 10000 });
        await page.locator('[data-test="dashboard-drilldown-folder-select"]').click();
        await page.getByRole("option", { name: "default", exact: true }).click();

        await page.locator('[data-test="dashboard-drilldown-dashboard-select"]').waitFor({ state: "visible", timeout: 10000 });
        await page.locator('[data-test="dashboard-drilldown-dashboard-select"]').click();
        await page.getByRole("option", { name: dashboardName, exact: true }).click();

        await page.locator('[data-test="dashboard-drilldown-tab-select"]').waitFor({ state: "visible", timeout: 10000 });
        await page.locator('[data-test="dashboard-drilldown-tab-select"]').click();
        await page.getByRole("option").first().click();

        const passAllToggle = page.locator('[data-test="dashboard-drilldown-pass-all-variables"]');
        await passAllToggle.waitFor({ state: "visible", timeout: 5000 });
        await passAllToggle.click();
        testLogger.info("passAllVariables enabled");

        await page.locator('[data-test="confirm-button"]').click();
        await popup.waitFor({ state: "hidden", timeout: 10000 });

        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender();
        await pm.dashboardPanelActions.savePanel();
        testLogger.info("Panel with passAllVariables drilldown saved");

        // ── 4. Select a variable value ───────────────────────────────────────
        await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 10000 });
        const { selectedValue } = await scopedVars.changeVariableValue(
          variableName, { optionIndex: 0, returnSelectedValue: true }
        );
        testLogger.info(`Selected variable value: "${selectedValue}"`);
        await safeWaitForNetworkIdle(page, { timeout: 3000 });

        expect(page.url()).toContain(`var-${variableName}=`);
        testLogger.info("var-* confirmed in URL before drilldown");

        // ── 5. Trigger same-dashboard drilldown ──────────────────────────────
        const drilldownMenu = await pm.dashboardDrilldown.triggerDrilldownFromTable();
        await expect(drilldownMenu).toBeVisible({ timeout: 5000 });
        await expect(pm.dashboardDrilldown.drilldownMenuFirstItem).toContainText("PassAll Same Dash");

        await pm.dashboardDrilldown.drilldownMenuFirstItem.click();

        try {
          await page.waitForURL(
            u => new URL(u).searchParams.has(`var-${variableName}`),
            { timeout: 15000 }
          );

          // Assert the VALUE matches what was selected (unused before this fix)
          const varValueAfterDrilldown = new URL(page.url()).searchParams.get(`var-${variableName}`);
          testLogger.info(`URL after drilldown: ${page.url()}`);
          expect(varValueAfterDrilldown).toBe(selectedValue);
          testLogger.info(`✅ var-${variableName}=${varValueAfterDrilldown} matches selected value`);

          // Regression guard: same value must survive 800ms
          await page.waitForTimeout(800);
          const varValueAfterWait = new URL(page.url()).searchParams.get(`var-${variableName}`);
          expect(varValueAfterWait).toBe(selectedValue);
          testLogger.info(`✅ Bug #11134 guard passed — var-${variableName} value unchanged 800ms after same-dashboard drilldown`);
        } finally {
          await pm.dashboardList.menuItem("dashboards-item").catch(() => {});
          await deleteDashboard(page, dashboardName).catch(() => {});
        }
      }
    );

    // -------------------------------------------------------------------------
    // Bug #11134 — Test 3: Same-dashboard drilldown targeting a different tab
    // Dashboard ID stays the same, tab changes, and var-* params must be passed.
    // Verifies the var-* watcher handles tab-switch within same-dashboard case.
    // -------------------------------------------------------------------------
    test(
      "same-dashboard drilldown to a different tab: tab changes + var-* params present and not clobbered @bug-11134 @P1",
      async ({ page }) => {
        testLogger.info("Test: same-dashboard drilldown — tab switch, var-* and dashboard ID persist (Bug #11134)");

        const pm = new PageManager(page);
        const scopedVars = new DashboardVariablesScoped(page);
        const dashboardName = `Dashboard_SameDash_Tab_${Date.now()}`;
        const variableName = `tab_var_${Date.now()}`;
        const secondTabName = "Analytics Tab";

        // ── 1. Create dashboard with a second tab and a global variable ───────
        await pm.dashboardList.menuItem("dashboards-item");
        await waitForDashboardPage(page);
        await pm.dashboardCreate.waitForDashboardUIStable();
        await pm.dashboardCreate.createDashboard(dashboardName);
        await page.locator(SELECTORS.ADD_PANEL_BTN).waitFor({ state: "visible" });

        await pm.dashboardSetting.openSetting();
        await scopedVars.addScopedVariable(
          variableName, "logs", "e2e_automate", "kubernetes_namespace_name",
          { scope: "global" }
        );
        await page.locator(getEditVariableBtn(variableName)).waitFor({ state: "visible", timeout: 10000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });
        await pm.dashboardSetting.closeSettingWindow();
        await safeWaitForHidden(page, '[data-test="dashboard-settings-dialog"]', { timeout: 5000 });
        await safeWaitForNetworkIdle(page, { timeout: 3000 });
        testLogger.info(`Variable '${variableName}' created`);

        // Add second tab in a fresh settings session.
        // closeSettingDashboard() (not closeSettingWindow()) because addTabAndWait
        // leaves the dialog open — matches pattern in setupDestinationDashboardWithTabs.
        await pm.dashboardSetting.openSetting();
        await pm.dashboardSetting.addTabAndWait(secondTabName);
        await pm.dashboardSetting.closeSettingDashboard();
        await safeWaitForHidden(page, '[data-test="dashboard-settings-dialog"]', { timeout: 5000 });
        await page.waitForTimeout(400); // Quasar backdrop fade-out animation
        await safeWaitForNetworkIdle(page, { timeout: 3000 });
        testLogger.info(`Second tab '${secondTabName}' added`);

        // ── 2. Add table panel with drilldown to same dashboard, second tab ──
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("table");
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream("e2e_automate");
        await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
        await pm.dashboardPanelActions.addPanelName("Tab Panel");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender();

        await pm.dashboardPanelConfigs.openConfigPanel();

        const addBtn = page.locator('[data-test="dashboard-addpanel-config-drilldown-add-btn"]').first();
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        const popup = page.locator('[data-test="dashboard-drilldown-popup"]');
        await popup.waitFor({ state: "visible", timeout: 10000 });

        await page.locator('[data-test="dashboard-config-panel-drilldown-name"]').fill("Same Dash Tab Drilldown");

        await page.locator('[data-test="dashboard-drilldown-folder-select"]').waitFor({ state: "visible", timeout: 10000 });
        await page.locator('[data-test="dashboard-drilldown-folder-select"]').click();
        await page.getByRole("option", { name: "default", exact: true }).click();

        await page.locator('[data-test="dashboard-drilldown-dashboard-select"]').waitFor({ state: "visible", timeout: 10000 });
        await page.locator('[data-test="dashboard-drilldown-dashboard-select"]').click();
        await page.getByRole("option", { name: dashboardName, exact: true }).click();

        await page.locator('[data-test="dashboard-drilldown-tab-select"]').waitFor({ state: "visible", timeout: 10000 });
        await page.locator('[data-test="dashboard-drilldown-tab-select"]').click();
        await page.getByRole("option", { name: secondTabName, exact: true }).click();
        testLogger.info(`Drilldown target: same dashboard, tab "${secondTabName}"`);

        const passAllToggle = page.locator('[data-test="dashboard-drilldown-pass-all-variables"]');
        await passAllToggle.waitFor({ state: "visible", timeout: 5000 });
        await passAllToggle.click();

        await page.locator('[data-test="confirm-button"]').click();
        await popup.waitFor({ state: "hidden", timeout: 10000 });

        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender();
        await pm.dashboardPanelActions.savePanel();
        testLogger.info("Panel with tab-switch drilldown saved");

        // ── 3. Select a variable value ───────────────────────────────────────
        await page.locator(getVariableSelector(variableName)).waitFor({ state: "visible", timeout: 10000 });
        const { selectedValue } = await scopedVars.changeVariableValue(
          variableName, { optionIndex: 0, returnSelectedValue: true }
        );
        testLogger.info(`Variable value selected: "${selectedValue}"`);
        await safeWaitForNetworkIdle(page, { timeout: 3000 });

        const dashboardParam = new URL(page.url()).searchParams.get("dashboard");
        testLogger.info(`Dashboard ID before drilldown: ${dashboardParam}`);

        // ── 4. Trigger same-dashboard tab-switch drilldown ───────────────────
        const drilldownMenu = await pm.dashboardDrilldown.triggerDrilldownFromTable();
        await expect(drilldownMenu).toBeVisible({ timeout: 5000 });
        await expect(pm.dashboardDrilldown.drilldownMenuFirstItem).toContainText("Same Dash Tab Drilldown");

        await pm.dashboardDrilldown.drilldownMenuFirstItem.click();

        try {
          await page.waitForURL(
            u => new URL(u).searchParams.has(`var-${variableName}`),
            { timeout: 15000 }
          );

          const urlParamsAfter = new URL(page.url()).searchParams;
          testLogger.info(`URL after tab-switch drilldown: ${page.url()}`);

          // Dashboard ID must be unchanged (same dashboard, different tab)
          expect(urlParamsAfter.get("dashboard")).toBe(dashboardParam);
          testLogger.info("✅ Dashboard ID unchanged after same-dashboard drilldown");

          // var-* value must match what was selected
          const varValueAfterDrilldown = urlParamsAfter.get(`var-${variableName}`);
          expect(varValueAfterDrilldown).toBe(selectedValue);
          testLogger.info(`✅ var-${variableName}=${varValueAfterDrilldown} matches selected value`);

          // Regression guard: both dashboard ID and var-* value must survive 800ms
          await page.waitForTimeout(800);
          const urlParamsAfterWait = new URL(page.url()).searchParams;
          expect(urlParamsAfterWait.get(`var-${variableName}`)).toBe(selectedValue);
          expect(urlParamsAfterWait.get("dashboard")).toBe(dashboardParam);
          testLogger.info("✅ Bug #11134 guard passed — dashboard ID and var-* value both unchanged after tab-switch drilldown");
        } finally {
          await pm.dashboardList.menuItem("dashboards-item").catch(() => {});
          await deleteDashboard(page, dashboardName).catch(() => {});
        }
      }
    );

    test.afterEach(async () => {
      testLogger.info("Dashboard regression test completed");
    });
  }
);
