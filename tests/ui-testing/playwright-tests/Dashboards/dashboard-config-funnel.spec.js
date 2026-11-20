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
  setupFunnelPanelWithConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");

// Funnel panel type (PR #15924): one stage per X value, sized by the Y value. Options: Stage order
// (Largest first / Smallest first / Query order), Orientation (Vertical / Horizontal) and Show percent of
// first stage. Every option offers "Default (…)", which drops the key from the saved panel.

// The e2e_automate namespaces have clearly different log counts, so stage order is observable on the chart.
const STAGE_FIELD = "kubernetes_namespace_name";
// The namespace with the most logs in the fixture: always the largest stage.
const LARGEST_STAGE = "ziox";

// ConfigPanel's sentinel for an option left on Default, which the select and the toggle group report.
const DEFAULT_VALUE = "__auto__";

const SORT_LABELS = ["Default (Largest first)", "Largest first", "Smallest first", "Query order"];
const ORIENT_LABELS = ["Default (Vertical)", "Vertical", "Horizontal"];

// Query builder hints shown in the empty wells of a funnel (en-US).
const STAGE_HINT = "Add 1 label field here";
const VALUE_HINT = "Add 1 values field here";
// panelValidation message for a funnel without exactly one stage field.
const ONE_FIELD_ERROR = "Add one field for the";

// Intercepted drilldown target, so the new tab never leaves the test network.
const DRILLDOWN_HOST = "https://example.com";
const DRILLDOWN_NAME = "Stage Drilldown";

/** Stage names ordered by value, largest first (or smallest first with `ascending`). */
const namesByValue = (state, ascending = false) =>
  [...state.stages]
    .sort((a, b) => (ascending ? a.value - b.value : b.value - a.value))
    .map((stage) => stage.name);

test.describe.configure({ mode: "parallel" });

test.describe("ConfigPanel — Funnel Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test(
    "funnel: renders one stage per value, largest first and vertical by default, options show their defaults, persists after save",
    { tag: ["@dashboards", "@funnelConfig", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupFunnelPanelWithConfig(page, pm, dashboardName, { stageField: STAGE_FIELD });
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);
      await pm.chartTypeSelector.expectChartTypeSelected("funnel");
      // Value defaults to a count.
      await expect(pm.chartTypeSelector.yAxisLayout).toContainText("count(");

      const state = await actions.waitForFunnel();
      expect(state.sort).toBe("descending");
      expect(state.orient).toBe("vertical");
      expect(state.stages.length).toBeGreaterThan(1);
      expect(state.stages.map((s) => s.name)).toContain(LARGEST_STAGE);
      // Largest first: drawn top to bottom from the largest stage down.
      expect(actions.funnelDrawOrder(state)).toEqual(namesByValue(state));
      expect(actions.funnelDrawOrder(state)[0]).toBe(LARGEST_STAGE);

      // Every option starts on Default, and each Default names the value it falls back to.
      await configs.expectConfigSelectValue(configs.funnelSortTrigger, DEFAULT_VALUE);
      await configs.expectFunnelOrient(DEFAULT_VALUE);
      await configs.expectConfigToggle(configs.funnelShowPercent, false);
      expect(await configs.getFunnelSortOptionLabels()).toEqual(SORT_LABELS);
      expect(await configs.getFunnelOrientOptionLabels()).toEqual(ORIENT_LABELS);

      await actions.savePanel();
      testLogger.info("Verifying funnel stage field and defaults persist after save");
      await reopenPanelConfig(page, pm);
      await expect(pm.chartTypeSelector.xAxisLayout).toContainText(STAGE_FIELD);
      await configs.expectConfigSelectValue(configs.funnelSortTrigger, DEFAULT_VALUE);
      await configs.expectFunnelOrient(DEFAULT_VALUE);
      await actions.waitForChartToRender();
      expect((await actions.waitForFunnel()).sort).toBe("descending");
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "stage order: Smallest first and Query order redraw the funnel and persist; Default resets to largest first",
    { tag: ["@dashboards", "@funnelConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupFunnelPanelWithConfig(page, pm, dashboardName, { stageField: STAGE_FIELD });
      await actions.waitForFunnel();

      // Smallest first: ECharts lays the stages out from the bottom, so top to bottom runs smallest to largest.
      await configs.selectFunnelSort("Smallest first");
      await configs.expectConfigSelectValue(configs.funnelSortTrigger, "ascending");
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getFunnelState())?.sort).toBe("ascending");
      let state = await actions.waitForFunnel();
      expect(actions.funnelDrawOrder(state)).toEqual(namesByValue(state, true));
      expect(actions.funnelDrawOrder(state).at(-1)).toBe(LARGEST_STAGE);

      // Query order: stages are drawn in the order the query returned them, not by size.
      await configs.selectFunnelSort("Query order");
      await configs.expectConfigSelectValue(configs.funnelSortTrigger, "none");
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getFunnelState())?.sort).toBe("none");
      state = await actions.waitForFunnel();
      expect(actions.funnelDrawOrder(state)).toEqual(state.stages.map((s) => s.name));

      await actions.savePanel();
      testLogger.info("Verifying Stage order = Query order persists after save");
      await reopenPanelConfig(page, pm);
      await configs.expectConfigSelectValue(configs.funnelSortTrigger, "none");
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getFunnelState())?.sort).toBe("none");

      // Default drops the key, so the funnel falls back to largest first.
      await configs.selectFunnelSort("Default (Largest first)");
      await configs.expectConfigSelectValue(configs.funnelSortTrigger, DEFAULT_VALUE);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getFunnelState())?.sort).toBe("descending");
      await actions.savePanel();

      await reopenPanelConfig(page, pm);
      await configs.expectConfigSelectValue(configs.funnelSortTrigger, DEFAULT_VALUE);
      state = await actions.waitForFunnel();
      expect(actions.funnelDrawOrder(state)[0]).toBe(LARGEST_STAGE);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "orientation: Horizontal lays stages left to right and persists; Default resets to vertical",
    { tag: ["@dashboards", "@funnelConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupFunnelPanelWithConfig(page, pm, dashboardName, { stageField: STAGE_FIELD });
      await actions.waitForFunnel();

      await configs.selectFunnelOrient("Horizontal", "horizontal");
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getFunnelState())?.orient).toBe("horizontal");
      let state = await actions.waitForFunnel();
      // Still largest first, now read left to right.
      expect(actions.funnelDrawOrder(state)).toEqual(namesByValue(state));
      const xs = state.stages.map((s) => s.x);
      const ys = state.stages.map((s) => s.y);
      // Stage centres spread along the width, not the height.
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys));

      await actions.savePanel();
      testLogger.info("Verifying Orientation = Horizontal persists after save");
      await reopenPanelConfig(page, pm);
      await configs.expectFunnelOrient("horizontal");
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getFunnelState())?.orient).toBe("horizontal");

      await configs.selectFunnelOrient("Default (Vertical)", DEFAULT_VALUE);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getFunnelState())?.orient).toBe("vertical");
      state = await actions.waitForFunnel();
      expect(actions.funnelDrawOrder(state)[0]).toBe(LARGEST_STAGE);
      await actions.savePanel();

      await reopenPanelConfig(page, pm);
      await configs.expectFunnelOrient(DEFAULT_VALUE);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "show percent: labels gain each stage's percent of the largest stage and it persists; off removes it",
    { tag: ["@dashboards", "@funnelConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      const largestLabel = async () =>
        (await actions.getFunnelState())?.stages.find((s) => s.name === LARGEST_STAGE)?.labelText ?? "";

      await setupFunnelPanelWithConfig(page, pm, dashboardName, { stageField: STAGE_FIELD });
      await actions.waitForFunnel();
      await expect.poll(largestLabel).toContain(LARGEST_STAGE);
      expect(await largestLabel()).not.toContain("%");

      await configs.setConfigToggle(configs.funnelShowPercent, true);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      // Percents are of the largest stage, so the largest one reads 100%.
      await expect.poll(largestLabel).toContain("(100%)");

      await actions.savePanel();
      testLogger.info("Verifying Show percent = on persists after save");
      await reopenPanelConfig(page, pm);
      await configs.expectConfigToggle(configs.funnelShowPercent, true);
      await actions.waitForChartToRender();
      await expect.poll(largestLabel).toContain("(100%)");

      // Off is the default, so the key is dropped and the percent leaves the labels.
      await configs.setConfigToggle(configs.funnelShowPercent, false);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(largestLabel).not.toContain("%");
      await actions.savePanel();

      await reopenPanelConfig(page, pm);
      await configs.expectConfigToggle(configs.funnelShowPercent, false);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "wells: one stage field and one value, no breakdown; a missing stage field is flagged and blocks save",
    { tag: ["@dashboards", "@funnelConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const selector = pm.chartTypeSelector;
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();

      // No stage field: the empty well asks for one label field and the panel will not save.
      await setupFunnelPanelWithConfig(page, pm, dashboardName, { stageField: null });
      await expect(selector.xAxisLayout).toContainText(STAGE_HINT);
      await expect(actions.dashboardErrorItems.first()).toContainText(ONE_FIELD_ERROR);
      await actions.savePanelExpectingBlocked(ONE_FIELD_ERROR);
      testLogger.info("Missing stage field blocks save");

      // A funnel never takes a breakdown: there is no Breakdown well and no +B button.
      await expect(selector.breakdownLayout).toHaveCount(0);
      await selector.expectAddFieldButtonAbsent("kubernetes_host", "b");

      await selector.searchAndAddField(STAGE_FIELD, "x");
      // One stage field and one value are the cap.
      await selector.expectAddFieldButtonEnabled("kubernetes_container_name", "x", false);
      await selector.expectAddFieldButtonEnabled("kubernetes_host", "y", false);

      // Without a value the funnel cannot size its stages.
      await selector.removeField("y_axis_1", "y");
      await expect(selector.yAxisLayout).toContainText(VALUE_HINT);
      await actions.applyDashboardBtn();
      await expect(actions.dashboardErrorItems.filter({ hasText: ONE_FIELD_ERROR })).toHaveCount(1);
      await actions.savePanelExpectingBlocked(ONE_FIELD_ERROR);
      testLogger.info("Missing value field blocks save");

      await selector.searchAndAddField("kubernetes_host", "y");
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);
      await actions.waitForFunnel();
      // Clear the earlier error toasts so savePanel() waits for the real navigation.
      await actions.dismissErrorToasts();
      await actions.savePanel();
      await expect(page).not.toHaveURL(/\/add_panel/);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "switching type: funnel to pie hides the funnel options; back to funnel restores them and the stages",
    { tag: ["@dashboards", "@funnelConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();

      await setupFunnelPanelWithConfig(page, pm, dashboardName, { stageField: STAGE_FIELD });
      await actions.waitForFunnel();
      await expect(configs.funnelSort).toBeVisible();

      await pm.chartTypeSelector.selectChartType("pie");
      await configs.expandAllConfigSections();
      await expect(configs.funnelSort).toHaveCount(0);
      await expect(configs.funnelOrient).toHaveCount(0);
      await expect(configs.funnelShowPercent).toHaveCount(0);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      expect(await actions.getFunnelState()).toBeNull();

      await pm.chartTypeSelector.selectChartType("funnel");
      await configs.expandAllConfigSections();
      await configs.scrollSidebarToElement(configs.funnelSort);
      await expect(configs.funnelSort).toBeVisible();
      await expect(configs.funnelOrient).toBeVisible();
      await expect(configs.funnelShowPercent).toBeVisible();
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);
      const state = await actions.waitForFunnel();
      expect(state.stages.map((s) => s.name)).toContain(LARGEST_STAGE);

      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );

  test(
    "drilldown: clicking a stage opens the drilldown with that stage's name",
    { tag: ["@dashboards", "@funnelConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();

      await page.context().route(`${DRILLDOWN_HOST}/**`, (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>drilldown</body></html>" })
      );

      await setupFunnelPanelWithConfig(page, pm, dashboardName, { stageField: STAGE_FIELD });
      await pm.dashboardDrilldown.addDrilldownByURL(
        DRILLDOWN_NAME,
        `${DRILLDOWN_HOST}/?stage=\${series.__name}`,
        { openInNewTab: true }
      );
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await actions.savePanel();

      const clicked = await actions.clickLargestFunnelStage();
      testLogger.info("Clicked funnel stage for drilldown", { name: clicked.name });
      expect(clicked.name).toBe(LARGEST_STAGE);
      await expect(pm.dashboardDrilldown.drilldownMenu).toBeVisible({ timeout: 10000 });

      const popupPromise = page.context().waitForEvent("page");
      await pm.dashboardDrilldown.drilldownMenuItem(DRILLDOWN_NAME).click();
      const popup = await popupPromise;
      await popup.waitForURL(/example\.com/, { timeout: 15000 });
      expect(new URL(popup.url()).searchParams.get("stage")).toBe(clicked.name);
      await popup.close();

      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );
});
