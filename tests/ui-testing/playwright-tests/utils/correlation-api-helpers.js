// Copyright 2026 OpenObserve Inc.

/**
 * Shared API plumbing for the Correlation (service-streams) e2e specs.
 *
 * The correlation specs all drive the same enterprise `service_streams`
 * endpoints (discovery, `_correlate`, `config/identity`, `_analytics`,
 * `_reset`), the same semantic-groups endpoint, and the same ingest paths.
 * This module is the single source of truth for that plumbing so every
 * correlation spec stays in lockstep. It deliberately contains NO test/expect
 * calls — assertions belong in the spec files.
 *
 * AUTH: routes through `authedRequest`/`getAuthHeaders` (cloud-auth.js) so it
 * shares the framework's session (global-setup storageState) and 401/403
 * self-heal — NOT a bespoke Basic-auth context.
 *
 * ORG ISOLATION (deliberate deviation from the shared-org norm): correlation
 * discovery, identity config, semantic groups and `_reset` are ORG-GLOBAL and
 * DESTRUCTIVE — one test's saveIdentity/reset would corrupt any test sharing
 * the org. So each test provisions a FRESH org via `createCorrelationOrg` and
 * tears it down in afterEach via `deleteOrg`. (The pre-standardization suite
 * created orgs but never deleted them — this fixes that leak.)
 */

const {
  getAuthHeaders,
  isCloudEnvironment,
  authedRequest,
} = require("./cloud-auth.js");

const BASE = process.env.ZO_BASE_URL || "http://localhost:5080";

// ---------------------------------------------------------------------------
// Temporal contract (f(env) of the backend under test):
//   ZO_MAX_FILE_RETENTION_TIME=10, ZO_FILE_PUSH_INTERVAL=10,
//   O2_SERVICE_STREAMS_BATCH_FLUSH_INTERVAL_SECS=5, SAMPLE_RATE=1.
// Measured end-to-end discovery latency is ~2min (WAL move-job cadence
// dominates). First flush after a cold start ~3.3min. 300s covers it with
// margin; deployed envs can raise it via env without a code change.
// ---------------------------------------------------------------------------
const DISCOVERY_DEADLINE_MS = Number(
  process.env.O2_CORR_DISCOVERY_DEADLINE_MS || 300_000,
);
const POLL_INTERVAL_MS = 3_000;
const MAX_STREAMS_PER_TYPE = Number(
  process.env.O2_SERVICE_STREAMS_MAX_STREAMS_PER_SERVICE || 50,
);

/** Unique, human-readable org prefix so parallel/repeat runs never collide. */
const uniqOrg = (p) =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function nowMicros() {
  return Date.now() * 1000;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll `fn` until it returns a truthy value or the deadline passes. */
async function pollUntil(
  fn,
  {
    deadlineMs = DISCOVERY_DEADLINE_MS,
    intervalMs = POLL_INTERVAL_MS,
    label = "condition",
  } = {},
) {
  const start = Date.now();
  let last;
  while (Date.now() - start < deadlineMs) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(
    `pollUntil: timed out after ${deadlineMs}ms waiting for ${label} (last=${JSON.stringify(
      last,
    )})`,
  );
}

// ---------------------------------------------------------------------------
// Per-org auth. On local ENT the root Basic header (getAuthHeaders) authorizes
// every org, including freshly created ones. On cloud, ingest into a fresh org
// needs THAT org's passcode (per-org tokens), so we mint it via the page's live
// session cookie. Management/correlate calls go through authedRequest (which
// self-heals) and don't need this.
// ---------------------------------------------------------------------------
async function ingestHeaders(page, org) {
  if (!isCloudEnvironment()) return getAuthHeaders();
  try {
    const pc = await page.evaluate(async (o) => {
      const r = await fetch(`/api/${o}/passcode`);
      return r.ok ? await r.json() : null;
    }, org);
    if (pc && pc.data && pc.data.passcode) {
      const basic = Buffer.from(`${pc.data.user}:${pc.data.passcode}`).toString(
        "base64",
      );
      return { Authorization: `Basic ${basic}`, "Content-Type": "application/json" };
    }
  } catch {
    /* fall through to root headers; caller surfaces any 401 */
  }
  return getAuthHeaders();
}

// ---------------------------------------------------------------------------
// Org lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a fresh org for one test's isolation. Returns its identifier.
 * Names are NOT idempotent — always unique, underscores only.
 */
async function createCorrelationOrg(page, prefix = "corr") {
  const name = uniqOrg(prefix);
  const res = await authedRequest(page, "post", `${BASE}/api/organizations`, {
    data: { name },
  });
  if (!res.ok()) {
    throw new Error(`org create failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  const org = body.identifier || (body.data && body.data.identifier);
  if (!org)
    throw new Error(`org create: no identifier in ${JSON.stringify(body)}`);
  return org;
}

/** Best-effort org teardown — never throws (cleanup must not fail a test). */
async function deleteOrg(page, org) {
  if (!org) return;
  try {
    await authedRequest(page, "delete", `${BASE}/api/organizations/${org}`);
  } catch {
    /* leak-avoidance is best-effort; a failed delete must not fail the test */
  }
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

/** records: array of flat objects; _timestamp (micros) added if missing. */
async function ingestLogs(page, org, stream, records) {
  const ts = nowMicros();
  const data = records.map((r) => ({ _timestamp: ts, ...r }));
  const res = await page.request.post(`${BASE}/api/${org}/${stream}/_json`, {
    headers: await ingestHeaders(page, org),
    data,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok() || body.code !== 200) {
    throw new Error(
      `ingestLogs(${stream}) failed: ${res.status()} ${JSON.stringify(body)}`,
    );
  }
  return body;
}

/** records: [{__name__, value, ...labels}]; _timestamp (millis) added if missing. */
async function ingestMetrics(page, org, records) {
  const ts = Date.now();
  const data = records.map((r) => ({
    __type__: "gauge",
    _timestamp: ts,
    value: 1,
    ...r,
  }));
  const res = await page.request.post(
    `${BASE}/api/${org}/ingest/metrics/_json`,
    { headers: await ingestHeaders(page, org), data },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok() || body.code !== 200) {
    throw new Error(`ingestMetrics failed: ${res.status()} ${JSON.stringify(body)}`);
  }
  return body;
}

/**
 * Minimal OTLP-JSON trace ingest. `attrs` are flat key->string maps placed as
 * resource attributes (keys without dots flatten to themselves in the stored
 * record). Emits one parent + `childCount` children.
 */
async function ingestTraces(page, org, serviceName, attrs, childCount = 1) {
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const traceId =
    "a".repeat(16) + Math.random().toString(16).slice(2, 18).padEnd(16, "0");
  const parentId = Math.random().toString(16).slice(2, 18).padEnd(16, "0");
  const mkAttr = (k, v) => ({ key: k, value: { stringValue: String(v) } });
  const resourceAttrs = [
    mkAttr("service.name", serviceName),
    ...Object.entries(attrs).map(([k, v]) => mkAttr(k, v)),
  ];
  const spans = [
    {
      traceId,
      spanId: parentId,
      name: "parent-op",
      kind: 2,
      startTimeUnixNano: String(nowNs - 5_000_000n),
      endTimeUnixNano: String(nowNs),
      attributes: [],
      status: {},
    },
  ];
  for (let i = 0; i < childCount; i++) {
    spans.push({
      traceId,
      spanId: Math.random().toString(16).slice(2, 18).padEnd(16, "0"),
      parentSpanId: parentId,
      name: `child-op-${i}`,
      kind: 3,
      startTimeUnixNano: String(nowNs - 4_000_000n),
      endTimeUnixNano: String(nowNs - 1_000_000n),
      attributes: [],
      status: {},
    });
  }
  const data = {
    resourceSpans: [
      {
        resource: { attributes: resourceAttrs },
        scopeSpans: [{ scope: { name: "corr-e2e" }, spans }],
      },
    ],
  };
  const res = await page.request.post(`${BASE}/api/${org}/v1/traces`, {
    headers: await ingestHeaders(page, org),
    data,
  });
  if (!res.ok()) {
    throw new Error(`ingestTraces failed: ${res.status()} ${await res.text()}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// service_streams API
// ---------------------------------------------------------------------------

async function listServices(page, org) {
  const res = await authedRequest(
    page,
    "get",
    `${BASE}/api/${org}/service_streams`,
  );
  if (!res.ok()) throw new Error(`listServices failed: ${res.status()}`);
  return res.json();
}

/** Returns {status, body} — body is null on 200-null no-match. */
async function correlate(
  page,
  org,
  availableDimensions,
  { sourceStream = "unknown", sourceType = "logs" } = {},
) {
  const res = await authedRequest(
    page,
    "post",
    `${BASE}/api/${org}/service_streams/_correlate`,
    {
      data: {
        source_stream: sourceStream,
        source_type: sourceType,
        available_dimensions: availableDimensions,
      },
    },
  );
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status(), body };
}

async function getIdentity(page, org) {
  const res = await authedRequest(
    page,
    "get",
    `${BASE}/api/${org}/service_streams/config/identity`,
  );
  if (!res.ok()) throw new Error(`getIdentity failed: ${res.status()}`);
  return res.json();
}

/** Returns {status, body} so 400-path tests can assert the message. */
async function saveIdentity(page, org, cfg) {
  const res = await authedRequest(
    page,
    "put",
    `${BASE}/api/${org}/service_streams/config/identity`,
    { data: cfg },
  );
  const body = await res.json().catch(() => null);
  return { status: res.status(), body };
}

async function getAnalytics(page, org) {
  const res = await authedRequest(
    page,
    "get",
    `${BASE}/api/${org}/service_streams/_analytics`,
  );
  if (!res.ok()) throw new Error(`getAnalytics failed: ${res.status()}`);
  return res.json();
}

async function reset(page, org) {
  const res = await authedRequest(
    page,
    "delete",
    `${BASE}/api/${org}/service_streams/_reset`,
  );
  if (!res.ok())
    throw new Error(`reset failed: ${res.status()} ${await res.text()}`);
  return res.json().catch(() => ({}));
}

// ---------------------------------------------------------------------------
// Semantic groups (Field Mappings)
// ---------------------------------------------------------------------------

async function getSemanticGroups(page, org) {
  const res = await authedRequest(
    page,
    "get",
    `${BASE}/api/${org}/alerts/deduplication/semantic-groups`,
  );
  if (!res.ok()) throw new Error(`getSemanticGroups failed: ${res.status()}`);
  return res.json();
}

async function putSemanticGroups(page, org, groups) {
  const res = await authedRequest(
    page,
    "put",
    `${BASE}/api/${org}/alerts/deduplication/semantic-groups`,
    { data: groups },
  );
  const body = await res.json().catch(() => null);
  return { status: res.status(), body };
}

/** Append a custom group to the org's current groups. */
async function addSemanticGroup(page, org, group) {
  const current = await getSemanticGroups(page, org);
  const groups = Array.isArray(current) ? current : current.groups || [];
  const next = groups.filter((g) => g.id !== group.id).concat([group]);
  const res = await putSemanticGroups(page, org, next);
  if (res.status !== 200) {
    throw new Error(
      `addSemanticGroup failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return next;
}

/** Remove a group by id. */
async function removeSemanticGroup(page, org, groupId) {
  const current = await getSemanticGroups(page, org);
  const groups = Array.isArray(current) ? current : current.groups || [];
  const res = await putSemanticGroups(
    page,
    org,
    groups.filter((g) => g.id !== groupId),
  );
  if (res.status !== 200) {
    throw new Error(
      `removeSemanticGroup failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Search (for zero-row / F1 verification)
// ---------------------------------------------------------------------------

/** Run SQL against logs; returns hits array. Window: last 30 min. */
async function searchLogs(page, org, sql) {
  const end = nowMicros();
  const start = end - 30 * 60 * 1_000_000;
  const res = await authedRequest(
    page,
    "post",
    `${BASE}/api/${org}/_search?type=logs`,
    { data: { query: { sql, start_time: start, end_time: end, from: 0, size: 100 } } },
  );
  if (!res.ok()) {
    throw new Error(`searchLogs failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  return body.hits || [];
}

/** Build `SELECT * FROM "stream" WHERE f1='v1' AND ...` from a filters map. */
function sqlForFilters(stream, filters) {
  const where = Object.entries(filters)
    .map(([k, v]) => `${k} = '${String(v).replace(/'/g, "''")}'`)
    .join(" AND ");
  return `SELECT * FROM "${stream}"${where ? ` WHERE ${where}` : ""}`;
}

/** Poll listServices until `pred(rows)` is truthy; returns the rows snapshot. */
async function waitForServices(page, org, pred, label = "services") {
  return pollUntil(
    async () => {
      const rows = await listServices(page, org);
      return pred(rows) ? rows : null;
    },
    { label },
  );
}

module.exports = {
  BASE,
  DISCOVERY_DEADLINE_MS,
  MAX_STREAMS_PER_TYPE,
  nowMicros,
  sleep,
  pollUntil,
  createCorrelationOrg,
  deleteOrg,
  ingestLogs,
  ingestMetrics,
  ingestTraces,
  listServices,
  correlate,
  getIdentity,
  saveIdentity,
  getAnalytics,
  reset,
  getSemanticGroups,
  putSemanticGroups,
  addSemanticGroup,
  removeSemanticGroup,
  searchLogs,
  sqlForFilters,
  waitForServices,
};
