// Builds OTLP spans for the merged-fix regression specs; the REST calls live in utils/traces-api.js and utils/auto-run-helpers.js.

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
