/**
 * Cloud API smoke — create, read back and update core objects through the API only.
 *
 * Cloud's meta store is Postgres; local CI runs SQLite, which accepts column-type
 * drift that Postgres rejects on read (e.g. #15434: alerts.recovery_destinations).
 * Every optional field is filled because empty ones are stored as NULL and skip
 * the type check.
 *
 * @tags @cloudApiSmoke @smoke @cloud @all
 */

const { test, expect } = require("@playwright/test");
const testLogger = require("../utils/test-logger.js");
const { CloudApiSmokePage } = require("../../pages/cloudPages/cloudApiSmokePage.js");

// Shared seed stream for this file; cleanup.spec.js deletes it before each run.
const STREAM = "cloud_api_smoke";

test.describe("Cloud API smoke", () => {
  let smoke;
  let created;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    smoke = new CloudApiSmokePage(page);
    created = {};
  });

  test.afterEach(async () => {
    await smoke.cleanup(created);
  });

  for (const realtime of [false, true]) {
    test(
      `${realtime ? "realtime" : "scheduled"} alert with every optional field saves, reads back and updates`,
      { tag: ["@cloudApiSmoke", "@alerts", "@smoke", "@P0", "@cloud", "@all"] },
      async () => {
        const id = smoke.uniqueSuffix();
        created.template = `smoke_tpl_${id}`;
        created.destination = `smoke_dest_${id}`;

        testLogger.step("Seed the stream the alert reads from");
        await smoke.seedStream(STREAM);

        testLogger.step("Create template and destination");
        await smoke.createTemplate(created.template);
        await smoke.createDestination(created.destination, created.template);
        expect((await smoke.getDestination(created.destination)).name).toBe(created.destination);

        testLogger.step("Create the alert with recovery destinations and every optional field");
        created.alertId = await smoke.createAlert(smoke.alertPayload(`smoke_alert_${id}`, STREAM, created.destination, { realtime }));

        testLogger.step("Read it back");
        const stored = await smoke.getAlert(created.alertId);
        const recovery = realtime ? [] : [created.destination];
        expect(stored.recovery_destinations).toEqual(recovery);
        expect(stored.context_attributes).toEqual({ team: "qa" });
        expect(stored.tags).toEqual(["cloud-api-smoke"]);
        expect(stored.deduplication.fingerprint_fields).toEqual(["level"]);
        // The API omits an unset warning threshold rather than sending null.
        if (realtime) expect(stored.trigger_condition).not.toHaveProperty("warning_threshold");
        else expect(stored.trigger_condition.warning_threshold).toBe(2);

        testLogger.step("Update it and read it back again");
        stored.description = "cloud api smoke updated";
        await smoke.updateAlert(created.alertId, stored);
        const updated = await smoke.getAlert(created.alertId);
        expect(updated.description).toBe("cloud api smoke updated");
        expect(updated.recovery_destinations).toEqual(recovery);
      }
    );
  }

  test(
    "alert optional fields clear to empty and fill again",
    { tag: ["@cloudApiSmoke", "@alerts", "@smoke", "@P1", "@cloud", "@all"] },
    async () => {
      const id = smoke.uniqueSuffix();
      created.template = `smoke_tpl_${id}`;
      created.destination = `smoke_dest_${id}`;
      await smoke.seedStream(STREAM);
      await smoke.createTemplate(created.template);
      await smoke.createDestination(created.destination, created.template);
      const payload = smoke.alertPayload(`smoke_clear_${id}`, STREAM, created.destination);
      created.alertId = await smoke.createAlert(payload);

      testLogger.step("Clear recovery destinations, tags, context, runbook and dedup");
      await smoke.updateAlert(created.alertId, smoke.clearedAlert(await smoke.getAlert(created.alertId)));
      const cleared = await smoke.getAlert(created.alertId);
      expect(cleared.recovery_destinations).toEqual([]);
      expect(cleared.context_attributes).toEqual({});
      // The API omits empty tags, an unset runbook and disabled dedup instead of sending empties.
      expect(cleared).not.toHaveProperty("tags");
      expect(cleared).not.toHaveProperty("runbook_url");
      expect(cleared).not.toHaveProperty("deduplication");

      testLogger.step("Fill them again");
      await smoke.updateAlert(created.alertId, { ...cleared, ...payload });
      const refilled = await smoke.getAlert(created.alertId);
      expect(refilled.recovery_destinations).toEqual([created.destination]);
      expect(refilled.tags).toEqual(["cloud-api-smoke"]);
      expect(refilled.context_attributes).toEqual({ team: "qa" });
      expect(refilled.deduplication.fingerprint_fields).toEqual(["level"]);
      expect(refilled.runbook_url).toBe("https://example.com/runbooks/cloud-api-smoke");
    }
  );

  test(
    "dashboard with panel, variables and an annotation saves and reads back",
    { tag: ["@cloudApiSmoke", "@dashboards", "@smoke", "@P1", "@cloud", "@all"] },
    async () => {
      const title = `smoke_dash_${smoke.uniqueSuffix()}`;
      created.dashboardId = await smoke.createDashboard(title);
      const stored = await smoke.getDashboard(created.dashboardId);
      const inner = stored[`v${stored.version}`] || stored;
      expect(inner.title).toBe(title);
      expect(inner.variables.list[0].value).toBe("prod");

      testLogger.step("Add an annotation with tags and read it back");
      const range = await smoke.addAnnotation(created.dashboardId, "Deploy ✓", ["deploy", "cloud-api-smoke"]);
      const annotation = await smoke.findAnnotation(created.dashboardId, "Deploy ✓", range);
      expect(annotation, "annotation must read back").toBeTruthy();
      expect(annotation.tags).toEqual(["deploy", "cloud-api-smoke"]);
    }
  );

  test(
    "grouped SLO with tags saves, reads back and updates",
    { tag: ["@cloudApiSmoke", "@slos", "@smoke", "@P1", "@cloud", "@all"] },
    async () => {
      await smoke.seedStream(STREAM);
      created.sloId = await smoke.createSlo(smoke.sloPayload(`smoke_slo_${smoke.uniqueSuffix()}`, STREAM));
      const stored = await smoke.getSlo(created.sloId);
      expect(stored.group_by).toEqual(["level"]);
      expect(stored.tags).toEqual(["cloud-api-smoke", "tier:1"]);

      stored.description = "cloud api smoke updated";
      await smoke.updateSlo(created.sloId, stored);
      expect((await smoke.getSlo(created.sloId)).description).toBe("cloud api smoke updated");
    }
  );

  test(
    "function saves and is listed",
    { tag: ["@cloudApiSmoke", "@functions", "@smoke", "@P1", "@cloud", "@all"] },
    async () => {
      created.functionName = `smoke_fn_${smoke.uniqueSuffix()}`;
      await smoke.createFunction(created.functionName);
      expect(await smoke.listFunctionNames()).toContain(created.functionName);
    }
  );

  test(
    "saved view saves and reads back",
    { tag: ["@cloudApiSmoke", "@savedViews", "@smoke", "@P1", "@cloud", "@all"] },
    async () => {
      const name = `smoke_view_${smoke.uniqueSuffix()}`;
      created.viewId = await smoke.createSavedView(name);
      const stored = await smoke.getSavedView(created.viewId);
      expect(stored.view_name).toBe(name);
      expect(stored.data).toEqual(smoke.savedViewData());
    }
  );

  test(
    "core list endpoints answer 200",
    { tag: ["@cloudApiSmoke", "@smoke", "@P1", "@cloud", "@all"] },
    async () => {
      for (const path of smoke.listEndpoints()) {
        testLogger.step(`GET /${path}`);
        await smoke.expectOk("GET", path);
      }
    }
  );
});
