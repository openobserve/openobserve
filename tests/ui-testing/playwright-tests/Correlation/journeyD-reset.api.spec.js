// Journey D — Reset & refresh (API tier of TC-D1..D2).
// Plan: docs/test_generator/test-plans/correlation-e2e-test-plan.md

const { test, expect } = require("@playwright/test");
const testLogger = require('../utils/test-logger.js');
const { CorrApi, sleep } = require("./utils/correlationApi");

test.describe.configure({ mode: "serial" });

// Alpha1 shards run under playwright-alpha1.config.js (5-min CI cap); several
// scenarios need two discovery waits — give every test explicit headroom.
test.beforeEach(() => test.setTimeout(600_000));

test.describe("Journey D — reset & refresh", () => {
  testLogger.info('test started');
  test("TC-D1: reset empties list AND correlate immediately; re-ingest re-discovers (F6)", async () => {
    const api = await CorrApi.create("corr_d1");
    try {
      const save = await api.saveIdentity({
        sets: [{ id: "vm", label: "VM", distinguish_by: ["host"] }],
        tracked_alias_ids: ["host"],
        service_optional: false,
      });
      expect(save.status).toBe(200);

      await api.ingestLogs("d1_logs", [
        { service: "dsvc", host: "dh1", message: "1" },
      ]);
      await api.waitForServices(
        (r) => r.some((row) => row.service_name === "dsvc"),
        "dsvc discovered pre-reset",
      );

      await api.reset();

      // F6: cache cleared + reload event — both reads empty IMMEDIATELY.
      const list = await api.listServices();
      expect(list, "list must be empty right after reset").toHaveLength(0);
      const corr = await api.correlate(
        { service: "dsvc", host: "dh1" },
        { sourceStream: "d1_logs", sourceType: "logs" },
      );
      expect(corr.status).toBe(200);
      expect(
        corr.body,
        "correlate must be null right after reset (no resurrection)",
      ).toBeNull();

      // Fresh ingest → re-discovery within the temporal contract.
      await api.ingestLogs("d1_logs", [
        { service: "dsvc", host: "dh1", message: "2" },
      ]);
      await api.waitForServices(
        (r) => r.some((row) => row.service_name === "dsvc"),
        "dsvc re-discovered after reset + fresh ingest",
      );
    } finally {
      await api.dispose();
    }
  });

  test("TC-D2: reset with ingest stopped → 200-null no-match, stably (F28 backend contract)", async () => {
    const api = await CorrApi.create("corr_d2");
    try {
      const save = await api.saveIdentity({
        sets: [{ id: "vm", label: "VM", distinguish_by: ["host"] }],
        tracked_alias_ids: ["host"],
        service_optional: false,
      });
      expect(save.status).toBe(200);

      await api.ingestLogs("d2_logs", [
        { service: "d2svc", host: "d2h", message: "x" },
      ]);
      await api.waitForServices(
        (r) => r.some((row) => row.service_name === "d2svc"),
        "d2svc discovered",
      );
      await api.reset();

      // "Null forever, honestly": no ingest → correlate stays a 200-null
      // no-match (never an error status). Sampled over 20s to catch late
      // resurrection from a straggler flush.
      for (let i = 0; i < 4; i++) {
        const { status, body } = await api.correlate(
          { service: "d2svc", host: "d2h" },
          { sourceStream: "d2_logs", sourceType: "logs" },
        );
        expect(status, "no-match must be HTTP 200, not an error").toBe(200);
        expect(body, `no-match must stay null (iteration ${i})`).toBeNull();
        await sleep(5000);
      }
    } finally {
      await api.dispose();
    }
  });
});
