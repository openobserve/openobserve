const {
  test,
  expect,
  navigateToBase,
  generateUUID,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const { generateLlmAgentTrace } = require("../../utils/service-graph-ingestion.js");
const { ingestOtlpTraces, waitForStreamRows, deleteStream } = require("../../utils/traces-api.js");

const UNBROKEN_NAME = `tool_${"unbroken_value_".repeat(4)}end`;
const SPACED_NAME =
  "a long operation name with many short words that needs far more room than one node box gives it";

test.describe("Trace DAG node labels stay in their boxes (o2-enterprise#1740)", () => {
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    stream = `e2e_ent1740_${generateUUID().slice(0, 8)}`;
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test(
    "long values are cut inside the node box in the DAG tab",
    {
      tag: ["@bug-ent1740", "@P2", "@regression", "@tracesRegression"],
    },
    async ({ page }) => {
      const trace = generateLlmAgentTrace({
        serviceName: "e2e-1740",
        childNames: [UNBROKEN_NAME, SPACED_NAME],
      });
      const { traceId } = trace.metadata;
      await ingestOtlpTraces(page.request, stream, trace.payload);
      await waitForStreamRows(page.request, stream, trace.metadata.spanCount, { traceId });

      const nowUs = Date.now() * 1000;
      await pm.tracesPage.navigateToTraceDetailsUrl({
        traceId,
        stream,
        fromUs: nowUs - 15 * 60 * 1000 * 1000,
        toUs: nowUs + 5 * 60 * 1000 * 1000,
      });
      expect(
        await pm.tracesPage.openTraceDetailsTab("dag"),
        "an LLM trace must offer the DAG tab",
      ).toBe(true);
      await expect
        .poll(async () => (await pm.tracesPage.measureDagNodeLabels()).length, {
          timeout: 30000,
          message: "all three spans must draw a node",
        })
        .toBe(3);

      const labels = await pm.tracesPage.measureDagNodeLabels();
      testLogger.info("DAG label geometry", { labels });
      for (const name of [UNBROKEN_NAME, SPACED_NAME]) {
        const label = labels.find((l) => l.text === name);
        expect(label, `the node for "${name}" must keep the full value for its hover`).toBeTruthy();
        expect(
          label.fullTextWidth,
          "Precondition: the value must be wider than its label, or nothing can overflow",
        ).toBeGreaterThan(label.labelWidth);
        expect(label.textOverflow, "a cut value must end with an ellipsis").toBe("ellipsis");
      }
      for (const label of labels) {
        expect(
          label.paintedLeft,
          `"${label.text}" spills out of the left of its box`,
        ).toBeGreaterThanOrEqual(label.boxLeft);
        expect(
          label.paintedRight,
          `"${label.text}" spills out of the right of its box`,
        ).toBeLessThanOrEqual(label.boxRight);
        expect(
          label.paintedTop,
          `"${label.text}" spills out of the top of its box`,
        ).toBeGreaterThanOrEqual(label.boxTop);
        expect(
          label.paintedBottom,
          `"${label.text}" spills out of the bottom of its box`,
        ).toBeLessThanOrEqual(label.boxBottom);
      }
    },
  );
});
