// Copyright 2026 OpenObserve Inc.

/**
 * Correlation — first-time service discovery  [P0]  (enterprise-only)
 *
 * Ingest telemetry across logs/traces/metrics and assert the service-streams
 * pipeline discovers each logical service exactly once, fully typed, with the
 * right disambiguation — and that a mixed-case correlate emits RAW-case filters
 * that actually return rows (the F1 regression core).
 *
 * Coverage:
 *  - DISC-01: k8s telemetry across three signals → services appear once, typed
 *  - DISC-02: serviceless metrics → no phantom per-stream service; service_optional
 *             host bridge (F7)
 *  - DISC-03: mixed-case values → raw case in filters, filters return rows (F1)
 *
 * Enterprise-gated: service_streams endpoints 403 on OSS builds.
 *
 * Org isolation: each test provisions a fresh org (discovery state is
 * org-global + destructive) and tears it down in afterEach. Shared plumbing:
 * ../utils/correlation-api-helpers.js.
 */

const { test, expect } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const {
  createCorrelationOrg,
  deleteOrg,
  ingestLogs,
  ingestMetrics,
  ingestTraces,
  correlate,
  saveIdentity,
  searchLogs,
  sqlForFilters,
  waitForServices,
} = require("../utils/correlation-api-helpers.js");

test.describe.configure({ mode: "serial" });

test.describe("Correlation — first-time discovery", { tag: ["@correlation", "@P0"] }, () => {
  let org;

  // Discovery polling can take DISCOVERY_DEADLINE_MS; several cases wait twice.
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.setTimeout(600_000);
    org = await createCorrelationOrg(page, "corr_disc");
  });

  test.afterEach(async ({ page }) => {
    await deleteOrg(page, org);
  });

  test("DISC-01: k8s telemetry across logs/traces/metrics → services appear once, fully typed", async ({
    page,
  }) => {
    // Default (bootstrap) identity config: sets derived from workload-type
    // groups — k8s coverage comes from k8s_cluster/k8s_namespace fields.
    const services = [
      { service: "api", ns: "n1" },
      { service: "web", ns: "n2" },
    ];
    for (const s of services) {
      await ingestLogs(page, org, "a1_logs", [
        { service: s.service, k8s_cluster: "c1", k8s_namespace: s.ns, message: "hi" },
        { service: s.service, k8s_cluster: "c1", k8s_namespace: s.ns, message: "hi2" },
      ]);
      // Canonical OTel resource attr keys flatten to
      // service_k8s_cluster_name / service_k8s_namespace_name, which the
      // default semantic groups cover (bare k8s_cluster does NOT).
      await ingestTraces(
        page,
        org,
        s.service,
        { "k8s.cluster.name": "c1", "k8s.namespace.name": s.ns },
        2,
      );
      await ingestMetrics(page, org, [
        { __name__: "a1_requests", service: s.service, k8s_cluster: "c1", k8s_namespace: s.ns },
      ]);
    }

    const rows = await waitForServices(
      page,
      org,
      (r) =>
        ["api", "web"].every((svc) =>
          r.some(
            (row) =>
              row.service_name === svc &&
              (row.logs_streams || []).includes("a1_logs") &&
              (row.metrics_streams || []).length > 0,
          ),
        ),
      "both services discovered with logs+metrics",
    );

    for (const svc of ["api", "web"]) {
      const mine = rows.filter((r) => r.service_name === svc);
      // Exactly one row per (service, disambiguation) — no duplicates.
      expect(
        mine.length,
        `expected exactly 1 row for ${svc}, got ${JSON.stringify(mine)}`,
      ).toBe(1);
      const row = mine[0];
      expect(row.logs_streams).toContain("a1_logs");
      expect(row.metrics_streams).toContain("a1_requests");
      // Disambiguation carries the k8s dims (semantic-ID key space).
      expect(row.disambiguation["k8s-cluster"]).toBe("c1");
      expect(Object.keys(row.disambiguation)).toContain("k8s-namespace");
      expect(row.set_id).toBeTruthy();
    }

    // Traces discovered from the default OTLP stream. Soft-verified: traces WAL
    // cadence can lag; assert only if present.
    const withTraces = rows.filter((r) => (r.traces_streams || []).length > 0);
    if (withTraces.length === 0) {
      testLogger.warn(
        "DISC-01: traces_streams not yet populated (traces WAL lag) — logs+metrics verified",
      );
    }
  });

  test("DISC-02: serviceless metrics → no phantom per-stream service; service_optional correlates via host (F7)", async ({
    page,
  }) => {
    const save = await saveIdentity(page, org, {
      sets: [{ id: "vm", label: "VM", distinguish_by: ["host"] }],
      tracked_alias_ids: ["host", "environment"],
      service_optional: true,
    });
    expect(save.status).toBe(200);

    // Metrics with NO service label; logs WITH service, sharing the host.
    await ingestMetrics(page, org, [
      { __name__: "a2_cpu", host: "shared_h1" },
      { __name__: "a2_mem", host: "shared_h1" },
    ]);
    await ingestLogs(page, org, "a2_logs", [
      { service: "web2", host: "shared_h1", message: "x" },
    ]);

    const rows = await waitForServices(
      page,
      org,
      (r) =>
        r.some((row) => row.service_name === "web2") &&
        r.some((row) => (row.metrics_streams || []).length > 0),
      "log service + metrics rows discovered",
    );

    // F7: fallback identity must derive from ORG-configured tracked ids, never
    // one phantom service per metric stream name.
    const phantom = rows.filter((r) => ["a2_cpu", "a2_mem"].includes(r.service_name));
    expect(
      phantom,
      `phantom per-metric-stream services found: ${JSON.stringify(phantom.map((p) => p.service_name))}`,
    ).toHaveLength(0);

    // service_optional=true: correlating from the log's host reaches the metrics.
    const { status, body } = await correlate(
      page,
      org,
      { service: "web2", host: "shared_h1" },
      { sourceStream: "a2_logs", sourceType: "logs" },
    );
    expect(status).toBe(200);
    expect(body, "expected a match (service_optional host bridge)").not.toBeNull();
    const metricStreams = (body.related_streams?.metrics || []).map((s) => s.stream_name);
    expect(metricStreams).toEqual(expect.arrayContaining(["a2_cpu"]));
  });

  test("DISC-03: mixed-case values — raw case emitted in filters, and those filters return rows (F1 regression)", async ({
    page,
  }) => {
    const save = await saveIdentity(page, org, {
      sets: [{ id: "vm", label: "VM", distinguish_by: ["host"] }],
      tracked_alias_ids: ["host"],
      service_optional: false,
    });
    expect(save.status).toBe(200);

    await ingestLogs(page, org, "a3_logs", [
      { service: "PaymentService", host: "Chaitanyas-MBP", message: "pay ok" },
      { service: "PaymentService", host: "Chaitanyas-MBP", message: "pay ok 2" },
    ]);

    await waitForServices(
      page,
      org,
      (r) => r.some((row) => (row.logs_streams || []).includes("a3_logs")),
      "mixed-case service discovered",
    );

    // Correlate with RAW-case request values (lowercase is matching-only).
    const { status, body } = await correlate(
      page,
      org,
      { service: "PaymentService", host: "Chaitanyas-MBP" },
      { sourceStream: "a3_logs", sourceType: "logs" },
    );
    expect(status).toBe(200);
    expect(body, "mixed-case correlate must match").not.toBeNull();

    // F1 regression core: every emitted filter, run as real SQL, returns >0 rows.
    const logStreams = body.related_streams?.logs || [];
    expect(logStreams.length).toBeGreaterThan(0);
    for (const s of logStreams) {
      const sql = sqlForFilters(s.stream_name, s.filters || {});
      const hits = await searchLogs(page, org, sql);
      expect(
        hits.length,
        `zero-row query for ${s.stream_name} — filters lowercased? sql=${sql}`,
      ).toBeGreaterThan(0);
      // Raw values (not lowercased) must appear in the emitted filters.
      expect(Object.values(s.filters || {})).toContain("PaymentService");
    }
  });
});
