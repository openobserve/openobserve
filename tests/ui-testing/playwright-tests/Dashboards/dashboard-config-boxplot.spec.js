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
  setupBoxplotPanelWithConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");

// Feature: box plot panel type (PR #15925) — one box per category with min/quartiles/median/max,
// and a Whiskers option (min to max, or 1.5 × IQR).

// Numeric column of e2e_automate that only zinc-cp1 logs carry, spread from 0 to 5272 around a median of 56,
// so the min-max and IQR whiskers clearly differ.
const VALUE_FIELD = "took";
const TOOK_MIN = 0;
const TOOK_MAX = 5272;
// Every row carrying took also carries an HTTP code (200, 302 or 401), so took by code draws three boxes.
const CATEGORY_FIELD = "code";
const CODES = ["200", "302", "401"];
// The code column is only set on zinc-cp1 and ziox logs, so code by namespace draws a box for each.
const DRILLDOWN_CATEGORY_FIELD = "kubernetes_namespace_name";
const DRILLDOWN_VALUE_FIELD = "code";
const DRILLDOWN_NAMESPACE = "zinc-cp1";

// ConfigPanel's sentinel for an option left on Default.
const DEFAULT_VALUE = "__auto__";
const WHISKER_LABELS = ["Default (Min to max)", "Min to max", "1.5 × IQR"];
const IQR_LABEL = "1.5 × IQR";

// Well names and empty-well hints of a box plot (en-US).
const CATEGORY_WELL = "Category";
const VALUE_WELL = "Value";
const CATEGORY_HINT = "Add 0 or 1 label field here";
const VALUE_HINT = "Add 1 field here";
// panelValidation message for a box plot without exactly one value field.
const ONE_VALUE_ERROR = "Add one field for the";

// Custom SQL returning raw values: the browser computes the box itself, so IQR mode can split off outliers.
// Without a GROUP BY every projected column lands on the Value well, so only the value is selected.
const RAW_VALUES_SQL = `SELECT ${VALUE_FIELD} AS "y_axis_1" FROM "e2e_automate" WHERE ${VALUE_FIELD} IS NOT NULL`;
// First column of the builder's summary SQL, which the Value well keeps after the switch to custom mode.
const STALE_SUMMARY_ALIAS = "y_axis_1_min";

// Intercepted drilldown target, so the new tab never leaves the test network.
const DRILLDOWN_HOST = "https://example.com";
const DRILLDOWN_NAME = "Box Drilldown";

test.describe.configure({ mode: "parallel" });

test.describe("ConfigPanel — Box Plot Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test(
    "box plot: one box of raw values with min-max whiskers by default; wells, legend and Whiskers default persist after save",
    { tag: ["@dashboards", "@boxplotConfig", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const selector = pm.chartTypeSelector;
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupBoxplotPanelWithConfig(page, pm, dashboardName);
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);
      await selector.expectChartTypeSelected("boxplot");

      // Category / Value wells, no breakdown, and the value is read raw (the SQL computes the summary).
      await selector.expectAxisLayoutNames({ x: CATEGORY_WELL, y: VALUE_WELL });
      await expect(selector.breakdownLayout).toHaveCount(0);
      await selector.expectYAxisRawField(VALUE_FIELD);

      // Without a category everything lands in one box; min-max whiskers reach the data's extremes.
      const state = await actions.waitForBoxplot();
      expect(state.boxes).toHaveLength(1);
      const [box] = state.boxes;
      expect(box.low).toBe(TOOK_MIN);
      expect(box.high).toBe(TOOK_MAX);
      expect(box.low).toBeLessThanOrEqual(box.q1);
      expect(box.q1).toBeLessThanOrEqual(box.median);
      expect(box.median).toBeLessThanOrEqual(box.q3);
      expect(box.q3).toBeLessThanOrEqual(box.high);
      expect(state.outliers).toHaveLength(0);
      // One series per panel, so there is no legend.
      expect(state.legendShown).toBe(false);

      // Whiskers starts on Default, and its Default names the value it falls back to.
      await configs.expectConfigSelectValue(configs.boxplotWhiskerTrigger, DEFAULT_VALUE);
      expect(await configs.getBoxplotWhiskerOptionLabels()).toEqual(WHISKER_LABELS);

      await actions.savePanel();
      testLogger.info("Verifying box plot fields and Whiskers default persist after save");
      await reopenPanelConfig(page, pm);
      await selector.expectYAxisRawField(VALUE_FIELD);
      await configs.expectConfigSelectValue(configs.boxplotWhiskerTrigger, DEFAULT_VALUE);
      await actions.waitForChartToRender();
      expect((await actions.waitForBoxplot()).boxes[0].high).toBe(TOOK_MAX);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "category: draws one box per category value in order, caps the wells at one field each, and persists",
    { tag: ["@dashboards", "@boxplotConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const selector = pm.chartTypeSelector;
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();

      await setupBoxplotPanelWithConfig(page, pm, dashboardName, { categoryField: CATEGORY_FIELD });
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);

      // Categories are sorted by name, one box each, and each box is a valid five-number summary.
      const state = await actions.waitForBoxplot(CODES.length);
      expect(state.categories).toEqual(CODES);
      expect(state.boxes.map((b) => b.name)).toEqual(CODES);
      for (const box of state.boxes) {
        expect([box.low, box.q1, box.median, box.q3, box.high]).toEqual(
          [box.low, box.q1, box.median, box.q3, box.high].sort((a, b) => a - b)
        );
      }

      // One category and one value are the cap.
      await selector.expectAddFieldButtonEnabled("kubernetes_host", "x", false);
      await selector.expectAddFieldButtonEnabled("kubernetes_host", "y", false);

      await actions.savePanel();
      testLogger.info("Verifying category field persists after save");
      await reopenPanelConfig(page, pm);
      await expect(selector.xAxisLayout).toContainText(CATEGORY_FIELD);
      await actions.waitForChartToRender();
      expect((await actions.waitForBoxplot(CODES.length)).categories).toEqual(CODES);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "whiskers: 1.5 × IQR pulls the whiskers in to the fences with no outlier points and persists; Default resets to min-max",
    { tag: ["@dashboards", "@boxplotConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupBoxplotPanelWithConfig(page, pm, dashboardName);
      const minMax = (await actions.waitForBoxplot()).boxes[0];
      expect(minMax.high).toBe(TOOK_MAX);

      await configs.selectBoxplotWhisker(IQR_LABEL);
      await configs.expectConfigSelectValue(configs.boxplotWhiskerTrigger, "iqr");
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getBoxplotState())?.boxes?.[0]?.high).toBeLessThan(TOOK_MAX);

      const state = await actions.waitForBoxplot();
      const iqr = state.boxes[0];
      // Only the whiskers move: the quartiles and median are the same summary.
      expect(iqr.q1).toBe(minMax.q1);
      expect(iqr.median).toBe(minMax.median);
      expect(iqr.q3).toBe(minMax.q3);
      const fence = 1.5 * (iqr.q3 - iqr.q1);
      expect(iqr.high).toBeLessThanOrEqual(iqr.q3 + fence + 1e-9);
      expect(iqr.low).toBeGreaterThanOrEqual(iqr.q1 - fence - 1e-9);
      // A builder query never sends raw values to the browser, so no outlier points are drawn.
      expect(state.outliers).toHaveLength(0);

      await actions.savePanel();
      testLogger.info("Verifying Whiskers = 1.5 × IQR persists after save");
      await reopenPanelConfig(page, pm);
      await configs.expectConfigSelectValue(configs.boxplotWhiskerTrigger, "iqr");
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getBoxplotState())?.boxes?.[0]?.high).toBe(iqr.high);

      // Default drops the key, so the whiskers fall back to min-max.
      await configs.selectBoxplotWhisker(WHISKER_LABELS[0]);
      await configs.expectConfigSelectValue(configs.boxplotWhiskerTrigger, DEFAULT_VALUE);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getBoxplotState())?.boxes?.[0]?.high).toBe(TOOK_MAX);
      await actions.savePanel();

      await reopenPanelConfig(page, pm);
      await configs.expectConfigSelectValue(configs.boxplotWhiskerTrigger, DEFAULT_VALUE);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "custom SQL: raw values draw outlier points only with 1.5 × IQR whiskers",
    { tag: ["@dashboards", "@boxplotConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const selector = pm.chartTypeSelector;
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupBoxplotPanelWithConfig(page, pm, dashboardName);
      await selector.setCustomSQL(RAW_VALUES_SQL);
      // Replacing the seeded summary SQL changes the column count, so Value is not remapped from
      // y_axis_1_min; swap it by hand, as a user has to.
      await selector.waitForFieldListRow("y_axis_1");
      await selector.removeFieldIfPresent(STALE_SUMMARY_ALIAS, "y");
      await selector.searchAndAddField("y_axis_1", "y");
      await selector.waitForCustomQueryAxes(null, "y_axis_1");
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);

      // Min-max whiskers cover every value, so nothing is an outlier.
      let state = await actions.waitForBoxplot();
      expect(state.boxes).toHaveLength(1);
      expect(state.boxes[0].high).toBe(TOOK_MAX);
      expect(state.outliers).toHaveLength(0);

      await configs.selectBoxplotWhisker(IQR_LABEL);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getBoxplotState())?.outliers?.length ?? 0).toBeGreaterThan(0);

      state = await actions.waitForBoxplot();
      const [box] = state.boxes;
      expect(box.high).toBeLessThan(TOOK_MAX);
      // Every outlier sits past a whisker, on the box's own category, and the max is one of them.
      for (const [index, value] of state.outliers) {
        expect(index).toBe(0);
        expect(value < box.low || value > box.high).toBe(true);
      }
      expect(state.outliers.map(([, value]) => value)).toContain(TOOK_MAX);

      await actions.savePanel();
      testLogger.info("Verifying custom SQL box plot keeps its outliers after save");
      await reopenPanelConfig(page, pm);
      await configs.expectConfigSelectValue(configs.boxplotWhiskerTrigger, "iqr");
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getBoxplotState())?.outliers?.length ?? 0).toBeGreaterThan(0);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "wells: an empty Value is flagged and blocks save, and a box plot never takes a breakdown",
    { tag: ["@dashboards", "@boxplotConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const selector = pm.chartTypeSelector;
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();

      await setupBoxplotPanelWithConfig(page, pm, dashboardName, { valueField: null });
      await expect(selector.xAxisLayout).toContainText(CATEGORY_HINT);
      await expect(selector.yAxisLayout).toContainText(VALUE_HINT);
      await expect(actions.dashboardErrorItems.first()).toContainText(ONE_VALUE_ERROR);
      await actions.savePanelExpectingBlocked(ONE_VALUE_ERROR);
      testLogger.info("Missing value field blocks save");

      await expect(selector.breakdownLayout).toHaveCount(0);
      await selector.expectAddFieldButtonAbsent("kubernetes_host", "b");

      // A category is optional: one value alone is enough to save.
      await selector.searchAndAddField(VALUE_FIELD, "y");
      await selector.expectYAxisRawField(VALUE_FIELD);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);
      await actions.waitForBoxplot();
      // Clear the earlier error toasts so savePanel() waits for the real navigation.
      await actions.dismissErrorToasts();
      await actions.savePanel();
      await expect(page).not.toHaveURL(/\/add_panel/);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "switching type: bar to box plot reads the value raw and draws a box per time bucket; back to bar hides Whiskers",
    { tag: ["@dashboards", "@boxplotConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const selector = pm.chartTypeSelector;
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupBarPanelWithConfig(page, pm, dashboardName);
      await expect(configs.boxplotWhisker).toHaveCount(0);

      // Swap the bar's measure for the numeric column so the boxes have values to summarise.
      await selector.removeField("y_axis_1", "y");
      await selector.searchAndAddField(VALUE_FIELD, "y");

      await selector.selectChartType("boxplot");
      // The bar's histogram(_timestamp) stays as the category, and the value loses its aggregation.
      await expect(selector.xAxisLayout).toContainText("_timestamp");
      await selector.expectYAxisRawField(VALUE_FIELD);
      await configs.expandAllConfigSections();
      await configs.scrollSidebarToElement(configs.boxplotWhisker);
      await expect(configs.boxplotWhisker).toBeVisible();
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);
      const state = await actions.waitForBoxplot();
      // Time-bucket categories are formatted timestamps.
      expect(state.categories.every((c) => /\d{4}-\d{2}-\d{2}/.test(c))).toBe(true);

      await selector.selectChartType("bar");
      await configs.expandAllConfigSections();
      await expect(configs.boxplotWhisker).toHaveCount(0);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      expect(await actions.getBoxplotState()).toBeNull();

      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );

  test(
    "drilldown: clicking a box opens the drilldown with that box's category",
    { tag: ["@dashboards", "@boxplotConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();

      await pm.dashboardDrilldown.stubDrilldownHost(DRILLDOWN_HOST);
      await setupBoxplotPanelWithConfig(page, pm, dashboardName, {
        valueField: DRILLDOWN_VALUE_FIELD,
        categoryField: DRILLDOWN_CATEGORY_FIELD,
      });
      await pm.dashboardDrilldown.addDrilldownByURL(
        DRILLDOWN_NAME,
        `${DRILLDOWN_HOST}/?category=\${series.__name}`,
        { openInNewTab: true }
      );
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await actions.savePanel();

      const clicked = await actions.clickBoxplotBox(DRILLDOWN_NAMESPACE);
      testLogger.info("Clicked box for drilldown", { name: clicked.name });
      await expect(pm.dashboardDrilldown.drilldownMenu).toBeVisible({ timeout: 10000 });

      const popup = await pm.dashboardDrilldown.openDrilldownInNewTab(DRILLDOWN_NAME, /example\.com/);
      expect(new URL(popup.url()).searchParams.get("category")).toBe(DRILLDOWN_NAMESPACE);
      await popup.close();

      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );
});
