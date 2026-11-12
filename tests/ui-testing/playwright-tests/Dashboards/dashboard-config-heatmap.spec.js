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
  setupHeatmapPanelWithConfig,
  setupPromQLHeatmapPanelWithConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");
const { ensureMetricsIngested } = require("../utils/shared-metrics-setup.js");

const NUMERIC_Y_FIELD = "code";
const COLOR_RANGE_INLINE_ERROR = "Min must be less than max; the automatic range is used instead";
const COLOR_RANGE_PANEL_ERROR = "Heatmap color scale min must be less than max";
const Y_BUCKET_SIZE_INLINE_ERROR = "Enter a bucket size greater than 0";
const Y_BUCKET_SIZE_PANEL_ERROR = "Heatmap y-axis bucket size must be greater than 0";
const Y_RANGE_INLINE_ERROR = "Min must be less than max; the full range is used instead";
const Y_RANGE_PANEL_ERROR = "Heatmap Y min must be less than Y max";

test.describe.configure({ mode: "parallel" });

test.describe("ConfigPanel — Heatmap Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test(
    "colour controls: shown with defaults for heatmap, axis border hidden, gone after switching to bar",
    { tag: ["@dashboards", "@heatmapConfig", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupHeatmapPanelWithConfig(page, pm, dashboardName);
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);

      await expect(configs.heatmapColorMin).toBeVisible();
      await expect(configs.heatmapColorMax).toBeVisible();
      await expect(configs.heatmapColorMinField).toHaveValue("");
      await expect(configs.heatmapColorMaxField).toHaveValue("");
      await expect(configs.heatmapPaletteTrigger).toHaveAttribute("data-test-selected-value", "spectral");
      await expect(configs.heatmapPaletteReverseBtn).toHaveAttribute("aria-checked", "false");
      await expect(configs.heatmapColorScale).toHaveAttribute("data-test-selected-value", "sqrt");
      await expect(configs.heatmapYSort).toHaveAttribute("data-test-selected-value", "data");
      testLogger.info("Heatmap colour controls visible with defaults");

      // A saved heatmap always draws its axis lines, so the border toggle is hidden for it.
      await expect(configs.axisBorder).toBeHidden();
      // Y bucketing only applies to a numeric y field; namespace name is a string.
      await expect(configs.heatmapYBucket).toBeHidden();
      await expect(configs.heatmapHistogramMode).toBeHidden();

      await pm.chartTypeSelector.selectChartType("bar");
      await expect(configs.heatmapColorMin).toBeHidden();
      await expect(configs.heatmapPalette).toBeHidden();
      await expect(configs.heatmapColorScale).toBeHidden();
      await expect(configs.heatmapYSort).toBeHidden();
      await expect(configs.axisBorder).toBeVisible();
      testLogger.info("Heatmap controls hidden after switching to bar");

      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );

  test(
    "colour range, palette, reverse and log scale: apply → chart renders; reopen → all persist",
    { tag: ["@dashboards", "@heatmapConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupHeatmapPanelWithConfig(page, pm, dashboardName);

      await configs.setHeatmapColorRange("1", "50");
      await configs.selectHeatmapPalette("Viridis");
      await expect(configs.heatmapPaletteTrigger).toHaveAttribute("data-test-selected-value", "viridis");
      await configs.toggleHeatmapPaletteReverse();
      await configs.selectHeatmapColorScale("Log", "log");
      await expect(configs.heatmapColorMaxError).toBeHidden();

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);
      await expect(pm.dashboardPanelActions.dashboardErrorItems).toHaveCount(0);
      testLogger.info("Heatmap colour settings applied");

      await pm.dashboardPanelActions.savePanel();
      testLogger.info("Verifying heatmap colour settings persist after save");
      await reopenPanelConfig(page, pm);
      await expect(configs.heatmapColorMinField).toHaveValue("1");
      await expect(configs.heatmapColorMaxField).toHaveValue("50");
      await expect(configs.heatmapPaletteTrigger).toHaveAttribute("data-test-selected-value", "viridis");
      await expect(configs.heatmapPaletteReverseBtn).toHaveAttribute("aria-checked", "true");
      await expect(configs.heatmapColorScale).toHaveAttribute("data-test-selected-value", "log");

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "inverted colour range: flagged inline and in panel errors, save blocked; fixing it allows save",
    { tag: ["@dashboards", "@heatmapConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupHeatmapPanelWithConfig(page, pm, dashboardName);

      await configs.setHeatmapColorRange("100", "10");
      await expect(configs.heatmapColorMaxError).toBeVisible();
      await expect(configs.heatmapColorMaxError).toContainText(COLOR_RANGE_INLINE_ERROR);

      await pm.dashboardPanelActions.applyDashboardBtn();
      await expect(pm.dashboardPanelActions.dashboardErrorItems).toContainText([COLOR_RANGE_PANEL_ERROR]);
      testLogger.info("Inverted colour range flagged");

      await pm.dashboardPanelActions.savePanel();
      await expect(page).toHaveURL(/\/add_panel/);
      testLogger.info("Save blocked while colour range is inverted");

      await configs.setHeatmapColorRange("10", "100");
      await expect(configs.heatmapColorMaxError).toBeHidden();
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await expect(pm.dashboardPanelActions.dashboardErrorItems).toHaveCount(0);

      await pm.dashboardPanelActions.savePanel();
      await expect(page).not.toHaveURL(/\/add_panel/);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "y-axis order: set Descending → apply → chart renders; reopen → persists",
    { tag: ["@dashboards", "@heatmapConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupHeatmapPanelWithConfig(page, pm, dashboardName);

      await configs.selectHeatmapYSort("Descending", "desc");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);
      testLogger.info("Heatmap y-axis order set to Descending");

      await pm.dashboardPanelActions.savePanel();
      await reopenPanelConfig(page, pm);
      await expect(configs.heatmapYSort).toHaveAttribute("data-test-selected-value", "desc");

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "y-axis buckets on numeric y: fixed size + y range persist; log mode offers a base",
    { tag: ["@dashboards", "@heatmapConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupHeatmapPanelWithConfig(page, pm, dashboardName, { yField: NUMERIC_Y_FIELD });

      await expect(configs.heatmapYBucket).toBeVisible();
      await expect(configs.heatmapYBucket).toHaveAttribute("data-test-selected-value", "none");
      await expect(configs.heatmapYMin).toBeHidden();

      await configs.selectHeatmapYBucketMode("Fixed size", "size");
      await configs.setHeatmapYBucketSize("100");
      await configs.setHeatmapYRange("0", "1000");
      // Bucketed rows are always ordered by value, so "Data order" is withdrawn.
      await expect(configs.getHeatmapYSortOption("Data order")).toHaveCount(0);
      await expect(configs.heatmapYSort).toHaveAttribute("data-test-selected-value", "asc");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);
      await expect(pm.dashboardPanelActions.dashboardErrorItems).toHaveCount(0);
      testLogger.info("Fixed-size y buckets applied");

      await pm.dashboardPanelActions.savePanel();
      await reopenPanelConfig(page, pm);
      await expect(configs.heatmapYBucket).toHaveAttribute("data-test-selected-value", "size");
      await expect(configs.heatmapYBucketSizeField).toHaveValue("100");
      await expect(configs.heatmapYMinField).toHaveValue("0");
      await expect(configs.heatmapYMaxField).toHaveValue("1000");
      testLogger.info("Fixed-size y buckets persisted");

      await configs.selectHeatmapYBucketMode("Log", "log");
      await expect(configs.heatmapYBucketSize).toBeHidden();
      await expect(configs.heatmapYBucketBase).toBeVisible();
      await configs.selectHeatmapYBucketBase("2");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.verifyChartHasData(expect);
      testLogger.info("Log y buckets (base 2) applied");

      await pm.dashboardPanelActions.savePanel();
      await reopenPanelConfig(page, pm);
      await expect(configs.heatmapYBucket).toHaveAttribute("data-test-selected-value", "log");
      await expect(configs.heatmapYBucketBase).toHaveAttribute("data-test-selected-value", "2");

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "y-axis bucket validation: size 0 and inverted y range are flagged inline and block save",
    { tag: ["@dashboards", "@heatmapConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupHeatmapPanelWithConfig(page, pm, dashboardName, { yField: NUMERIC_Y_FIELD });

      await configs.selectHeatmapYBucketMode("Fixed size", "size");
      await configs.setHeatmapYBucketSize("0");
      await expect(configs.heatmapYBucketSizeError).toContainText(Y_BUCKET_SIZE_INLINE_ERROR);
      // Apply only reports the empty builder query; the heatmap-specific reason surfaces on save.
      await pm.dashboardPanelActions.savePanel();
      await expect(pm.dashboardPanelActions.getErrorToastWithText(Y_BUCKET_SIZE_PANEL_ERROR)).toBeVisible();
      await expect(page).toHaveURL(/\/add_panel/);
      testLogger.info("Zero bucket size blocks save");

      await configs.setHeatmapYBucketSize("100");
      await expect(configs.heatmapYBucketSizeError).toBeHidden();
      await configs.setHeatmapYRange("500", "100");
      await expect(configs.heatmapYMaxError).toContainText(Y_RANGE_INLINE_ERROR);
      await pm.dashboardPanelActions.savePanel();
      await expect(pm.dashboardPanelActions.getErrorToastWithText(Y_RANGE_PANEL_ERROR)).toBeVisible();
      await expect(page).toHaveURL(/\/add_panel/);
      testLogger.info("Inverted y range blocks save");

      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );
});

test.describe("ConfigPanel — PromQL Heatmap Settings", () => {
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test(
    "Prometheus histogram mode: toggle shows bucket unit and hides y-axis order; persists after save",
    { tag: ["@dashboards", "@heatmapConfig", "@promql", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupPromQLHeatmapPanelWithConfig(page, pm, dashboardName);

      await expect(configs.heatmapColorScale).toBeVisible();
      await expect(configs.heatmapHistogramMode).toBeVisible();
      await expect(configs.heatmapHistogramModeBtn).toHaveAttribute("aria-checked", "false");
      await expect(configs.heatmapYSort).toBeVisible();
      await expect(configs.heatmapBucketUnit).toBeHidden();
      // Y bucketing is generated in builder SQL, so PromQL never offers it.
      await expect(configs.heatmapYBucket).toBeHidden();

      await configs.toggleHeatmapHistogramMode();
      await expect(configs.heatmapBucketUnit).toBeVisible();
      await expect(configs.heatmapYSort).toBeHidden();
      testLogger.info("Prometheus histogram mode enabled");

      await pm.dashboardPanelActions.savePanel();
      await reopenPanelConfig(page, pm);
      await expect(configs.heatmapHistogramModeBtn).toHaveAttribute("aria-checked", "true");
      await expect(configs.heatmapBucketUnit).toBeVisible();

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );
});
