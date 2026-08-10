// Journey C — Detection rules / identity sets (API tier of TC-C1..C4).
// Plan: docs/test_generator/test-plans/correlation-e2e-test-plan.md

const { test, expect } = require("@playwright/test");
const { CorrApi } = require("./utils/correlationApi");

test.describe.configure({ mode: "serial" });

// Alpha1 shards run under playwright-alpha1.config.js (5-min CI cap); several
// scenarios need two discovery waits — give every test explicit headroom.
test.beforeEach(() => test.setTimeout(600_000));

test.describe("Journey C — identity sets", () => {
  test("TC-C1 + TC-C2: two sets route correctly; editing a set cleans its rows immediately (F8/F10)", async () => {
    const api = await CorrApi.create("corr_c12");
    try {
      const save = await api.saveIdentity({
        sets: [
          {
            id: "k8s",
            label: "K8s",
            distinguish_by: ["k8s-cluster", "k8s-namespace"],
          },
          { id: "vm", label: "VM", distinguish_by: ["environment", "host"] },
        ],
        tracked_alias_ids: [
          "k8s-cluster",
          "k8s-namespace",
          "environment",
          "host",
        ],
        service_optional: false,
      });
      expect(save.status).toBe(200);

      // TC-C1: each shape lands in its own set.
      await api.ingestLogs("c1_k8s_logs", [
        {
          service: "ksvc",
          k8s_cluster: "c1",
          k8s_namespace: "n1",
          message: "k8s",
        },
      ]);
      await api.ingestLogs("c1_vm_logs", [
        { service: "vsvc", environment: "prod", host: "h9", message: "vm" },
      ]);
      const rows = await api.waitForServices(
        (r) =>
          r.some((row) => row.service_name === "ksvc") &&
          r.some((row) => row.service_name === "vsvc"),
        "both shapes discovered",
      );
      expect(rows.find((r) => r.service_name === "ksvc").set_id).toBe("k8s");
      expect(rows.find((r) => r.service_name === "vsvc").set_id).toBe("vm");

      // TC-C2: change the vm set's shape → its rows are cleaned IMMEDIATELY
      // (delete_by_set_id + cache clear + reload event on save — no flush wait).
      const edit = await api.saveIdentity({
        sets: [
          {
            id: "k8s",
            label: "K8s",
            distinguish_by: ["k8s-cluster", "k8s-namespace"],
          },
          {
            id: "vm",
            label: "VM",
            distinguish_by: ["environment", "k8s-cluster"],
          },
        ],
        tracked_alias_ids: [
          "k8s-cluster",
          "k8s-namespace",
          "environment",
          "host",
        ],
        service_optional: false,
      });
      expect(edit.status).toBe(200);

      const after = await api.listServices();
      expect(
        after.filter((r) => r.set_id === "vm"),
        "vm-set rows must be deleted immediately on shape change",
      ).toHaveLength(0);
      expect(
        after.filter((r) => r.set_id === "k8s"),
        "unchanged k8s set rows must survive",
      ).toHaveLength(1);

      // Correlate during the transition: fresh rows or no-match — never a stale union.
      const mid = await api.correlate(
        { service: "vsvc", environment: "prod" },
        { sourceStream: "c1_vm_logs", sourceType: "logs" },
      );
      expect(mid.status).toBe(200);
      expect(mid.body, "stale vm row must not match after cleanup").toBeNull();

      // New-shape data re-populates the set.
      await api.ingestLogs("c1_vm_logs", [
        {
          service: "vsvc",
          environment: "prod",
          k8s_cluster: "c1",
          host: "h9",
          message: "vm2",
        },
      ]);
      const repop = await api.waitForServices(
        (r) =>
          r.some((row) => row.service_name === "vsvc" && row.set_id === "vm"),
        "vm set repopulated under new shape",
      );
      const vrow = repop.find(
        (r) => r.service_name === "vsvc" && r.set_id === "vm",
      );
      expect(Object.keys(vrow.disambiguation).sort()).toEqual([
        "environment",
        "k8s-cluster",
      ]);
    } finally {
      await api.dispose();
    }
  });

  test("TC-C3: cluster-qualified correlate narrows; service-only correlate is an honest union (F11)", async () => {
    const api = await CorrApi.create("corr_c3");
    try {
      const save = await api.saveIdentity({
        sets: [{ id: "k8s", label: "K8s", distinguish_by: ["k8s-cluster"] }],
        tracked_alias_ids: ["k8s-cluster"],
        service_optional: false,
      });
      expect(save.status).toBe(200);

      await api.ingestLogs("us_c3_logs", [
        { service: "globalsvc", k8s_cluster: "us", message: "us" },
      ]);
      await api.ingestLogs("eu_c3_logs", [
        { service: "globalsvc", k8s_cluster: "eu", message: "eu" },
      ]);
      await api.waitForServices(
        (r) => r.filter((row) => row.service_name === "globalsvc").length === 2,
        "both cluster rows discovered",
      );

      // Cluster-qualified → only that cluster's streams.
      const us = await api.correlate(
        { service: "globalsvc", "k8s-cluster": "us" },
        { sourceStream: "us_c3_logs", sourceType: "logs" },
      );
      expect(us.status).toBe(200);
      expect(us.body).not.toBeNull();
      const usLogs = (us.body.related_streams?.logs || []).map(
        (s) => s.stream_name,
      );
      expect(usLogs).toContain("us_c3_logs");
      expect(
        usLogs,
        "eu stream must not leak into a us-qualified correlate",
      ).not.toContain("eu_c3_logs");

      // Service-only → union is the documented contract; filters must carry
      // ONLY the service field so the UI can cue the ambiguity.
      const bare = await api.correlate(
        { service: "globalsvc" },
        { sourceStream: "us_c3_logs", sourceType: "logs" },
      );
      expect(bare.status).toBe(200);
      expect(bare.body).not.toBeNull();
      const bareLogs = (bare.body.related_streams?.logs || []).map(
        (s) => s.stream_name,
      );
      expect(bareLogs.sort()).toEqual(["eu_c3_logs", "us_c3_logs"]);
      for (const s of bare.body.related_streams?.logs || []) {
        const keys = Object.keys(s.filters || {});
        expect(
          keys.every((k) => !/cluster/i.test(k)),
          `service-only union must not synthesize cluster filters (got ${keys})`,
        ).toBe(true);
      }
    } finally {
      await api.dispose();
    }
  });

  test("TC-C4: typo'd distinguish_by rejected with exact message; config untouched (F26)", async () => {
    const api = await CorrApi.create("corr_c4");
    try {
      const bad = await api.saveIdentity({
        sets: [{ id: "typo", label: "Typo", distinguish_by: ["environmnet"] }],
        tracked_alias_ids: [],
        service_optional: false,
      });
      expect(bad.status).toBe(400);
      const msg = JSON.stringify(bad.body);
      expect(msg).toContain("typo");
      expect(msg).toContain("unknown distinguish_by group IDs");
      expect(msg).toContain("environmnet");

      // T3: nothing was persisted — config has no 'typo' set.
      const cfg = await api.getIdentity();
      expect((cfg.sets || []).map((s) => s.id)).not.toContain("typo");
    } finally {
      await api.dispose();
    }
  });
});
