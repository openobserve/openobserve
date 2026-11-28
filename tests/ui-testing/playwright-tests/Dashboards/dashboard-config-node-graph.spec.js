const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { NODE_GRAPH_FIXTURE } from "./utils/dashIngestion.js";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  reopenPanelConfig,
  discardAndCleanupTestDashboard,
  setupNodeGraphPanelWithConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");

// Node graph panel type (PR #15926): nodes and directed edges from Source, Target and Value fields (the sankey
// builder), drawn with a force or circular layout and optional edge value labels in compact numbers.

const { sourceField: SOURCE, targetField: TARGET, valueField: VALUE } = NODE_GRAPH_FIXTURE;
// web → api is sent twice and merged into one edge; worker → worker is a self call, never drawn as an edge.
const NODE_NAMES = ["api", "cache", "db", "web", "worker"];
const EDGE_PAIRS = [
  ["web", "api"],
  ["api", "db"],
  ["db", "cache"],
  ["cache", "api"],
  ["api", "worker"],
];
const SELF_NODE = "worker";
const SELF_MARK = "↻";

// ConfigPanel's sentinel for an option left on Default, which the toggle group reports.
const DEFAULT_VALUE = "__auto__";
const LAYOUT_LABELS = ["Default (Force)", "Force", "Circular"];
// The panel's edge curveness, which tells the two layouts apart on the live chart.
const FORCE_CURVENESS = 0.12;
const CIRCULAR_CURVENESS = 0.3;

// Builder hints and panelValidation messages for a node graph (en-US).
const EMPTY_HINT = "Add 1 field here";
const SOURCE_ERROR = "Add one field for the source";
const TARGET_ERROR = "Add one field for the target";
const VALUE_ERROR = "Add one field for the value";

// Intercepted drilldown target, so the new tab never leaves the test network.
const DRILLDOWN_HOST = "https://example.com";
const DRILLDOWN_NAME = "Node Drilldown";

const sortedNames = (state) => state.nodes.map((n) => n.name).sort();
const sortedPairs = (state) => state.edges.map((e) => `${e.source}->${e.target}`).sort();
const centroid = (nodes) => ({
  x: nodes.reduce((sum, n) => sum + n.x, 0) / nodes.length,
  y: nodes.reduce((sum, n) => sum + n.y, 0) / nodes.length,
});
const positionsByName = (state) => Object.fromEntries(state.nodes.map((n) => [n.name, [n.x, n.y]]));

test.describe.configure({ mode: "parallel" });

test.describe("ConfigPanel — Node Graph Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test(
    "node graph: Source/Target/Value build one node per service and one edge per pair, options default to Force and no edge values, persists after save",
    { tag: ["@dashboards", "@nodeGraphConfig", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const selector = pm.chartTypeSelector;
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupNodeGraphPanelWithConfig(page, pm, dashboardName);
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);

      await selector.expectChartTypeSelected("node-graph");
      await expect(selector.getSankeySourceLayout()).toContainText(SOURCE);
      await expect(selector.getSankeyTargetLayout()).toContainText(TARGET);
      // Value is summed per source → target pair by default.
      await expect(selector.getSankeyValueLayout()).toContainText(`sum(${VALUE})`);

      const state = await actions.waitForNodeGraph();
      expect(state.layout).toBe("none");
      expect(state.draggable).toBe(true);
      expect(state.curveness).toBe(FORCE_CURVENESS);
      expect(state.edgeLabels).toBe(false);
      expect(sortedNames(state)).toEqual(NODE_NAMES);
      // The repeated web → api rows become one edge, and the self call adds no edge.
      expect(sortedPairs(state)).toEqual(EDGE_PAIRS.map(([s, t]) => `${s}->${t}`).sort());
      expect(actions.nodeGraphEdge(state, SELF_NODE, SELF_NODE)).toBeUndefined();

      // web → api sums 600 + 600 against api → db's 300, so it is four times as heavy.
      const webApi = actions.nodeGraphEdge(state, "web", "api").value;
      const apiDb = actions.nodeGraphEdge(state, "api", "db").value;
      expect(webApi / apiDb).toBeCloseTo(4, 5);
      // The self call stays on its node; every other node has none.
      expect(actions.nodeGraphNode(state, SELF_NODE).self).toBeGreaterThan(0);
      expect(state.nodes.filter((n) => n.self !== null).map((n) => n.name)).toEqual([SELF_NODE]);
      // api carries the most traffic, so it is drawn as the largest node.
      const largest = state.nodes.reduce((a, b) => (b.symbolSize > a.symbolSize ? b : a));
      expect(largest.name).toBe("api");

      // Every option starts on Default, and the Default names the layout it falls back to.
      await configs.expectNodeGraphLayout(DEFAULT_VALUE);
      expect(await configs.getNodeGraphLayoutOptionLabels()).toEqual(LAYOUT_LABELS);
      await configs.expectNodeGraphShowEdgeLabels(false);

      await actions.savePanel();
      testLogger.info("Verifying node graph fields and defaults persist after save");
      await reopenPanelConfig(page, pm);
      await expect(selector.getSankeySourceLayout()).toContainText(SOURCE);
      await expect(selector.getSankeyTargetLayout()).toContainText(TARGET);
      await expect(selector.getSankeyValueLayout()).toContainText(`sum(${VALUE})`);
      await configs.expectNodeGraphLayout(DEFAULT_VALUE);
      await configs.expectNodeGraphShowEdgeLabels(false);
      await actions.waitForChartToRender();
      expect(sortedNames(await actions.waitForNodeGraph())).toEqual(NODE_NAMES);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "layout: Circular places every node on a ring and persists; Default resets to the force layout",
    { tag: ["@dashboards", "@nodeGraphConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupNodeGraphPanelWithConfig(page, pm, dashboardName);
      await actions.waitForChartToRender();
      const force = await actions.waitForNodeGraph();
      expect(force.curveness).toBe(FORCE_CURVENESS);

      await configs.selectNodeGraphLayout("Circular", "circular");
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getNodeGraphState())?.curveness).toBe(CIRCULAR_CURVENESS);
      const circular = await actions.waitForNodeGraph();
      // On a ring every node sits the same distance from the centre.
      const centre = centroid(circular.nodes);
      const radii = circular.nodes.map((n) => Math.hypot(n.x - centre.x, n.y - centre.y));
      expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(3);
      expect(Math.min(...radii)).toBeGreaterThan(20);
      // Same graph, new positions.
      expect(sortedNames(circular)).toEqual(NODE_NAMES);
      expect(positionsByName(circular)).not.toEqual(positionsByName(force));

      await actions.savePanel();
      testLogger.info("Verifying Layout = Circular persists after save");
      await reopenPanelConfig(page, pm);
      await configs.expectNodeGraphLayout("circular");
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getNodeGraphState())?.curveness).toBe(CIRCULAR_CURVENESS);

      // Default drops the key, so the graph falls back to the force layout.
      await configs.selectNodeGraphLayout("Default (Force)", DEFAULT_VALUE);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getNodeGraphState())?.curveness).toBe(FORCE_CURVENESS);
      await actions.savePanel();

      await reopenPanelConfig(page, pm);
      await configs.expectNodeGraphLayout(DEFAULT_VALUE);
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getNodeGraphState())?.curveness).toBe(FORCE_CURVENESS);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "show edge values: labels edges in compact numbers and puts the self call under its node, persists; off hides them",
    { tag: ["@dashboards", "@nodeGraphConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupNodeGraphPanelWithConfig(page, pm, dashboardName);
      await actions.waitForChartToRender();
      let state = await actions.waitForNodeGraph();
      expect(state.edges.some((e) => e.labelShown)).toBe(false);
      expect(actions.nodeGraphNode(state, SELF_NODE).labelText).not.toContain(SELF_MARK);

      await configs.setNodeGraphShowEdgeLabels(true);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getNodeGraphState())?.edgeLabels).toBe(true);
      // A label that would overlap another or leave the panel shows on hover only, so at least one is drawn.
      await expect
        .poll(async () => (await actions.getNodeGraphState())?.edges.filter((e) => e.labelText).length)
        .toBeGreaterThan(0);
      state = await actions.waitForNodeGraph();
      // Values of 1000 and up are shortened ("1.2K"); smaller ones are written out.
      for (const edge of state.edges.filter((e) => e.labelText)) {
        if (edge.value >= 1000) expect(edge.labelText).toMatch(/^\d+(\.\d)?[KMB]$/);
        else expect(edge.labelText).not.toMatch(/[KMB]$/);
      }
      // The self call has no edge to carry its value, so it is written under the node name.
      await expect
        .poll(async () => actions.nodeGraphNode(await actions.getNodeGraphState(), SELF_NODE).labelText)
        .toContain(SELF_MARK);

      await actions.savePanel();
      testLogger.info("Verifying Show edge values = on persists after save");
      await reopenPanelConfig(page, pm);
      await configs.expectNodeGraphShowEdgeLabels(true);
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getNodeGraphState())?.edgeLabels).toBe(true);

      // Off is the default, so the key is dropped and the labels go.
      await configs.setNodeGraphShowEdgeLabels(false);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect.poll(async () => (await actions.getNodeGraphState())?.edgeLabels).toBe(false);
      state = await actions.waitForNodeGraph();
      expect(state.edges.filter((e) => e.labelText)).toHaveLength(0);
      expect(actions.nodeGraphNode(state, SELF_NODE).labelText).not.toContain(SELF_MARK);
      await actions.savePanel();

      await reopenPanelConfig(page, pm);
      await configs.expectNodeGraphShowEdgeLabels(false);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "drag: a dropped node stays where it was dropped across a re-run; changing the layout places it afresh",
    { tag: ["@dashboards", "@nodeGraphConfig", "@P2"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();
      const NODE = "cache";

      await setupNodeGraphPanelWithConfig(page, pm, dashboardName);
      await actions.waitForChartToRender();
      const before = await actions.waitForNodeGraph();
      const start = actions.nodeGraphNode(before, NODE);
      // Halfway towards the graph's centre, so the drop always lands inside the panel.
      const centre = centroid(before.nodes);
      const dx = Math.round((centre.x - start.x) / 2) || 40;
      const dy = Math.round((centre.y - start.y) / 2) || 40;

      await actions.dragNodeGraphNode(NODE, dx, dy);
      testLogger.info("Dragged node graph node", { node: NODE, dx, dy });
      // null while the chart is mid-redraw, so a poll waits instead of throwing.
      const movedTo = async () => {
        const state = await actions.getNodeGraphState();
        return state ? actions.nodeGraphNode(state, NODE) : null;
      };
      await expect
        .poll(async () => {
          const node = await movedTo();
          return node ? Math.hypot(node.x - start.x - dx, node.y - start.y - dy) : Infinity;
        })
        .toBeLessThan(8);
      const dropped = actions.nodeGraphNode(await actions.waitForNodeGraph(), NODE);

      // A re-run redraws from the options, and the drop is written into them.
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      const afterRerun = actions.nodeGraphNode(await actions.waitForNodeGraph(), NODE);
      expect(Math.hypot(afterRerun.x - dropped.x, afterRerun.y - dropped.y)).toBeLessThan(3);

      // Another layout places every node afresh, so going back to Force restores the original spot.
      await configs.selectNodeGraphLayout("Circular", "circular");
      await actions.applyDashboardBtn();
      await expect.poll(async () => (await actions.getNodeGraphState())?.curveness).toBe(CIRCULAR_CURVENESS);
      await configs.selectNodeGraphLayout("Force", "force");
      await actions.applyDashboardBtn();
      await expect.poll(async () => (await actions.getNodeGraphState())?.curveness).toBe(FORCE_CURVENESS);
      await expect
        .poll(async () => {
          const node = await movedTo();
          return node ? Math.hypot(node.x - start.x, node.y - start.y) : Infinity;
        })
        .toBeLessThan(3);

      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );

  test(
    "validation: missing Source, Target and Value are each flagged and block save",
    { tag: ["@dashboards", "@nodeGraphConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const selector = pm.chartTypeSelector;
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();

      await setupNodeGraphPanelWithConfig(page, pm, dashboardName, {
        sourceField: null,
        targetField: null,
        valueField: null,
      });
      // Every empty well shows the one-field hint.
      await expect(selector.getSankeySourceLayout()).toContainText(EMPTY_HINT);
      await expect(selector.getSankeyTargetLayout()).toContainText(EMPTY_HINT);
      await expect(selector.getSankeyValueLayout()).toContainText(EMPTY_HINT);
      await expect(actions.dashboardErrorItems.filter({ hasText: SOURCE_ERROR })).toHaveCount(1);
      await expect(actions.dashboardErrorItems.filter({ hasText: TARGET_ERROR })).toHaveCount(1);
      await expect(actions.dashboardErrorItems.filter({ hasText: VALUE_ERROR })).toHaveCount(1);
      await actions.savePanelExpectingBlocked(SOURCE_ERROR);
      testLogger.info("Empty node graph blocks save");

      // Each field clears only its own error.
      await selector.searchAndAddField(SOURCE, "source");
      await selector.searchAndAddField(TARGET, "target");
      await actions.applyDashboardBtn();
      await expect(actions.dashboardErrorItems.filter({ hasText: SOURCE_ERROR })).toHaveCount(0);
      await expect(actions.dashboardErrorItems.filter({ hasText: TARGET_ERROR })).toHaveCount(0);
      await expect(actions.dashboardErrorItems.filter({ hasText: VALUE_ERROR })).toHaveCount(1);
      await actions.savePanelExpectingBlocked(VALUE_ERROR);
      testLogger.info("Node graph without a value blocks save");

      await selector.searchAndAddField(VALUE, "sankeyvalue");
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);
      expect(sortedNames(await actions.waitForNodeGraph())).toEqual(NODE_NAMES);
      // Clear the earlier error toasts so savePanel() waits for the real navigation.
      await actions.dismissErrorToasts();
      await actions.savePanel();
      await expect(page).not.toHaveURL(/\/add_panel/);
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "switching type: node graph to sankey keeps the fields and hides the node graph options; back restores them",
    { tag: ["@dashboards", "@nodeGraphConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const selector = pm.chartTypeSelector;
      const actions = pm.dashboardPanelActions;
      const configs = pm.dashboardPanelConfigs;
      const dashboardName = generateDashboardName();

      await setupNodeGraphPanelWithConfig(page, pm, dashboardName);
      await actions.waitForChartToRender();
      await configs.selectNodeGraphLayout("Circular", "circular");

      // Both are flow charts on the same builder, so the fields carry over.
      await selector.selectChartType("sankey");
      await expect(selector.getSankeySourceLayout()).toContainText(SOURCE);
      await expect(selector.getSankeyTargetLayout()).toContainText(TARGET);
      await expect(selector.getSankeyValueLayout()).toContainText(VALUE);
      await configs.expandAllConfigSections();
      await expect(configs.nodeGraphLayout).toHaveCount(0);
      await expect(configs.nodeGraphShowEdgeLabels).toHaveCount(0);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);
      await expect.poll(async () => actions.getNodeGraphState()).toBeNull();

      await selector.selectChartType("node-graph");
      await selector.expectChartTypeSelected("node-graph");
      await configs.expandAllConfigSections();
      await expect(configs.nodeGraphLayout).toBeVisible();
      await configs.expectNodeGraphShowEdgeLabels(false);
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await expect(actions.dashboardErrorItems).toHaveCount(0);
      const state = await actions.waitForNodeGraph();
      expect(sortedNames(state)).toEqual(NODE_NAMES);
      expect(sortedPairs(state)).toHaveLength(EDGE_PAIRS.length);

      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );

  test(
    "drilldown: clicking a node opens the drilldown with that node's name",
    { tag: ["@dashboards", "@nodeGraphConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const actions = pm.dashboardPanelActions;
      const dashboardName = generateDashboardName();
      const NODE = "api";

      await page.context().route(`${DRILLDOWN_HOST}/**`, (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>drilldown</body></html>" })
      );

      await setupNodeGraphPanelWithConfig(page, pm, dashboardName);
      await pm.dashboardDrilldown.addDrilldownByURL(
        DRILLDOWN_NAME,
        `${DRILLDOWN_HOST}/?node=\${node.__name}`,
        { openInNewTab: true }
      );
      await actions.applyDashboardBtn();
      await actions.waitForChartToRender();
      await actions.savePanel();

      // api is the largest node, so it is the easiest real click target.
      await actions.clickNodeGraphNode(NODE);
      await expect(pm.dashboardDrilldown.drilldownMenu).toBeVisible({ timeout: 10000 });

      const popupPromise = page.context().waitForEvent("page");
      await pm.dashboardDrilldown.drilldownMenuItem(DRILLDOWN_NAME).click();
      const popup = await popupPromise;
      await popup.waitForURL(/example\.com/, { timeout: 15000 });
      expect(new URL(popup.url()).searchParams.get("node")).toBe(NODE);
      await popup.close();

      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );
});
