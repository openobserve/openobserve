const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  reopenPanelConfig,
  discardAndCleanupTestDashboard,
  setupBarPanelWithConfig,
  setupDistributionPanelWithConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");

// Feature: distribution panel type (PR #15920) — a histogram of raw values with
// bucket count, bucket size and bucket offset options.

// Numeric column of the e2e_automate fixture (HTTP status codes), so the histogram has real values to bucket.
const NUMERIC_FIELD = "code";
const BREAKDOWN_FIELD = "kubernetes_namespace_name";

// Placeholders built by defaultPlaceholder(): "Default: {value}".
const COUNT_PLACEHOLDER = "Default: 30";
const SIZE_PLACEHOLDER = "Default: Auto";
const OFFSET_PLACEHOLDER = "Default: 0";

// Query Limit help text and placeholder for a raw-value chart with no limit set (10,000-row cap).
const RAW_ROW_LIMIT_HELP = "At 0, the chart reads at most 10,000 raw rows";
const RAW_ROW_LIMIT_PLACEHOLDER = "10000";

// panelConfigRangeError messages for distribution_bucket_count (1..1000) and distribution_bucket_size (> 0).
const BUCKET_COUNT_ERROR = "Bucket count must be between 1 and 1000";
const BUCKET_SIZE_ERROR = "Bucket size must be greater than 0";

test.describe.configure({ mode: "parallel" });

test.describe("ConfigPanel — Distribution Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test(
    "distribution: renders raw values with no X axis and shows bucket options with their defaults",
    { tag: ["@dashboards", "@distributionConfig", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupDistributionPanelWithConfig(page, pm, dashboardName);
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);

      // The chart picker marks Distribution as the selected type.
      await pm.chartTypeSelector.expectChartTypeSelected("distribution");

      // A histogram buckets the y values, so there is no X axis drop zone; Breakdown stays available.
      await pm.chartTypeSelector.expectXAxisLayoutVisible(false);
      await pm.chartTypeSelector.expectBreakdownLayoutContains();
      // The y field is read raw, never aggregated.
      await pm.chartTypeSelector.expectYAxisRawField(NUMERIC_FIELD);

      await configs.scrollSidebarToElement(configs.distributionBucketCount);
      await expect(configs.distributionBucketCount).toBeVisible();
      await expect(configs.distributionBucketSize).toBeVisible();
      await expect(configs.distributionBucketOffset).toBeVisible();
      await configs.expectDistributionBuckets({ count: "", size: "", offset: "" });
      await expect(configs.distributionBucketCountField).toHaveAttribute("placeholder", COUNT_PLACEHOLDER);
      await expect(configs.distributionBucketSizeField).toHaveAttribute("placeholder", SIZE_PLACEHOLDER);
      await expect(configs.distributionBucketOffsetField).toHaveAttribute("placeholder", OFFSET_PLACEHOLDER);
      await expect(configs.distributionBucketCountField).toBeEnabled();

      // Query Limit explains the raw-row cap while no limit is set.
      await configs.scrollSidebarToElement(configs.queryLimit);
      await expect(configs.queryLimitField).toHaveAttribute("placeholder", RAW_ROW_LIMIT_PLACEHOLDER);
      await expect(configs.queryLimit).toContainText(RAW_ROW_LIMIT_HELP);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "bucket count and offset: chart re-renders and both values persist after save",
    { tag: ["@dashboards", "@distributionConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupDistributionPanelWithConfig(page, pm, dashboardName);

      await configs.setDistributionBucketCount("5");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);
      await expect(pm.dashboardPanelActions.dashboardErrorItems).toHaveCount(0);

      await configs.setDistributionBucketOffset("0.5");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);
      await expect(pm.dashboardPanelActions.dashboardErrorItems).toHaveCount(0);

      await pm.dashboardPanelActions.savePanel();
      testLogger.info("Verifying bucket count and offset persist after save");
      await reopenPanelConfig(page, pm);
      await configs.expectDistributionBuckets({ count: "5", size: "", offset: "0.5" });
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "bucket size: setting it disables bucket count, clearing it enables count again, and it persists",
    { tag: ["@dashboards", "@distributionConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupDistributionPanelWithConfig(page, pm, dashboardName);

      await configs.setDistributionBucketSize("50");
      await expect(configs.distributionBucketCountField).toBeDisabled();
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);

      await configs.setDistributionBucketSize("");
      await expect(configs.distributionBucketCountField).toBeEnabled();
      await expect(configs.distributionBucketSizeField).toHaveAttribute("placeholder", SIZE_PLACEHOLDER);

      await configs.setDistributionBucketSize("100");
      await expect(configs.distributionBucketCountField).toBeDisabled();
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);

      await pm.dashboardPanelActions.savePanel();
      testLogger.info("Verifying bucket size persists and still disables bucket count after save");
      await reopenPanelConfig(page, pm);
      await configs.expectDistributionBuckets({ count: "", size: "100", offset: "" });
      await expect(configs.distributionBucketCountField).toBeDisabled();
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "clearing saved bucket values resets them to their defaults after save",
    { tag: ["@dashboards", "@distributionConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupDistributionPanelWithConfig(page, pm, dashboardName);
      await configs.setDistributionBucketCount("10");
      await configs.setDistributionBucketOffset("2");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.savePanel();

      await reopenPanelConfig(page, pm);
      await configs.expectDistributionBuckets({ count: "10", size: "", offset: "2" });
      await configs.setDistributionBucketCount("");
      await configs.setDistributionBucketOffset("");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);
      await pm.dashboardPanelActions.savePanel();

      testLogger.info("Verifying cleared bucket values persist as unset after save");
      await reopenPanelConfig(page, pm);
      await configs.expectDistributionBuckets({ count: "", size: "", offset: "" });
      await expect(configs.distributionBucketCountField).toHaveAttribute("placeholder", COUNT_PLACEHOLDER);
      await expect(configs.distributionBucketOffsetField).toHaveAttribute("placeholder", OFFSET_PLACEHOLDER);
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "validation: out-of-range bucket count and zero bucket size are flagged inline and block save",
    { tag: ["@dashboards", "@distributionConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupDistributionPanelWithConfig(page, pm, dashboardName);

      for (const invalidCount of ["0", "1001"]) {
        await configs.setDistributionBucketCount(invalidCount);
        await expect(configs.distributionBucketCountError).toContainText(BUCKET_COUNT_ERROR);
        await pm.dashboardPanelActions.savePanelExpectingBlocked(BUCKET_COUNT_ERROR);
        testLogger.info("Out-of-range bucket count blocks save", { invalidCount });
      }

      await configs.setDistributionBucketCount("1000");
      await expect(configs.distributionBucketCountError).toBeHidden();

      // A set bucket size replaces the count, so only the size reports an error.
      await configs.setDistributionBucketSize("0");
      await expect(configs.distributionBucketSizeError).toContainText(BUCKET_SIZE_ERROR);
      await expect(configs.distributionBucketCountField).toBeDisabled();
      await pm.dashboardPanelActions.savePanelExpectingBlocked(BUCKET_SIZE_ERROR);
      testLogger.info("Zero bucket size blocks save");

      await configs.setDistributionBucketSize("10");
      await expect(configs.distributionBucketSizeError).toBeHidden();
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await expect(pm.dashboardPanelActions.dashboardErrorItems).toHaveCount(0);
      // Clear the earlier error toasts so savePanel() waits for the real navigation.
      await pm.dashboardPanelActions.dismissErrorToasts();
      await pm.dashboardPanelActions.savePanel();
      await expect(page).not.toHaveURL(/\/add_panel/);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "breakdown: stacks the histogram by a field and the breakdown persists after save",
    { tag: ["@dashboards", "@distributionConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupDistributionPanelWithConfig(page, pm, dashboardName, { breakdownField: BREAKDOWN_FIELD });
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);
      await expect(pm.dashboardPanelActions.dashboardErrorItems).toHaveCount(0);

      await pm.chartTypeSelector.expectBreakdownLayoutContains(BREAKDOWN_FIELD);

      await pm.dashboardPanelActions.savePanel();
      testLogger.info("Verifying breakdown persists after save");
      await reopenPanelConfig(page, pm);
      await pm.chartTypeSelector.expectBreakdownLayoutContains(BREAKDOWN_FIELD);
      await pm.chartTypeSelector.expectXAxisLayoutVisible(false);
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "switching type: bar to distribution drops the X axis and aggregation; back to bar hides the bucket options",
    { tag: ["@dashboards", "@distributionConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupBarPanelWithConfig(page, pm, dashboardName);
      await pm.chartTypeSelector.expectXAxisLayoutVisible(true);
      await expect(configs.distributionBucketCount).toHaveCount(0);

      // Swap the bar's measure for the numeric column so the histogram has values to bucket.
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField(NUMERIC_FIELD, "y");

      await pm.chartTypeSelector.selectChartType("distribution");
      await pm.chartTypeSelector.expectXAxisLayoutVisible(false);
      await pm.chartTypeSelector.expectYAxisRawField(NUMERIC_FIELD);
      await configs.expandAllConfigSections();
      await configs.scrollSidebarToElement(configs.distributionBucketCount);
      await expect(configs.distributionBucketSize).toBeVisible();
      await expect(configs.distributionBucketOffset).toBeVisible();
      await configs.setDistributionBucketCount("8");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);
      await expect(pm.dashboardPanelActions.dashboardErrorItems).toHaveCount(0);

      await pm.chartTypeSelector.selectChartType("bar");
      await configs.expandAllConfigSections();
      await expect(configs.distributionBucketCount).toHaveCount(0);
      await expect(configs.distributionBucketSize).toHaveCount(0);
      await expect(configs.distributionBucketOffset).toHaveCount(0);
      await pm.chartTypeSelector.expectXAxisLayoutVisible(true);

      // Leave the panel unsaved: a bar switched back from distribution has no X field until one is added.
      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );
});
