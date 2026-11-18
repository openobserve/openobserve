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
  setupSunburstPanelWithConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");

// Feature: sunburst panel type (PR #15923) — rings up to 5 levels deep, one per Group field plus an
// optional Sub-group outer ring, sized by count/sum; clicking a slice re-roots the chart; a
// "Show labels" option; drilldown passes the clicked slice's own name.

// Low-cardinality columns of the e2e_automate fixture, innermost ring first.
const NAMESPACE = "kubernetes_namespace_name";
const CONTAINER = "kubernetes_container_name";
const HOST = "kubernetes_host";
const POD = "kubernetes_pod_name";
const STREAM = "stream";
// One namespace value present in the fixture, so the inner ring is checked against real data.
const KNOWN_NAMESPACE = "monitoring";

// Builder well names and hints for a sunburst (en-US).
const WELL_NAMES = { x: "Group", y: "Size", b: "Sub-group" };
const GROUP_HINT = "Up to 5 fields, one ring each";

// panelValidation messages for sunburst.
const NO_GROUP_ERROR = "Add at least one field for the";
const SIZE_ERROR = "Size must be a count or a sum";

// Intercepted drilldown target, so the new tab never leaves the test network.
const DRILLDOWN_HOST = "https://example.com";
const DRILLDOWN_NAME = "Slice Drilldown";

test.describe.configure({ mode: "parallel" });

test.describe("ConfigPanel — Sunburst Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test(
    "sunburst: Group/Size/Sub-group wells, count size by default, one ring per level, persists after save",
    { tag: ["@dashboards", "@sunburstConfig", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();

      await setupSunburstPanelWithConfig(page, pm, dashboardName, {
        groupFields: [NAMESPACE, CONTAINER],
        subGroupField: STREAM,
      });
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);

      await pm.chartTypeSelector.expectChartTypeSelected("sunburst");
      await pm.chartTypeSelector.expectAxisLayoutNames(WELL_NAMES);
      // Size defaults to a count, the additive aggregation inner rings can sum.
      await expect(pm.chartTypeSelector.yAxisLayout).toContainText("count(");

      // Two group fields + one sub-group = three rings, the namespaces on the innermost one.
      const state = await actions.waitForSunburst();
      expect(state.depth).toBe(3);
      expect(state.rootNames).toContain(KNOWN_NAMESPACE);
      expect(state.labelsShown).toBe(true);
      expect(state.nodeClick).toBe("rootToNode");
      expect(new Set(state.slices.map((s) => s.depth))).toEqual(new Set([1, 2, 3]));

      // Show labels is on by default.
      await pm.dashboardPanelConfigs.expectSunburstShowLabels(true);

      await actions.savePanel();
      testLogger.info("Verifying sunburst fields persist after save");
      await reopenPanelConfig(page, pm);
      await expect(pm.chartTypeSelector.xAxisLayout).toContainText(NAMESPACE);
      await expect(pm.chartTypeSelector.xAxisLayout).toContainText(CONTAINER);
      await pm.chartTypeSelector.expectBreakdownLayoutContains(STREAM);
      await actions.waitForChartToRender();
      expect((await actions.waitForSunburst()).depth).toBe(3);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "show labels: turning it off hides the ring labels and persists; turning it on restores them",
    { tag: ["@dashboards", "@sunburstConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupSunburstPanelWithConfig(page, pm, dashboardName, { groupFields: [NAMESPACE, CONTAINER] });
      await actions.waitForChartToRender();

      await configs.setSunburstShowLabels(false);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getSunburstState())?.labelsShown).toBe(false);

      await actions.savePanel();
      testLogger.info("Verifying Show labels = off persists after save");
      await reopenPanelConfig(page, pm);
      await configs.expectSunburstShowLabels(false);
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getSunburstState())?.labelsShown).toBe(false);

      // Back on: the default, so the key is dropped and labels return.
      await configs.setSunburstShowLabels(true);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getSunburstState())?.labelsShown).toBe(true);
      await actions.savePanel();

      await reopenPanelConfig(page, pm);
      await configs.expectSunburstShowLabels(true);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "clicking a slice re-roots the chart to that slice",
    { tag: ["@dashboards", "@sunburstConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();

      await setupSunburstPanelWithConfig(page, pm, dashboardName, { groupFields: [NAMESPACE, CONTAINER] });
      await actions.waitForChartToRender();
      const before = await actions.waitForSunburst();
      expect(before.viewRoot).toBe("");
      const innerNames = before.slices.filter((s) => s.depth === 1).map((s) => s.name);
      expect(innerNames.length).toBeGreaterThan(1);

      const clicked = await actions.clickLargestSunburstSlice(1);
      testLogger.info("Clicked sunburst slice", { name: clicked.name });

      await expect.poll(async () => (await actions.getSunburstState())?.viewRoot).toBe(clicked.name);
      // Once re-rooted, the other inner-ring slices are no longer drawn.
      await expect
        .poll(async () => {
          const state = await actions.getSunburstState();
          return state.slices.filter((s) => s.depth === 1 && s.name !== clicked.name).length;
        })
        .toBe(0);

      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );

  test(
    "level cap: five rings across group and sub-group disable adding more fields",
    { tag: ["@dashboards", "@sunburstConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const selector = pm.chartTypeSelector;
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();

      await setupSunburstPanelWithConfig(page, pm, dashboardName, {
        groupFields: [NAMESPACE, CONTAINER, HOST],
      });
      // Three rings: both a group and the sub-group can still be added.
      await selector.expectAddFieldButtonEnabled(POD, "x", true);
      await selector.expectAddFieldButtonEnabled(STREAM, "b", true);

      // Four groups + the sub-group = five rings, the cap.
      await selector.searchAndAddField(POD, "x");
      await selector.searchAndAddField(STREAM, "b");
      await selector.expectAddFieldButtonEnabled("kubernetes_docker_id", "x", false);
      await selector.expectAddFieldButtonEnabled("level", "x", false);

      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);
      expect((await actions.waitForSunburst()).depth).toBe(5);

      // Dropping the sub-group frees one level, so a group can be added again.
      await selector.removeField("breakdown_1", "b");
      await selector.expectAddFieldButtonEnabled("level", "x", true);
      await selector.searchAndAddField("level", "x");
      // Five group fields: the cap is reached and no sub-group fits either.
      await selector.expectAddFieldButtonEnabled("kubernetes_docker_id", "x", false);
      await selector.expectAddFieldButtonEnabled(STREAM, "b", false);

      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "validation: no group field and a non-additive size are flagged and block save",
    { tag: ["@dashboards", "@sunburstConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const selector = pm.chartTypeSelector;
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();

      // No group field: the empty Group well explains the ring rule and the panel will not save.
      await setupSunburstPanelWithConfig(page, pm, dashboardName, { groupFields: [] });
      await expect(selector.xAxisLayout).toContainText(GROUP_HINT);
      await expect(actions.dashboardErrorItems.first()).toContainText(NO_GROUP_ERROR);
      await actions.savePanelExpectingBlocked(NO_GROUP_ERROR);
      testLogger.info("Missing group field blocks save");

      await selector.searchAndAddField(NAMESPACE, "x");
      // max cannot be summed into the inner rings, so it is rejected.
      await selector.configureYAxisFunction("y_axis_1", "max");
      await actions.applyDashboardBtn();
      await expect(actions.dashboardErrorItems.filter({ hasText: SIZE_ERROR })).toHaveCount(1);
      await actions.savePanelExpectingBlocked(SIZE_ERROR);
      testLogger.info("Non-additive size blocks save");

      await selector.configureYAxisFunction("y_axis_1", "count");
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);
      await actions.waitForSunburst();
      // Clear the earlier error toasts so savePanel() waits for the real navigation.
      await actions.dismissErrorToasts();
      await actions.savePanel();
      await expect(page).not.toHaveURL(/\/add_panel/);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "switching type: sunburst to pie hides Show labels; back to sunburst restores the option and rings",
    { tag: ["@dashboards", "@sunburstConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();

      await setupSunburstPanelWithConfig(page, pm, dashboardName, { groupFields: [NAMESPACE] });
      await actions.waitForChartToRender();
      await configs.expectSunburstShowLabels(true);

      await pm.chartTypeSelector.selectChartType("pie");
      await configs.expandAllConfigSections();
      await expect(configs.sunburstShowLabels).toHaveCount(0);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      expect(await actions.getSunburstState()).toBeNull();

      await pm.chartTypeSelector.selectChartType("sunburst");
      await pm.chartTypeSelector.expectAxisLayoutNames(WELL_NAMES);
      await configs.expandAllConfigSections();
      await configs.expectSunburstShowLabels(true);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);
      const state = await actions.waitForSunburst();
      expect(state.depth).toBe(1);
      expect(state.rootNames).toContain(KNOWN_NAMESPACE);

      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );

  test(
    "drilldown: clicking a slice opens the drilldown with that slice's name instead of re-rooting",
    { tag: ["@dashboards", "@sunburstConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();

      await page.context().route(`${DRILLDOWN_HOST}/**`, (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>drilldown</body></html>" })
      );

      await setupSunburstPanelWithConfig(page, pm, dashboardName, { groupFields: [NAMESPACE, CONTAINER] });
      await pm.dashboardDrilldown.addDrilldownByURL(
        DRILLDOWN_NAME,
        `${DRILLDOWN_HOST}/?slice=\${series.__name}`,
        { openInNewTab: true }
      );
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      // With a drilldown, a click opens the menu, so the chart must not also re-root.
      await expect.poll(async () => (await actions.getSunburstState())?.nodeClick).toBe(false);
      await actions.savePanel();

      const clicked = await actions.clickLargestSunburstSlice(1);
      testLogger.info("Clicked sunburst slice for drilldown", { name: clicked.name });
      await expect(pm.dashboardDrilldown.drilldownMenu).toBeVisible({ timeout: 10000 });
      expect((await actions.getSunburstState()).viewRoot).toBe("");

      const popupPromise = page.context().waitForEvent("page");
      await pm.dashboardDrilldown.drilldownMenuItem(DRILLDOWN_NAME).click();
      const popup = await popupPromise;
      await popup.waitForURL(/example\.com/, { timeout: 15000 });
      expect(new URL(popup.url()).searchParams.get("slice")).toBe(clicked.name);
      await popup.close();

      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );
});
