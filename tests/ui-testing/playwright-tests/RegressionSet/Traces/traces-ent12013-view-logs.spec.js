const {
  test,
  expect,
  navigateToBase,
  generateUUID,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const { generateSingleSpanTrace } = require("../../utils/service-graph-ingestion.js");
const {
  orgId,
  ingestOtlpTraces,
  waitForStreamRows,
  deleteStream,
} = require("../../utils/traces-api.js");
const { ingestLogs } = require("../../utils/correlation-api-helpers.js");

const NAMESPACE = "prod";

test.describe("Span View Logs (#12013, #15028)", { tag: "@enterprise" }, () => {
  let pm;
  let suffix;
  let traceStream;
  let traceId;
  let spanId;
  const createdLogStreams = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    suffix = generateUUID().slice(0, 8);
    traceStream = `e2e_viewlogs_${suffix}`;
    const trace = generateSingleSpanTrace({ serviceName: `e2e-viewlogs-${suffix}` });
    ({ traceId, spanId } = trace.metadata);
    await ingestOtlpTraces(page.request, traceStream, trace.payload);
    await waitForStreamRows(page.request, traceStream, 1, { traceId });
    const nowUs = Date.now() * 1000;
    await pm.tracesPage.navigateToTraceDetailsUrl({
      traceId,
      stream: traceStream,
      fromUs: nowUs - 15 * 60 * 1000 * 1000,
      toUs: nowUs + 5 * 60 * 1000 * 1000,
    });
    expect(
      await pm.tracesPage.openTraceDetailsTab("waterfall"),
      "the waterfall tab must exist",
    ).toBe(true);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, traceStream);
    while (createdLogStreams.length)
      await deleteStream(page.request, createdLogStreams.pop(), { type: "logs" });
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test(
    "a span with no correlated logs warns and stays on the trace",
    {
      tag: ["@bug-12013", "@P2", "@regression", "@tracesRegression"],
    },
    async ({ page }) => {
      const correlate = page.waitForResponse(
        (r) => r.url().includes("/service_streams/_correlate"),
        { timeout: 30000 },
      );
      await pm.tracesPage.clickSpanViewLogs(spanId);
      expect((await correlate).status(), "the correlation lookup must have run").toBe(200);

      await pm.tracesPage.expectWarningToast("No correlated logs found for this span");
      await expect(page, "View Logs must not leave the trace when nothing is correlated").toHaveURL(
        /\/traces\/trace-details/,
      );
    },
  );

  test(
    "logs in streams with different namespace fields open on the span, with no field error",
    {
      tag: ["@bug-15028", "@P1", "@regression", "@tracesRegression"],
    },
    async ({ page }) => {
      const k8sStream = `e2e_viewlogs_k8s_${suffix}`;
      const plainStream = `e2e_viewlogs_plain_${suffix}`;
      createdLogStreams.push(k8sStream, plainStream);
      await ingestLogs(page, orgId(), k8sStream, [
        {
          trace_id: traceId,
          span_id: spanId,
          message: `from ${k8sStream}`,
          k8s_namespace_name: NAMESPACE,
        },
      ]);
      await ingestLogs(page, orgId(), plainStream, [
        {
          trace_id: traceId,
          span_id: spanId,
          message: `from ${plainStream}`,
          namespace: NAMESPACE,
        },
      ]);
      for (const stream of [k8sStream, plainStream])
        await waitForStreamRows(page.request, stream, 1, { type: "logs", traceId });

      await pm.tracesPage.stubSpanCorrelation({
        serviceName: `e2e-viewlogs-${suffix}`,
        logStreams: [
          { stream_name: k8sStream, filters: { k8s_namespace_name: NAMESPACE } },
          { stream_name: plainStream, filters: { namespace: NAMESPACE } },
        ],
      });

      await pm.tracesPage.clickSpanViewLogs(spanId);

      await expect(page, "View Logs must open the Logs page").toHaveURL(/\/logs\?/, {
        timeout: 30000,
      });
      const opened = new URL(page.url()).searchParams;
      expect(opened.get("stream").split(",").sort(), "both log streams must stay selected").toEqual(
        [k8sStream, plainStream].sort(),
      );
      const query = Buffer.from(
        (opened.get("query") || "").replace(/^b64uni:/, ""),
        "base64",
      ).toString();
      expect(query, "Bug #15028: the filter must rest on the span and trace ids only").toBe(
        `span_id = '${spanId}' and trace_id = '${traceId}'`,
      );
      await pm.logsPage.expectLogsTableRowCount(2);
      await pm.logsPage.expectNoQueryError(
        "Bug #15028: the logs query must not fail on a missing field",
      );
    },
  );
});
