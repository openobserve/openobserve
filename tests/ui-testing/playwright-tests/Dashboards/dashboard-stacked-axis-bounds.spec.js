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
  setupStackedPanelWithConfig,
  setupBarPanelWithBreakdownAndConfig,
  setupPromQLStackedPanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
import { stackExtent, tallestPoint, waitForValueAxisFit } from "./utils/stackedAxisHelpers.js";
const testLogger = require("../utils/test-logger.js");
const { ensureMetricsIngested } = require("../utils/shared-metrics-setup.js");

// Below any real stack of the ingested counts, so a kept bound would visibly clip the chart.
const CLIPPING_MAX = "1";
const ROOMY_MAX = "100000000";
const maxApplied = (fit) => fit.max !== null;
const minApplied = (fit) => fit.min !== null;

test.describe.configure({ mode: "parallel" });

test.describe("Stacked panels — user y-axis bounds never clip a stack (SQL)", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test(
    "stacked: y max below the tallest stack widens to the stack sum; saved value stays as typed",
    { tag: ["@dashboardStackedAxisBounds", "@dashboards", "@P0", "@all"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupStackedPanelWithConfig(page, pm, dashboardName);
      await pm.dashboardPanelConfigs.Y_AxisMax(CLIPPING_MAX);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      const fit = await waitForValueAxisFit(pm, expect, { ready: maxApplied });
      const { hi } = stackExtent(fit.series);
      testLogger.info("Stacked fit in editor", { max: fit.max, tallestStack: hi });
      expect(hi).toBeGreaterThan(Number(CLIPPING_MAX));
      expect(fit.max).toBeCloseTo(hi, 6);

      await pm.dashboardPanelActions.savePanel();
      const savedFit = await waitForValueAxisFit(pm, expect, { ready: maxApplied });
      expect(savedFit.max).toBeCloseTo(stackExtent(savedFit.series).hi, 6);
      testLogger.info("Saved dashboard panel keeps the full stacks", { max: savedFit.max });

      await reopenPanelConfig(page, pm);
      await expect(pm.dashboardPanelConfigs.yAxisMaxField).toHaveValue(CLIPPING_MAX);
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "stacked: y max above every stack is kept as set",
    { tag: ["@dashboardStackedAxisBounds", "@dashboards", "@P1", "@all"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupStackedPanelWithConfig(page, pm, dashboardName);
      await pm.dashboardPanelConfigs.Y_AxisMax(ROOMY_MAX);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      const fit = await waitForValueAxisFit(pm, expect, { ready: maxApplied });
      const { hi } = stackExtent(fit.series);
      testLogger.info("Roomy max", { max: fit.max, tallestStack: hi });
      expect(hi).toBeLessThan(Number(ROOMY_MAX));
      expect(fit.max).toBe(Number(ROOMY_MAX));

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "stacked: y min above zero widens down to the bar baseline; an unset max stays automatic",
    { tag: ["@dashboardStackedAxisBounds", "@dashboards", "@P1", "@all"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupStackedPanelWithConfig(page, pm, dashboardName);
      await pm.dashboardPanelConfigs.Y_AxisMin("5");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      const fit = await waitForValueAxisFit(pm, expect, { ready: minApplied });
      testLogger.info("Stacked min fit", { min: fit.min, max: fit.max });
      expect(fit.min).toBe(0);
      expect(fit.max).toBeNull();

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "h-stacked: the value (x) axis max widens to the stack sum",
    { tag: ["@dashboardStackedAxisBounds", "@dashboards", "@P1", "@all"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupStackedPanelWithConfig(page, pm, dashboardName, { chartType: "h-stacked" });
      await pm.dashboardPanelConfigs.Y_AxisMax(CLIPPING_MAX);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      const fit = await waitForValueAxisFit(pm, expect, { valueAxis: "xAxis", ready: maxApplied });
      const { hi } = stackExtent(fit.series);
      testLogger.info("h-stacked fit", { max: fit.max, tallestStack: hi });
      expect(hi).toBeGreaterThan(Number(CLIPPING_MAX));
      expect(fit.max).toBeCloseTo(hi, 6);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "area-stacked: y max below the tallest stack widens to the stack sum",
    { tag: ["@dashboardStackedAxisBounds", "@dashboards", "@P1", "@all"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupStackedPanelWithConfig(page, pm, dashboardName, { chartType: "area-stacked" });
      await pm.dashboardPanelConfigs.Y_AxisMax(CLIPPING_MAX);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      const fit = await waitForValueAxisFit(pm, expect, { ready: maxApplied });
      const { hi } = stackExtent(fit.series);
      testLogger.info("area-stacked fit", { max: fit.max, tallestStack: hi });
      expect(hi).toBeGreaterThan(Number(CLIPPING_MAX));
      expect(fit.max).toBeCloseTo(hi, 6);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "bar (not stacked): y max widens only to the tallest single bar, never to a stack sum",
    { tag: ["@dashboardStackedAxisBounds", "@dashboards", "@P2", "@all"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);
      await pm.dashboardPanelConfigs.Y_AxisMax(CLIPPING_MAX);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      const fit = await waitForValueAxisFit(pm, expect, { ready: maxApplied });
      const tallestBar = tallestPoint(fit.series);
      // Summing every series per bucket is what the bound would be if bars were wrongly treated as one stack.
      const asOneStack = stackExtent(fit.series.map((s) => ({ ...s, stack: "all" }))).hi;
      testLogger.info("Bar fits its tallest bar", { max: fit.max, tallestBar, asOneStack });
      expect(tallestBar).toBeGreaterThan(Number(CLIPPING_MAX));
      expect(asOneStack).toBeGreaterThan(tallestBar);
      expect(fit.max).toBe(tallestBar);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );
});

test.describe("Stacked panels — user y-axis bounds never clip a stack (PromQL)", () => {
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test(
    "PromQL stacked: y max below the tallest stack widens to the stack sum",
    { tag: ["@dashboardStackedAxisBounds", "@dashboards", "@promql", "@P1", "@all"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupPromQLStackedPanelWithConfig(page, pm, dashboardName);
      // cpu_usage is a percentage, so a sub-1 max always cuts into its stack.
      await pm.dashboardPanelConfigs.Y_AxisMax("0.001");
      await pm.dashboardPanelActions.applyAndWaitForPromQLQuery();

      const fit = await waitForValueAxisFit(pm, expect, { ready: maxApplied });
      const { hi } = stackExtent(fit.series);
      testLogger.info("PromQL stacked fit", { max: fit.max, tallestStack: hi });
      expect(hi).toBeGreaterThan(0.001);
      expect(fit.max).toBeCloseTo(hi, 6);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );
});
