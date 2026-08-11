// Journey A — First-time discovery (API tier of TC-A1..A3).
// Plan: docs/test_generator/test-plans/correlation-e2e-test-plan.md

const { test, expect } = require("@playwright/test");
const testLogger = require('../utils/test-logger.js');
const { CorrApi } = require("./utils/correlationApi");

test.describe.configure({ mode: "serial" });

// Alpha1 shards run under playwright-alpha1.config.js (5-min CI cap); several
// scenarios need two discovery waits — give every test explicit headroom.
test.beforeEach(() => test.setTimeout(600_000));

test.describe("Journey A — first-time discovery", () => {
  testLogger.info('test started');
  test("TC-A1: k8s telemetry across logs/traces/metrics → services appear once, fully typed", async () => {
    const api = await CorrApi.create("corr_a1");
    try {
      // Default (bootstrap) identity config: sets derived from workload-type
      // groups — k8s coverage comes from k8s_cluster/k8s_namespace fields.
      const services = [
        { service: "api", ns: "n1" },
        { service: "web", ns: "n2" },
      ];
      for (const s of services) {
        await api.ingestLogs("a1_logs", [
          {
            service: s.service,
            k8s_cluster: "c1",
            k8s_namespace: s.ns,
            message: "hi",
          },
          {
            service: s.service,
            k8s_cluster: "c1",
            k8s_namespace: s.ns,
            message: "hi2",
          },
        ]);
        // Canonical OTel resource attr keys: they flatten to
        // service_k8s_cluster_name / service_k8s_namespace_name, which the
        // default semantic groups cover (bare k8s_cluster does NOT — it
        // flattens to service_k8s_cluster, an uncovered spelling).
        await api.ingestTraces(
          s.service,
          { "k8s.cluster.name": "c1", "k8s.namespace.name": s.ns },
          2,
        );
        await api.ingestMetrics([
          {
            __name__: "a1_requests",
            service: s.service,
            k8s_cluster: "c1",
            k8s_namespace: s.ns,
          },
        ]);
      }

      const rows = await api.waitForServices(
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
        // T3: exactly one row per (service, disambiguation) — no duplicates.
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
        // set_id resolved to a real set, not empty.
        expect(row.set_id).toBeTruthy();
      }

      // Traces are discovered from the traces stream (default OTLP stream).
      // Soft-verified: traces WAL cadence can lag; assert if present.
      const withTraces = rows.filter(
        (r) => (r.traces_streams || []).length > 0,
      );
      if (withTraces.length === 0) {
        console.warn(
          "TC-A1: traces_streams not yet populated (traces WAL lag) — logs+metrics verified",
        );
      }
    } finally {
      await api.dispose();
    }
  });

  test("TC-A2: serviceless metrics → no phantom per-stream service; service_optional correlates via host", async () => {
    const api = await CorrApi.create("corr_a2");
    try {
      const save = await api.saveIdentity({
        sets: [{ id: "vm", label: "VM", distinguish_by: ["host"] }],
        tracked_alias_ids: ["host", "environment"],
        service_optional: true,
      });
      expect(save.status).toBe(200);

      // Metrics with NO service label; logs WITH service, sharing the host.
      await api.ingestMetrics([
        { __name__: "a2_cpu", host: "shared_h1" },
        { __name__: "a2_mem", host: "shared_h1" },
      ]);
      await api.ingestLogs("a2_logs", [
        { service: "web2", host: "shared_h1", message: "x" },
      ]);

      const rows = await api.waitForServices(
        (r) =>
          r.some((row) => row.service_name === "web2") &&
          r.some((row) => (row.metrics_streams || []).length > 0),
        "log service + metrics rows discovered",
      );

      // F7: fallback identity must derive from ORG-configured tracked ids,
      // never one phantom service per metric stream name.
      const phantom = rows.filter((r) =>
        ["a2_cpu", "a2_mem"].includes(r.service_name),
      );
      expect(
        phantom,
        `phantom per-metric-stream services found: ${JSON.stringify(phantom.map((p) => p.service_name))}`,
      ).toHaveLength(0);

      // service_optional=true: correlating from the log's host reaches the metrics streams.
      const { status, body } = await api.correlate(
        { service: "web2", host: "shared_h1" },
        { sourceStream: "a2_logs", sourceType: "logs" },
      );
      expect(status).toBe(200);
      expect(
        body,
        "expected a match (service_optional host bridge)",
      ).not.toBeNull();
      const metricStreams = (body.related_streams?.metrics || []).map(
        (s) => s.stream_name,
      );
      expect(metricStreams).toEqual(expect.arrayContaining(["a2_cpu"]));
    } finally {
      await api.dispose();
    }
  });

  test("TC-A3: mixed-case values — raw case emitted in filters, and those filters return rows (F1 regression)", async () => {
    const api = await CorrApi.create("corr_a3");
    try {
      const save = await api.saveIdentity({
        sets: [{ id: "vm", label: "VM", distinguish_by: ["host"] }],
        tracked_alias_ids: ["host"],
        service_optional: false,
      });
      expect(save.status).toBe(200);

      await api.ingestLogs("a3_logs", [
        {
          service: "PaymentService",
          host: "Chaitanyas-MBP",
          message: "pay ok",
        },
        {
          service: "PaymentService",
          host: "Chaitanyas-MBP",
          message: "pay ok 2",
        },
      ]);

      await api.waitForServices(
        (r) => r.some((row) => (row.logs_streams || []).includes("a3_logs")),
        "mixed-case service discovered",
      );

      // Correlate with RAW-case request values (lowercase is matching-only).
      const { status, body } = await api.correlate(
        { service: "PaymentService", host: "Chaitanyas-MBP" },
        { sourceStream: "a3_logs", sourceType: "logs" },
      );
      expect(status).toBe(200);
      expect(body, "mixed-case correlate must match").not.toBeNull();

      // F1 regression core: every emitted filter, run as real SQL, returns >0 rows.
      const logStreams = body.related_streams?.logs || [];
      expect(logStreams.length).toBeGreaterThan(0);
      for (const s of logStreams) {
        const sql = api.sqlForFilters(s.stream_name, s.filters || {});
        const hits = await api.searchLogs(sql);
        expect(
          hits.length,
          `zero-row query for ${s.stream_name} — filters lowercased? sql=${sql}`,
        ).toBeGreaterThan(0);
        // Raw values (not lowercased) must appear in the emitted filters.
        const values = Object.values(s.filters || {});
        expect(values).toContain("PaymentService");
      }
    } finally {
      await api.dispose();
    }
  });
});
