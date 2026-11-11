const {
  test,
  expect,
  navigateToBase,
  generateUUID,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const { ingestOtlpTraces, waitForStreamRows, deleteStream } = require("../../utils/traces-api.js");
const { generateDiamondTrace } = require("../../utils/service-graph-ingestion.js");

const SERVICES = ["database", "frontend-app", "inventory-service", "order-service"];

test.describe("Trace details graphs (#12463, #15973)", () => {
  let pm;
  let stream;
  let trace;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    stream = `e2e_15973_${generateUUID().slice(0, 8)}`;
    trace = generateDiamondTrace();
    await ingestOtlpTraces(page.request, stream, trace.payload);
    await waitForStreamRows(page.request, stream, trace.metadata.spanCount, {
      traceId: trace.metadata.traceId,
    });
    const nowUs = Date.now() * 1000;
    await pm.tracesPage.navigateToTraceDetailsUrl({
      traceId: trace.metadata.traceId,
      stream,
      fromUs: nowUs - 15 * 60 * 1000 * 1000,
      toUs: nowUs + 5 * 60 * 1000 * 1000,
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test(
    "Graph View draws one node per service, with both callers on the shared service",
    {
      tag: ["@bug-12463", "@P1", "@regression", "@tracesRegression"],
    },
    async () => {
      await pm.tracesPage.openTraceGraphView("graph");
      const chart = await pm.tracesPage.waitForSettledChart(pm.tracesPage.traceGraphChart);

      expect(chart.type, "Graph View must render a graph series").toBe("graph");
      expect([...chart.names].sort(), "Bug #12463: one node per service").toEqual(SERVICES);
      expect([...chart.links].sort()).toEqual([
        "frontend-app->inventory-service",
        "frontend-app->order-service",
        "inventory-service->database",
        "order-service->database",
      ]);
    },
  );

  for (const view of ["tree", "graph"]) {
    test(
      `Trace Graph ${view} view: zoom in, zoom out and fit change the rendered scale`,
      {
        tag: ["@bug-15973", "@P2", "@regression", "@tracesRegression"],
      },
      async () => {
        await pm.tracesPage.openTraceGraphView(view);
        await pm.tracesPage.expectNodeChartZoomCycle(pm.tracesPage.traceGraphChart, "trace-graph");
      },
    );
  }

  test(
    "Flame Graph: zoom in narrows the visible range, zoom out widens it and fit restores it",
    {
      tag: ["@bug-15973", "@P2", "@regression", "@tracesRegression"],
    },
    async () => {
      expect(
        await pm.tracesPage.openTraceDetailsTab("flame-graph"),
        "the flame graph tab must exist",
      ).toBe(true);
      const baseline = await pm.tracesPage.waitForSettledChart(pm.tracesPage.flameGraphChartScroll);
      const baselineLabels = await pm.tracesPage.getFlameRulerLabels();
      expect(baseline.xMax - baseline.xMin, "the flame graph opens on the whole trace").toBe(100);

      await pm.tracesPage.clickChartZoomControl("flame-graph", "zoom-in");
      await pm.tracesPage.clickChartZoomControl("flame-graph", "zoom-in");
      await expect
        .poll(() => pm.tracesPage.getFlameVisibleRange(), {
          timeout: 10000,
          message: "zoom in must narrow the x range",
        })
        .toBeLessThan(70);
      const zoomedRange = await pm.tracesPage.getFlameVisibleRange();
      expect(
        await pm.tracesPage.getFlameRulerLabels(),
        "the time ruler must follow the zoom",
      ).not.toEqual(baselineLabels);

      await pm.tracesPage.clickChartZoomControl("flame-graph", "zoom-out");
      await expect
        .poll(() => pm.tracesPage.getFlameVisibleRange(), {
          timeout: 10000,
          message: "zoom out must widen the x range",
        })
        .toBeGreaterThan(zoomedRange);

      await pm.tracesPage.clickChartZoomControl("flame-graph", "fit-screen");
      await expect
        .poll(() => pm.tracesPage.getFlameVisibleRange(), {
          timeout: 10000,
          message: "fit must restore the whole trace",
        })
        .toBe(100);
      expect(await pm.tracesPage.getFlameRulerLabels()).toEqual(baselineLabels);
    },
  );
});
