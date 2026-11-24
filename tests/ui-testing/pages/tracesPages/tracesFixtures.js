// Builds OTLP spans, log rows and topologies for the merged-fix regression specs; the REST calls live in utils/traces-api.js and utils/auto-run-helpers.js.

import crypto from "crypto";
const {
  orgId,
  stringAttr,
  intAttr,
  ingestOtlpTraces,
  waitForSearch,
  waitForStreamRows,
  deleteStream,
} = require("../../playwright-tests/utils/traces-api.js");
const {
  ingestRows,
} = require("../../playwright-tests/utils/auto-run-helpers.js");

const HOUR_US = 3600 * 1e6;

export const hexId = (bytes) => crypto.randomBytes(bytes).toString("hex");
export const uniqueTraceStream = (tag) =>
  `e2e_${tag}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const otlpAttr = (key, value) =>
  Number.isInteger(value)
    ? intAttr(key, value)
    : stringAttr(key, String(value));

/** One OTLP span starting `agoMs` before `nowNs`, lasting `durationNs`. */
export function otlpSpan({
  traceId,
  spanId = hexId(8),
  parentSpanId = "",
  name,
  nowNs,
  agoMs,
  durationNs,
  statusCode = 0,
  attributes = [],
  links,
}) {
  const start = nowNs - BigInt(agoMs) * 1000000n;
  const span = {
    traceId,
    spanId,
    parentSpanId,
    name,
    kind: 2,
    startTimeUnixNano: String(start),
    endTimeUnixNano: String(start + BigInt(durationNs)),
    attributes,
    status: { code: statusCode },
  };
  if (links) span.links = links;
  return span;
}

/** Posts `{ serviceName: spans[] }` to `stream` and waits until search returns all of them. */
export async function ingestSpansAndWait(request, stream, spansByService) {
  const resourceSpans = Object.entries(spansByService).map(
    ([service, spans]) => ({
      resource: { attributes: [otlpAttr("service.name", service)] },
      scopeSpans: [{ scope: { name: "e2e" }, spans }],
    }),
  );
  const total = resourceSpans.reduce(
    (n, r) => n + r.scopeSpans[0].spans.length,
    0,
  );
  await ingestOtlpTraces(
    request,
    stream,
    { resourceSpans },
    { message: `Precondition: OTLP ingest into ${stream} must succeed` },
  );
  await waitForStreamRows(request, stream, total, {
    message: `Precondition: all ${total} seeded spans must be searchable`,
  });
  return total;
}

/** Posts JSON rows to the logs stream `stream` and waits until all of them are searchable over the last 6 hours. */
export async function ingestLogsAndWait(request, stream, rows) {
  await ingestRows(request, orgId(), stream, rows);
  const endUs = Date.now() * 1000 + 60e6;
  await waitForSearch(request, `SELECT count(*) AS n FROM "${stream}"`, {
    type: "logs",
    startUs: endUs - 6 * HOUR_US,
    endUs,
    expected: rows.length,
    pick: (result) => Number(result.hits[0]?.n ?? 0),
    message: `Precondition: all ${rows.length} seeded rows must be searchable`,
  });
}

export async function deleteTraceStream(request, stream, type = "traces") {
  await deleteStream(request, stream, { type });
}

/** One trace of `spanCount` consecutive one-second spans of `serviceName`, ending a second ago; the trace id derives from `rid`. */
export function simpleTracesPayload(rid, serviceName, spanCount) {
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const traceId = `${rid}`
    .padEnd(32, "0")
    .replace(/[^0-9a-f]/g, "a")
    .slice(0, 32);
  const spans = Array.from({ length: spanCount }, (_, i) => ({
    traceId,
    spanId: `${i + 1}`.padStart(16, "0"),
    name: `op-${i}`,
    kind: 2,
    startTimeUnixNano: String(nowNs - BigInt((i + 2) * 1_000_000_000)),
    endTimeUnixNano: String(nowNs - BigInt((i + 1) * 1_000_000_000)),
    attributes: [],
    status: {},
  }));
  return {
    resourceSpans: [
      {
        resource: { attributes: [stringAttr("service.name", serviceName)] },
        scopeSpans: [{ scope: { name: "e2e" }, spans }],
      },
    ],
  };
}

/** One single-span trace per service, each span named `op-<service>` and ending two seconds ago. */
export function oneSpanPerServicePayload(services) {
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  return {
    resourceSpans: services.map((svc, idx) => {
      const i = idx + 1;
      return {
        resource: { attributes: [stringAttr("service.name", svc)] },
        scopeSpans: [
          {
            scope: { name: "e2e" },
            spans: [
              {
                traceId: `${i}`.padStart(32, "c"),
                spanId: `${i}`.padStart(16, "0"),
                name: `op-${svc}`,
                kind: 2,
                startTimeUnixNano: String(nowNs - 3_000_000_000n),
                endTimeUnixNano: String(nowNs - 2_000_000_000n),
                attributes: [],
                status: {},
              },
            ],
          },
        ],
      };
    }),
  };
}

const hex = (n, len) => n.toString(16).padStart(len, "0");

/** `traces` GenAI traces of `app`: an invoke_agent root span with an execute_tool and a chat child each. */
export function aiAgentTracesPayload({ rid, app, agent, tool, model, traces }) {
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const seed = parseInt(rid, 36);
  const spans = [];
  for (let t = 0; t < traces; t++) {
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
      span(rootId, null, `invoke_agent ${agent}`, 0, [
        stringAttr("gen_ai.operation.name", "invoke_agent"),
        stringAttr("gen_ai.agent.name", agent),
      ]),
      span(hex(t * 10 + 2, 16), rootId, `execute_tool ${tool}`, 60, [
        stringAttr("gen_ai.operation.name", "execute_tool"),
        stringAttr("gen_ai.tool.name", tool),
      ]),
      span(hex(t * 10 + 3, 16), rootId, `chat ${model}`, 120, [
        stringAttr("gen_ai.operation.name", "chat"),
        stringAttr("gen_ai.request.model", model),
        stringAttr("gen_ai.response.model", model),
      ]),
    );
  }
  return {
    resourceSpans: [
      {
        resource: { attributes: [stringAttr("service.name", app)] },
        scopeSpans: [{ scope: { name: "e2e" }, spans }],
      },
    ],
  };
}

/** Service Graph topology for aiAgentTracesPayload: app -> agent -> tool and agent -> model, each edge carrying `traces` requests. */
export function aiAgentTopology({ stream, app, agent, tool, model, traces }) {
  const node = (id, serviceType) => ({
    id,
    label: id,
    requests: traces,
    errors: 0,
    error_rate: 0,
    stream_name: stream,
    kind: serviceType || "service",
    ...(serviceType ? { service_type: serviceType } : {}),
  });
  const edge = (from, to, connectionType) => ({
    from,
    to,
    total_requests: traces,
    failed_requests: 0,
    error_rate: 0,
    p50_latency_ns: 50000000,
    p95_latency_ns: 50000000,
    p99_latency_ns: 50000000,
    connection_type: connectionType,
  });
  return {
    nodes: [
      node(app),
      node(agent, "agent"),
      node(tool, "tool"),
      node(model, "model"),
    ],
    edges: [
      edge(app, agent, "agent"),
      edge(agent, tool, "tool"),
      edge(agent, model, "model"),
    ],
  };
}

// Sidebar-filter spans: 16 spans over services a (0-5), b (6-10), c (11-15).
export const SIDEBAR_SPAN_COUNT = 16;
const SIDEBAR_NULL_STATUS = [0, 4, 8, 12];
const SIDEBAR_STATUS_500 = [3, 6, 9, 15];
const SIDEBAR_ERRORS = [0, 5, 10, 15];

/** Spans 0,4,8,12 lack http_status_code, 3,6,9,15 are 500, the rest 200; 0,5,10,15 are ERROR; span 15 lasts 1.234567 s. */
export function sidebarFilterSpans() {
  const nowNs = BigInt(Date.now()) * 1000000n;
  const service = (i) => (i < 6 ? "a" : i < 11 ? "b" : "c");
  const byService = {};
  for (let i = 0; i < SIDEBAR_SPAN_COUNT; i++) {
    const attributes = SIDEBAR_NULL_STATUS.includes(i)
      ? []
      : [
          otlpAttr(
            "http_status_code",
            SIDEBAR_STATUS_500.includes(i) ? "500" : "200",
          ),
        ];
    const span = otlpSpan({
      traceId: hexId(16),
      name: `fb-op-${String(i).padStart(2, "0")}`,
      nowNs,
      agoMs: 600000 + i * 1000,
      durationNs: i === 15 ? 1234567000 : 100000000 + i * 50000000,
      statusCode: SIDEBAR_ERRORS.includes(i) ? 2 : 0,
      attributes,
    });
    (byService[service(i)] ||= []).push(span);
  }
  return byService;
}

// Long enough to be cut and slanted under the drill-down comparison bars.
const DRILL_DOWN_REASONS = [
  "notify_failed_downstream",
  "checkout_pending_review",
  "payment_gateway_timeout",
  "inventory_sync_failed",
];

// CI rejects rows older than ZO_INGEST_ALLOWED_UPTO=5 h, so 40 rows 6 min apart stay within 4 h.
/** `count` log rows with level, svc_name, reason, msg and code, spread 6 min apart so a histogram brush selects a subset. */
export function drillDownLogRows(count) {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    _timestamp: (now - (count - i) * 360000) * 1000,
    level: ["info", "error", "warn"][i % 3],
    svc_name: ["alpha", "beta", "gamma"][i % 3 === 0 ? 0 : i % 2 ? 1 : 2],
    reason: DRILL_DOWN_REASONS[i % 4],
    msg: `message number ${i % 10}`,
    code: 200 + (i % 5),
  }));
}
