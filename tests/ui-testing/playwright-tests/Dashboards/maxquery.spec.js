const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "./utils/dashCreation.js";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import { generateDashboardName } from "./utils/configPanelHelpers.js";

import PageManager from "../../pages/page-manager";
const testLogger = require("../utils/test-logger.js");

// Use a dedicated stream for max query range tests (not e2e_automate)
const MAX_QUERY_STREAM = "e2e_max_query_range";

test.describe.configure({ mode: "serial" });

// ============================================================================
// Helpers
// ============================================================================

/**
 * Ingest data into the dedicated max query range stream.
 */
async function ingestToStream(page) {
  await ingestion(page, MAX_QUERY_STREAM);
}

/**
 * Set max query range (in hours) on the dedicated stream via the UI.
 * Pass "0" to reset (no limit).
 */
/**
 * Set max query range (in hours) on the dedicated stream via the API.
 * Pass 0 to reset (no limit).
 * Uses PUT /{org_id}/streams/{stream_name}/settings?type=logs
 */
async function setMaxQueryRange(page, hours) {
  const orgId = process.env.ORGNAME || "default";
  const payload = { max_query_range: hours };

  const result = await page.evaluate(
    async ({ orgId, streamName, payload }) => {
      const r = await fetch(
        `/api/${orgId}/streams/${streamName}/settings?type=logs`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const text = await r.text();
      return { status: r.status, body: text };
    },
    { orgId, streamName: MAX_QUERY_STREAM, payload }
  );

  if (result.status === 200) {
    testLogger.info("Max query range set via API", { hours, stream: MAX_QUERY_STREAM });
  } else {
    testLogger.warn("Failed to set max query range via API", { result });
  }

  // Allow time for settings to propagate
  await page.waitForTimeout(1000);
}

/**
 * Build a panel with a wide time range (6 weeks) in the panel editor,
 * apply, name, and save. This is done BEFORE setting max query range
 * so the time picker buttons are not disabled.
 * Leaves the user on the dashboard view (panel saved).
 */
async function buildPanelWithWideRange(page, pm, panelName, chartType = "area") {
  await pm.dashboardCreate.addPanel();
  await pm.chartTypeSelector.selectChartType(chartType);
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream(MAX_QUERY_STREAM);
  await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
  await pm.chartTypeSelector.searchAndAddField("kubernetes_labels_name", "b");

  // Set wide time range while no restriction is active
  await waitForDateTimeButtonToBeEnabled(page);
  await pm.dateTimeHelper.setRelativeTimeRange("6-w");

  await pm.dashboardPanelActions.applyDashboardBtn();
  await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});
  await pm.dashboardPanelActions.addPanelName(panelName);
  await pm.dashboardPanelActions.savePanel();
}

/**
 * Wait for the search API response to complete.
 * The response may be SSE (streaming) or JSON, so we don't parse it.
 */
async function waitForSearchResponse(page) {
  const orgName = process.env.ORGNAME || "default";
  await page.waitForResponse(
    (resp) =>
      resp.url().includes(`/api/${orgName}/`) &&
      resp.url().includes("_search") &&
      resp.url().includes("type=logs") &&
      resp.status() === 200,
    { timeout: 30000 }
  );
  // Allow time for the UI to process the response and render
  await page.waitForTimeout(2000);
}

// Warning icon selector (from PanelErrorButtons.vue)
const WARNING_SELECTOR = '[data-test="panel-max-duration-warning"]';

// ============================================================================
// Test suite
// ============================================================================

test.describe("Dashboard Max Query Range", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    // Ingest data into our dedicated stream
    await ingestToStream(page);
    // Wait for stream to be indexed and available in the UI
    await page.waitForTimeout(2000);
  });

  // --------------------------------------------------------------------------
  // Scenario 1: Warning icon appears when query range exceeds max limit
  // --------------------------------------------------------------------------
  test(
    "should display max query range warning when time range exceeds the stream limit",
    { tag: ["@maxQueryRange", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      // Step 1: Create dashboard with wide time range (no restriction yet)
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await buildPanelWithWideRange(page, pm, "Max Query Panel", "area");

      // Step 2: Now set max query range to 2 hours on the stream
      await setMaxQueryRange(page,2);

      // Step 3: Navigate back to the dashboard and reload to trigger query with restriction
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);

      // Open the dashboard
      const dashboardRow = page
        .locator('//tr[.//div[@title="' + dashboardName + '"]]')
        .nth(0);
      await dashboardRow.locator('div[title="' + dashboardName + '"]').click();
      await page.waitForTimeout(2000);

      // Set time range to 6 weeks (dashboard level, re-triggers search)
      await waitForDateTimeButtonToBeEnabled(page);
      await pm.dateTimeHelper.setRelativeTimeRange("6-w");

      // Wait for the search to complete
      await waitForSearchResponse(page);

      // Step 4: Assert warning icon is visible on the panel
      await expect(page.locator(WARNING_SELECTOR).first()).toBeVisible({
        timeout: 15000,
      });

      testLogger.info("Warning icon is visible when query range exceeds max limit");

      // Step 5: Hover over the warning to verify tooltip text
      await page.locator(WARNING_SELECTOR).first().hover();
      const tooltip = page.locator(".q-tooltip");
      await expect(tooltip).toBeVisible({ timeout: 5000 });
      const tooltipText = await tooltip.textContent();
      expect(tooltipText).toContain("Query duration is modified due to query range restriction");
      expect(tooltipText).toContain("Data returned for:");

      testLogger.info("Tooltip text verified", { tooltipText });

      // Cleanup: delete dashboard and reset max query range
      await page.locator('[data-test="dashboard-back-btn"]').click();
      await deleteDashboard(page, dashboardName);
      await setMaxQueryRange(page,0);
    }
  );

  // --------------------------------------------------------------------------
  // Scenario 2: Warning disappears when time range is within the limit
  // --------------------------------------------------------------------------
  test(
    "should hide max query range warning when time range is within the stream limit",
    { tag: ["@maxQueryRange", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      // Step 1: Create dashboard with wide time range (no restriction yet)
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await buildPanelWithWideRange(page, pm, "Toggle Warning Panel", "bar");

      // Step 2: Set max query range to 4 hours
      await setMaxQueryRange(page,4);

      // Step 3: Navigate back to the dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      const dashboardRow = page
        .locator('//tr[.//div[@title="' + dashboardName + '"]]')
        .nth(0);
      await dashboardRow.locator('div[title="' + dashboardName + '"]').click();
      await page.waitForTimeout(2000);

      // Set time range to 6 weeks (exceeds 4h limit)
      await waitForDateTimeButtonToBeEnabled(page);
      await pm.dateTimeHelper.setRelativeTimeRange("6-w");
      await waitForSearchResponse(page);

      // Warning should be visible
      await expect(page.locator(WARNING_SELECTOR).first()).toBeVisible({
        timeout: 15000,
      });

      testLogger.info("Warning visible with 6-week range (exceeds 4h limit)");

      // Now set time range WITHIN the limit (2 hours)
      await waitForDateTimeButtonToBeEnabled(page);
      await pm.dateTimeHelper.setRelativeTimeRange("2-h");
      await waitForSearchResponse(page);

      // Warning should disappear
      await expect(page.locator(WARNING_SELECTOR)).not.toBeVisible({
        timeout: 15000,
      });

      testLogger.info("Warning hidden with 2-hour range (within 4h limit)");

      // Cleanup
      await page.locator('[data-test="dashboard-back-btn"]').click();
      await deleteDashboard(page, dashboardName);
      await setMaxQueryRange(page,0);
    }
  );

  // --------------------------------------------------------------------------
  // Scenario 3: Warning appears in panel editor (add_panel page) as well
  // --------------------------------------------------------------------------
  test(
    "should display max query range warning in the panel editor when range is exceeded",
    { tag: ["@maxQueryRange", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      // Step 1: Create dashboard first (no restriction yet)
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);

      // Step 2: Set max query range to 2 hours
      await setMaxQueryRange(page,2);

      // Step 3: Go back to dashboards, open the dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      const dashboardRow = page
        .locator('//tr[.//div[@title="' + dashboardName + '"]]')
        .nth(0);
      await dashboardRow.locator('div[title="' + dashboardName + '"]').click();
      await page.waitForTimeout(2000);

      // Add panel in editor — set time range BEFORE selecting stream
      // so the time picker buttons are not yet disabled by the restriction
      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.selectChartType("line");

      // Set wide time range first (before stream selection applies restriction)
      await waitForDateTimeButtonToBeEnabled(page);
      await pm.dateTimeHelper.setRelativeTimeRange("6-w");

      // Now select the stream and field
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(MAX_QUERY_STREAM);
      await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");

      // Click Apply to trigger the query (6-week range exceeds 2-hour limit)
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

      // The warning should be visible in the editor
      await expect(page.locator(WARNING_SELECTOR).first()).toBeVisible({
        timeout: 15000,
      });

      testLogger.info("Warning visible in panel editor when range exceeds max");

      // Save the panel so we can cleanly navigate back
      await pm.dashboardPanelActions.addPanelName("Editor Warning Panel");
      await pm.dashboardPanelActions.savePanel();

      // Go back to dashboard list and cleanup
      await page.locator('[data-test="dashboard-back-btn"]').click();
      await deleteDashboard(page, dashboardName);
      await setMaxQueryRange(page,0);
    }
  );

  // --------------------------------------------------------------------------
  // Scenario 4: Different chart types show the warning
  // --------------------------------------------------------------------------
  test(
    "should display max query range warning across different chart types",
    { tag: ["@maxQueryRange", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      // Step 1: Create dashboard and add panels with wide time range (no restriction yet)
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);

      const chartTypes = ["bar", "line", "pie"];

      for (let i = 0; i < chartTypes.length; i++) {
        const chartType = chartTypes[i];
        testLogger.info(`Adding panel with chart type: ${chartType}`);

        // First panel uses addPanel (empty dashboard), subsequent use addPanelToExistingDashboard
        if (i === 0) {
          await pm.dashboardCreate.addPanel();
        } else {
          await pm.dashboardCreate.addPanelToExistingDashboard();
        }
        await pm.chartTypeSelector.selectChartType(chartType);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream(MAX_QUERY_STREAM);
        await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");

        // Set wide time range in editor (no restriction yet)
        await waitForDateTimeButtonToBeEnabled(page);
        await pm.dateTimeHelper.setRelativeTimeRange("6-w");

        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

        await pm.dashboardPanelActions.addPanelName(`Panel_${chartType}`);
        await pm.dashboardPanelActions.savePanel();
      }

      // Step 2: Now set max query range to 2 hours
      await setMaxQueryRange(page,2);

      // Step 3: Navigate back to the dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      const dashboardRow = page
        .locator('//tr[.//div[@title="' + dashboardName + '"]]')
        .nth(0);
      await dashboardRow.locator('div[title="' + dashboardName + '"]').click();
      await page.waitForTimeout(2000);

      // Set time range to 6 weeks on dashboard view
      await waitForDateTimeButtonToBeEnabled(page);
      await pm.dateTimeHelper.setRelativeTimeRange("6-w");

      // Wait for all panels to load
      await page.waitForTimeout(5000);

      // All panels should show the warning
      const warningIcons = page.locator(WARNING_SELECTOR);
      const count = await warningIcons.count();
      expect(count).toBeGreaterThanOrEqual(chartTypes.length);

      testLogger.info(`All ${count} panels show max query range warning on dashboard view`);

      // Cleanup
      await page.locator('[data-test="dashboard-back-btn"]').click();
      await deleteDashboard(page, dashboardName);
      await setMaxQueryRange(page,0);
    }
  );

  // --------------------------------------------------------------------------
  // Scenario 5: Warning shows correct adjusted time range in tooltip
  // --------------------------------------------------------------------------
  test(
    "should show the correct adjusted time range in the warning tooltip",
    { tag: ["@maxQueryRange", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      // Step 1: Create dashboard with wide time range (no restriction yet)
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await buildPanelWithWideRange(page, pm, "Tooltip Range Panel", "line");

      // Step 2: Set max query range to 3 hours
      await setMaxQueryRange(page,3);

      // Step 3: Navigate back to the dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      const dashboardRow = page
        .locator('//tr[.//div[@title="' + dashboardName + '"]]')
        .nth(0);
      await dashboardRow.locator('div[title="' + dashboardName + '"]').click();
      await page.waitForTimeout(2000);

      // Set time range to 6 weeks
      await waitForDateTimeButtonToBeEnabled(page);
      await pm.dateTimeHelper.setRelativeTimeRange("6-w");
      await waitForSearchResponse(page);

      // Verify warning is present
      await expect(page.locator(WARNING_SELECTOR).first()).toBeVisible({
        timeout: 15000,
      });

      // Hover and verify the tooltip mentions the correct restriction hours
      await page.locator(WARNING_SELECTOR).first().hover();
      const tooltip = page.locator(".q-tooltip");
      await expect(tooltip).toBeVisible({ timeout: 5000 });
      const tooltipText = await tooltip.textContent();

      // Should mention "3 hours" since we set max query range to 3
      expect(tooltipText).toContain("restriction of 3 hours");
      expect(tooltipText).toContain("Data returned for:");

      testLogger.info("Tooltip correctly shows 3-hour restriction", { tooltipText });

      // Cleanup
      await page.locator('[data-test="dashboard-back-btn"]').click();
      await deleteDashboard(page, dashboardName);
      await setMaxQueryRange(page,0);
    }
  );

  // --------------------------------------------------------------------------
  // Scenario 6: No warning when no max query range is set (default 0)
  // --------------------------------------------------------------------------
  test(
    "should not display warning when max query range is not set on the stream",
    { tag: ["@maxQueryRange", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      // Ensure max query range is 0 (no limit)
      await setMaxQueryRange(page,0);

      // Create dashboard with panel and wide time range
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await buildPanelWithWideRange(page, pm, "No Limit Panel", "area");

      // Wait for search to complete
      await page.waitForTimeout(3000);

      // Warning should NOT be visible since there is no max query range limit
      await expect(page.locator(WARNING_SELECTOR)).not.toBeVisible({
        timeout: 5000,
      });

      testLogger.info("No warning shown when max query range is not set");

      // Cleanup
      await page.locator('[data-test="dashboard-back-btn"]').click();
      await deleteDashboard(page, dashboardName);
    }
  );

  // --------------------------------------------------------------------------
  // Scenario 7: Warning with multi-SQL queries on the same stream
  // --------------------------------------------------------------------------
  test(
    "should display max query range warning with multiple SQL queries on the same stream",
    { tag: ["@maxQueryRange", "@multiSQL", "@P2"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      // Step 1: Create dashboard and set max query range first
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await setMaxQueryRange(page, 2);

      // Step 2: Add panel with multiple SQL queries in the editor
      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.selectChartType("line");

      // Set wide time range BEFORE selecting stream (so buttons aren't disabled)
      await waitForDateTimeButtonToBeEnabled(page);
      await pm.dateTimeHelper.setRelativeTimeRange("6-w");

      // First query tab: select stream and field
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(MAX_QUERY_STREAM);
      await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");

      // Add a second query tab on the same stream
      await msql.addQueryTab(1);
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(MAX_QUERY_STREAM);
      await pm.chartTypeSelector.searchAndAddField("kubernetes_labels_name", "y");

      // Apply to trigger the query (6-week range exceeds 2-hour limit)
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

      // Warning should be visible in the panel editor
      await expect(page.locator(WARNING_SELECTOR).first()).toBeVisible({
        timeout: 15000,
      });

      testLogger.info("Warning visible with multi-SQL queries exceeding max range in editor");

      // Hover over the warning to verify tooltip
      await page.locator(WARNING_SELECTOR).first().hover();
      const tooltip = page.locator(".q-tooltip");
      await expect(tooltip).toBeVisible({ timeout: 5000 });
      const tooltipText = await tooltip.textContent();
      expect(tooltipText).toContain("Query duration is modified due to query range restriction");

      testLogger.info("Multi-SQL warning tooltip verified", { tooltipText });

      // Cleanup: delete dashboard via API and reset max query range
      const orgId = process.env.ORGNAME || "default";

      // Get the dashboard ID from the URL
      const currentUrl = page.url();
      const dashIdMatch = currentUrl.match(/dashboards\/([^/?]+)/);

      if (dashIdMatch) {
        // Delete dashboard via API
        await page.evaluate(
          async ({ orgId, dashId }) => {
            // First, get the folder for this dashboard
            const listResp = await fetch(`/api/${orgId}/dashboards`);
            const dashboards = await listResp.json();
            const dash = dashboards?.dashboards?.find(d => d.dashboardId === dashId || d.dashboard_id === dashId);
            const folderId = dash?.folderId || dash?.folder_id || "default";
            await fetch(`/api/${orgId}/folders/${folderId}/dashboards/${dashId}`, { method: "DELETE" });
          },
          { orgId, dashId: dashIdMatch[1] }
        );
        testLogger.info("Dashboard deleted via API");
      }

      await setMaxQueryRange(page, 0);
    }
  );

  // --------------------------------------------------------------------------
  // Cleanup: Delete the dedicated stream after all tests
  // --------------------------------------------------------------------------
  // test.afterAll(async ({ browser }) => {
  //   const context = await browser.newContext({
  //     storageState: "playwright-tests/utils/auth/user.json",
  //   });
  //   const page = await context.newPage();

  //   try {
  //     const pm = new PageManager(page);

  //     // Navigate to the app so the page context is ready
  //     const baseUrl = `${process.env["ZO_BASE_URL"]}?org_identifier=${process.env["ORGNAME"]}`;
  //     await page.goto(baseUrl);
  //     await page.waitForLoadState("domcontentloaded");

  //     // Delete the dedicated stream via API (this also effectively resets settings)
  //     await pm.streamsPage.deleteStreamViaAPI(MAX_QUERY_STREAM, "logs").catch(() => {
  //       testLogger.warn("Could not delete test stream in afterAll");
  //     });
  //   } catch (error) {
  //     testLogger.warn("afterAll cleanup error", { error: error.message });
  //   } finally {
  //     await context.close();
  //   }
  // });
});
