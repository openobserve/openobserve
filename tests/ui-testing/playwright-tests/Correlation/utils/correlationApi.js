// API helper for the service-streams correlation Phase-1 (API-only) suite.
// Targets a locally running enterprise build (wt-correlation-fix worktree).
//
// Temporal contract (f(env) of the backend under test, per
// docs/test_generator/test-plans/correlation-e2e-test-plan.md):
//   ZO_MAX_FILE_RETENTION_TIME=10, ZO_FILE_PUSH_INTERVAL=10,
//   O2_SERVICE_STREAMS_BATCH_FLUSH_INTERVAL_SECS=5, SAMPLE_RATE=1.
// Measured end-to-end discovery latency on this env is ~2min (WAL move job
// cadence dominates), so the poll deadline is 180s. Never assert
// "not visible before Ns" — the batch processor flushes early on queue pressure.

const { request: apiRequest } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

// Deployed-env support (alpha1 workflow): the run exports ZO_BASE_URL and
// ALPHA1_USER_* / ZO_ROOT_USER_* creds. Local dev falls back to the
// wt-correlation-fix stack defaults.
const BASE_URL =
  process.env.O2_BASE_URL || process.env.ZO_BASE_URL || "http://localhost:5090";
const USER =
  process.env.O2_ROOT_EMAIL ||
  process.env.ZO_ROOT_USER_EMAIL ||
  process.env.ALPHA1_USER_EMAIL;
const PASS =
  process.env.O2_ROOT_PASSWORD ||
  process.env.ZO_ROOT_USER_PASSWORD ||
  process.env.ALPHA1_USER_PASSWORD;

// Alpha1 mints a browser auth state (cookies) — basic auth may not exist on
// cloud. When the minted state is present, drive the API with it instead.
const AUTH_STATE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "utils",
  "auth",
  "user.json",
);

// First flush after a cold server start has been measured at ~3.3 min
// (WAL replay + move-job warmup); 300s covers it with margin. Deployed envs
// may run slower flush/sampling settings — the dispatcher can raise this via
// env without a code change.
const DISCOVERY_DEADLINE_MS = Number(
  process.env.O2_CORR_DISCOVERY_DEADLINE_MS || 300_000,
);
const POLL_INTERVAL_MS = 3_000;

function nowMicros() {
  return Date.now() * 1000;
}

async function sleep(ms) {
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
    `pollUntil: timed out after ${deadlineMs}ms waiting for ${label} (last=${JSON.stringify(last)})`,
  );
}

class CorrApi {
  constructor(ctx, org, orgName) {
    this.ctx = ctx;
    this.org = org;
    this.orgName = orgName;
  }

  /** Create a fresh org (names are NOT idempotent — always unique, underscores only). */
  static async create(orgPrefix) {
    // NOTE: httpCredentials won't work here — OpenObserve's 401 has no
    // WWW-Authenticate challenge, so Playwright never retries with creds.
    // Send the Basic header on every request instead. On alpha1, prefer the
    // minted session cookies (cloud logins may not accept basic auth).
    // Only trust the minted auth state on an actual alpha1 run (ALPHA1_USER_*
    // exported) — a stale local user.json must not hijack local basic auth.
    const isAlpha1Run = !!process.env.ALPHA1_USER_EMAIL;
    const ctxOptions = { baseURL: BASE_URL };
    if (isAlpha1Run && fs.existsSync(AUTH_STATE_PATH)) {
      ctxOptions.storageState = AUTH_STATE_PATH;
    } else {
      ctxOptions.extraHTTPHeaders = {
        Authorization: `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`,
      };
    }
    const ctx = await apiRequest.newContext(ctxOptions);
    const name = `${orgPrefix}_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
    const res = await ctx.post("/api/organizations", { data: { name } });
    if (!res.ok()) {
      throw new Error(`org create failed: ${res.status()} ${await res.text()}`);
    }
    const body = await res.json();
    const org = body.identifier || (body.data && body.data.identifier);
    if (!org)
      throw new Error(`org create: no identifier in ${JSON.stringify(body)}`);
    return new CorrApi(ctx, org, name);
  }

  async dispose() {
    await this.ctx.dispose();
  }

  // ---------- ingest ----------

  /** records: array of flat objects; _timestamp (micros) added if missing. */
  async ingestLogs(stream, records) {
    const ts = nowMicros();
    const data = records.map((r) => ({ _timestamp: ts, ...r }));
    const res = await this.ctx.post(`/api/${this.org}/${stream}/_json`, {
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
  async ingestMetrics(records) {
    const ts = Date.now();
    const data = records.map((r) => ({
      __type__: "gauge",
      _timestamp: ts,
      value: 1,
      ...r,
    }));
    const res = await this.ctx.post(`/api/${this.org}/ingest/metrics/_json`, {
      data,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok() || body.code !== 200) {
      throw new Error(
        `ingestMetrics failed: ${res.status()} ${JSON.stringify(body)}`,
      );
    }
    return body;
  }

  /**
   * Minimal OTLP-JSON trace ingest. `spans`: [{name, attrs, parent}] — attrs are
   * flat key->string maps placed as resource attributes (keys without dots
   * flatten to themselves in the stored record). Emits one parent + children.
   */
  async ingestTraces(serviceName, attrs, childCount = 1) {
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
    const res = await this.ctx.post(`/api/${this.org}/v1/traces`, { data });
    if (!res.ok()) {
      throw new Error(
        `ingestTraces failed: ${res.status()} ${await res.text()}`,
      );
    }
    return res;
  }

  // ---------- service_streams API ----------

  async listServices() {
    const res = await this.ctx.get(`/api/${this.org}/service_streams`);
    if (!res.ok()) throw new Error(`listServices failed: ${res.status()}`);
    return res.json();
  }

  /** Returns {status, body} — body is null on 200-null no-match. */
  async correlate(
    availableDimensions,
    { sourceStream = "unknown", sourceType = "logs" } = {},
  ) {
    const res = await this.ctx.post(
      `/api/${this.org}/service_streams/_correlate`,
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

  async getIdentity() {
    const res = await this.ctx.get(
      `/api/${this.org}/service_streams/config/identity`,
    );
    if (!res.ok()) throw new Error(`getIdentity failed: ${res.status()}`);
    return res.json();
  }

  /** Returns {status, body} so 400-path tests can assert the message. */
  async saveIdentity(cfg) {
    const res = await this.ctx.put(
      `/api/${this.org}/service_streams/config/identity`,
      {
        data: cfg,
      },
    );
    const body = await res.json().catch(() => null);
    return { status: res.status(), body };
  }

  async getAnalytics() {
    const res = await this.ctx.get(
      `/api/${this.org}/service_streams/_analytics`,
    );
    if (!res.ok()) throw new Error(`getAnalytics failed: ${res.status()}`);
    return res.json();
  }

  async reset() {
    const res = await this.ctx.delete(
      `/api/${this.org}/service_streams/_reset`,
    );
    if (!res.ok())
      throw new Error(`reset failed: ${res.status()} ${await res.text()}`);
    return res.json().catch(() => ({}));
  }

  // ---------- semantic groups (Field Mappings) ----------

  async getSemanticGroups() {
    const res = await this.ctx.get(
      `/api/${this.org}/alerts/deduplication/semantic-groups`,
    );
    if (!res.ok()) throw new Error(`getSemanticGroups failed: ${res.status()}`);
    return res.json();
  }

  async putSemanticGroups(groups) {
    const res = await this.ctx.put(
      `/api/${this.org}/alerts/deduplication/semantic-groups`,
      {
        data: groups,
      },
    );
    const body = await res.json().catch(() => null);
    return { status: res.status(), body };
  }

  /** Append a custom group to the org's current groups. */
  async addSemanticGroup(group) {
    const current = await this.getSemanticGroups();
    const groups = Array.isArray(current) ? current : current.groups || [];
    const next = groups.filter((g) => g.id !== group.id).concat([group]);
    const res = await this.putSemanticGroups(next);
    if (res.status !== 200) {
      throw new Error(
        `addSemanticGroup failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    return next;
  }

  /** Remove a group by id. */
  async removeSemanticGroup(groupId) {
    const current = await this.getSemanticGroups();
    const groups = Array.isArray(current) ? current : current.groups || [];
    const res = await this.putSemanticGroups(
      groups.filter((g) => g.id !== groupId),
    );
    if (res.status !== 200) {
      throw new Error(
        `removeSemanticGroup failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
  }

  // ---------- search (for FL-4 zero-row verification) ----------

  /** Run SQL against logs; returns hits array. Window: last 30 min. */
  async searchLogs(sql) {
    const end = nowMicros();
    const start = end - 30 * 60 * 1_000_000;
    const res = await this.ctx.post(`/api/${this.org}/_search?type=logs`, {
      data: {
        query: { sql, start_time: start, end_time: end, from: 0, size: 100 },
      },
    });
    if (!res.ok()) {
      throw new Error(`searchLogs failed: ${res.status()} ${await res.text()}`);
    }
    const body = await res.json();
    return body.hits || [];
  }

  /** Build `SELECT * FROM "stream" WHERE f1='v1' AND ...` from a filters map. */
  sqlForFilters(stream, filters) {
    const where = Object.entries(filters)
      .map(([k, v]) => `${k} = '${String(v).replace(/'/g, "''")}'`)
      .join(" AND ");
    return `SELECT * FROM "${stream}"${where ? ` WHERE ${where}` : ""}`;
  }

  // ---------- polling shorthands ----------

  /** Poll until `pred(rows)` is truthy; returns the rows snapshot. */
  async waitForServices(pred, label = "services") {
    return pollUntil(
      async () => {
        const rows = await this.listServices();
        return pred(rows) ? rows : null;
      },
      { label },
    );
  }
}

module.exports = {
  CorrApi,
  pollUntil,
  sleep,
  nowMicros,
  DISCOVERY_DEADLINE_MS,
};
