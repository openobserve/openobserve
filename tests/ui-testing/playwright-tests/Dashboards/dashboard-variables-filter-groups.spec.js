// Auto SQL Query Values variables with AND/OR filter groups built in the shared FilterBuilder (openobserve#15355, plan B1-B4).
const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager.js";
const fx = require("../utils/query-variable-fixtures.js");

const uniqueTitle = (base) => `${base}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const ERROR_SERVICES = ["cart", "checkout", "inventory", "payments"];

const condition = (field, operator, value, logicalOperator) => ({
  type: "condition",
  values: [],
  column: { field, streamAlias: null },
  operator,
  value,
  logicalOperator,
  filterType: "condition",
});

const autoQuery = (extra = {}) => ({
  stream_type: "logs",
  stream: fx.LOGS_STREAM,
  field: "service_name",
  max_record_size: null,
  ...extra,
});

/** Opens a dashboard holding `variables` on a new Query Values variable `svc` reading service_name. */
async function startAutoVariable(qv, variables = [], extra = "") {
  const id = await fx.createDashboard(fx.dashboardBody(uniqueTitle("e2e_qv_groups"), { variables }));
  await qv.openDashboard(fx.dashboardUrl(id, extra));
  await qv.openVariablesSettings();
  await qv.startNewVariable("svc");
  await qv.setAutoSource("logs", fx.LOGS_STREAM, "service_name");
  return id;
}

test.describe.configure({ mode: "parallel" });

test.describe("Query Values variables - Auto SQL filter groups", { tag: ["@dashboards", "@dashboardVariables", "@queryVariables", "@P1"] }, () => {
  test.beforeAll(async () => {
    await fx.ingestQueryVariableData();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test.afterAll(async () => {
    await fx.deleteCreatedDashboards();
  });

  test("B1: AND filters narrow the values and save as a flat filter list", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startAutoVariable(qv);

    await qv.addFilter("level", "=", "error");
    await qv.addFilter("k8s_cluster", "=", "prod-eu");
    await qv.filters.expectConnector("1", "AND");
    await qv.save();

    const svc = await fx.getVariable(id, "svc");
    expect(svc.query_data).toEqual(autoQuery({
      filter: [
        { name: "level", operator: "=", value: "error" },
        { name: "k8s_cluster", operator: "=", value: "prod-eu" },
      ],
    }));

    await qv.closeSettings();
    await qv.expectOptionValues("svc", ["cart", "checkout"]);
  });

  test("B2: flipping a connector to OR widens the values and saves only filter_group", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startAutoVariable(qv);
    const queries = fx.trackQueries(page);

    await qv.addFilter("level", "=", "error");
    await qv.addFilter("k8s_cluster", "=", "prod-eu");
    await qv.filters.toggleConnector("1");
    await qv.filters.expectConnector("1", "OR");
    await qv.save();

    const svc = await fx.getVariable(id, "svc");
    expect(svc.query_data).not.toHaveProperty("filter");
    expect(svc.query_data).not.toHaveProperty("query");
    expect(svc.query_data).not.toHaveProperty("query_type");
    const conditions = svc.query_data.filter_group.conditions;
    expect(conditions.map((c) => [c.column.field, c.operator, c.value, c.logicalOperator])).toEqual([
      ["level", "=", "error", "AND"],
      ["k8s_cluster", "=", "prod-eu", "OR"],
    ]);

    await qv.closeSettings();
    await qv.expectOptionValues("svc", ["cart", "checkout", "frontend", "inventory", "payments"]);
    expect(queries.values().some((sql) => /"?level"?\s*=\s*'error'\s+OR\s+"?k8s_cluster"?\s*=\s*'prod-eu'/.test(sql)), queries.values().join("\n")).toBe(true);
  });

  test("B3: a nested group A AND (B OR C) filters correctly and reopens as the same tree", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startAutoVariable(qv);
    const queries = fx.trackQueries(page);

    await qv.addFilter("level", "=", "error");
    await qv.filters.addGroup();
    await qv.filters.addCondition({ field: "k8s_cluster", operator: "=", value: "prod-us" });
    await qv.filters.close();
    await qv.addFilter("k8s_namespace", "=", "default", { groupPath: "1" });
    await qv.filters.toggleConnector("1-1");
    await qv.filters.expectConnector("1", "AND");
    await qv.filters.expectConnector("1-1", "OR");
    await qv.save();

    const svc = await fx.getVariable(id, "svc");
    expect(svc.query_data).not.toHaveProperty("filter");
    const [first, group] = svc.query_data.filter_group.conditions;
    expect([first.column.field, first.value]).toEqual(["level", "error"]);
    expect(group.filterType).toBe("group");
    expect(group.conditions.map((c) => [c.column.field, c.value, c.logicalOperator])).toEqual([
      ["k8s_cluster", "prod-us", "AND"],
      ["k8s_namespace", "default", "OR"],
    ]);

    await qv.closeSettings();
    await qv.expectOptionValues("svc", ["inventory", "payments"]);
    const nested = /"?level"?\s*=\s*'error'\s+AND\s+\(\s*"?k8s_cluster"?\s*=\s*'prod-us'\s+OR\s+"?k8s_namespace"?\s*=\s*'default'\s*\)/;
    expect(queries.values().some((sql) => nested.test(sql)), queries.values().join("\n")).toBe(true);

    await page.reload();
    await qv.openVariablesSettings();
    await qv.editVariable("svc");
    await qv.filters.expectChipCount(3);
    await qv.filters.expectConnector("1", "AND");
    await qv.filters.expectConnector("1-1", "OR");
    await expect(page.locator('[data-test="dashboard-variable-filter-builder-group-1"]')).toContainText("k8s_namespace");
  });

  test("B4: variables, single-value IN and numeric-looking values inside OR groups query without errors", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const group = (...conditions) => ({ filter_group: { filterType: "group", logicalOperator: "AND", conditions } });
    const variables = [
      fx.customVariable("cl", ["prod-us", "prod-eu"]),
      fx.customVariable("nsm", ["payments", "default", "search"], { multiSelect: true }),
      fx.queryValuesVariable("b4_multi", autoQuery(group(
        condition("k8s_namespace", "IN", "$nsm", "AND"),
        condition("level", "=", "warn", "OR"),
      ))),
      fx.queryValuesVariable("b4_in1", autoQuery(group(
        condition("level", "IN", "error", "AND"),
        condition("k8s_cluster", "=", "staging", "OR"),
      ))),
      fx.queryValuesVariable("b4_sid", autoQuery(group(
        condition("service_id", "=", "101", "AND"),
        condition("service_id", "=", "007", "OR"),
      ))),
    ];
    const queries = fx.trackQueries(page);
    const id = await startAutoVariable(qv, variables, "&var-cl=prod-us&var-nsm=payments&var-nsm=default");

    await qv.addFilter("k8s_cluster", "=", "$cl");
    await qv.addFilter("level", "=", "warn");
    await qv.filters.toggleConnector("1");
    await qv.save();
    const svc = await fx.getVariable(id, "svc");
    expect(svc.query_data.filter_group.conditions.map((c) => [c.column.field, c.value, c.logicalOperator])).toEqual([
      ["k8s_cluster", "$cl", "AND"],
      ["level", "warn", "OR"],
    ]);
    await qv.closeSettings();

    await qv.expectOptionValues("svc", ["email", "frontend", "payments", "search"]);
    await qv.expectOptionValues("b4_multi", ["auth", "checkout", "frontend", "inventory", "payments", "search"]);
    await qv.expectOptionValues("b4_in1", ["auth", ...ERROR_SERVICES]);
    await qv.expectOptionValues("b4_sid", ["checkout", "email"]);

    const sql = queries.values().join("\n");
    expect(sql).toMatch(/"?k8s_cluster"?\s*=\s*'prod-us'\s+OR/);
    expect(sql).toMatch(/"?k8s_namespace"?\s+IN\s+\('(payments|default)',\s*'(payments|default)'\)\s+OR/);
    expect(sql).toMatch(/"?level"?\s+IN\s+\('error'\)\s+OR/);
    expect(sql).toMatch(/"?service_id"?\s*=\s*'007'/);
    for (const name of ["svc", "b4_multi", "b4_in1", "b4_sid"]) {
      await expect(page.locator(`[data-test="variable-query-error-${name}"]`)).toHaveCount(0);
    }
  });
  test("max record size limits Auto SQL options and is saved", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startAutoVariable(qv);
    await qv.setMaxRecordSize(3);
    await qv.save();

    expect((await fx.getVariable(id, "svc")).query_data.max_record_size).toBe(3);
    await qv.closeSettings();
    await expect.poll(async () => (await qv.readOptions("svc")).length, { timeout: 45000 }).toBe(3);
  });

  test("an unfinished filter condition blocks Save until it gets a value", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    // The builder drops a condition abandoned before its value, so an unfinished one can only arrive from saved JSON.
    const id = await fx.createDashboard(fx.dashboardBody(uniqueTitle("e2e_qv_unfinished"), {
      variables: [fx.queryValuesVariable("svc", autoQuery({ filter: [{ name: "level", operator: "=", value: "" }] }))],
    }));
    await qv.openDashboard(fx.dashboardUrl(id));
    await qv.openVariablesSettings();
    await qv.editVariable("svc");

    await qv.expectSaveBlocked(qv.filters.chip("level", 0).and(page.locator('[data-invalid="true"]')));
    expect((await fx.getVariable(id, "svc")).query_data.filter).toEqual([{ name: "level", operator: "=", value: "" }]);

    await qv.filters.changeValue(0, "error");
    await qv.save();
    expect((await fx.getVariable(id, "svc")).query_data.filter).toEqual([{ name: "level", operator: "=", value: "error" }]);
  });
});
