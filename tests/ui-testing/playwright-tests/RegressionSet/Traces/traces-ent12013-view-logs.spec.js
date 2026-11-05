const {
  test,
  expect,
  navigateToBase,
  generateUUID,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const {
  generateHexId,
  buildSpan,
  buildResourceSpans,
  buildTracePayload,
} = require("../../utils/service-graph-ingestion.js");
const { ingestOtlpTraces, deleteStream } = require("../../utils/traces-api.js");
const { getAuthHeaders } = require("../../utils/cloud-auth.js");

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
    traceId = generateHexId(16);
    spanId = generateHexId(8);
    const nowNs = BigInt(Date.now() - 60000) * 1000000n;
    await ingestOtlpTraces(
      page.request,
      traceStream,
      buildTracePayload([
        buildResourceSpans(`e2e-viewlogs-${suffix}`, [
          buildSpan({
            traceId,
            spanId,
            name: "checkout",
            kind: 2,
            startTimeNs: nowNs,
            endTimeNs: nowNs + 5000000n,
          }),
        ]),
      ]),
    );
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
      const baseUrl = (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/+$/, "");
      const org = process.env.ORGNAME || "default";
      const k8sStream = `e2e_viewlogs_k8s_${suffix}`;
      const plainStream = `e2e_viewlogs_plain_${suffix}`;
      createdLogStreams.push(k8sStream, plainStream);
      const seed = async (stream, record) => {
        const response = await page.request.post(`${baseUrl}/api/${org}/${stream}/_json`, {
          headers: getAuthHeaders(),
          data: [{ trace_id: traceId, span_id: spanId, message: `from ${stream}`, ...record }],
        });
        expect(response.status(), "Precondition: logs must ingest").toBe(200);
      };
      await seed(k8sStream, { k8s_namespace_name: NAMESPACE });
      await seed(plainStream, { namespace: NAMESPACE });

      // Discovery takes minutes, so the correlate answer is fixed here; this proves how the UI uses it, not what the endpoint returns.
      await page.route("**/service_streams/_correlate", (route) =>
        route.fulfill({
          json: {
            service_name: `e2e-viewlogs-${suffix}`,
            matched_dimensions: { service: `e2e-viewlogs-${suffix}` },
            additional_dimensions: {},
            related_streams: {
              logs: [
                { stream_name: k8sStream, filters: { k8s_namespace_name: NAMESPACE } },
                { stream_name: plainStream, filters: { namespace: NAMESPACE } },
              ],
              traces: [],
              metrics: [],
              profiles: [],
            },
          },
        }),
      );

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
      await expect(
        page.locator(pm.logsPage.errorMessage),
        "Bug #15028: the logs query must not fail on a missing field",
      ).toHaveCount(0);
    },
  );
});
