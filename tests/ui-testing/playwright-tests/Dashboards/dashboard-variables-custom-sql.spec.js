// Custom SQL Query Values variables: prefill, Run preview, value/label columns, limits and options (openobserve#15355, plan D1-D6).
const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager.js";
const fx = require("../utils/query-variable-fixtures.js");

const S = fx.LOGS_STREAM;
const ERRORS_QUERY = `SELECT DISTINCT service_name, service_id FROM "${S}" WHERE level = 'error'`;
const ERROR_LABELS = [
  { value: "cart", label: "104" },
  { value: "checkout", label: "101" },
  { value: "inventory", label: "106" },
  { value: "payments", label: "102" },
];
const uniqueTitle = (base) => `${base}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

/** A dashboard with `variables` and a panel counting rows per service where service_name matches `$svc`. */
async function createDashboard(variables = [], panelWhere = "service_name = '$svc'") {
  return fx.createDashboard(fx.dashboardBody(uniqueTitle("e2e_qv_custom_sql"), {
    variables,
    panels: [fx.logsTablePanel("qv_sql_panel", `SELECT service_name, count(*) AS cnt FROM "${S}" WHERE ${panelWhere} GROUP BY service_name`)],
  }));
}

/** Opens a new variable `name` in Custom SQL mode on a dashboard holding `variables`. */
async function startCustomVariable(qv, { variables = [], extra = "", name = "svc", panelWhere } = {}) {
  const id = await createDashboard(variables, panelWhere);
  await qv.openDashboard(fx.dashboardUrl(id, extra));
  await qv.openVariablesSettings();
  await qv.startNewVariable(name);
  await qv.setMode("custom");
  return id;
}

const customSql = (query, extra = {}) =>
  fx.queryValuesVariable("svc", { stream_type: "logs", stream: "", field: "", max_record_size: null, filter: [], query, ...extra });

test.describe.configure({ mode: "parallel" });

test.describe("Query Values variables - Custom SQL", { tag: ["@dashboards", "@dashboardVariables", "@queryVariables", "@P1"] }, () => {
  test.beforeAll(async () => {
    await fx.ingestQueryVariableData();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test.afterAll(async () => {
    await fx.deleteCreatedDashboards();
  });

  test("D1: Auto -> Custom prefills the Auto query and Auto keeps its settings when switched back", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await createDashboard();
    await qv.openDashboard(fx.dashboardUrl(id));
    await qv.openVariablesSettings();
    await qv.startNewVariable("svc");

    await qv.setStreamType("logs");
    await qv.setMode("custom");
    await expect.poll(() => qv.queryText()).toBe("");
    await qv.setMode("auto");

    await qv.setStream(S);
    await qv.setField("service_name");
    await qv.addFilter("level", "=", "error");
    await qv.setMode("custom");
    await expect.poll(() => qv.queryText()).toBe(`SELECT DISTINCT "service_name" FROM "${S}" WHERE "level" = 'error'`);

    await qv.setMode("auto");
    await expect(qv.streamTrigger).toContainText(S);
    await expect(qv.fieldTrigger).toContainText("service_name");
    await qv.filters.expectChip("level", "=");
    await qv.filters.expectValue(0, "error");
  });

  test("D2: custom query with value and label columns previews, saves the new keys and shows labels", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startCustomVariable(qv);
    const queries = fx.trackQueries(page);

    await expect(qv.previewIdle).toBeVisible();
    await qv.fillQuery(ERRORS_QUERY);
    await qv.runPreview();
    await expect(qv.previewCount).toHaveText("4 values");
    expect((await qv.previewTexts("service_name")).sort()).toEqual(["cart", "checkout", "inventory", "payments"]);
    expect((await qv.previewTexts("service_id")).sort()).toEqual(["101", "102", "104", "106"]);
    await expect(qv.valueFieldTrigger).toContainText("service_name");
    await expect(qv.labelFieldTrigger).toHaveText("");
    await qv.selectLabelColumn("service_id");
    await qv.save();

    const svc = await fx.getVariable(id, "svc");
    expect(svc.query_data.query).toBe(ERRORS_QUERY);
    expect(svc.query_data.value_field).toBe("service_name");
    expect(svc.query_data.label_field).toBe("service_id");
    expect(svc.query_data).not.toHaveProperty("custom_query");
    expect(svc.query_data).not.toHaveProperty("query_type");

    await qv.closeSettings();
    await qv.expectOptions("svc", ERROR_LABELS);
    queries.clear();
    await qv.selectOption("svc", "payments");
    await expect(qv.shownValue("svc")).toHaveText("102");
    await qv.refreshDashboard();
    await expect.poll(() => page.url()).toContain("var-svc=payments");
    await fx.waitForSearch(queries, "service_name = 'payments'");
  });

  test("D2: the value column skips internal columns, and changing value or clearing label changes the options", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startCustomVariable(qv);

    await qv.fillQuery(`SELECT service_name, k8s_cluster FROM "${S}" WHERE level = 'error'`);
    await qv.runPreview();
    expect(await qv.valueColumnOptions()).toContain("_timestamp");
    await expect(qv.valueFieldTrigger).toContainText("service_name");

    await qv.selectValueColumn("k8s_cluster");
    await qv.selectLabelColumn("service_name");
    await qv.save();
    let svc = await fx.getVariable(id, "svc");
    expect([svc.query_data.value_field, svc.query_data.label_field]).toEqual(["k8s_cluster", "service_name"]);

    await qv.editVariable("svc");
    await qv.expectMode("custom");
    await qv.clearLabelColumn();
    await qv.save();
    svc = await fx.getVariable(id, "svc");
    expect(svc.query_data.value_field).toBe("k8s_cluster");
    expect(svc.query_data).not.toHaveProperty("label_field");

    await qv.closeSettings();
    await qv.expectOptions("svc", [
      { value: "prod-eu", label: "prod-eu" },
      { value: "prod-us", label: "prod-us" },
      { value: "staging", label: "staging" },
    ]);
  });

  test("D3: '$var' and a multi-select $var in a custom query follow the parent selection in preview and on the dashboard", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const query = `SELECT DISTINCT service_name FROM "${S}" WHERE k8s_cluster = '$cl' AND k8s_namespace IN ($nsm)`;
    const variables = [
      fx.customVariable("cl", ["prod-eu", "prod-us", "staging"]),
      fx.customVariable("nsm", ["checkout", "payments", "default"], { multiSelect: true }),
    ];
    const id = await startCustomVariable(qv, { variables, extra: "&var-cl=prod-eu&var-nsm=checkout&var-nsm=payments" });
    const queries = fx.trackQueries(page);

    await qv.fillQuery(query);
    await expect(page.locator('[data-test="dashboard-variable-query-parent-cl"]')).toHaveText("$cl = prod-eu");
    await expect(page.locator('[data-test="dashboard-variable-query-parent-nsm"]')).toHaveText("$nsm = checkout, payments");
    await qv.runPreview();
    expect((await qv.previewTexts("service_name")).sort()).toEqual(["cart", "checkout"]);
    await qv.save();
    await qv.closeSettings();

    await qv.expectOptionValues("svc", ["cart", "checkout"]);
    queries.clear();
    await qv.selectOption("cl", "prod-us");
    await qv.expectOptionValues("svc", ["payments"]);
    await fx.waitForSearch(queries, /k8s_cluster = 'prod-us' AND k8s_namespace IN \('(checkout|payments)', ?'(checkout|payments)'\)/);

    // The editor reads parent values from the URL, which takes a new selection only on Refresh.
    await qv.refreshDashboard();
    await expect.poll(() => page.url()).toContain("var-cl=prod-us");
    await qv.openVariablesSettings();
    await qv.editVariable("svc");
    await expect(page.locator('[data-test="dashboard-variable-query-parent-cl"]')).toHaveText("$cl = prod-us");
    await qv.runPreview();
    expect(await qv.previewTexts("service_name")).toEqual(["payments"]);
  });

  test("D4: an empty custom query blocks Save and stays in Custom mode", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startCustomVariable(qv);
    await qv.fillQuery(`SELECT DISTINCT service_name FROM "${S}"`);
    await qv.clearQuery();

    await qv.expectSaveBlocked(qv.queryError);
    await expect(qv.queryError).toHaveText("Query is required");
    await qv.expectMode("custom");
    expect((await fx.getDashboard(id)).variables.list).toEqual([]);
  });

  test("D5: Run preview shows error, empty, capped and undefined-variable states", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    await startCustomVariable(qv);

    await qv.fillQuery(`SELEC service_name FRM "${S}"`);
    await qv.runPreview();
    await expect(qv.previewError).toBeVisible();
    await expect(qv.previewError).toContainText(/error/i);
    await expect(qv.valueFieldTrigger).toHaveText(/Run the preview/);

    await qv.fillQuery(`SELECT DISTINCT service_name FROM "${S}" WHERE level = 'no-such-level'`);
    await qv.runPreview();
    await expect(qv.previewEmpty).toBeVisible();

    await qv.setMaxRecordSize(3);
    await qv.fillQuery(`SELECT service_name FROM "${S}"`);
    await qv.runPreview();
    await expect(qv.previewCount).toHaveText("3 values");
    await expect(qv.previewCapped).toHaveText(/Capped at 3/);

    await qv.fillQuery(`SELECT DISTINCT service_name FROM "${S}"`);
    await qv.runPreview();
    await expect(qv.previewCount).toHaveText("3 values");
    await expect(qv.previewCapped).toBeVisible();

    await qv.fillQuery(`SELECT DISTINCT service_name FROM "${S}" WHERE k8s_cluster = '$nothere'`);
    await expect(qv.undefinedWarning).toContainText("$nothere");
    await qv.runPreview();
    await expect(qv.previewEmpty).toBeVisible();
  });

  test("D6: reopening a custom SQL variable shows Custom mode with its query and columns", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await createDashboard([customSql(ERRORS_QUERY, { value_field: "service_name", label_field: "service_id" })]);
    await qv.openDashboard(fx.dashboardUrl(id));
    await qv.openVariablesSettings();
    await qv.editVariable("svc");

    await qv.expectMode("custom");
    await expect.poll(() => qv.queryText()).toBe(ERRORS_QUERY);
    await expect(qv.valueFieldTrigger).toContainText("service_name");
    await expect(qv.labelFieldTrigger).toContainText("service_id");
    await expect(qv.filterSection).toBeHidden();
  });

  test("max record size limits custom SQL options and clearing it restores the default", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startCustomVariable(qv);
    await qv.fillQuery(`SELECT DISTINCT service_name FROM "${S}"`);
    await qv.setMaxRecordSize(3);
    await qv.save();
    expect((await fx.getVariable(id, "svc")).query_data.max_record_size).toBe(3);
    await qv.closeSettings();
    await expect.poll(async () => (await qv.readOptions("svc")).length, { timeout: 45000 }).toBe(3);

    await qv.openVariablesSettings();
    await qv.editVariable("svc");
    await qv.setMaxRecordSize("");
    await qv.save();
    expect((await fx.getVariable(id, "svc")).query_data.max_record_size ?? null).toBeNull();
    await qv.closeSettings();
    await qv.expectOptionValues("svc", fx.ALL_SERVICES);
  });

  test("multi-select, default value choices, All and hide on dashboard work for a custom SQL variable", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startCustomVariable(qv, { panelWhere: "service_name IN ($svc)" });
    const queries = fx.trackQueries(page);
    await qv.fillQuery(ERRORS_QUERY.replace(", service_id", ""));
    await qv.setMultiSelect(true);
    await qv.setDefaultSelection("all");
    await qv.save();
    let svc = await fx.getVariable(id, "svc");
    expect([svc.multiSelect, svc.selectAllValueForMultiSelect]).toEqual([true, "all"]);
    await qv.closeSettings();

    const panelSql = await fx.waitForSearch(queries, /service_name IN \('[a-z]+', ?'[a-z]+', ?'[a-z]+', ?'[a-z]+'\)/, { timeout: 45000 });
    const inList = panelSql.match(/service_name IN \(([^)]*)\)/)[1];
    expect(inList.split(",").map((v) => v.trim().replace(/'/g, "")).sort()).toEqual(["cart", "checkout", "inventory", "payments"]);

    await qv.openVariablesSettings();
    await qv.editVariable("svc");
    await qv.setDefaultSelection("custom", ["payments"]);
    await qv.save();
    svc = await fx.getVariable(id, "svc");
    expect([svc.selectAllValueForMultiSelect, svc.customMultiSelectValue]).toEqual(["custom", ["payments"]]);
    await qv.closeSettings();
    // A fresh URL: a var-svc left in it by the earlier selection would win over the saved default.
    await qv.openDashboard(fx.dashboardUrl(id));
    await expect(qv.shownValue("svc")).toHaveText("payments", { timeout: 45000 });

    await qv.openVariablesSettings();
    await qv.editVariable("svc");
    await qv.setDefaultSelection("first");
    await qv.setMultiSelect(false);
    await qv.setHideOnDashboard(true);
    await qv.save();
    svc = await fx.getVariable(id, "svc");
    expect([svc.multiSelect, svc.selectAllValueForMultiSelect, svc.hideOnDashboard]).toEqual([false, "first", true]);
    await qv.closeSettings();
    await expect(qv.selector("svc")).toBeHidden();
  });
});
