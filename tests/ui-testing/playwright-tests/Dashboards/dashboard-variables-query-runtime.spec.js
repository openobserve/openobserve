// Query Values variables on a running dashboard: panels, All, chains, time range, URL sync, export/import, plus regression smoke (openobserve#15355, plan F1-F6, G1-G2).
const fs = require("fs");
const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager.js";
const fx = require("../utils/query-variable-fixtures.js");

const S = fx.LOGS_STREAM;
const uniqueTitle = (base) => `${base}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const sortedIn = (sql, column) => {
  const list = sql.match(new RegExp(`${column} IN \\(([^)]*)\\)`))?.[1] ?? "";
  return list.split(",").map((v) => v.trim().replace(/'/g, "")).filter(Boolean).sort();
};

const SVC_QUERY = `SELECT DISTINCT service_name FROM "${S}" WHERE k8s_cluster = '$cl'`;
const NS_QUERY = `SELECT DISTINCT k8s_namespace FROM "${S}" WHERE k8s_cluster = '$cl'`;
const SVC_PANEL = `SELECT service_name, count(*) AS cnt FROM "${S}" WHERE service_name = '$svc' GROUP BY service_name`;
const NS_PANEL = `SELECT k8s_namespace AS service_name, count(*) AS cnt FROM "${S}" WHERE k8s_namespace IN ($pm) GROUP BY k8s_namespace`;
const AUTO_PANEL = `SELECT k8s_namespace AS service_name, count(*) AS cnt FROM "${S}" WHERE k8s_namespace IN ($ans) GROUP BY k8s_namespace`;

const customSql = (name, query, valueField, extra = {}) =>
  fx.queryValuesVariable(name, {
    stream_type: "logs", stream: "", field: "", max_record_size: null, filter: [], query, value_field: valueField,
  }, extra);

/** cl (custom) -> svc and pm (custom SQL, pm multi) plus an Auto ans; a panel per variable. */
function runtimeDashboard(title) {
  return fx.dashboardBody(title, {
    variables: [
      fx.customVariable("cl", ["prod-eu", "prod-us", "staging"]),
      customSql("svc", SVC_QUERY, "service_name"),
      customSql("pm", NS_QUERY, "k8s_namespace", { multiSelect: true }),
      fx.queryValuesVariable("ans", { stream_type: "logs", stream: S, field: "k8s_namespace", max_record_size: null, filter: [] }),
    ],
    panels: [
      fx.logsTablePanel("svc_panel", SVC_PANEL),
      fx.logsTablePanel("pm_panel", NS_PANEL),
      fx.logsTablePanel("ans_panel", AUTO_PANEL),
    ],
  });
}

test.describe.configure({ mode: "parallel" });

test.describe("Query Values variables - dashboard runtime", { tag: ["@dashboards", "@dashboardVariables", "@queryVariables", "@P1"] }, () => {
  test.beforeAll(async () => {
    await fx.ingestQueryVariableData();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test.afterAll(async () => {
    await fx.deleteCreatedDashboards();
  });

  test("F1: a panel using a custom query variable follows its selection", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await fx.createDashboard(runtimeDashboard(uniqueTitle("e2e_qv_f1")));
    const queries = fx.trackQueries(page);
    await qv.openDashboard(fx.dashboardUrl(id, "&var-cl=prod-eu"));

    for (const name of ["cl", "svc", "pm", "ans"]) await expect(qv.selector(name)).toBeVisible();
    await qv.expectOptionValues("svc", ["cart", "checkout", "frontend"]);

    await qv.selectOption("svc", "checkout");
    await qv.refreshDashboard();
    await fx.waitForSearch(queries, "service_name = 'checkout'");
    await expect(page.locator('[data-test="dashboard-panel-table"]').first()).toContainText("checkout", { timeout: 30000 });

    await qv.selectOption("svc", "frontend");
    await qv.refreshDashboard();
    await fx.waitForSearch(queries, "service_name = 'frontend'");
  });

  test("F2: All on a custom variable sends its listed options; All on an Auto variable sends no filter", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await fx.createDashboard(runtimeDashboard(uniqueTitle("e2e_qv_f2")));
    const queries = fx.trackQueries(page);
    await qv.openDashboard(fx.dashboardUrl(id, "&var-cl=prod-eu"));

    await qv.expectOptionValues("pm", ["checkout", "monitoring", "payments"]);
    await qv.selectAllMulti("pm");
    await qv.selectAll("ans");
    queries.clear();
    await qv.refreshDashboard();

    const nsSql = await fx.waitForSearch(queries, /k8s_namespace IN \('[a-z]+', ?'[a-z]+', ?'[a-z]+'\) GROUP/);
    expect(sortedIn(nsSql, "k8s_namespace")).toEqual(["checkout", "monitoring", "payments"]);
    await fx.waitForSearch(queries, "_o2_all_");
    await expect(page.locator('[data-test="dashboard-panel-table"]').nth(2)).toContainText("default", { timeout: 30000 });
    await expect(page.locator('[data-test="dashboard-panel-table"]').nth(2)).toContainText("search");
  });

  test("F3: a multi-select custom child of a parent drives its panel through the chain", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await fx.createDashboard(runtimeDashboard(uniqueTitle("e2e_qv_f3")));
    const queries = fx.trackQueries(page);
    await qv.openDashboard(fx.dashboardUrl(id, "&var-cl=prod-eu"));

    await qv.selectOptions("pm", ["monitoring", "payments"]);
    queries.clear();
    await qv.refreshDashboard();
    const first = await fx.waitForSearch(queries, /k8s_namespace IN \('[a-z]+', ?'[a-z]+'\) GROUP/);
    expect(sortedIn(first, "k8s_namespace")).toEqual(["monitoring", "payments"]);

    queries.clear();
    await qv.selectOption("cl", "prod-us");
    await fx.waitForSearch(queries, "k8s_cluster = 'prod-us'");
    await qv.expectOptionValues("pm", ["monitoring", "payments", "search"]);
    await qv.selectOptions("pm", ["search"]);
    queries.clear();
    await qv.refreshDashboard();
    await fx.waitForSearch(queries, "k8s_namespace IN ('search')");
  });

  test("F4: a time range change reloads custom variable values and re-runs panels", async ({ page }) => {
    const pm = new PageManager(page);
    const qv = pm.dashboardQueryVariable;
    const id = await fx.createDashboard(runtimeDashboard(uniqueTitle("e2e_qv_f4")));
    const queries = fx.trackQueries(page);
    await qv.openDashboard(fx.dashboardUrl(id, "&var-cl=prod-eu"));
    await fx.waitForSearch(queries, (sql) => sql.startsWith("SELECT DISTINCT service_name"));
    await fx.waitForSearch(queries, "service_name = '");

    queries.clear();
    await pm.dashboardTimeRefresh.setRelative("6", "h");
    await qv.refreshDashboard();
    const sixHours = 6 * 3600 * 1_000_000;
    const window = (r) => r.endTime - r.startTime;
    await expect
      .poll(() => queries.searchRequests().some((r) => r.sql.startsWith("SELECT DISTINCT service_name") && window(r) >= sixHours - 60_000_000), { timeout: 30000 })
      .toBe(true);
    await expect
      .poll(() => queries.searchRequests().some((r) => r.sql.includes("WHERE service_name = '") && window(r) >= sixHours - 60_000_000), { timeout: 30000 })
      .toBe(true);
  });

  test("F5: var-x in the URL selects custom variable values on load", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await fx.createDashboard(runtimeDashboard(uniqueTitle("e2e_qv_f5")));
    const queries = fx.trackQueries(page);
    await qv.openDashboard(fx.dashboardUrl(id, "&var-cl=prod-us&var-svc=payments&var-pm=payments&var-pm=search"));

    await expect(qv.shownValue("svc")).toHaveText("payments", { timeout: 45000 });
    await fx.waitForSearch(queries, "service_name = 'payments'");
    const nsSql = await fx.waitForSearch(queries, /k8s_namespace IN \('[a-z]+', ?'[a-z]+'\) GROUP/);
    expect(sortedIn(nsSql, "k8s_namespace")).toEqual(["payments", "search"]);
  });

  test("F6: exporting and re-importing a dashboard with every variable kind keeps the variables identical", async ({ page }) => {
    const pm = new PageManager(page);
    const qv = pm.dashboardQueryVariable;
    const group = { filterType: "group", logicalOperator: "AND", conditions: [
      { type: "condition", values: [], column: { field: "level", streamAlias: null }, operator: "=", value: "error", logicalOperator: "AND", filterType: "condition" },
      { type: "condition", values: [], column: { field: "k8s_cluster", streamAlias: null }, operator: "=", value: "$cl", logicalOperator: "OR", filterType: "condition" },
    ] };
    const body = runtimeDashboard(uniqueTitle("e2e_qv_f6"));
    body.variables.list.push(
      fx.queryValuesVariable("auto_and", { stream_type: "logs", stream: S, field: "service_name", max_record_size: 5, filter: [{ name: "level", operator: "=", value: "error" }] }),
      fx.queryValuesVariable("auto_or", { stream_type: "logs", stream: S, field: "service_name", max_record_size: null, filter_group: group }),
      fx.queryValuesVariable("auto_promql", { stream_type: "metrics", stream: fx.METRIC_UP, field: "pod", max_record_size: null, filter: [{ name: "cluster", operator: "=", value: "$cl" }], query_type: "promql" }),
      fx.queryValuesVariable("custom_promql", { stream_type: "metrics", stream: "", field: "", max_record_size: null, filter: [], query_type: "promql", query: `label_values(${fx.METRIC_UP}{cluster="$cl"}, namespace)` }),
      customSql("custom_labels", `SELECT DISTINCT service_name, service_id FROM "${S}"`, "service_name", {}),
      { type: "constant", name: "k_const", label: "k_const", value: "payments", hideOnDashboard: false, escapeSingleQuotes: true },
      { type: "textbox", name: "k_text", label: "k_text", value: "checkout", hideOnDashboard: false, escapeSingleQuotes: true },
    );
    body.variables.list.find((v) => v.name === "custom_labels").query_data.label_field = "service_id";
    const id = await fx.createDashboard(body);
    const original = await fx.getDashboard(id);

    await qv.openDashboard(fx.dashboardUrl(id, "&var-cl=prod-eu"));
    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await pm.dashboardShareExport.pressExportShortcut();
    const download = await downloadPromise;
    const exportedPath = test.info().outputPath("exported.dashboard.json");
    await download.saveAs(exportedPath);
    const exported = JSON.parse(fs.readFileSync(exportedPath, "utf-8"));
    expect(JSON.stringify(fx.innerDashboard(exported).variables)).toBe(JSON.stringify(original.variables));

    const title = uniqueTitle("e2e_qv_f6_import");
    await page.goto(`/web/dashboards?org_identifier=${fx.ORG()}&folder=default`);
    await pm.dashboardImport.clickImportDashboard();
    await pm.dashboardImport.uploadDashboardFile(exportedPath, { title });
    await pm.dashboardImport.clickImportButton();
    await expect.poll(() => fx.findDashboardId(title), { timeout: 30000 }).toBeTruthy();
    const importedId = await fx.findDashboardId(title);
    fx.trackDashboard(importedId);

    const imported = await fx.getDashboard(importedId);
    expect(JSON.stringify(imported.variables)).toBe(JSON.stringify(original.variables));
  });

  test("G1: panel builder filters still build the WHERE clause, including a query variable", async ({ page }) => {
    const pm = new PageManager(page);
    const qv = pm.dashboardQueryVariable;
    const id = await fx.createDashboard(fx.dashboardBody(uniqueTitle("e2e_qv_g1"), {
      variables: [fx.queryValuesVariable("svc", { stream_type: "logs", stream: S, field: "service_name", max_record_size: null, filter: [{ name: "level", operator: "=", value: "error" }] })],
    }));
    await qv.openDashboard(fx.dashboardUrl(id, "&var-svc=payments"));
    await expect(qv.shownValue("svc")).toHaveText("payments", { timeout: 45000 });
    const queries = fx.trackQueries(page);

    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(`qv_g1_${Date.now()}`);
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream(S);
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardFilter.builder.addCondition("level", "=", "error");
    await pm.dashboardFilter.builder.addCondition("service_name", "=", "$svc");
    await pm.dashboardFilter.builder.expectConnector("1", "AND");
    // The panel editor keeps its own selection of svc, so the expected value is read from its dropdown.
    const svcValue = (await qv.shownValue("svc").innerText()).trim();
    expect(["cart", "checkout", "inventory", "payments"]).toContain(svcValue);
    queries.clear();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await fx.waitForSearch(queries, `level = 'error' AND service_name = '${svcValue}'`);
  });

  test("G2: constant, textbox, custom and date variables still work and save unchanged", async ({ page }) => {
    const pm = new PageManager(page);
    const qv = pm.dashboardQueryVariable;
    const id = await fx.createDashboard(fx.dashboardBody(uniqueTitle("e2e_qv_g2"), {
      variables: [
        { type: "constant", name: "k_const", label: "k_const", value: "payments", hideOnDashboard: false, escapeSingleQuotes: true },
        { type: "textbox", name: "k_text", label: "k_text", value: "checkout", hideOnDashboard: false, escapeSingleQuotes: true },
        fx.customVariable("k_custom", ["prod-eu", "prod-us"]),
      ],
      panels: [fx.logsTablePanel("g2_panel", `SELECT service_name, count(*) AS cnt FROM "${S}" WHERE service_name IN ('$k_text', '$k_const') AND k8s_cluster = '$k_custom' GROUP BY service_name`)],
    }));
    const before = await fx.getDashboard(id);
    const queries = fx.trackQueries(page);
    await qv.openDashboard(fx.dashboardUrl(id));

    await fx.waitForSearch(queries, "service_name IN ('checkout', 'payments') AND k8s_cluster = 'prod-eu'");
    queries.clear();
    await pm.dashboardVariablesScoped.changeTextboxVariableValue("k_text", "cart");
    await qv.selectOption("k_custom", "prod-us");
    await qv.refreshDashboard();
    await fx.waitForSearch(queries, "service_name IN ('cart', 'payments') AND k8s_cluster = 'prod-us'");

    await qv.openVariablesSettings();
    for (const name of ["k_const", "k_text", "k_custom"]) {
      await qv.editVariable(name);
      await qv.save();
    }
    const after = await fx.getDashboard(id);
    for (const name of ["k_const", "k_text", "k_custom"]) {
      const was = before.variables.list.find((v) => v.name === name);
      const now = after.variables.list.find((v) => v.name === name);
      expect(now.type).toBe(was.type);
      expect(now.query_data ?? null).toBeNull();
    }
    expect(after.variables.list.find((v) => v.name === "k_const").value).toBe("payments");

    await qv.startNewVariable("k_date");
    await qv.setVariableType("date");
    await qv.save();
    const date = await fx.getVariable(id, "k_date");
    expect(date.type).toBe("date");
    expect(date.query_data ?? null).toBeNull();
  });
});
