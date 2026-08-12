// Copyright 2026 OpenObserve Inc.

/**
 * Correlation — custom semantic groups  [P1]  (enterprise-only)
 *
 * A custom semantic field group (mapping raw fields like `dc`/`dc_region` to a
 * canonical group id) must shape discovery and correlation end-to-end, honour
 * the "only new data picks up config" (FL-1) contract, and reject configs that
 * reference a deleted group.
 *
 * Coverage:
 *  - CUSTOM-01 (TC-B2): custom group in distinguish_by shapes NEW data e2e
 *  - CUSTOM-02 (TC-B3): group added AFTER data existed — FL-1 honesty
 *  - CUSTOM-03 (TC-B4): deleting a referenced group → 400 on save, config intact (F26)
 *
 * Shared plumbing: ../utils/correlation-api-helpers.js.
 */

const { test, expect } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const {
  createCorrelationOrg,
  deleteOrg,
  ingestLogs,
  correlate,
  saveIdentity,
  getIdentity,
  addSemanticGroup,
  removeSemanticGroup,
  waitForServices,
} = require("../utils/correlation-api-helpers.js");

test.describe.configure({ mode: "serial" });

const DC_GROUP = {
  id: "datacenter",
  display: "Datacenter",
  group: "Custom",
  fields: ["dc", "dc_region"],
};

test.describe("Correlation — custom semantic groups", { tag: ["@correlation", "@P1"] }, () => {
  let org;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.setTimeout(600_000);
    org = await createCorrelationOrg(page, "corr_cg");
  });

  test.afterEach(async ({ page }) => {
    await deleteOrg(page, org);
  });

  test("CUSTOM-01: custom group in distinguish_by shapes NEW data end-to-end (TC-B2)", async ({
    page,
  }) => {
    await addSemanticGroup(page, org, DC_GROUP);
    const save = await saveIdentity(page, org, {
      sets: [{ id: "dcset", label: "Datacenter", distinguish_by: ["datacenter"] }],
      tracked_alias_ids: ["datacenter"],
      service_optional: false,
    });
    expect(save.status, JSON.stringify(save.body)).toBe(200);

    // NEW data carrying the custom field (FL-1: only new data picks up config).
    await ingestLogs(page, org, "eu_b2_logs", [{ service: "pay", dc: "eu-1", message: "eu" }]);
    await ingestLogs(page, org, "us_b2_logs", [{ service: "pay", dc: "us-1", message: "us" }]);

    // Discovery rows carry the custom group in disambiguation.
    const rows = await waitForServices(
      page,
      org,
      (r) =>
        r.some((row) => row.disambiguation?.datacenter === "eu-1") &&
        r.some((row) => row.disambiguation?.datacenter === "us-1"),
      "both datacenter rows discovered",
    );
    const euRow = rows.find((r) => r.disambiguation?.datacenter === "eu-1");
    expect(euRow.logs_streams).toContain("eu_b2_logs");

    // Correlate from an eu-1 log returns ONLY eu streams, raw value in filters.
    const { status, body } = await correlate(
      page,
      org,
      { service: "pay", datacenter: "eu-1" },
      { sourceStream: "eu_b2_logs", sourceType: "logs" },
    );
    expect(status).toBe(200);
    expect(body).not.toBeNull();
    const logStreams = (body.related_streams?.logs || []).map((s) => s.stream_name);
    expect(logStreams).toContain("eu_b2_logs");
    expect(
      logStreams,
      "us stream must be excluded when datacenter disambiguates",
    ).not.toContain("us_b2_logs");
    const euFilters = (body.related_streams?.logs || []).find(
      (s) => s.stream_name === "eu_b2_logs",
    ).filters;
    expect(Object.values(euFilters || {})).toContain("eu-1");
  });

  test("CUSTOM-02: group added AFTER data existed — honesty of the FL-1 contract (TC-B3)", async ({
    page,
  }) => {
    // Phase 0: discover under config v1 (k8s-cluster only).
    const v1 = await saveIdentity(page, org, {
      sets: [{ id: "k8s", label: "K8s", distinguish_by: ["k8s-cluster"] }],
      tracked_alias_ids: ["k8s-cluster"],
      service_optional: false,
    });
    expect(v1.status).toBe(200);
    await ingestLogs(page, org, "b3_logs", [
      { service: "web3", k8s_cluster: "c1", dc: "eu-1", message: "old data" },
    ]);
    await waitForServices(
      page,
      org,
      (r) => r.some((row) => row.service_name === "web3"),
      "web3 discovered under v1 config",
    );

    // Phase 1: add the custom group + a NEW set (k8s set untouched so its rows
    // survive F10 cleanup) — correlate immediately, NO new ingest.
    await addSemanticGroup(page, org, DC_GROUP);
    const v2 = await saveIdentity(page, org, {
      sets: [
        { id: "k8s", label: "K8s", distinguish_by: ["k8s-cluster"] },
        { id: "dcset", label: "Datacenter", distinguish_by: ["datacenter"] },
      ],
      tracked_alias_ids: ["k8s-cluster", "datacenter"],
      service_optional: false,
    });
    expect(v2.status).toBe(200);

    const pre = await correlate(
      page,
      org,
      { service: "web3", "k8s-cluster": "c1", datacenter: "eu-1" },
      { sourceStream: "b3_logs", sourceType: "logs" },
    );
    expect(pre.status).toBe(200);
    // Contract pin: existing rows (unchanged set) still match via coverage —
    // config change alone must NOT hard-null existing correlation.
    expect(pre.body, "pre-re-ingest correlate must still match (FL-1 honesty)").not.toBeNull();

    // Phase 2: one new ingest batch → tracked dims upgrade (datacenter value
    // becomes visible on the row / correlate response).
    await ingestLogs(page, org, "b3_logs", [
      { service: "web3", k8s_cluster: "c1", dc: "eu-1", message: "new data" },
    ]);
    const rows = await waitForServices(
      page,
      org,
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
    const post = await correlate(
      page,
      org,
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
  });

  test("CUSTOM-03: deleting a referenced group → 400 on save, config unchanged (F26) (TC-B4)", async ({
    page,
  }) => {
    await addSemanticGroup(page, org, DC_GROUP);
    // Orphan lives ONLY in distinguish_by: tracked_alias_ids is validated first,
    // so an orphan there would mask the set-naming F26 message.
    const good = {
      sets: [{ id: "dcset", label: "Datacenter", distinguish_by: ["datacenter"] }],
      tracked_alias_ids: [],
      service_optional: false,
    };
    const saved = await saveIdentity(page, org, good);
    expect(saved.status).toBe(200);

    // Delete the group out from under the config.
    await removeSemanticGroup(page, org, "datacenter");

    // (a) Re-save unchanged config → 400 naming the set and the orphan id.
    const resave = await saveIdentity(page, org, good);
    expect(resave.status, "orphan distinguish_by must be rejected").toBe(400);
    const msg = JSON.stringify(resave.body);
    expect(msg).toContain("dcset");
    expect(msg).toContain("datacenter");

    // (b) Orphan only in tracked_alias_ids → 400 "Unknown alias group IDs".
    const trackedOnly = await saveIdentity(page, org, {
      sets: [{ id: "vm", label: "VM", distinguish_by: ["host"] }],
      tracked_alias_ids: ["datacenter"],
      service_optional: false,
    });
    expect(trackedOnly.status).toBe(400);
    expect(JSON.stringify(trackedOnly.body)).toContain("Unknown alias group IDs");

    // Config unchanged — still the pre-delete good config.
    const cfg = await getIdentity(page, org);
    expect(cfg.sets.map((s) => s.id)).toEqual(["dcset"]);
  });
});
