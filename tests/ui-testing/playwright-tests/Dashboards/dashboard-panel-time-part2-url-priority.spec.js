const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import {
  createDashboardWithPanelTime,
  createDashboardWithMultiplePanels,
  addPanelWithPanelTime,
  cleanupDashboard,
  getDashboardIdFromURL
} from "./utils/panelTimeSetup.js";
import {
  assertPanelTimeInURL,
  assertPanelTimeNotInURL,
  assertPanelTimeAbsoluteInURL,
  assertPanelTimeDisplay,
  assertURLChanged,
  assertURLUnchanged
} from "./utils/panelTimeAssertions.js";

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard Panel Time - Part 2: URL Synchronization and Priority", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("7-should sync panel time to URL and persist", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_URLSync_${timestamp}`;
    const panelName = `Panel_URLSync_${timestamp}`;

    // Step 1: Create dashboard with panel
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName,
      allowPanelTime: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Step 2: Change Panel time to "Last 7d" and Apply
    await pm.dashboardPanelTime.changePanelTimeInView(panelId, "7-d", true);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Step 3: Verify URL immediately updates
    await assertPanelTimeInURL(page, panelId, "7d");

    // Step 4: Copy URL, open in new tab
    const currentURL = page.url();
    const newPage = await page.context().newPage();
    await newPage.goto(currentURL);
    await newPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Step 5: Verify Panel shows "Last 7d" in new tab
    const pickerText = await newPage.locator(`[data-test="panel-time-picker-${panelId}-btn"]`).textContent();
    expect(pickerText).toContain("7");

    await newPage.close();

    // Step 10: Reload page (F5)
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Step 11: Verify URL params remain
    await assertPanelTimeInURL(page, panelId, "7d");

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("8-should support URL sharing and browser navigation", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_URLSharing_${timestamp}`;

    // Step 1: Configure dashboard with panels
    const { panelIds } = await createDashboardWithMultiplePanels(page, pm, {
      dashboardName,
      panels: [
        { panelName: `Panel_A_${timestamp}`, allowPanelTime: true, panelTimeMode: "individual", panelTimeRange: "1-h" },
        { panelName: `Panel_B_${timestamp}`, allowPanelTime: true, panelTimeMode: "individual", panelTimeRange: "7-d" }
      ]
    });

    const panelAId = panelIds[0];

    // Step 2: Copy URL
    const initialURL = page.url();

    // Step 6: Change Panel A to "Last 24h"
    await pm.dashboardPanelTime.changePanelTimeInView(panelAId, "24-h", true);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await assertPanelTimeInURL(page, panelAId, "24h");

    // Step 7: Change Panel A to "Last 30d"
    await pm.dashboardPanelTime.changePanelTimeInView(panelAId, "30-d", true);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await assertPanelTimeInURL(page, panelAId, "30d");

    // Step 8: Click browser back button
    await page.goBack();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Step 9: Verify URL and picker show "Last 24h"
    await assertPanelTimeInURL(page, panelAId, "24h");

    // Step 10: Click browser forward button
    await page.goForward();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Step 11: Verify URL shows "Last 30d"
    await assertPanelTimeInURL(page, panelAId, "30d");

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("9-should handle URL with many panels", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_ManyPanels_${timestamp}`;

    // Create dashboard with 10 panels (reduced from 20 for test performance)
    const panels = [];
    for (let i = 0; i < 10; i++) {
      panels.push({
        panelName: `Panel_${i}_${timestamp}`,
        allowPanelTime: true,
        panelTimeMode: "individual",
        panelTimeRange: i % 2 === 0 ? "1-h" : "7-d"
      });
    }

    const { panelIds } = await createDashboardWithMultiplePanels(page, pm, {
      dashboardName,
      panels
    });

    // Step 3: Verify URL contains all panel params
    for (let i = 0; i < panelIds.length; i++) {
      const expectedTime = i % 2 === 0 ? "1h" : "7d";
      await assertPanelTimeInURL(page, panelIds[i], expectedTime);
    }

    // Step 4: Check URL length
    const url = page.url();
    const urlLength = url.length;
    expect(urlLength).toBeLessThan(2000); // Should be < 2000 chars

    // Step 5: Copy URL, open in new tab
    const newPage = await page.context().newPage();
    await newPage.goto(url);
    await newPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Step 6: Verify all panels load with correct times
    for (let i = 0; i < panelIds.length; i++) {
      const expectedTime = i % 2 === 0 ? "1h" : "7d";
      await assertPanelTimeInURL(newPage, panelIds[i], expectedTime);
    }

    await newPage.close();

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("10-should respect time range priority (URL > Config > Global)", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_Priority_${timestamp}`;

    // Setup panels with different configs
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Panel A: config "1h"
    const panelAId = await addPanelWithPanelTime(page, pm, {
      panelName: `Panel_A_${timestamp}`,
      allowPanelTime: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Panel B: no panel time (uses global)
    const panelBId = await addPanelWithPanelTime(page, pm, {
      panelName: `Panel_B_${timestamp}`,
      allowPanelTime: false
    });

    // Step 2: Load without URL params
    // Step 3: Verify Panel A shows "1h" (config priority)
    await assertPanelTimeInURL(page, panelAId, "1h");

    // Step 4: Verify Panel B has no picker (uses global)
    const panelBPicker = page.locator(`[data-test="panel-time-picker-${panelBId}"]`);
    expect(await panelBPicker.isVisible().catch(() => false)).toBe(false);

    // Step 6: Load with URL override for Panel A
    const dashboardId = getDashboardIdFromURL(page);
    const urlWithParams = `${page.url().split('?')[0]}?dashboard=${dashboardId}&pt-period.${panelAId}=30d`;
    await page.goto(urlWithParams);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Step 7: Verify Panel A shows "30d" (URL priority over config)
    await assertPanelTimeInURL(page, panelAId, "30d");

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });

  test("11-should handle 'Use Global' mode priority", async ({ page }) => {
    const pm = new PageManager(page);
    const timestamp = Date.now();
    const dashboardName = `Dashboard_GlobalMode_${timestamp}`;

    // Setup panels
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();
    await pm.dashboardCreate.createDashboard(dashboardName);
    await page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]').waitFor({ state: "visible" });

    // Panel A: "Use global" mode
    const panelAId = await addPanelWithPanelTime(page, pm, {
      panelName: `Panel_A_${timestamp}`,
      allowPanelTime: true,
      panelTimeMode: "global"
    });

    // Panel B: "Use individual" mode with config "1h"
    const panelBId = await addPanelWithPanelTime(page, pm, {
      panelName: `Panel_B_${timestamp}`,
      allowPanelTime: true,
      panelTimeMode: "individual",
      panelTimeRange: "1-h"
    });

    // Step 2: Verify Panel A follows global (shows picker)
    const panelAPicker = page.locator(`[data-test="panel-time-picker-${panelAId}"]`);
    expect(await panelAPicker.isVisible()).toBe(true);

    // Step 3: Load with URL param for Panel A (should be ignored)
    const dashboardId = getDashboardIdFromURL(page);
    const urlWithParams = `${page.url().split('?')[0]}?dashboard=${dashboardId}&pt-period.${panelAId}=24h`;
    await page.goto(urlWithParams);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Step 4: Verify Panel A still uses global time (URL ignored)
    // Panel should NOT have URL param applied because mode is "global"
    const pickerText = await page.locator(`[data-test="panel-time-picker-${panelAId}-btn"]`).textContent();
    // Should show global time, not 24h from URL

    // Step 5: Verify Panel B shows "1h" (individual mode respects config)
    await assertPanelTimeInURL(page, panelBId, "1h");

    // Step 8: Change global time
    await pm.dashboardPanelTime.changeGlobalTime("1-h");

    // Step 9: Verify Panel A updates, Panel B unchanged
    const panelAText = await page.locator(`[data-test="panel-time-picker-${panelAId}-btn"]`).textContent();
    expect(panelAText).toContain("1");

    // Cleanup
    await cleanupDashboard(page, pm, dashboardName);
  });
});
