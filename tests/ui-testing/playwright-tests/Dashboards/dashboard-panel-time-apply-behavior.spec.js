const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import {
  startPanelCreation,
  createDashboardWithPanelTime,
  cleanupDashboard,
  editPanel,
  savePanel,
} from "./utils/panelTimeSetup.js";
import {
  assertPanelTimePickerVisible,
  assertPanelTimeInURL,
} from "./utils/panelTimeAssertions.js";
import {
  openQueryInspector,
  closeQueryInspector,
  getQueryInspectorDateTime,
  verifyQueryInspectorDateTime,
  assertDateTimesAreSame,
} from "./utils/queryInspectorHelpers.js";

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Panel Time - Apply Button Behavior", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("1-should apply new time in Add Panel mode and verify via query inspector", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_AddPanel_${timestamp}`;
    const panelName = `Panel_AddPanel_${timestamp}`;

    // Step 1-2: Create dashboard and start adding a panel (without saving)
    await startPanelCreation(page, pm, { dashboardName, panelName });

    // Step 3-4: Change date time to "Last 6 days" and apply
    await pm.dashboardPanelTime.changeGlobalTime('6-d');
    await page.waitForTimeout(2000); // Buffer for data processing

    // Step 5: Verify time range via query inspector (expects ~6 days)
    await verifyQueryInspectorDateTime(page, { expectedRange: "6d" });

    // Step 6: Save panel
    await savePanel(page);

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("2-should apply new time in Edit Panel mode (not revert to config) and verify via query inspector", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_EditPanel_${timestamp}`;
    const panelName = `Panel_EditPanel_${timestamp}`;

    // Step 1: Create panel with individual time "Last 1h" (panel_time_range config)
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Verify panel has time picker with 1h
    await assertPanelTimePickerVisible(page, panelId);
    await assertPanelTimeInURL(page, panelId, "1h");

    // Step 2: Edit the panel
    await editPanel(page, panelName);

    // Step 3: Verify top date time picker shows "1h" initially (from panel config)
    const pickerText = await pm.dashboardPanelTime.getGlobalTimePickerText();
    expect(pickerText).toContain("1");
    expect(pickerText.toLowerCase()).toContain("hour");

    // Step 4-5: Change date time to "Last 6 days" and apply
    // CRITICAL: The time range should be ~6 days, NOT 1 hour
    // This verifies the fix: queries use current picker value, not panel config
    await pm.dashboardPanelTime.changeGlobalTime('6-d');
    await page.waitForTimeout(1000); // Buffer for data processing

    // Step 6-8: Verify the query uses NEW time (6 days)
    await verifyQueryInspectorDateTime(page, { expectedRange: "6d" });

    // Step 9: Change time again to verify Apply works multiple times
    await pm.dashboardPanelTime.changeGlobalTime('1-w');
    await page.waitForTimeout(1000); // Buffer for data processing

    // Verify time updated to ~1 week
    await verifyQueryInspectorDateTime(page, { expectedRange: "1w" });

    // Step 10: Save panel
    await savePanel(page);

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("3-should apply new time in Edit Panel mode with absolute time ranges", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_EditAbsolute_${timestamp}`;
    const panelName = `Panel_EditAbsolute_${timestamp}`;

    // Step 1: Create panel with relative time "Last 1h"
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Step 2: Edit the panel
    await editPanel(page, panelName);

    // Step 3: Open date time picker and switch to absolute time
    await pm.dashboardPanelTime.openGlobalPickerAbsoluteTab();
    await page.waitForTimeout(500);

    // Step 4: Click Apply button and wait for data
    await pm.dashboardPanelTime.clickDateTimeApply();
    await page.waitForTimeout(1000); // Buffer for data processing

    // Step 5: Verify via query inspector
    await verifyQueryInspectorDateTime(page);

    // Close without saving
    await pm.dashboardPanelTime.discardPanelChanges();

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("4-should apply new time in View Panel mode and verify via API", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_ViewPanel_${timestamp}`;
    const panelName = `Panel_ViewPanel_${timestamp}`;

    // Step 1: Create panel with individual time "Last 1h"
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Verify panel has time picker
    await assertPanelTimePickerVisible(page, panelId);

    // Step 2: Open panel in full-screen view
    await pm.dashboardPanelTime.openViewPanelModal(panelId);

    // Step 3: Verify date time picker is visible in view panel mode
    await pm.dashboardPanelTime.expectViewPanelDateTimePickerVisible();

    // Verify it shows "1h" initially
    const pickerText = await pm.dashboardPanelTime.getViewPanelDateTimePickerText();
    expect(pickerText).toContain("1");
    expect(pickerText.toLowerCase()).toContain("hour");

    // Step 4: Set up API monitoring to capture query request
    let apiCallDetected = false;
    let capturedStartTime = null;
    let capturedEndTime = null;

    const responseHandler = async (response) => {
      const url = response.url();
      if (url.includes('/_search') || url.includes('/query')) {
        try {
          const request = response.request();
          const postData = request.postData();
          if (postData) {
            const data = JSON.parse(postData);
            if (data.query?.start_time && data.query?.end_time) {
              apiCallDetected = true;
              capturedStartTime = data.query.start_time;
              capturedEndTime = data.query.end_time;
            }
          }
        } catch (error) {
          // Ignore parsing errors
        }
      }
    };

    page.on('response', responseHandler);

    // Step 5-6: Change date time to "Last 6 days" and apply
    await pm.dashboardPanelTime.changeViewPanelDateTime('6-d');
    await page.waitForTimeout(2000); // Wait for API call to complete

    page.off('response', responseHandler);

    // Step 7: Verify API call was made with correct time range
    expect(apiCallDetected).toBe(true);
    expect(capturedStartTime).toBeTruthy();
    expect(capturedEndTime).toBeTruthy();

    // Verify time range is approximately 6 days (in microseconds)
    const durationMs = (capturedEndTime - capturedStartTime) / 1000;
    const expectedDurationMs = 6 * 24 * 60 * 60 * 1000; // 6 days in ms
    const tolerance = expectedDurationMs * 0.1; // 10% tolerance

    expect(durationMs).toBeGreaterThanOrEqual(expectedDurationMs - tolerance);
    expect(durationMs).toBeLessThanOrEqual(expectedDurationMs + tolerance);

    // Step 8: Close view panel (back to dashboard)
    await pm.dashboardPanelTime.closeViewPanelModal();

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("5-should apply new time when panel has no initial panel_time_range config", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_NoConfig_${timestamp}`;
    const panelName = `Panel_NoConfig_${timestamp}`;

    // Step 1: Create panel WITHOUT panel time config (uses global time)
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      panelTimeEnabled: false, // No panel-specific time
      panelTimeMode: "global",
      panelTimeRange: null
    });

    // Step 2: Edit the panel
    await editPanel(page, panelName);

    // Step 3: Top picker should show global time (default 15m)
    const pickerText = await pm.dashboardPanelTime.getGlobalTimePickerText();
    expect(pickerText).toBeTruthy();

    // Step 4-5: Change date time to "Last 1 day" and apply
    await pm.dashboardPanelTime.changeGlobalTime('1-d');
    await page.waitForTimeout(1000); // Buffer for data processing

    // Step 6-7: Verify the query uses the new time (1 day) via query inspector
    await verifyQueryInspectorDateTime(page, { expectedRange: "1d" });

    // Step 8: Save panel
    await savePanel(page);

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("6-should apply multiple time changes sequentially in Edit Panel mode", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_Sequential_${timestamp}`;
    const panelName = `Panel_Sequential_${timestamp}`;

    // Step 1: Create panel with individual time "Last 1h"
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Step 2: Edit the panel
    await editPanel(page, panelName);

    // Test sequence: 1h → 6d → 1w → 15m

    // Step 3: Change to 6d and verify
    await pm.dashboardPanelTime.changeGlobalTime('6-d');
    await page.waitForTimeout(1000); // Buffer for data processing
    await verifyQueryInspectorDateTime(page, { expectedRange: "6d" });

    // Step 4: Change to 1w and verify
    await pm.dashboardPanelTime.changeGlobalTime('1-w');
    await page.waitForTimeout(1000); // Buffer for data processing
    await verifyQueryInspectorDateTime(page, { expectedRange: "1w" });

    // Step 5: Change to 15m and verify
    await pm.dashboardPanelTime.changeGlobalTime('15-m');
    await page.waitForTimeout(1000); // Buffer for data processing
    await verifyQueryInspectorDateTime(page, { expectedRange: "15m" });

    // Step 6: Save panel
    await savePanel(page);

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("7-should not apply changes when Apply is not clicked in Edit Panel mode", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_NoApply_${timestamp}`;
    const panelName = `Panel_NoApply_${timestamp}`;

    // Step 1: Create panel with individual time "Last 1h"
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Step 2: Edit the panel
    await editPanel(page, panelName);

    // Step 3: Capture initial query time by opening inspector
    await openQueryInspector(page);
    const initialDateTime = await getQueryInspectorDateTime(page);
    await closeQueryInspector(page);

    // Step 4: Change date time to "Last 6 days" but DON'T click Apply
    await pm.dashboardPanelTime.selectGlobalTimeWithoutApply('6-d');

    // DON'T click Apply - just close the picker
    await pm.dashboardPanelTime.dismissDateTimePicker();

    // Step 5: Open query inspector again and verify time hasn't changed
    await openQueryInspector(page);
    const currentDateTime = await getQueryInspectorDateTime(page);

    // Time should be the same as before (still 1h) because Apply wasn't clicked
    assertDateTimesAreSame(initialDateTime, currentDateTime);

    await closeQueryInspector(page);

    // Close without saving
    await pm.dashboardPanelTime.discardPanelChanges();

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });
});
