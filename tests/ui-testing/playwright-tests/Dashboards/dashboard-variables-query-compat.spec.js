// Query Values variables saved before AND/OR filter groups keep loading and saving unchanged (openobserve#15355, plan A1-A4, B5).
const path = require("path");
const fs = require("fs");
const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager.js";
const testLogger = require("../utils/test-logger.js");
const fx = require("../utils/query-variable-fixtures.js");

const FIXTURE_PATH = path.resolve(__dirname, "../../../test-data/dashboard-legacy-query-variables.json");
const FIXTURE = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8"));
const fixtureVariable = (name) => FIXTURE.variables.list.find((v) => v.name === name);
const NEW_QUERY_KEYS = ["filter_group", "query", "query_type", "custom_query", "value_field", "label_field"];

const uniqueTitle = (base) => `${base}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function createLegacyDashboard() {
  return fx.createDashboard({ ...FIXTURE, title: uniqueTitle("e2e_qv_legacy") });
}

function expectNoNewKeys(queryData) {
  for (const key of NEW_QUERY_KEYS) expect(queryData, `query_data must not gain "${key}"`).not.toHaveProperty(key);
}

test.describe.configure({ mode: "parallel" });

test.describe("Query Values variables - legacy dashboards", { tag: ["@dashboards", "@dashboardVariables", "@queryVariables", "@P1"] }, () => {
  test.beforeAll(async () => {
    await fx.ingestQueryVariableData();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test.afterAll(async () => {
    await fx.deleteCreatedDashboards();
  });

  test("A1: an imported v8 dashboard loads every legacy filter operator and renders its panel", async ({ page }) => {
    const pm = new PageManager(page);
    const qv = pm.dashboardQueryVariable;
    const title = uniqueTitle("e2e_qv_import");

    await page.goto(`/web/dashboards?org_identifier=${fx.ORG()}&folder=default`);
    await pm.dashboardImport.clickImportDashboard();
    // The import form requires the dashboardId every exported file carries; the server assigns a new one.
    await pm.dashboardImport.uploadDashboardFile(FIXTURE_PATH, {
      title,
      transform: (json) => { json.dashboardId = `e2e_${Date.now()}`; },
    });
    await pm.dashboardImport.clickImportButton();
    await expect.poll(() => fx.findDashboardId(title), { timeout: 30000 }).toBeTruthy();
    const id = await fx.findDashboardId(title);
    fx.trackDashboard(id);

    const imported = await fx.getDashboard(id);
    for (const variable of FIXTURE.variables.list) {
      const saved = imported.variables.list.find((v) => v.name === variable.name);
      expect(JSON.stringify(saved.query_data)).toBe(JSON.stringify(variable.query_data));
    }

    const queries = fx.trackQueries(page);
    await qv.openDashboard(fx.dashboardUrl(id, "&var-cluster=prod-eu"));

    await qv.expectOptionValues("cluster", ["prod-eu", "prod-us", "staging"]);
    await qv.expectOptionValues("ns", ["checkout", "monitoring", "payments"]);
    await qv.expectOptionValues("svc_eq", ["cart", "checkout", "inventory", "payments"]);
    await qv.expectOptionValues("svc_ne", ["cart", "checkout", "frontend"]);
    await qv.expectOptionValues("svc_in", ["cart", "checkout", "frontend", "inventory", "payments", "search"]);
    await qv.expectOptionValues("svc_contains", ["checkout", "frontend"]);
    await qv.expectOptionValues("svc_null", ["frontend"]);
    await qv.expectOptionValues("svc_notnull", fx.ALL_SERVICES.filter((s) => s !== "frontend"));

    await expect
      .poll(() => queries.searches().some((sql) => sql.includes("k8s_cluster = 'prod-eu'")), { timeout: 30000 })
      .toBe(true);
    await expect(page.locator('[data-test="dashboard-panel-table"]').first()).toContainText("checkout", { timeout: 30000 });
    testLogger.info("Legacy variables loaded", { values: queries.values().length });
  });

  test("A2: opening and saving a legacy variable unchanged keeps query_data byte-identical", async ({ page }) => {
    const pm = new PageManager(page);
    const qv = pm.dashboardQueryVariable;
    const id = await createLegacyDashboard();

    await qv.openDashboard(fx.dashboardUrl(id, "&var-cluster=prod-eu"));
    await qv.openVariablesSettings();
    await qv.editVariable("svc_ne");

    await qv.expectMode("auto");
    await qv.filters.expectChipCount(2);
    await qv.filters.expectChip("level", "!=");
    await qv.filters.expectValue(0, "debug");
    await qv.filters.expectConnector("1", "AND");
    await qv.filters.expectChip("k8s_cluster", "=");
    await qv.filters.expectValue(1, "$cluster");

    await qv.save();

    const saved = await fx.getDashboard(id);
    for (const variable of FIXTURE.variables.list) {
      const after = saved.variables.list.find((v) => v.name === variable.name);
      expect(JSON.stringify(after.query_data), `${variable.name} query_data`).toBe(JSON.stringify(variable.query_data));
      expectNoNewKeys(after.query_data);
    }
  });

  test("A3: editing an AND-only legacy filter still saves a flat filter list", async ({ page }) => {
    const pm = new PageManager(page);
    const qv = pm.dashboardQueryVariable;
    const id = await createLegacyDashboard();

    await qv.openDashboard(fx.dashboardUrl(id, "&var-cluster=prod-eu"));
    await qv.openVariablesSettings();
    await qv.editVariable("svc_ne");
    await qv.filters.changeValue(0, "warn");
    await qv.filters.expectValue(0, "warn");
    await qv.save();

    const saved = await fx.getDashboard(id);
    const svcNe = saved.variables.list.find((v) => v.name === "svc_ne");
    expect(svcNe.query_data.filter).toEqual([
      { name: "level", operator: "!=", value: "warn" },
      { name: "k8s_cluster", operator: "=", value: "$cluster" },
    ]);
    expectNoNewKeys(svcNe.query_data);
    for (const variable of FIXTURE.variables.list.filter((v) => v.name !== "svc_ne")) {
      const after = saved.variables.list.find((v) => v.name === variable.name);
      expect(JSON.stringify(after.query_data), `${variable.name} query_data`).toBe(JSON.stringify(variable.query_data));
    }

    await qv.closeSettings();
    await qv.expectOptionValues("svc_ne", ["cart", "checkout"]);
  });

  test("A4: '= $multi' with two parent values loads the child with IN", async ({ page }) => {
    const pm = new PageManager(page);
    const qv = pm.dashboardQueryVariable;
    const id = await createLegacyDashboard();
    const queries = fx.trackQueries(page);

    await qv.openDashboard(fx.dashboardUrl(id, "&var-cluster=prod-eu"));
    await qv.expectOptionValues("ns", ["checkout", "monitoring", "payments"]);
    queries.clear();
    await qv.selectOptions("ns", ["checkout", "payments"]);

    await qv.expectOptionValues("svc_multi", ["cart", "checkout", "payments"]);
    const inClause = /"?k8s_namespace"?\s+IN\s+\('(checkout|payments)',\s*'(checkout|payments)'\)/;
    expect(queries.values().some((sql) => inClause.test(sql)), queries.values().join("\n")).toBe(true);
  });

  test("B5: turning an OR filter back into AND saves a flat filter again", async ({ page }) => {
    const pm = new PageManager(page);
    const qv = pm.dashboardQueryVariable;
    const condition = (field, value, logicalOperator) => ({
      type: "condition",
      values: [],
      column: { field, streamAlias: null },
      operator: "=",
      value,
      logicalOperator,
      filterType: "condition",
    });
    const id = await fx.createDashboard(fx.dashboardBody(uniqueTitle("e2e_qv_b5"), {
      variables: [fx.queryValuesVariable("svc", {
        stream_type: "logs",
        stream: fx.LOGS_STREAM,
        field: "service_name",
        max_record_size: null,
        filter_group: {
          filterType: "group",
          logicalOperator: "AND",
          conditions: [condition("level", "error", "AND"), condition("k8s_cluster", "prod-eu", "OR")],
        },
      })],
    }));

    await qv.openDashboard(fx.dashboardUrl(id));
    await qv.expectOptionValues("svc", ["cart", "checkout", "frontend", "inventory", "payments"]);

    await qv.openVariablesSettings();
    await qv.editVariable("svc");
    await qv.filters.expectConnector("1", "OR");
    await qv.filters.toggleConnector("1");
    await qv.filters.expectConnector("1", "AND");
    await qv.save();

    const svc = await fx.getVariable(id, "svc");
    expect(svc.query_data.filter).toEqual([
      { name: "level", operator: "=", value: "error" },
      { name: "k8s_cluster", operator: "=", value: "prod-eu" },
    ]);
    expectNoNewKeys(svc.query_data);

    await qv.closeSettings();
    await qv.expectOptionValues("svc", ["cart", "checkout"]);
  });
});
