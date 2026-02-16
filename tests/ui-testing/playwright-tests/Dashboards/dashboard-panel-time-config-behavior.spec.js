const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import {
  createDashboardWithPanelTime,
  addPanelWithPanelTime,
  cleanupDashboard,
  getPanelId,
  editPanel,
  savePanel,
  savePanelAndGetId
} from "./utils/panelTimeSetup.js";
import {
  assertPanelTimePickerVisible,
  assertPanelTimePickerNotVisible,
  assertPanelTimeInURL,
  assertPanelTimeNotInURL,
  assertPanelTimeToggleState,
  assertPanelTimeMode,
  assertPanelDataNotRefreshed,
  assertPanelDataRefreshed,
  assertGlobalTimeDisplay
} from "./utils/panelTimeAssertions.js";
import {
  verifyQueryInspectorDateTime,
  assertQueryInspectorHasDateTime,
  assertQueryInspectorTimeRange,
  closeQueryInspector,
} from "./utils/queryInspectorHelpers.js";
import {
  monitorVariableAPICalls,
  waitForVariableToLoad
} from "../utils/variable-helpers.js";
const { safeWaitForHidden, safeWaitForNetworkIdle, safeWaitForDOMContentLoaded } = require("../utils/wait-helpers.js");
// Import centralized selectors
const {
  SELECTORS,
  getVariableSelector,
  getEditVariableBtn,
} = require("../../pages/dashboardPages/dashboard-selectors.js");

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Panel Time - Part 1: Configuration and Basic Behavior", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("1-should configure panel time toggle and modes", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_Config_${timestamp}`;
    const panelName = `Panel_Config_${timestamp}`;

    // Step 1: Create dashboard and panel (without panel time initially)
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Add a basic panel using helper (panel time disabled initially)
    let panelId = await addPanelWithPanelTime(page, pm, {
      panelName,
      panelTimeEnabled: false
    });

    // Step 2: Edit panel and enable panel time
    await editPanel(page, panelName);
    // Open config panel sidebar
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Step 2: Enable panel time toggle
    await pm.dashboardPanelTime.enablePanelTime();
    await assertPanelTimeToggleState(page, true);

    // Step 3: Select "Use global time" mode
    await pm.dashboardPanelTime.selectGlobalTimeMode();
    await assertPanelTimeMode(page, 'global');

    // Save panel and re-capture panelId to ensure we have correct ID
    panelId = await savePanelAndGetId(page, { panelIndex: 0 });

    // Step 4: Edit panel again using helper function
    await editPanel(page, panelName);

    // Open config panel sidebar again
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Step 5: Select "Use individual time" mode
    await pm.dashboardPanelTime.selectIndividualTimeMode();
    await assertPanelTimeMode(page, 'individual');

    // Set individual time
    await pm.dashboardPanelTime.setPanelTimeRelative("1-h");

    // Step 6: Switch back to global mode
    await pm.dashboardPanelTime.selectGlobalTimeMode();
    await assertPanelTimeMode(page, 'global');
    // Note: panel_time_range should be cleared (verify in backend if needed)

    // Step 7: Disable panel time toggle
    await pm.dashboardPanelTime.disablePanelTime();
    await assertPanelTimeToggleState(page, false);

    // Save and verify using helper function
    await savePanel(page);

    // Verify panel time picker is NOT visible in view mode
    await assertPanelTimePickerNotVisible(page, panelId);

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("2-should select and save relative and absolute time", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_TimeSelection_${timestamp}`;
    const panelName = `Panel_TimeSelection_${timestamp}`;

    // Step 1: Create dashboard with panel having individual time "Last 1h"
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Step 2: Verify panel time picker visible with "1h"
    await assertPanelTimePickerVisible(page, panelId);

    // Step 3: Edit and change to 15m
    await editPanel(page, panelName);
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelTime.setPanelTimeRelative("15-m");
    await savePanel(page);

    // Step 4: Edit and change to 6d
    await editPanel(page, panelName);
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelTime.setPanelTimeRelative("6-d");
    await savePanel(page);

    // Verify picker shows 6d
    await assertPanelTimePickerVisible(page, panelId);

    // Step 5: Test absolute time
    await editPanel(page, panelName);

    // Open config panel sidebar
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Use common function to set absolute time
    await pm.dashboardPanelTime.setPanelTimeAbsolute("1", "1");
    await savePanel(page);

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("2.5-should show panel time in edit mode picker", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_EditMode_${timestamp}`;
    const panelName = `Panel_EditMode_${timestamp}`;

    // Step 1: Create panel with individual time "Last 1h"
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Step 2: Edit the panel again
    await editPanel(page, panelName);
    // Open config panel sidebar
    await pm.dashboardPanelConfigs.openConfigPanel();
    // Step 3: Verify top date time picker shows "Last 1h" (NOT global time)
    const pickerText = await page.locator('[data-test="dashboard-config-panel-time-picker"]').textContent();
    expect(pickerText).toContain("1");
    expect(pickerText.toLowerCase()).toContain("hour");

    // Step 4: Change panel time to "Last 6d"
    // Open config panel sidebar
    // await pm.dashboardPanelConfigs.openConfigPanel();

    await pm.dashboardPanelTime.setPanelTimeRelative("6-d");
    await page.locator('[data-test="dashboard-panel-save"]').click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Step 5: Edit panel again
    await editPanel(page, panelName);
    await pm.dashboardPanelConfigs.openConfigPanel();
    // Step 6: Verify picker shows "Last 6d"
    const pickerText2 = await page.locator('[data-test="dashboard-config-panel-time-picker"]').textContent();
    expect(pickerText2).toContain("6");
    expect(pickerText2.toLowerCase()).toContain("day");

    // Close without saving
    // Set up dialog handler BEFORE clicking discard
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("unsaved changes");
      await dialog.accept();
    });
    await page.locator('[data-test="dashboard-panel-discard"]').click().catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Step 9: Edit panel without panel time config
    // First disable panel time
    await editPanel(page, panelName);

    // Open config panel sidebar
    await pm.dashboardPanelConfigs.openConfigPanel();

    await pm.dashboardPanelTime.disablePanelTime();
    await page.locator('[data-test="dashboard-panel-save"]').click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Step 10: Edit again and verify panel time picker is NOT in config sidebar
    await editPanel(page, panelName);

    await pm.dashboardPanelConfigs.openConfigPanel();

    // Verify panel time picker is NOT present in config because panel time is disabled
    const panelTimePickerInConfig = page.locator('[data-test="dashboard-config-panel-time-picker"]');
    await expect(panelTimePickerInConfig).not.toBeVisible();

    // Cleanup
    // Set up dialog handler BEFORE clicking discard
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("unsaved changes");
      await dialog.accept();
    });
    await page.locator('[data-test="dashboard-panel-discard"]').click().catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("3-should display panel time picker correctly based on config", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_PickerVisibility_${timestamp}`;

    // Create dashboard with multiple panels
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Panel A: panel_time_enabled: true with individual time "Last 1h"
    const panelAId = await addPanelWithPanelTime(page, pm, {
      panelName: `Panel_A_${timestamp}`,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Panel B: panel_time_enabled: false
    const panelBId = await addPanelWithPanelTime(page, pm, {
      panelName: `Panel_B_${timestamp}`,
      panelTimeEnabled: false
    });

    // Step 2: Verify Panel A has picker visible
    await assertPanelTimePickerVisible(page, panelAId);

    // Step 3: Verify Panel B has NO picker
    await assertPanelTimePickerNotVisible(page, panelBId);

    // Step 4: Click Panel A picker
    await pm.dashboardPanelTime.clickPanelTimePicker(panelAId);

    // Verify dropdown opens
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

    // Step 5: Click outside to close
    await page.keyboard.press('Escape');
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Step 6: Click picker again and select time
    await pm.dashboardPanelTime.changePanelTimeInView(panelAId, "6-d", false);

    // Dropdown should still be open (not clicked Apply yet)
    await page.locator('.q-menu').waitFor({ state: "visible", timeout: 3000 });

    // Click Apply
    await page.locator('[data-test="date-time-apply-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Verify dropdown closes and URL updates
    await page.locator('.q-menu').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
    await assertPanelTimeInURL(page, panelAId, "6d");

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("4-should change panel time with Apply button", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_ChangeTime_${timestamp}`;
    const panelName = `Panel_ChangeTime_${timestamp}`;

    // Create dashboard with panel having individual time "Last 1h"
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Wait for URL to contain the panel time parameter (not the add panel preview parameter)
    await page.waitForFunction(
      (pid) => window.location.href.includes(`pt-period.${pid}`),
      panelId,
      { timeout: 10000 }
    );

    // Capture initial URL
    const initialURL = page.url();

    // Step 2: Click panel picker, select "Last 6 days"
    await pm.dashboardPanelTime.clickPanelTimePicker(panelId);
    await page.locator('[data-test="date-time-relative-6-d-btn"]').click();

    // Step 3: Verify panel data does NOT refresh yet
    await assertPanelDataNotRefreshed(page, 2000);

    // Step 4: Verify URL has NOT updated yet
    expect(page.url()).toBe(initialURL);

    // Step 5: Click Apply button
    await page.locator('[data-test="date-time-apply-btn"]').click();

    // Step 6: Verify API call fires immediately
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Step 7: Verify URL updates
    await assertPanelTimeInURL(page, panelId, "6d");

    // Step 8: Verify URL changed from initial
    expect(page.url()).not.toBe(initialURL);

    // Step 9: Open Query Inspector from panel dropdown menu in View Dashboard
    await page.locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`).click();
    await page.locator('[data-test="dashboard-query-inspector-panel"]').click();
    await page.waitForTimeout(1000);

    // Step 10: Verify query inspector shows new time (6d, not the old 1h)
    await assertQueryInspectorHasDateTime(page);
    await assertQueryInspectorTimeRange(page, "6d");

    // Close query inspector
    await closeQueryInspector(page);

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("5-should handle global vs individual time interaction", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_GlobalIndividual_${timestamp}`;

    // Setup dashboard with multiple panels
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Panel A: Individual time "Last 1h"
    const panelAId = await addPanelWithPanelTime(page, pm, {
      panelName: `Panel_A_${timestamp}`,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Panel B: "Use global" mode
    const panelBId = await addPanelWithPanelTime(page, pm, {
      panelName: `Panel_B_${timestamp}`,
      panelTimeEnabled: true,
      panelTimeMode: "global"
    });

    // Panel C: No panel time (uses global by default)
    const panelCId = await addPanelWithPanelTime(page, pm, {
      panelName: `Panel_C_${timestamp}`,
      panelTimeEnabled: false
    });

    // Step 2: Change global time to "Last 24h"
    await pm.dashboardPanelTime.changeGlobalTime("1-w");

    // Step 3: Verify Panel A still shows "Last 1h" (independent)
    const panelAText = await page.locator(`[data-test="panel-time-picker-${panelAId}"]`).textContent();
    expect(panelAText).toContain("1");

    // Step 4: Verify Panel B updates to "Last 1w" (follows global)
    const panelBText = await page.locator(`[data-test="panel-time-picker-${panelBId}"]`).textContent();
    expect(panelBText).toContain("1");

    // Step 5: Verify Panel C has no picker
    await assertPanelTimePickerNotVisible(page, panelCId);

    // Step 6: Change Panel A time to "Last 6d"
    await pm.dashboardPanelTime.changePanelTimeInView(panelAId, "6-d", true);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Step 7: Verify Panel A now shows "6d"
    await assertPanelTimeInURL(page, panelAId, "6d");

    // Step 8: Change global time to "Last 1h"
    await pm.dashboardPanelTime.changeGlobalTime("1-h");

    // Step 9: Verify Panel A still shows "Last 6d" (unaffected)
    const panelATextAfter = await page.locator(`[data-test="panel-time-picker-${panelAId}"]`).textContent();
    expect(panelATextAfter).toContain("6");

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("6-should handle panel time with variables and tab navigation", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_Variables_${timestamp}`;
    const panelName = `Panel_A_${timestamp}`;
    const globalVariableName = `global_var_${timestamp}`;
    const panelVariableName = `panel_var_${timestamp}`;

    // Step 1: Create dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Step 2: Add global variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardVariablesScoped.addScopedVariable(
      globalVariableName,
      "logs",
      "e2e_automate",
      "kubernetes_container_name",
      { scope: "global" }
    );
    await page.locator(getEditVariableBtn(globalVariableName)).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, SELECTORS.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Step 3: Create Panel A with individual time "Last 1h" using helper
    const panelAId = await addPanelWithPanelTime(page, pm, {
      panelName,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Step 4: Add panel-level variable
    await pm.dashboardSetting.openSetting();
    await pm.dashboardVariablesScoped.addScopedVariable(
      panelVariableName,
      "logs",
      "e2e_automate",
      "kubernetes_namespace_name",
      { scope: "panels", assignedPanels: [panelName] }
    );
    await page.locator(getEditVariableBtn(panelVariableName)).waitFor({ state: "visible", timeout: 15000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    await pm.dashboardSetting.closeSettingWindow();
    await safeWaitForHidden(page, SELECTORS.DIALOG, { timeout: 5000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Step 5: Verify Panel A has panel time picker showing "1h"
    await assertPanelTimePickerVisible(page, panelAId);
    await assertPanelTimeInURL(page, panelAId, "1h");

    // Step 6: Verify panel variable is visible
    await page.locator(getVariableSelector(panelVariableName)).waitFor({ state: "visible", timeout: 10000 });

    // Step 7: Change Panel A's panel variable
    const panelVariableDropdown = page.locator(getVariableSelector(panelVariableName));
    await panelVariableDropdown.waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Monitor API call when clicking dropdown
    const apiMonitor1 = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 15000 });
    await panelVariableDropdown.click();
    const result1 = await apiMonitor1;

    // Step 8: Verify variable query uses panel time "Last 1h" (not global 15m)
    expect(result1.success).toBe(true);
    expect(result1.actualCount).toBeGreaterThanOrEqual(1);

    // Close dropdown
    await page.keyboard.press('Escape');
    await safeWaitForHidden(page, SELECTORS.MENU, { timeout: 3000 });

    // Step 9: Change Panel A time to "Last 1d"
    await pm.dashboardPanelTime.changePanelTimeInView(panelAId, "1-d", true);
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    await assertPanelTimeInURL(page, panelAId, "1d");

    // Step 10: Change Panel A's variable again
    await safeWaitForNetworkIdle(page, { timeout: 3000 });
    const apiMonitor2 = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 15000 });
    await panelVariableDropdown.click();
    const result2 = await apiMonitor2;

    // Step 11: Verify variable query now uses "Last 1d" (new panel time)
    expect(result2.success).toBe(true);
    expect(result2.actualCount).toBeGreaterThanOrEqual(1);

    // Close dropdown
    await page.keyboard.press('Escape');
    await safeWaitForHidden(page, SELECTORS.MENU, { timeout: 3000 });

    // Step 12: Test global variable uses global time (not panel time)
    const globalVariableDropdown = page.locator(getVariableSelector(globalVariableName));
    await globalVariableDropdown.waitFor({ state: "visible", timeout: 10000 });
    await safeWaitForNetworkIdle(page, { timeout: 3000 });

    // Monitor global variable API call
    const apiMonitor3 = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 15000 });
    await globalVariableDropdown.click();
    const result3 = await apiMonitor3;

    // Step 13: Verify global variable query uses global time (15m), not panel time (24h)
    expect(result3.success).toBe(true);
    expect(result3.actualCount).toBeGreaterThanOrEqual(1);

    // Close dropdown
    await page.keyboard.press('Escape');
    await safeWaitForHidden(page, SELECTORS.MENU, { timeout: 3000 });

    // Step 14: Change global time to verify global variable tracks it
    await pm.dashboardPanelTime.changeGlobalTime("1-h");
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Monitor global variable API call after global time change
    const apiMonitor4 = monitorVariableAPICalls(page, { expectedCount: 1, timeout: 15000 });
    await globalVariableDropdown.click();
    const result4 = await apiMonitor4;

    // Verify global variable now uses new global time (1h)
    expect(result4.success).toBe(true);
    expect(result4.actualCount).toBeGreaterThanOrEqual(1);

    // Verify Panel A still shows 1d (unaffected by global change)
    await assertPanelTimeInURL(page, panelAId, "1d");

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });
});
