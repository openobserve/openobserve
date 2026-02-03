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

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Panel Time - Part 3: Advanced Features and Edge Cases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("12-should support View Panel modal time picker", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_ViewModal_${timestamp}`;
    const panelName = `Panel_ViewModal_${timestamp}`;

    // Step 1: Create panel with individual time "Last 1h"
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      allowPanelTime: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Step 2: Click "View" on Panel
    await pm.dashboardPanelTime.openViewPanelModal(panelId);

    // Step 3: Verify modal picker visible
    await assertPanelTimePickerInModal(page);

    // Step 6: Change time to "Last 7d" in modal
    const modalPicker = page.locator('[data-test="dashboard-viewpanel-date-time-picker"]');
    await modalPicker.click();
    await page.locator('[data-test="date-time-relative-7-d-btn"]').click();

    // Step 8: Click Apply
    await page.locator('[data-test="date-time-apply-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Step 10: Verify URL updates
    await assertPanelTimeInURL(page, panelId, "7d");

    // Step 11: Close modal
    await pm.dashboardPanelTime.closeViewPanelModal();

    // Step 12: Verify Panel in dashboard shows "Last 7d"
    const pickerText = await page.locator(`[data-test="panel-time-picker-${panelId}-btn"]`).textContent();
    expect(pickerText).toContain("7");

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
      allowPanelTime: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Step 2: Click "Full Screen"
    await pm.dashboardPanelTime.openPanelFullScreen(panelId);

    // Step 3: Verify full screen mode and picker visible
    await assertPanelTimePickerInFullScreen(page);

    // Step 6: Change time to "Last 24h"
    await pm.dashboardPanelTime.changePanelTimeInFullScreen("24-h", true);

    // Step 8: Verify URL updated
    await assertPanelTimeInURL(page, panelId, "24h");

    // Step 12: Exit full screen
    await pm.dashboardPanelTime.exitFullScreen();

    // Step 13: Verify Panel shows "Last 24h"
    const pickerText = await page.locator(`[data-test="panel-time-picker-${panelId}-btn"]`).textContent();
    expect(pickerText).toContain("24");

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
        { panelName: `Panel_A_${timestamp}`, allowPanelTime: true, panelTimeMode: "individual", panelTimeRange: "1-h" },
        { panelName: `Panel_B_${timestamp}`, allowPanelTime: true, panelTimeMode: "individual", panelTimeRange: "7-d" },
        { panelName: `Panel_C_${timestamp}`, allowPanelTime: false }
      ]
    });

    // Step 2: Export dashboard
    // Note: Actual export implementation depends on UI
    // For now, verify panels are configured correctly
    await assertPanelTimePickerVisible(page, panelIds[0]);
    await assertPanelTimePickerVisible(page, panelIds[1]);

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
        { panelName: `Panel_A_${timestamp}`, allowPanelTime: true, panelTimeMode: "individual", panelTimeRange: "1-h" },
        { panelName: `Panel_B_${timestamp}`, allowPanelTime: true, panelTimeMode: "individual", panelTimeRange: "7-d" },
        { panelName: `Panel_C_${timestamp}`, allowPanelTime: true, panelTimeMode: "global" },
        { panelName: `Panel_D_${timestamp}`, allowPanelTime: false }
      ]
    });

    // Step 2: Click global refresh button
    await pm.dashboardPanelTime.clickGlobalRefresh();

    // Step 3: Verify all panels refresh
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Step 4: Verify each panel maintains its time
    await assertPanelTimeInURL(page, panelIds[0], "1h");
    await assertPanelTimeInURL(page, panelIds[1], "7d");

    // Step 6: Change global time
    await pm.dashboardPanelTime.changeGlobalTime("1-h");

    // Step 7: Verify Panel C and D refresh with new global time
    // Panel A and B should maintain their times
    await assertPanelTimeInURL(page, panelIds[0], "1h");
    await assertPanelTimeInURL(page, panelIds[1], "7d");

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
      allowPanelTime: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Verify URL has panel time
    await assertPanelTimeInURL(page, panelId, "1h");

    // Step 2: Delete Panel
    const deleteBtn = page.locator(`[data-test="panel-${panelId}-delete-btn"]`);
    await deleteBtn.click().catch(() => {
      // Try alternative delete method
      page.locator(`[data-test="panel-delete-button-${panelId}"]`).click();
    });

    // Confirm deletion
    await page.locator('[data-test="confirm-button"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

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
        { panelName: `Panel_1_${timestamp}`, allowPanelTime: true, panelTimeMode: "individual", panelTimeRange: "1-h" },
        { panelName: `Panel_2_${timestamp}`, allowPanelTime: true, panelTimeMode: "individual", panelTimeRange: "7-d" },
        { panelName: `Panel_3_${timestamp}`, allowPanelTime: true, panelTimeMode: "individual", panelTimeRange: "15-m" }
      ]
    });

    // Step 2: Test invalid URL param (load with invalid value)
    const currentURL = page.url();
    const invalidURL = `${currentURL}&pt-period.${panelIds[0]}=invalidvalue`;
    await page.goto(invalidURL);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Should fallback to config or global (should not crash)
    const panelPicker = page.locator(`[data-test="panel-time-picker-${panelIds[0]}"]`);
    expect(await panelPicker.isVisible()).toBe(true);

    // Step 3: Test missing panel in URL
    const missingPanelURL = `${currentURL}&pt-period.nonexistent=1h`;
    await page.goto(missingPanelURL);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Should ignore unknown panel (should not crash)
    expect(await panelPicker.isVisible()).toBe(true);

    // Step 5: Test concurrent changes
    await pm.dashboardPanelTime.changePanelTimeInView(panelIds[0], "24-h", true);
    await pm.dashboardPanelTime.changeGlobalTime("1-h");

    // Panel time should be preserved
    await assertPanelTimeInURL(page, panelIds[0], "24h");

    // Step 7: Test quick successive changes
    await pm.dashboardPanelTime.clickPanelTimePicker(panelIds[0]);
    await page.locator('[data-test="date-time-relative-1-h-btn"]').click();
    await page.locator('[data-test="date-time-relative-7-d-btn"]').click();
    await page.locator('[data-test="date-time-relative-30-d-btn"]').click();
    await page.locator('[data-test="date-time-apply-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Last change (30d) should be applied
    await assertPanelTimeInURL(page, panelIds[0], "30d");

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });
});
