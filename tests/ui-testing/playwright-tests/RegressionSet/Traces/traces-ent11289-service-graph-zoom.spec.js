const { test, navigateToBase } = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");

const { buildTopologyResponse } = require("../../utils/service-graph-ingestion.js");

const STREAM = "default";
const TOPOLOGY = buildTopologyResponse(
  ["gateway", "orders", "stock", "database"],
  [
    ["gateway", "orders"],
    ["gateway", "stock"],
    ["orders", "database"],
    ["stock", "database"],
  ],
);

test.describe("Service Graph zoom buttons (#11289)", { tag: "@enterprise" }, () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await pm.serviceGraphPage.stubTopology(TOPOLOGY);
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
