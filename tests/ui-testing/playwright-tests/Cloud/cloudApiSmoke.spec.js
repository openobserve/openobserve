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

  test(
    "alert with every optional field saves, reads back and updates",
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
      created.alertId = await smoke.createAlert(smoke.alertPayload(`smoke_alert_${id}`, STREAM, created.destination));

      testLogger.step("Read it back");
      const stored = await smoke.getAlert(created.alertId);
      expect(stored.recovery_destinations).toEqual([created.destination]);
      expect(stored.context_attributes).toEqual({ team: "qa" });
      expect(stored.tags).toEqual(["cloud-api-smoke"]);

      testLogger.step("Update it and read it back again");
      stored.description = "cloud api smoke updated";
      await smoke.updateAlert(created.alertId, stored);
      const updated = await smoke.getAlert(created.alertId);
      expect(updated.description).toBe("cloud api smoke updated");
      expect(updated.recovery_destinations).toEqual([created.destination]);
    }
  );

  test(
    "dashboard saves and reads back",
    { tag: ["@cloudApiSmoke", "@dashboards", "@smoke", "@P1", "@cloud", "@all"] },
    async () => {
      const title = `smoke_dash_${smoke.uniqueSuffix()}`;
      created.dashboardId = await smoke.createDashboard(title);
      const stored = await smoke.getDashboard(created.dashboardId);
      const inner = stored[`v${stored.version}`] || stored;
      expect(inner.title).toBe(title);
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
      expect(stored.data.smoke).toBe(true);
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
