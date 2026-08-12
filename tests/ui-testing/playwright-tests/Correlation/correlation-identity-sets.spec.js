// Copyright 2026 OpenObserve Inc.

/**
 * Correlation — detection rules / identity sets  [P0]  (enterprise-only)
 *
 * Identity sets route discovered rows by shape; editing a set cleans its rows
 * immediately; a cluster-qualified correlate narrows while a service-only one
 * is an honest union; a typo'd distinguish_by is rejected without mutating
 * config.
 *
 * Coverage:
 *  - IDENT-01 (TC-C1/C2): two sets route correctly; editing a set cleans rows
 *    immediately (F8/F10)
 *  - IDENT-02 (TC-C3): cluster-qualified narrows; service-only is honest union (F11)
 *  - IDENT-03 (TC-C4): typo'd distinguish_by → exact 400, config untouched (F26)
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
  listServices,
  waitForServices,
} = require("../utils/correlation-api-helpers.js");

test.describe.configure({ mode: "serial" });

test.describe("Correlation — identity sets", { tag: ["@correlation", "@P0"] }, () => {
  let org;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.setTimeout(600_000);
    org = await createCorrelationOrg(page, "corr_ident");
  });

  test.afterEach(async ({ page }) => {
    await deleteOrg(page, org);
  });

  test("IDENT-01: two sets route correctly; editing a set cleans its rows immediately (F8/F10) (TC-C1/C2)", async ({
    page,
  }) => {
    const save = await saveIdentity(page, org, {
      sets: [
        { id: "k8s", label: "K8s", distinguish_by: ["k8s-cluster", "k8s-namespace"] },
        { id: "vm", label: "VM", distinguish_by: ["environment", "host"] },
      ],
      tracked_alias_ids: ["k8s-cluster", "k8s-namespace", "environment", "host"],
      service_optional: false,
    });
    expect(save.status).toBe(200);

    // Each shape lands in its own set.
    await ingestLogs(page, org, "c1_k8s_logs", [
      { service: "ksvc", k8s_cluster: "c1", k8s_namespace: "n1", message: "k8s" },
    ]);
    await ingestLogs(page, org, "c1_vm_logs", [
      { service: "vsvc", environment: "prod", host: "h9", message: "vm" },
    ]);
    const rows = await waitForServices(
      page,
      org,
      (r) =>
        r.some((row) => row.service_name === "ksvc") &&
        r.some((row) => row.service_name === "vsvc"),
      "both shapes discovered",
    );
    expect(rows.find((r) => r.service_name === "ksvc").set_id).toBe("k8s");
    expect(rows.find((r) => r.service_name === "vsvc").set_id).toBe("vm");

    // Change the vm set's shape → its rows are cleaned IMMEDIATELY
    // (delete_by_set_id + cache clear + reload event on save — no flush wait).
    const edit = await saveIdentity(page, org, {
      sets: [
        { id: "k8s", label: "K8s", distinguish_by: ["k8s-cluster", "k8s-namespace"] },
        { id: "vm", label: "VM", distinguish_by: ["environment", "k8s-cluster"] },
      ],
      tracked_alias_ids: ["k8s-cluster", "k8s-namespace", "environment", "host"],
      service_optional: false,
    });
    expect(edit.status).toBe(200);

    const after = await listServices(page, org);
    expect(
      after.filter((r) => r.set_id === "vm"),
      "vm-set rows must be deleted immediately on shape change",
    ).toHaveLength(0);
    expect(
      after.filter((r) => r.set_id === "k8s"),
      "unchanged k8s set rows must survive",
    ).toHaveLength(1);

    // Correlate during the transition: fresh rows or no-match — never a stale union.
    const mid = await correlate(
      page,
      org,
      { service: "vsvc", environment: "prod" },
      { sourceStream: "c1_vm_logs", sourceType: "logs" },
    );
    expect(mid.status).toBe(200);
    expect(mid.body, "stale vm row must not match after cleanup").toBeNull();

    // New-shape data re-populates the set.
    await ingestLogs(page, org, "c1_vm_logs", [
      { service: "vsvc", environment: "prod", k8s_cluster: "c1", host: "h9", message: "vm2" },
    ]);
    const repop = await waitForServices(
      page,
      org,
      (r) => r.some((row) => row.service_name === "vsvc" && row.set_id === "vm"),
      "vm set repopulated under new shape",
    );
    const vrow = repop.find((r) => r.service_name === "vsvc" && r.set_id === "vm");
    expect(Object.keys(vrow.disambiguation).sort()).toEqual(["environment", "k8s-cluster"]);
  });

  test("IDENT-02: cluster-qualified correlate narrows; service-only correlate is an honest union (F11) (TC-C3)", async ({
    page,
  }) => {
    const save = await saveIdentity(page, org, {
      sets: [{ id: "k8s", label: "K8s", distinguish_by: ["k8s-cluster"] }],
      tracked_alias_ids: ["k8s-cluster"],
      service_optional: false,
    });
    expect(save.status).toBe(200);

    await ingestLogs(page, org, "us_c3_logs", [
      { service: "globalsvc", k8s_cluster: "us", message: "us" },
    ]);
    await ingestLogs(page, org, "eu_c3_logs", [
      { service: "globalsvc", k8s_cluster: "eu", message: "eu" },
    ]);
    await waitForServices(
      page,
      org,
      (r) => r.filter((row) => row.service_name === "globalsvc").length === 2,
      "both cluster rows discovered",
    );

    // Cluster-qualified → only that cluster's streams.
    const us = await correlate(
      page,
      org,
      { service: "globalsvc", "k8s-cluster": "us" },
      { sourceStream: "us_c3_logs", sourceType: "logs" },
    );
    expect(us.status).toBe(200);
    expect(us.body).not.toBeNull();
    const usLogs = (us.body.related_streams?.logs || []).map((s) => s.stream_name);
    expect(usLogs).toContain("us_c3_logs");
    expect(usLogs, "eu stream must not leak into a us-qualified correlate").not.toContain(
      "eu_c3_logs",
    );

    // Service-only → union is the documented contract; filters must carry ONLY
    // the service field so the UI can cue the ambiguity.
    const bare = await correlate(
      page,
      org,
      { service: "globalsvc" },
      { sourceStream: "us_c3_logs", sourceType: "logs" },
    );
    expect(bare.status).toBe(200);
    expect(bare.body).not.toBeNull();
    const bareLogs = (bare.body.related_streams?.logs || []).map((s) => s.stream_name);
    expect(bareLogs.sort()).toEqual(["eu_c3_logs", "us_c3_logs"]);
    for (const s of bare.body.related_streams?.logs || []) {
      const keys = Object.keys(s.filters || {});
      expect(
        keys.every((k) => !/cluster/i.test(k)),
        `service-only union must not synthesize cluster filters (got ${keys})`,
      ).toBe(true);
    }
  });

  test("IDENT-03: typo'd distinguish_by rejected with exact message; config untouched (F26) (TC-C4)", async ({
    page,
  }) => {
    const bad = await saveIdentity(page, org, {
      sets: [{ id: "typo", label: "Typo", distinguish_by: ["environmnet"] }],
      tracked_alias_ids: [],
      service_optional: false,
    });
    expect(bad.status).toBe(400);
    const msg = JSON.stringify(bad.body);
    expect(msg).toContain("typo");
    expect(msg).toContain("unknown distinguish_by group IDs");
    expect(msg).toContain("environmnet");

    // Nothing was persisted — config has no 'typo' set.
    const cfg = await getIdentity(page, org);
    expect((cfg.sets || []).map((s) => s.id)).not.toContain("typo");
  });
});
