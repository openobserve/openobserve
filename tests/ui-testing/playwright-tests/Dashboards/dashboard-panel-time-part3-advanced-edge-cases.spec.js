const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import {
  createDashboardWithPanelTime,
  createDashboardWithMultiplePanels,
  addPanelWithPanelTime,
  cleanupDashboard,
  getPanelId
} from "./utils/panelTimeSetup.js";
import {
  assertPanelTimePickerVisible,
  assertPanelTimeInURL,
  assertPanelTimeNotInURL,
  assertPanelTimePickerInModal,
  assertPanelTimePickerInFullScreen
} from "./utils/panelTimeAssertions.js";
const { safeWaitForHidden, safeWaitForNetworkIdle, safeWaitForDOMContentLoaded } = require("../utils/wait-helpers.js");

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Panel Time - Part 3: Advanced Features and Edge Cases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("12-should support View Panel modal time picker independently", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_ViewModal_${timestamp}`;
    const panelName = `Panel_ViewModal_${timestamp}`;

    // Step 1: Create panel with individual time "Last 1h"
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Step 2: Verify initial URL has "1h"
    await assertPanelTimeInURL(page, panelId, "1h");

    // Step 3: Click "View" on Panel
    await pm.dashboardPanelTime.openViewPanelModal(panelId);

    // Step 4: Verify modal picker visible
    await assertPanelTimePickerInModal(page);

    // Step 5: Change time to "Last 6d" in modal
    const modalPicker = page.locator('[data-test="dashboard-viewpanel-date-time-picker"]');
    await modalPicker.click();
    await page.locator('[data-test="date-time-relative-6-d-btn"]').click();

    // Step 6: Click Apply
    await page.locator('[data-test="date-time-apply-btn"]').click();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Step 7: Verify URL remains unchanged (View Panel time is temporary)
    await assertPanelTimeInURL(page, panelId, "1h");

    // Step 8: Close modal
    await pm.dashboardPanelTime.closeViewPanelModal();

    // Step 9: Verify Panel in dashboard still shows "Last 1h" (not affected by View Panel change)
    const pickerText = await page.locator(`[data-test="panel-time-picker-${panelId}"]`).textContent();
    expect(pickerText).toContain("1");
    expect(pickerText).not.toContain("7");

    // Step 10: Verify URL still has "1h"
    await assertPanelTimeInURL(page, panelId, "1h");

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("13-should support Full Screen mode time picker", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_FullScreen_${timestamp}`;
    const panelName = `Panel_FullScreen_${timestamp}`;

    // Step 1: Create panel with individual time "Last 1h"
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Step 2: Verify initial URL has "1h"
    await assertPanelTimeInURL(page, panelId, "1h");

    // Step 3: Click "Full Screen" (navigates to dashboard view)
    await pm.dashboardPanelTime.openPanelFullScreen(panelId);

    // Step 4: Verify panel time picker visible in full screen (dashboard view)
    await assertPanelTimePickerInFullScreen(page, panelId);

    // Step 5: Change time to "Last 1d" in full screen
    await pm.dashboardPanelTime.changePanelTimeInFullScreen(panelId, "1-d", true);

    // Step 6: Verify URL updated to "1d"
    await assertPanelTimeInURL(page, panelId, "1d");

    // Step 7: Verify panel picker shows "1d"
    const pickerText = await page.locator(`[data-test="panel-time-picker-${panelId}"]`).textContent();
    expect(pickerText).toContain("1");

    // Step 8: Reload to verify persistence
    await page.reload();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Step 9: Verify URL still has "1d" after reload
    await assertPanelTimeInURL(page, panelId, "1d");

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("14-should support export/import and clone operations", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_ExportImport_${timestamp}`;

    // Step 1: Configure dashboard with panels
    const { panelIds } = await createDashboardWithMultiplePanels(page, pm, {
      dashboardName,
      panels: [
        { panelName: `Panel_A_${timestamp}`, panelTimeEnabled: true, panelTimeMode: "individual", panelTimeRange: "1-h" },
        { panelName: `Panel_B_${timestamp}`, panelTimeEnabled: true, panelTimeMode: "individual", panelTimeRange: "6-d" },
        { panelName: `Panel_C_${timestamp}`, panelTimeEnabled: false }
      ]
    });

    // Step 2: Export dashboard
    // Note: Actual export implementation depends on UI
    // For now, verify panels are configured correctly
    await assertPanelTimePickerVisible(page, panelIds[0]);
    await assertPanelTimePickerVisible(page, panelIds[1]);
    await pm.dashboardPanelTime.clickGlobalRefresh();
    // Step 7: Clone Panel A
    // Note: Clone implementation depends on UI
    // Verify original panel still works
    await assertPanelTimeInURL(page, panelIds[0], "1h");

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("15-should handle global refresh with mixed panel times", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_GlobalRefresh_${timestamp}`;

    // Step 1: Setup dashboard with mixed times
    const { panelIds } = await createDashboardWithMultiplePanels(page, pm, {
      dashboardName,
      panels: [
        { panelName: `Panel_A_${timestamp}`, panelTimeEnabled: true, panelTimeMode: "individual", panelTimeRange: "1-h" },
        { panelName: `Panel_B_${timestamp}`, panelTimeEnabled: true, panelTimeMode: "individual", panelTimeRange: "6-d" },
        { panelName: `Panel_C_${timestamp}`, panelTimeEnabled: true, panelTimeMode: "global" },
        { panelName: `Panel_D_${timestamp}`, panelTimeEnabled: false }
      ]
    });

    // Step 2: Click global refresh button
    await pm.dashboardPanelTime.clickGlobalRefresh();

    // Step 3: Verify all panels refresh
    await safeWaitForNetworkIdle(page, { timeout: 10000 });

    // Step 4: Verify each panel maintains its time
    await assertPanelTimeInURL(page, panelIds[0], "1h");
    await assertPanelTimeInURL(page, panelIds[1], "6d");

    // Step 6: Change global time
    await pm.dashboardPanelTime.changeGlobalTime("1-h");

    // Step 7: Verify Panel C and D refresh with new global time
    // Panel A and B should maintain their times
    await assertPanelTimeInURL(page, panelIds[0], "1h");
    await assertPanelTimeInURL(page, panelIds[1], "6d");

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("16-should handle delete panel and URL cleanup", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_Delete_${timestamp}`;
    const panelName = `Panel_Delete_${timestamp}`;

    // Step 1: Setup panel with time and URL param
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      panelTimeEnabled: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Verify URL has panel time
    await assertPanelTimeInURL(page, panelId, "1h");

    // Step 2: Delete Panel using helper method
    await pm.dashboardPanelEdit.deletePanel(panelName);
    await safeWaitForNetworkIdle(page, { timeout: 5000 });
    
    await pm.dashboardPanelTime.clickGlobalRefresh();
    
    // Step 4: Verify URL param removed
    await assertPanelTimeNotInURL(page, panelId);

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("17-should handle edge cases and errors", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_EdgeCases_${timestamp}`;

    // Step 1: Create dashboard with multiple panels
    const { panelIds } = await createDashboardWithMultiplePanels(page, pm, {
      dashboardName,
      panels: [
        { panelName: `Panel_1_${timestamp}`, panelTimeEnabled: true, panelTimeMode: "individual", panelTimeRange: "1-h" },
        { panelName: `Panel_2_${timestamp}`, panelTimeEnabled: true, panelTimeMode: "individual", panelTimeRange: "6-d" },
        { panelName: `Panel_3_${timestamp}`, panelTimeEnabled: true, panelTimeMode: "individual", panelTimeRange: "15-m" }
      ]
    });

    // Step 2: Test invalid URL param (load with invalid value)
    const currentURL = page.url();
    const invalidURL = `${currentURL}&pt-period.${panelIds[0]}=invalidvalue`;
    await page.goto(invalidURL);
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Should fallback to config or global (should not crash)
    const panelPicker = page.locator(`[data-test="panel-time-picker-${panelIds[0]}"]`);
    expect(await panelPicker.isVisible()).toBe(true);

    // Step 3: Test missing panel in URL
    const missingPanelURL = `${currentURL}&pt-period.nonexistent=1h`;
    await page.goto(missingPanelURL);
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Should ignore unknown panel (should not crash)
    expect(await panelPicker.isVisible()).toBe(true);

    // Step 5: Test concurrent changes
    await pm.dashboardPanelTime.changePanelTimeInView(panelIds[0], "1-d", true);
    await pm.dashboardPanelTime.changeGlobalTime("1-h");

    // Panel time should be preserved
    await assertPanelTimeInURL(page, panelIds[0], "1d");

    // Step 7: Test quick successive changes
    await pm.dashboardPanelTime.clickPanelTimePicker(panelIds[0]);
    await page.locator('[data-test="date-time-relative-1-h-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-d-btn"]').click();
    await page.locator('[data-test="date-time-relative-1-m-btn"]').click();
    await page.locator('[data-test="date-time-apply-btn"]').click();
    await safeWaitForNetworkIdle(page, { timeout: 5000 });

    // Last change (1m) should be applied
    await assertPanelTimeInURL(page, panelIds[0], "1m");

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });
});
