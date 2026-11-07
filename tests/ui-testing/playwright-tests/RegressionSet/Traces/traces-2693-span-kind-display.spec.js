const {
  test,
  expect,
  navigateToBase,
  generateUUID,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const { ingestOtlpTraces, deleteStream } = require("../../utils/traces-api.js");
const {
  generateHexId,
  buildSpan,
  buildResourceSpans,
  buildTracePayload,
} = require("../../utils/service-graph-ingestion.js");

const KINDS = { unspecified: 0, internal: 1, server: 2, client: 3, producer: 4, consumer: 5 };

test.describe("Trace details span kind (#2693)", () => {
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    stream = `e2e_2693_${generateUUID().slice(0, 8)}`;
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test(
    "an INTERNAL root span shows as Internal, and each other kind keeps its own badge",
    {
      tag: ["@bug-2693", "@P1", "@regression", "@tracesRegression"],
    },
    async ({ page }) => {
      const traceId = generateHexId(16);
      const rootSpanId = generateHexId(8);
      const nowNs = BigInt(Date.now() - 60000) * 1000000n;
      const span = (name, kind, spanId, parentSpanId) =>
        buildSpan({
          traceId,
          spanId,
          parentSpanId,
          name,
          kind,
          startTimeNs: nowNs,
          endTimeNs: nowNs + 5000000n,
        });
      const spans = [span("main", KINDS.internal, rootSpanId)];
      for (const [label, kind] of Object.entries(KINDS))
        spans.push(span(`child-${label}`, kind, generateHexId(8), rootSpanId));
      await ingestOtlpTraces(
        page.request,
        stream,
        buildTracePayload([buildResourceSpans("e2e-2693", spans)]),
      );

      const nowUs = Date.now() * 1000;
      await pm.tracesPage.navigateToTraceDetailsUrl({
        traceId,
        stream,
        fromUs: nowUs - 15 * 60 * 1000 * 1000,
        toUs: nowUs + 5 * 60 * 1000 * 1000,
      });
      await pm.tracesPage.selectWaterfallSpan("main");

      // The root plus child-internal are the only two Internal spans; a mapping that reads kind 1 as Server moves both.
      expect(
        await pm.tracesPage.countSpanKindBadges("internal"),
        "Bug #2693: INTERNAL spans must carry the Internal badge",
      ).toBe(2);
      for (const label of ["server", "client", "producer", "consumer"]) {
        expect(
          await pm.tracesPage.countSpanKindBadges(label),
          `exactly one ${label} span was sent`,
        ).toBe(1);
      }
      await pm.tracesPage.expectSidebarAttributeValue("span_kind", "Internal");
    },
  );
});
