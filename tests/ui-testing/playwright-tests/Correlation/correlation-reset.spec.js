// Copyright 2026 OpenObserve Inc.

/**
 * Correlation — reset & refresh  [P1]  (enterprise-only)
 *
 * `_reset` must empty the service list AND make the next correlate a no-match
 * immediately (cache clear + reload event), and with ingest stopped it must
 * stay a stable 200-null no-match — never an error.
 *
 * Coverage:
 *  - RESET-01 (TC-D1): reset empties list + correlate immediately; re-ingest re-discovers (F6)
 *  - RESET-02 (TC-D2): reset with ingest stopped → 200-null no-match, stably (F28)
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
  listServices,
  reset,
  waitForServices,
  sleep,
} = require("../utils/correlation-api-helpers.js");

test.describe.configure({ mode: "serial" });

test.describe("Correlation — reset & refresh", { tag: ["@correlation", "@P1"] }, () => {
  let org;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.setTimeout(600_000);
    org = await createCorrelationOrg(page, "corr_reset");
  });

  test.afterEach(async ({ page }) => {
    await deleteOrg(page, org);
  });

  test("RESET-01: reset empties list AND correlate immediately; re-ingest re-discovers (F6) (TC-D1)", async ({
    page,
  }) => {
    const save = await saveIdentity(page, org, {
      sets: [{ id: "vm", label: "VM", distinguish_by: ["host"] }],
      tracked_alias_ids: ["host"],
      service_optional: false,
    });
    expect(save.status).toBe(200);

    await ingestLogs(page, org, "d1_logs", [{ service: "dsvc", host: "dh1", message: "1" }]);
    await waitForServices(
      page,
      org,
      (r) => r.some((row) => row.service_name === "dsvc"),
      "dsvc discovered pre-reset",
    );

    await reset(page, org);

    // F6: cache cleared + reload event — both reads empty IMMEDIATELY.
    const list = await listServices(page, org);
    expect(list, "list must be empty right after reset").toHaveLength(0);
    const corr = await correlate(
      page,
      org,
      { service: "dsvc", host: "dh1" },
      { sourceStream: "d1_logs", sourceType: "logs" },
    );
    expect(corr.status).toBe(200);
    expect(corr.body, "correlate must be null right after reset (no resurrection)").toBeNull();

    // Fresh ingest → re-discovery within the temporal contract.
    await ingestLogs(page, org, "d1_logs", [{ service: "dsvc", host: "dh1", message: "2" }]);
    await waitForServices(
      page,
      org,
      (r) => r.some((row) => row.service_name === "dsvc"),
      "dsvc re-discovered after reset + fresh ingest",
    );
  });

  test("RESET-02: reset with ingest stopped → 200-null no-match, stably (F28 backend contract) (TC-D2)", async ({
    page,
  }) => {
    const save = await saveIdentity(page, org, {
      sets: [{ id: "vm", label: "VM", distinguish_by: ["host"] }],
      tracked_alias_ids: ["host"],
      service_optional: false,
    });
    expect(save.status).toBe(200);

    await ingestLogs(page, org, "d2_logs", [{ service: "d2svc", host: "d2h", message: "x" }]);
    await waitForServices(
      page,
      org,
      (r) => r.some((row) => row.service_name === "d2svc"),
      "d2svc discovered",
    );
    await reset(page, org);

    // "Null forever, honestly": no ingest → correlate stays a 200-null no-match
    // (never an error status). Sampled over 20s to catch late resurrection from
    // a straggler flush.
    for (let i = 0; i < 4; i++) {
      const { status, body } = await correlate(
        page,
        org,
        { service: "d2svc", host: "d2h" },
        { sourceStream: "d2_logs", sourceType: "logs" },
      );
      expect(status, "no-match must be HTTP 200, not an error").toBe(200);
      expect(body, `no-match must stay null (iteration ${i})`).toBeNull();
      await sleep(5000);
    }
  });
});
