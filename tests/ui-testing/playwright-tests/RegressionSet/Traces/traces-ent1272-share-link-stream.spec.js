const {
  test,
  expect,
  navigateToBase,
  generateUUID,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const { generateMultiHopTrace } = require("../../utils/service-graph-ingestion.js");
const { ingestOtlpTraces, deleteStream } = require("../../utils/traces-api.js");

test.describe("Share Link from a trace opened outside the explorer (o2-enterprise#1272)", () => {
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    stream = `e2e_ent1272_${generateUUID().slice(0, 8)}`;
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test(
    "the short link keeps the non-default stream and loads the trace in a fresh tab",
    {
      tag: ["@bug-ent1272", "@P1", "@regression", "@tracesRegression"],
    },
    async ({ page, context }) => {
      const trace = generateMultiHopTrace({ latencyMs: 60 });
      await ingestOtlpTraces(page.request, stream, trace.payload);
      const nowUs = Date.now() * 1000;

      // Opened directly so the explorer's selected stream is never set, the state the short link must not depend on.
      await pm.tracesPage.navigateToTraceDetailsUrl({
        traceId: trace.metadata.traceId,
        stream,
        fromUs: nowUs - 15 * 60 * 1000 * 1000,
        toUs: nowUs + 5 * 60 * 1000 * 1000,
      });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const sharedUrl = await pm.tracesPage.clickShareLinkAndGetUrl(
        pm.tracesPage.shareTraceDetailsButton,
      );
      expect(sharedUrl, "Share must produce a short link").toContain("/short/");

      const shared = await context.newPage();
      try {
        await shared.goto(sharedUrl);
        await expect(shared, "Bug #1272: the short link must keep the stream").toHaveURL(
          new RegExp(`/traces/trace-details\\?.*stream=${stream}`),
          { timeout: 30000 },
        );
        await expect(shared).toHaveURL(new RegExp(`trace_id=${trace.metadata.traceId}`));
        const sharedPm = new PageManager(shared);
        expect(
          await sharedPm.tracesPage.openTraceDetailsTab("waterfall"),
          "the trace must load in the fresh tab",
        ).toBe(true);
        await sharedPm.tracesPage.expectTraceTreeHasSpans();
      } finally {
        await shared.close();
      }
    },
  );
});
