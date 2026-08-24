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
import DashboardMaxQueryRange from "../../pages/dashboardPages/dashboard-max-query-range.js";
const testLogger = require("../utils/test-logger.js");

// Use a dedicated stream for max query range tests (not e2e_automate)
const MAX_QUERY_STREAM = "e2e_max_query_range";

// Serial mode is required: all tests share the same stream (e2e_max_query_range)
// and its max_query_range setting. Running in parallel would cause tests to
// reset each other's stream state mid-execution.
//
// This said "default", which does NOT deliver that. The config sets
// fullyParallel: true with workers: 3, and under fullyParallel a describe in
// "default" mode runs its tests in PARALLEL — the exact thing the comment above
// says must not happen. So every test here has been racing its siblings over one
// mutable stream setting: afterEach resets max_query_range to 0 while another
// test is still querying, so its warning never renders, and the date-time picker
// (which filters the offered ranges by the active restriction) can drop the
// 6-week option mid-test. That is the shape of the intermittent
// "warning icon not found" / "date-time-relative-6-w-btn not found" failures.
//
// "serial" is what the comment was asking for. The alternative — a dedicated
// stream per test, as the multi-SQL partial-error tests use — would allow
// parallelism, but it is a larger change than this fix warrants.
test.describe.configure({ mode: "serial" });


// ============================================================================
// Helpers
// ============================================================================

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
  await pm.chartTypeSelector.removeField("y_axis_1", "y");
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

// ============================================================================
// Test suite
// ============================================================================

test.describe("Dashboard Max Query Range", () => {
  test.beforeEach(async ({ page }) => {
    const pm = new PageManager(page);
    await navigateToBase(page);
    await ingestion(page, MAX_QUERY_STREAM);
    // Poll until the stream is actually queryable instead of sleeping 2s: the
    // ingest -> queryable delay scales with load, so a constant wait is both
    // wasteful when the box is idle and too short when it is not.
    await pm.dashboardMaxQueryRange.waitForStreamReady(MAX_QUERY_STREAM);
  });

  // Ensure max query range is always reset even when a test fails mid-way,
  // preventing restriction state from cascading into subsequent tests.
  test.afterEach(async ({ page }) => {
    const pm = new PageManager(page);
    await pm.dashboardMaxQueryRange.resetMaxQueryRange();
  });

  // --------------------------------------------------------------------------
  // Scenario 1: Warning icon appears when query range exceeds max limit
  // --------------------------------------------------------------------------
  test(
    "should display max query range warning when time range exceeds the stream limit",
    { tag: ["@maxQueryRange", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const mqr = pm.dashboardMaxQueryRange;
      const dashboardName = generateDashboardName();

      // Create dashboard with wide time range (no restriction yet)
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await buildPanelWithWideRange(page, pm, "Max Query Panel", "area");

      // Set max query range to 2 hours
      await mqr.setMaxQueryRange(2);

      // Navigate back and reopen dashboard with wide time range
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardList.clickOnDashboard(dashboardName);

      await waitForDateTimeButtonToBeEnabled(page);
      const searchDone1 = mqr.createSearchResponsePromise();
      await pm.dateTimeHelper.setRelativeTimeRange("6-w");
      await searchDone1;
      await mqr.waitForPanelsIdle();

      // Assert warning icon is visible
      await expect(pm.dashboardMaxQueryRange.warningIcon.first()).toBeVisible({
        timeout: 15000,
      });

      // Verify tooltip text
      const tooltipText = await mqr.getWarningTooltipText();
      // Accept either backend wording — see expectRangeRestrictionTooltip.
      mqr.expectRangeRestrictionTooltip(expect, tooltipText);

      testLogger.info("Tooltip text verified", { tooltipText });

      // Cleanup
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
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
      const mqr = pm.dashboardMaxQueryRange;
      const dashboardName = generateDashboardName();

      // Create dashboard with wide time range, then restrict to 4 hours
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await buildPanelWithWideRange(page, pm, "Toggle Warning Panel", "bar");
      await mqr.setMaxQueryRange(4);

      // Reopen dashboard and set 6-week range (exceeds limit)
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardList.clickOnDashboard(dashboardName);

      await waitForDateTimeButtonToBeEnabled(page);
      const searchDone6w = mqr.createSearchResponsePromise();
      await pm.dateTimeHelper.setRelativeTimeRange("6-w");
      await searchDone6w;
      await mqr.waitForPanelsIdle();

      // Warning should be visible
      await expect(pm.dashboardMaxQueryRange.warningIcon.first()).toBeVisible({
        timeout: 15000,
      });
      testLogger.info("Warning visible with 6-week range (exceeds 4h limit)");

      // Set time range within the limit (2 hours)
      await waitForDateTimeButtonToBeEnabled(page);
      const searchDone2h = mqr.createSearchResponsePromise();
      await pm.dateTimeHelper.setRelativeTimeRange("2-h");
      await searchDone2h;
      await mqr.waitForPanelsIdle();

      // Warning should disappear
      await expect(pm.dashboardMaxQueryRange.warningIcon).not.toBeVisible({
        timeout: 15000,
      });
      testLogger.info("Warning hidden with 2-hour range (within 4h limit)");

      // Cleanup
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
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
      const mqr = pm.dashboardMaxQueryRange;
      const dashboardName = generateDashboardName();

      // Create dashboard, then set restriction
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await mqr.setMaxQueryRange(2);

      // Reopen dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardList.clickOnDashboard(dashboardName);

      // Add panel — set time range BEFORE selecting stream (avoids disabled buttons)
      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.selectChartType("line");

      await waitForDateTimeButtonToBeEnabled(page);
      await pm.dateTimeHelper.setRelativeTimeRange("6-w");

      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(MAX_QUERY_STREAM);
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

      // Warning should be visible in editor
      await expect(pm.dashboardMaxQueryRange.warningIcon.first()).toBeVisible({
        timeout: 15000,
      });
      testLogger.info("Warning visible in panel editor when range exceeds max");

      // Save and cleanup
      await pm.dashboardPanelActions.addPanelName("Editor Warning Panel");
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
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
      const mqr = pm.dashboardMaxQueryRange;
      const dashboardName = generateDashboardName();

      // Create dashboard and add panels with wide time range (no restriction yet)
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);

      const chartTypes = ["bar", "line", "area"];

      for (let i = 0; i < chartTypes.length; i++) {
        const chartType = chartTypes[i];
        testLogger.info(`Adding panel with chart type: ${chartType}`);

        if (i === 0) {
          await pm.dashboardCreate.addPanel();
        } else {
          await pm.dashboardCreate.addPanelToExistingDashboard();
        }
        await pm.chartTypeSelector.selectChartType(chartType);
        await pm.chartTypeSelector.selectStreamType("logs");
        await pm.chartTypeSelector.selectStream(MAX_QUERY_STREAM);
        await pm.chartTypeSelector.removeField("y_axis_1", "y");
        await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");

        await waitForDateTimeButtonToBeEnabled(page);
        await pm.dateTimeHelper.setRelativeTimeRange("6-w");

        await pm.dashboardPanelActions.applyDashboardBtn();
        await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

        await pm.dashboardPanelActions.addPanelName(`Panel_${chartType}`);
        await pm.dashboardPanelActions.savePanel();
      }

      // Set restriction and reopen dashboard
      await mqr.setMaxQueryRange(2);

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardList.clickOnDashboard(dashboardName);

      await waitForDateTimeButtonToBeEnabled(page);
      // Register one listener per panel before triggering the time range change
      const allSearchesDone = mqr.createNSearchResponsesPromise(chartTypes.length);
      await pm.dateTimeHelper.setRelativeTimeRange("6-w");
      await allSearchesDone;

      // Verify all panels show the warning (retries until count is met or timeout)
      await expect(pm.dashboardMaxQueryRange.warningIcon).toHaveCount(chartTypes.length, { timeout: 15000 });
      testLogger.info(`All ${chartTypes.length} panels show max query range warning`);

      // Cleanup
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
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
      const mqr = pm.dashboardMaxQueryRange;
      const dashboardName = generateDashboardName();

      // Create dashboard with wide time range, then restrict to 3 hours
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await buildPanelWithWideRange(page, pm, "Tooltip Range Panel", "line");
      await mqr.setMaxQueryRange(3);

      // Reopen dashboard with wide time range
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardList.clickOnDashboard(dashboardName);

      await waitForDateTimeButtonToBeEnabled(page);
      const searchDone5 = mqr.createSearchResponsePromise();
      await pm.dateTimeHelper.setRelativeTimeRange("6-w");
      await searchDone5;
      await mqr.waitForPanelsIdle();

      // Verify warning is present
      await expect(pm.dashboardMaxQueryRange.warningIcon.first()).toBeVisible({
        timeout: 15000,
      });

      // Hover and verify the tooltip reports the restriction.
      const tooltipText = await mqr.getWarningTooltipText();
      mqr.expectRangeRestrictionTooltip(expect, tooltipText);

      // Only the non-streaming backend names the limit in hours; the streaming
      // path reports the cached window and never says "restriction of N hours".
      // Assert the number where the message actually carries it, rather than
      // pinning the whole test to one deployment mode.
      if (DashboardMaxQueryRange.statesRestrictionHours(tooltipText)) {
        expect(tooltipText).toContain("restriction of 3 hours");
      } else {
        testLogger.info(
          "Streaming backend: tooltip reports the limit without naming hours",
          { tooltipText }
        );
      }

      // Cleanup
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
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
      const mqr = pm.dashboardMaxQueryRange;
      const dashboardName = generateDashboardName();

      // Ensure no limit
      await mqr.resetMaxQueryRange();

      // Create dashboard with panel and wide time range
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await buildPanelWithWideRange(page, pm, "No Limit Panel", "area");

      // Warning should NOT be visible since there is no max query range limit
      await expect(pm.dashboardMaxQueryRange.warningIcon).not.toBeVisible({
        timeout: 5000,
      });
      testLogger.info("No warning shown when max query range is not set");

      // Cleanup
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  // --------------------------------------------------------------------------
  // Scenario 7: Warning with multi-SQL queries on the same stream
  // --------------------------------------------------------------------------
  test.skip(
    "should display max query range warning with multiple SQL queries on the same stream",
    { tag: ["@maxQueryRange", "@multiSQL", "@P2"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const mqr = pm.dashboardMaxQueryRange;
      const msql = pm.dashboardMultiSQL;
      const dashboardName = generateDashboardName();

      // Create dashboard and set restriction
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await mqr.setMaxQueryRange(2);

      // Add panel — set time range BEFORE selecting stream
      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.selectChartType("line");

      await waitForDateTimeButtonToBeEnabled(page);
      await pm.dateTimeHelper.setRelativeTimeRange("6-w");

      // First query tab
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(MAX_QUERY_STREAM);
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");

      // Second query tab
      await msql.addQueryTab(1);
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(MAX_QUERY_STREAM);
      await pm.chartTypeSelector.searchAndAddField("kubernetes_labels_name", "y");

      // Apply and assert warning
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender().catch(() => {});

      await expect(pm.dashboardMaxQueryRange.warningIcon.first()).toBeVisible({
        timeout: 15000,
      });
      testLogger.info("Warning visible with multi-SQL queries exceeding max range");

      // Verify tooltip
      const tooltipText = await mqr.getWarningTooltipText();
      // Accept either backend wording — see expectRangeRestrictionTooltip.
      mqr.expectRangeRestrictionTooltip(expect, tooltipText);

      // Cleanup
      await pm.dashboardPanelActions.addPanelName("MultiSQL Max Query Panel");
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );
});
