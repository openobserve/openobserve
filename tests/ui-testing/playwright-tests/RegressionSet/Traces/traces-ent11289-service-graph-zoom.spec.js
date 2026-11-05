const { test, navigateToBase } = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");

const STREAM = "default";
const node = (name) => ({
  id: name,
  label: name,
  requests: 10,
  errors: 0,
  error_rate: 0,
  kind: "service",
});
const edge = (from, to) => ({
  from,
  to,
  total_requests: 10,
  failed_requests: 0,
  error_rate: 0,
  p50_latency_ns: 1000000,
  p95_latency_ns: 2000000,
  p99_latency_ns: 3000000,
});
const TOPOLOGY = {
  nodes: ["gateway", "orders", "stock", "database"].map(node),
  edges: [
    edge("gateway", "orders"),
    edge("gateway", "stock"),
    edge("orders", "database"),
    edge("stock", "database"),
  ],
};

test.describe("Service Graph zoom buttons (#11289)", { tag: "@enterprise" }, () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    // The rollup takes minutes and only the chart's controls are under test, so the topology answer is fixed here.
    await page.route("**/traces/service_graph/topology/current**", (route) =>
      route.fulfill({ json: TOPOLOGY }),
    );
    await navigateToBase(page);
    await pm.serviceGraphPage.navigateToServiceGraphTab(STREAM);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  for (const view of ["tree", "graph"]) {
    test(
      `${view} view: zoom in, zoom out and fit change the rendered scale`,
      {
        tag: ["@bug-11289", "@P2", "@regression", "@tracesRegression"],
      },
      async () => {
        if (view === "graph") await pm.serviceGraphPage.switchToGraphView();
        else await pm.serviceGraphPage.switchToTreeView();
        await pm.tracesPage.expectNodeChartZoomCycle(
          pm.serviceGraphPage.chartContainer,
          "service-graph",
        );
      },
    );
  }
});
