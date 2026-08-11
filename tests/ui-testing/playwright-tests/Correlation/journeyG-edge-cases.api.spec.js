// Journey G — Data-shape edge cases & bounded growth (API tier of TC-G1..G3).
// Plan: docs/test_generator/test-plans/correlation-e2e-test-plan.md

const { test, expect } = require("@playwright/test");
const testLogger = require('../utils/test-logger.js');
const { CorrApi } = require("./utils/correlationApi");

test.describe.configure({ mode: "serial" });

// Alpha1 shards run under playwright-alpha1.config.js (5-min CI cap); several
// scenarios need two discovery waits — give every test explicit headroom.
test.beforeEach(() => test.setTimeout(600_000));

const MAX_STREAMS_PER_TYPE = Number(
  process.env.O2_SERVICE_STREAMS_MAX_STREAMS_PER_SERVICE || 50,
);

test.describe("Journey G — edge cases & bounded growth", () => {
  testLogger.info('test started');
  test("TC-G1: 60 metric streams for one service → capped at max_streams_per_type (F32)", async () => {
    const api = await CorrApi.create("corr_g1");
    try {
      const save = await api.saveIdentity({
        sets: [{ id: "vm", label: "VM", distinguish_by: ["host"] }],
        tracked_alias_ids: ["host"],
        service_optional: false,
      });
      expect(save.status).toBe(200);

      const records = [];
      for (let i = 0; i < 60; i++) {
        records.push({
          __name__: `g1_metric_${String(i).padStart(2, "0")}`,
          service: "capsvc",
          host: "caph",
        });
      }
      await api.ingestMetrics(records);
      // A log row anchors the service so partial metric arrival is observable.
      await api.ingestLogs("g1_logs", [
        { service: "capsvc", host: "caph", message: "anchor" },
      ]);

      // Wait until the row has absorbed at least the cap's worth of streams.
      const rows = await api.waitForServices(
        (r) =>
          r.some(
            (row) =>
              row.service_name === "capsvc" &&
              (row.metrics_streams || []).length >= MAX_STREAMS_PER_TYPE,
          ),
        `capsvc metrics_streams reaches cap (${MAX_STREAMS_PER_TYPE})`,
      );
      const row = rows.find((r) => r.service_name === "capsvc");
      // F32: the DB write path must enforce the cap — never 60.
      expect(
        row.metrics_streams.length,
        `stream array exceeded max_streams_per_type: ${row.metrics_streams.length}`,
      ).toBeLessThanOrEqual(MAX_STREAMS_PER_TYPE);
    } finally {
      await api.dispose();
    }
  });

  test("TC-G2: subset → richer disambiguation upgrades in place; stale subset never returns (F19)", async () => {
    const api = await CorrApi.create("corr_g2");
    try {
      const save = await api.saveIdentity({
        sets: [
          {
            id: "k8s",
            label: "K8s",
            distinguish_by: ["k8s-cluster", "k8s-namespace"],
          },
        ],
        tracked_alias_ids: ["k8s-cluster", "k8s-namespace"],
        service_optional: false,
      });
      expect(save.status).toBe(200);

      // Stage 1: cluster only → row {k8s-cluster: c1}.
      await api.ingestLogs("g2_logs", [
        { service: "gsvc", k8s_cluster: "c1", message: "s1" },
      ]);
      await api.waitForServices(
        (r) =>
          r.some(
            (row) =>
              row.service_name === "gsvc" &&
              row.disambiguation?.["k8s-cluster"] === "c1",
          ),
        "subset row {cluster} discovered",
      );

      // Stage 2: cluster+namespace → the richer row replaces the subset.
      await api.ingestLogs("g2_logs", [
        {
          service: "gsvc",
          k8s_cluster: "c1",
          k8s_namespace: "n1",
          message: "s2",
        },
      ]);
      const rows = await api.waitForServices(
        (r) =>
          r.some(
            (row) =>
              row.service_name === "gsvc" &&
              row.disambiguation?.["k8s-namespace"] === "n1",
          ),
        "richer row {cluster, ns} discovered",
      );

      // Single row survives; the subset orphan is deleted AND cache-evicted.
      const mine = rows.filter((r) => r.service_name === "gsvc");
      expect(
        mine.length,
        `expected exactly one row after subset merge, got ${JSON.stringify(
          mine.map((m) => m.disambiguation),
        )}`,
      ).toBe(1);
      expect(mine[0].disambiguation).toEqual({
        "k8s-cluster": "c1",
        "k8s-namespace": "n1",
      });

      // Correlate must serve the upgraded row, never the stale subset.
      const { status, body } = await api.correlate(
        { service: "gsvc", "k8s-cluster": "c1", "k8s-namespace": "n1" },
        { sourceStream: "g2_logs", sourceType: "logs" },
      );
      expect(status).toBe(200);
      expect(body).not.toBeNull();
      expect(body.matched_dimensions["k8s-namespace"]).toBe("n1");
    } finally {
      await api.dispose();
    }
  });

  test("TC-G3: whitespace-only / empty dimension values → no phantom rows, no empty keys (F21)", async () => {
    const api = await CorrApi.create("corr_g3");
    try {
      const save = await api.saveIdentity({
        sets: [
          {
            id: "k8s",
            label: "K8s",
            distinguish_by: ["k8s-cluster", "k8s-namespace"],
          },
        ],
        tracked_alias_ids: ["k8s-cluster", "k8s-namespace"],
        service_optional: false,
      });
      expect(save.status).toBe(200);

      await api.ingestLogs("g3_logs", [
        {
          service: "wsvc",
          k8s_cluster: "c1",
          k8s_namespace: "   ",
          message: "ws",
        },
        {
          service: "wsvc",
          k8s_cluster: "c1",
          k8s_namespace: "",
          message: "empty",
        },
      ]);
      const rows = await api.waitForServices(
        (r) => r.some((row) => row.service_name === "wsvc"),
        "wsvc discovered despite hollow namespace values",
      );

      const mine = rows.filter((r) => r.service_name === "wsvc");
      // Exactly one row — whitespace and empty variants must not fork rows.
      expect(
        mine.length,
        `phantom rows from hollow values: ${JSON.stringify(mine.map((m) => m.disambiguation))}`,
      ).toBe(1);
      // And no empty-string / whitespace-only values anywhere in it.
      const row = mine[0];
      for (const [k, v] of [
        ...Object.entries(row.disambiguation || {}),
        ...Object.entries(row.all_dimensions || {}),
      ]) {
        expect(
          String(v).trim().length,
          `hollow value stored under '${k}'`,
        ).toBeGreaterThan(0);
      }
      expect(row.disambiguation).toEqual({ "k8s-cluster": "c1" });
    } finally {
      await api.dispose();
    }
  });
});
