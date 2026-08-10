// Journey B — Custom semantic groups (API tier of TC-B2..B4).
// Plan: docs/test_generator/test-plans/correlation-e2e-test-plan.md

const { test, expect } = require("@playwright/test");
const { CorrApi } = require("./utils/correlationApi");

test.describe.configure({ mode: "serial" });

// Alpha1 shards run under playwright-alpha1.config.js (5-min CI cap); several
// scenarios need two discovery waits — give every test explicit headroom.
test.beforeEach(() => test.setTimeout(600_000));

const DC_GROUP = {
  id: "datacenter",
  display: "Datacenter",
  group: "Custom",
  fields: ["dc", "dc_region"],
};

test.describe("Journey B — custom semantic groups", () => {
  test("TC-B2: custom group in distinguish_by shapes NEW data end-to-end", async () => {
    const api = await CorrApi.create("corr_b2");
    try {
      await api.addSemanticGroup(DC_GROUP);
      const save = await api.saveIdentity({
        sets: [
          { id: "dcset", label: "Datacenter", distinguish_by: ["datacenter"] },
        ],
        tracked_alias_ids: ["datacenter"],
        service_optional: false,
      });
      expect(save.status, JSON.stringify(save.body)).toBe(200);

      // NEW data carrying the custom field (FL-1: only new data picks up config).
      await api.ingestLogs("eu_b2_logs", [
        { service: "pay", dc: "eu-1", message: "eu" },
      ]);
      await api.ingestLogs("us_b2_logs", [
        { service: "pay", dc: "us-1", message: "us" },
      ]);

      // T4: discovery rows carry the custom group in disambiguation.
      const rows = await api.waitForServices(
        (r) =>
          r.some((row) => row.disambiguation?.datacenter === "eu-1") &&
          r.some((row) => row.disambiguation?.datacenter === "us-1"),
        "both datacenter rows discovered",
      );
      const euRow = rows.find((r) => r.disambiguation?.datacenter === "eu-1");
      expect(euRow.logs_streams).toContain("eu_b2_logs");

      // T2: correlate from an eu-1 log returns ONLY eu streams, raw value in filters.
      const { status, body } = await api.correlate(
        { service: "pay", datacenter: "eu-1" },
        { sourceStream: "eu_b2_logs", sourceType: "logs" },
      );
      expect(status).toBe(200);
      expect(body).not.toBeNull();
      const logStreams = (body.related_streams?.logs || []).map(
        (s) => s.stream_name,
      );
      expect(logStreams).toContain("eu_b2_logs");
      expect(
        logStreams,
        "us stream must be excluded when datacenter disambiguates",
      ).not.toContain("us_b2_logs");
      const euFilters = (body.related_streams?.logs || []).find(
        (s) => s.stream_name === "eu_b2_logs",
      ).filters;
      expect(Object.values(euFilters || {})).toContain("eu-1");
    } finally {
      await api.dispose();
    }
  });

  test("TC-B3: group added AFTER data existed — honesty of the FL-1 contract", async () => {
    const api = await CorrApi.create("corr_b3");
    try {
      // Phase 0: discover under config v1 (k8s-cluster only).
      const v1 = await api.saveIdentity({
        sets: [{ id: "k8s", label: "K8s", distinguish_by: ["k8s-cluster"] }],
        tracked_alias_ids: ["k8s-cluster"],
        service_optional: false,
      });
      expect(v1.status).toBe(200);
      await api.ingestLogs("b3_logs", [
        { service: "web3", k8s_cluster: "c1", dc: "eu-1", message: "old data" },
      ]);
      await api.waitForServices(
        (r) => r.some((row) => row.service_name === "web3"),
        "web3 discovered under v1 config",
      );

      // Phase 1: add the custom group + a NEW set (k8s set untouched, so its
      // rows survive F10 cleanup) — correlate immediately, NO new ingest.
      await api.addSemanticGroup(DC_GROUP);
      const v2 = await api.saveIdentity({
        sets: [
          { id: "k8s", label: "K8s", distinguish_by: ["k8s-cluster"] },
          { id: "dcset", label: "Datacenter", distinguish_by: ["datacenter"] },
        ],
        tracked_alias_ids: ["k8s-cluster", "datacenter"],
        service_optional: false,
      });
      expect(v2.status).toBe(200);

      const pre = await api.correlate(
        { service: "web3", "k8s-cluster": "c1", datacenter: "eu-1" },
        { sourceStream: "b3_logs", sourceType: "logs" },
      );
      expect(pre.status).toBe(200);
      // Contract pin: existing rows (unchanged set) still match via coverage —
      // config change alone must NOT hard-null existing correlation.
      expect(
        pre.body,
        "pre-re-ingest correlate must still match (FL-1 honesty)",
      ).not.toBeNull();

      // Phase 2: one new ingest batch → tracked dims upgrade (datacenter value
      // becomes visible on the row / correlate response).
      await api.ingestLogs("b3_logs", [
        { service: "web3", k8s_cluster: "c1", dc: "eu-1", message: "new data" },
      ]);
      const rows = await api.waitForServices(
        (r) =>
          r.some(
            (row) =>
              row.service_name === "web3" &&
              (row.all_dimensions?.datacenter === "eu-1" ||
                row.disambiguation?.datacenter === "eu-1"),
          ),
        "web3 row upgraded with datacenter after re-ingest",
      );
      const row = rows.find((r) => r.service_name === "web3");
      const post = await api.correlate(
        { service: "web3", "k8s-cluster": "c1", datacenter: "eu-1" },
        { sourceStream: "b3_logs", sourceType: "logs" },
      );
      expect(post.status).toBe(200);
      expect(post.body).not.toBeNull();
      const dims = {
        ...(post.body.matched_dimensions || {}),
        ...(post.body.additional_dimensions || {}),
      };
      expect(
        dims.datacenter ?? row.all_dimensions?.datacenter,
        "datacenter must be visible after re-ingest",
      ).toBe("eu-1");
    } finally {
      await api.dispose();
    }
  });

  test("TC-B4: deleting a referenced group → 400 on save, config unchanged (F26)", async () => {
    const api = await CorrApi.create("corr_b4");
    try {
      await api.addSemanticGroup(DC_GROUP);
      // Orphan lives ONLY in distinguish_by: tracked_alias_ids is validated
      // first, so an orphan there would mask the set-naming F26 message.
      const good = {
        sets: [
          { id: "dcset", label: "Datacenter", distinguish_by: ["datacenter"] },
        ],
        tracked_alias_ids: [],
        service_optional: false,
      };
      const saved = await api.saveIdentity(good);
      expect(saved.status).toBe(200);

      // Delete the group out from under the config.
      await api.removeSemanticGroup("datacenter");

      // (a) Re-save unchanged config → 400 naming the set and the orphan id.
      const resave = await api.saveIdentity(good);
      expect(resave.status, "orphan distinguish_by must be rejected").toBe(400);
      const msg = JSON.stringify(resave.body);
      expect(msg).toContain("dcset");
      expect(msg).toContain("datacenter");

      // (b) Orphan only in tracked_alias_ids → 400 "Unknown alias group IDs".
      const trackedOnly = await api.saveIdentity({
        sets: [{ id: "vm", label: "VM", distinguish_by: ["host"] }],
        tracked_alias_ids: ["datacenter"],
        service_optional: false,
      });
      expect(trackedOnly.status).toBe(400);
      expect(JSON.stringify(trackedOnly.body)).toContain(
        "Unknown alias group IDs",
      );

      // T3: config unchanged — still the pre-delete good config.
      const cfg = await api.getIdentity();
      expect(cfg.sets.map((s) => s.id)).toEqual(["dcset"]);
    } finally {
      await api.dispose();
    }
  });
});
