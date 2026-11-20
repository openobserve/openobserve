// Service Graph is enterprise-only, so this spec runs only from the ENT overlay.
const {
  test,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const {
  ingestOtlpTraces,
  waitForStreamRows,
  deleteStream,
  stringAttr,
} = require("../../utils/traces-api.js");

const RID = Math.random().toString(36).slice(2, 8);
const STREAM = `e2e_16961_ai_${RID}`;
const APP = `app-${RID}`;
const AGENT = `agent-${RID}`;
const TOOL = `tool-${RID}`;
const MODEL = `model-${RID}`;
const TRACES = 3;
const SPANS_PER_TRACE = 3;

const hex = (n, len) => n.toString(16).padStart(len, "0");

function aiTracesPayload() {
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const seed = parseInt(RID, 36);
  const spans = [];
  for (let t = 0; t < TRACES; t++) {
    const traceId = hex(seed, 24) + hex(t + 1, 8);
    const rootId = hex(t * 10 + 1, 16);
    const startNs = nowNs - BigInt((t + 1) * 5_000_000_000);
    const span = (spanId, parentSpanId, name, offsetMs, attributes) => ({
      traceId,
      spanId,
      ...(parentSpanId ? { parentSpanId } : {}),
      name,
      kind: 1,
      startTimeUnixNano: String(startNs + BigInt(offsetMs) * 1_000_000n),
      endTimeUnixNano: String(startNs + BigInt(offsetMs + 50) * 1_000_000n),
      attributes,
      status: {},
    });
    spans.push(
      span(rootId, null, `invoke_agent ${AGENT}`, 0, [
        stringAttr("gen_ai.operation.name", "invoke_agent"),
        stringAttr("gen_ai.agent.name", AGENT),
      ]),
      span(hex(t * 10 + 2, 16), rootId, `execute_tool ${TOOL}`, 60, [
        stringAttr("gen_ai.operation.name", "execute_tool"),
        stringAttr("gen_ai.tool.name", TOOL),
      ]),
      span(hex(t * 10 + 3, 16), rootId, `chat ${MODEL}`, 120, [
        stringAttr("gen_ai.operation.name", "chat"),
        stringAttr("gen_ai.request.model", MODEL),
        stringAttr("gen_ai.response.model", MODEL),
      ]),
    );
  }
  return {
    resourceSpans: [
      {
        resource: { attributes: [stringAttr("service.name", APP)] },
        scopeSpans: [{ scope: { name: "e2e" }, spans }],
      },
    ],
  };
}

const node = (id, serviceType) => ({
  id,
  label: id,
  requests: TRACES,
  errors: 0,
  error_rate: 0,
  stream_name: STREAM,
  kind: serviceType || "service",
  ...(serviceType ? { service_type: serviceType } : {}),
});
const edge = (from, to, connectionType) => ({
  from,
  to,
  total_requests: TRACES,
  failed_requests: 0,
  error_rate: 0,
  p50_latency_ns: 50000000,
  p95_latency_ns: 50000000,
  p99_latency_ns: 50000000,
  connection_type: connectionType,
});
// The rollup daemon takes minutes to draw GenAI nodes; the bug is in the panel-to-Traces hand-off, which reads the real spans.
const TOPOLOGY = {
  nodes: [
    node(APP),
    node(AGENT, "agent"),
    node(TOOL, "tool"),
    node(MODEL, "model"),
  ],
  edges: [
    edge(APP, AGENT, "agent"),
    edge(AGENT, TOOL, "tool"),
    edge(AGENT, MODEL, "model"),
  ],
};

async function viewTracesFromFirstOperation(pm, nodeName) {
  await pm.serviceGraphPage.clickNodeByName(nodeName);
  await pm.serviceGraphPage.expectSidePanelServiceName(nodeName);
  await pm.serviceGraphPage.openFirstOperationTraces(nodeName, TRACES);
}

test.describe(
  "Service Graph View traces from AI nodes (#16961)",
  { tag: "@enterprise" },
  () => {
    test.describe.configure({ mode: "serial" });
    let pm;

    test.beforeAll(async ({ request }) => {
      await ingestOtlpTraces(request, STREAM, aiTracesPayload());
      await waitForStreamRows(request, STREAM, TRACES * SPANS_PER_TRACE);
    });

    test.afterAll(async ({ request }) => {
      await deleteStream(request, STREAM, { type: "traces" });
    });

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

    test(
      "a service node's operation opens its spans",
      { tag: ["@bug-16961", "@P1", "@regression", "@tracesRegression"] },
      async () => {
        await viewTracesFromFirstOperation(pm, APP);
        await pm.tracesPage.expectSpansFoundCount(TRACES);
      },
    );

    for (const [kind, name] of [
      ["tool", TOOL],
      ["model", MODEL],
    ]) {
      test(
        `View traces from an AI ${kind} node opens the spans its operation row counts`,
        { tag: ["@bug-16961", "@P1", "@regression", "@tracesRegression"] },
        async () => {
          await viewTracesFromFirstOperation(pm, name);
          testLogger.info("Traces filter", {
            filter: await pm.serviceGraphPage.getTracesUrlQuery(),
          });
          await pm.tracesPage.expectSpansFoundCount(TRACES);
        },
      );
    }
  },
);
