const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import DashboardVariables from "../../pages/dashboardPages/dashboard-variables.js";
import {
  createDashboardWithPanelTime,
  addPanelWithPanelTime,
  cleanupDashboard,
  editPanel,
  savePanel,
  getPanelId,
} from "./utils/panelTimeSetup.js";
import { waitForDashboardPage } from "./utils/dashCreation.js";
import {
  assertPanelTimePickerVisible,
  assertPanelTimeInURL,
} from "./utils/panelTimeAssertions.js";
import {
  monitorVariableAPICalls,
  waitForVariableToLoad
} from "../utils/variable-helpers.js";

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Panel Time - Variables Time Behavior", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("25-should use global time (NOT panel config) for variables in Add Panel mode (v4.0)", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardVariables = new DashboardVariables(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_VarAddPanelConfig_${timestamp}`;
    const panelName = `Panel_VarAddPanelConfig_${timestamp}`;
    const variableName = `var_${timestamp}`;

    // Step 1: Navigate to dashboards and create dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({
      state: "visible",
      timeout: 10000
    });

    // Step 2: Add a query-based variable to the dashboard
    await dashboardVariables.addQueryVariable(variableName);

    // Wait for dashboard to be ready after variable addition
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({
      state: "visible",
      timeout: 10000
    });

    // Step 3: Add panel with useDefaultTime enabled and panel_time_range set to "Last 1h"
    // This config is for VIEW MODE ONLY in v4.0
    const panelId = await addPanelWithPanelTime(page, pm, {
      panelName,
      panelTimeEnabled: true,
      panelTimeRange: "1-h"
    });

    // Verify panel has time picker with 1h in view mode
    await assertPanelTimePickerVisible(page, panelId);
    await assertPanelTimeInURL(page, panelId, "1h");

    // Wait for panel to be fully rendered (longer timeout for parallel execution)
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Step 4: Edit the panel
    await editPanel(page, panelName);

    // Step 5: Change global time to "Last 6d" and apply
    // v4.0 CRITICAL: In add/edit mode, variables use GLOBAL time, not panel config
    await pm.dashboardPanelTime.changeGlobalTime('6-d');

    // Step 6: Set up API monitoring to capture variable values request
    const monitor = dashboardVariables.createVariableAPIMonitor();
    page.on('response', monitor.handler);

    // Step 7: Open variable dropdown to trigger /values API call with current time context
    await dashboardVariables.openVariableDropdown(variableName);

    // Step 8: Verify API call was made with GLOBAL time (6d), NOT panel config time (1h)
    // v4.0: In Add Panel mode, variables use global time from picker, NOT panel_time_range config
    await dashboardVariables.verifyVariableTimeRange(
      monitor,
      6 * 24 * 60 * 60 * 1000, // 6 days in ms
      'Variables correctly use GLOBAL time (6d) in Add Panel mode, NOT panel config (1h) - v4.0 behavior'
    );

    page.off('response', monitor.handler);

    // Close without saving
    await pm.dashboardPanelTime.discardPanelChanges();

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("26-should use global time (NOT panel config) for variables in Edit Panel mode (v4.0)", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardVariables = new DashboardVariables(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_VarEditPanel_${timestamp}`;
    const panelName = `Panel_VarEditPanel_${timestamp}`;
    const variableName = `var_${timestamp}`;

    // Step 1: Navigate to dashboards and create dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({
      state: "visible",
      timeout: 10000
    });

    // Step 2: Add a query-based variable to the dashboard
    await dashboardVariables.addQueryVariable(variableName);

    // Wait for dashboard to be ready after variable addition
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({
      state: "visible",
      timeout: 10000
    });

    // Step 3: Add panel with useDefaultTime enabled and panel_time_range set to "Last 1h"
    // This config is for VIEW MODE ONLY in v4.0
    const panelId = await addPanelWithPanelTime(page, pm, {
      panelName,
      panelTimeEnabled: true,
      panelTimeRange: "1-h"
    });

    // Verify panel has time picker in view mode
    await assertPanelTimePickerVisible(page, panelId);

    // Wait for panel to be fully rendered (longer timeout for parallel execution)
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Step 4: Edit the panel
    await editPanel(page, panelName);

    // Step 5: Verify global picker shows "1h" initially (populated from panel config)
    const pickerText = await pm.dashboardPanelTime.getGlobalTimePickerText();
    expect(pickerText).toContain("1");
    expect(pickerText.toLowerCase()).toContain("hour");

    // Step 6: Change global time to "Last 6 days" and apply
    // v4.0: In Edit Panel mode, variables use GLOBAL time (6d), NOT panel config (1h)
    await pm.dashboardPanelTime.changeGlobalTime('6-d');

    // Step 7: Set up API monitoring to capture variable values request
    const monitor = dashboardVariables.createVariableAPIMonitor();
    page.on('response', monitor.handler);

    // Step 8: Open variable dropdown to trigger /values API call with current time context
    await dashboardVariables.openVariableDropdown(variableName);

    // Step 9: Verify API call was made with GLOBAL time (6d), NOT panel config (1h)
    // v4.0: Variables use global picker value in Edit Panel mode, not panel_time_range config
    await dashboardVariables.verifyVariableTimeRange(
      monitor,
      6 * 24 * 60 * 60 * 1000, // 6 days in ms
      'Variables correctly use GLOBAL time (6d) in Edit Panel mode, NOT panel config (1h) - v4.0 behavior'
    );

    page.off('response', monitor.handler);

    // Close without saving
    await pm.dashboardPanelTime.discardPanelChanges();

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("27-should use global time for variables when useDefaultTime is disabled (v4.0)", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardVariables = new DashboardVariables(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_VarNoConfig_${timestamp}`;
    const panelName = `Panel_VarNoConfig_${timestamp}`;
    const variableName = `var_${timestamp}`;

    // Step 1: Navigate to dashboards and create dashboard
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({
      state: "visible",
      timeout: 10000
    });

    // Step 2: Add a query-based variable to the dashboard
    await dashboardVariables.addQueryVariable(variableName);

    // Wait for dashboard to be ready after variable addition
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({
      state: "visible",
      timeout: 10000
    });

    // Step 3: Add panel WITHOUT useDefaultTime enabled (no panel time feature)
    // v4.0: useDefaultTime is false/undefined, panel behaves like main branch
    const panelId = await addPanelWithPanelTime(page, pm, {
      panelName,
      panelTimeEnabled: false, // useDefaultTime is OFF
      panelTimeRange: null
    });

    // Wait for panel to be fully rendered (longer timeout for parallel execution)
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Step 4: Edit the panel
    await editPanel(page, panelName);

    // Step 5: Change global time to "Last 3 days" and apply
    // Variables should use global time (3d)
    await pm.dashboardPanelTime.changeGlobalTime('3-d');

    // Step 6: Set up API monitoring to capture variable values request
    const monitor = dashboardVariables.createVariableAPIMonitor();
    page.on('response', monitor.handler);

    // Step 7: Open variable dropdown to trigger /values API call with current time context
    await dashboardVariables.openVariableDropdown(variableName);

    // Step 8: Verify API call was made with global time (3d)
    // v4.0: Variables use global time when useDefaultTime is disabled
    await dashboardVariables.verifyVariableTimeRange(
      monitor,
      3 * 24 * 60 * 60 * 1000, // 3 days in ms
      'Variables correctly use global time (3d) when useDefaultTime is disabled - v4.0 behavior'
    );

    page.off('response', monitor.handler);

    // Close without saving
    await pm.dashboardPanelTime.discardPanelChanges();

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });
});
