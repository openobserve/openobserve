// Metrics Query Values variables: the SQL | PromQL language row, Auto PromQL and Custom PromQL (openobserve#15355, plan C1-C4, E1-E3).
const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager.js";
const fx = require("../utils/query-variable-fixtures.js");

const UP = fx.METRIC_UP;
const uniqueTitle = (base) => `${base}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const PODS_QUERY = `label_values(${UP}{cluster="$cl"}, pod)`;
const OR_MESSAGE = "PromQL filters support AND only";

/** Opens a new variable `name` on a dashboard holding a custom `cl` (prod-eu first) plus `variables`. */
async function startVariable(qv, { variables = [], extra = "", name = "pv" } = {}) {
  const id = await fx.createDashboard(fx.dashboardBody(uniqueTitle("e2e_qv_promql"), {
    variables: [fx.customVariable("cl", ["prod-eu", "prod-us", "staging"]), ...variables],
  }));
  await qv.openDashboard(fx.dashboardUrl(id, extra));
  await qv.openVariablesSettings();
  await qv.startNewVariable(name);
  return id;
}

async function startCustomPromql(qv, options) {
  const id = await startVariable(qv, options);
  await qv.setStreamType("metrics");
  await qv.setLanguage("promql");
  await qv.setMode("custom");
  return id;
}

const customPromql = (name, query, extra = {}) =>
  fx.queryValuesVariable(name, {
    stream_type: "metrics",
    stream: "",
    field: "",
    max_record_size: null,
    filter: [],
    query_type: "promql",
    query,
    ...extra,
  });

test.describe.configure({ mode: "parallel" });

test.describe("Query Values variables - metrics and PromQL", { tag: ["@dashboards", "@dashboardVariables", "@queryVariables", "@P1"] }, () => {
  test.beforeAll(async () => {
    await fx.ingestQueryVariableData();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test.afterAll(async () => {
    await fx.deleteCreatedDashboards();
  });

  test("C1: only the metrics stream type shows the query language row", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    await startVariable(qv);

    await expect(qv.languageRow).toBeHidden();
    await qv.setStreamType("logs");
    await expect(qv.languageRow).toBeHidden();
    await qv.setStreamType("traces");
    await expect(qv.languageRow).toBeHidden();
    await qv.setStreamType("metrics");
    await expect(qv.languageRow).toBeVisible();
    await expect(qv.languageRow).toContainText("Query language");
    await qv.expectLanguage("sql");
    await qv.setLanguage("promql");
    await qv.setStreamType("logs");
    await expect(qv.languageRow).toBeHidden();
    await qv.setStreamType("metrics");
    await qv.expectLanguage("sql");
  });

  test("C2: Auto PromQL with AND matchers and $var loads label values and saves query_type without query", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startVariable(qv, { extra: "&var-cl=prod-eu" });
    const queries = fx.trackQueries(page);

    await qv.setStreamType("metrics");
    await qv.setLanguage("promql");
    await qv.setStream(UP);
    const fields = await qv.fieldOptions();
    expect(fields).toEqual(expect.arrayContaining(["cluster", "job", "namespace", "pod"]));
    for (const internal of ["_timestamp", "__hash__", "value"]) expect(fields).not.toContain(internal);
    await qv.setField("namespace");
    await qv.addFilter("cluster", "=", "$cl");
    await qv.addFilter("job", "=", "kubelet");
    await qv.save();

    const pv = await fx.getVariable(id, "pv");
    expect(pv.query_data).toEqual({
      stream_type: "metrics",
      stream: UP,
      field: "namespace",
      max_record_size: null,
      filter: [
        { name: "cluster", operator: "=", value: "$cl" },
        { name: "job", operator: "=", value: "kubelet" },
      ],
      query_type: "promql",
    });

    await qv.closeSettings();
    await qv.expectOptionValues("pv", ["checkout", "payments"]);
    const lookup = queries.promql().find((url) => url.includes("/label/namespace/values") && url.includes(UP));
    expect(lookup, queries.promql().join("\n")).toBeTruthy();
    expect(lookup).toContain("prod-eu");
    expect(lookup).toContain('job="kubelet"');

    await qv.selectOption("cl", "prod-us");
    await qv.expectOptionValues("pv", ["search"]);
  });

  test("C3: an OR filter blocks Save in PromQL with a message until the OR is removed", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startVariable(qv);

    await qv.setStreamType("metrics");
    await qv.setStream(UP);
    await qv.setField("pod");
    await qv.addFilter("cluster", "=", "prod-eu");
    await qv.addFilter("job", "=", "node");
    await qv.filters.toggleConnector("1");
    await qv.filters.expectConnector("1", "OR");
    await qv.setLanguage("promql");

    await qv.expectSaveBlocked(qv.drawerText(OR_MESSAGE));
    expect((await fx.getDashboard(id)).variables.list.map((v) => v.name)).toEqual(["cl"]);

    await qv.filters.removeChipAt(1);
    await expect(qv.drawerText(OR_MESSAGE)).toBeHidden();
    await qv.save();
    const pv = await fx.getVariable(id, "pv");
    expect(pv.query_data.query_type).toBe("promql");
    expect(pv.query_data.filter).toEqual([{ name: "cluster", operator: "=", value: "prod-eu" }]);
    expect(pv.query_data).not.toHaveProperty("filter_group");
  });

  test("C4: Auto SQL on a metrics stream still works and saves no query_type", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startVariable(qv);

    await qv.setStreamType("metrics");
    await qv.expectLanguage("sql");
    await qv.setStream(UP);
    await qv.setField("namespace");
    await qv.addFilter("cluster", "=", "prod-us");
    await qv.save();

    const pv = await fx.getVariable(id, "pv");
    expect(pv.query_data).toEqual({
      stream_type: "metrics",
      stream: UP,
      field: "namespace",
      max_record_size: null,
      filter: [{ name: "cluster", operator: "=", value: "prod-us" }],
    });
    await qv.closeSettings();
    await qv.expectOptionValues("pv", ["payments", "search"]);
  });

  test("Auto PromQL -> Custom prefills label_values() and Auto keeps its settings when switched back", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    await startVariable(qv);

    await qv.setStreamType("metrics");
    await qv.setLanguage("promql");
    await qv.setStream(UP);
    await qv.setField("namespace");
    await qv.addFilter("job", "=", "kubelet");
    await qv.setMode("custom");
    await expect.poll(() => qv.queryText()).toBe(`label_values(${UP}{job="kubelet"}, namespace)`);
    await qv.expectLanguage("promql");

    await qv.setMode("auto");
    await expect(qv.streamTrigger).toContainText(UP);
    await expect(qv.fieldTrigger).toContainText("namespace");
    await qv.filters.expectChip("job", "=");
  });

  test("E1: label_values, label_names, metrics and query_result each preview and load options", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startCustomPromql(qv, { name: "pods" });

    await qv.openFunctionsHelp();
    for (const fn of ["label-values", "label-values-selector", "label-names", "metrics", "query-result"]) {
      await expect(qv.functionRow(fn)).toBeVisible();
    }
    await qv.insertFunctionExample("label-names");
    await expect.poll(() => qv.queryText()).toBe("label_names()");

    await qv.fillQuery(PODS_QUERY);
    await qv.runPreview();
    expect((await qv.previewTexts()).sort()).toEqual(["checkout-0", "payments-0"]);

    await qv.fillQuery("label_values(job)");
    await qv.runPreview();
    expect(await qv.previewTexts()).toEqual(expect.arrayContaining(["kubelet", "node"]));

    await qv.fillQuery(`label_names(${UP})`);
    await qv.runPreview();
    expect(await qv.previewTexts()).toEqual(expect.arrayContaining(["cluster", "job", "namespace", "pod"]));

    await qv.fillQuery("label_names()");
    await expect.poll(async () => {
      await qv.runPreview();
      return qv.previewTexts().catch(() => []);
    }, { timeout: 60000 }).toEqual(expect.arrayContaining(["cluster", "namespace", "pod"]));

    await qv.fillQuery("metrics(e2e_qv_.*)");
    await expect.poll(async () => {
      await qv.runPreview();
      return (await qv.previewTexts().catch(() => [])).sort();
    }, { timeout: 60000 }).toEqual([fx.METRIC_INFO, UP].sort());

    await qv.fillQuery(`query_result(count by (namespace) (${UP}{cluster="prod-eu"}))`);
    await qv.runPreview();
    const samples = await qv.previewTexts();
    expect(samples).toHaveLength(2);
    expect(samples.join("\n")).toContain('namespace="checkout"');
    expect(samples.join("\n")).toContain('namespace="payments"');

    await qv.fillQuery(PODS_QUERY);
    await qv.save();
    await qv.closeSettings();
    await qv.expectOptionValues("pods", ["checkout-0", "payments-0"]);
    expect((await fx.getVariable(id, "pods")).query_data.query).toBe(PODS_QUERY);
  });

  test("E1: bad PromQL and an invalid metrics() regex show the reason in Run preview", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    await startCustomPromql(qv);

    await qv.fillQuery(`query_result(sum by (namespace) ${UP})`);
    await qv.runPreview();
    await expect(qv.previewError).toBeVisible();
    await expect(qv.previewError).not.toHaveText(/^\s*$/);

    await qv.fillQuery("metrics(*bad)");
    await qv.runPreview();
    await expect(qv.previewError).toContainText("*bad");

    await qv.fillQuery(`label_values(${UP}{cluster="no-such-cluster"}, pod)`);
    await qv.runPreview();
    await expect(qv.previewEmpty).toBeVisible();

    await qv.fillQuery(`label_values(${UP}{cluster="$nothere"}, pod)`);
    await expect(qv.undefinedWarning).toContainText("$nothere");
  });

  test("E2: $var inside a matcher follows the parent, and regex characters or quotes in it stay escaped", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startCustomPromql(qv, { name: "pods" });
    await qv.fillQuery(PODS_QUERY);
    await expect(page.locator('[data-test="dashboard-variable-query-parent-cl"]')).toHaveText("$cl = prod-eu");
    await qv.save();
    await qv.closeSettings();

    await qv.expectOptionValues("pods", ["checkout-0", "payments-0"]);
    await qv.selectOption("cl", "prod-us");
    await qv.expectOptionValues("pods", ["payments-1", "search-0"]);

    const queries = fx.trackQueries(page);
    const tricky = `pr"o'd.*\\+(eu)`;
    await qv.openDashboard(fx.dashboardUrl(id, `&var-cl=${encodeURIComponent(tricky)}`));
    await qv.expectNoData("pods");
    const lookup = queries.promql().find((url) => url.includes("/label/pod/values"));
    expect(lookup, queries.promql().join("\n")).toContain(`cluster="pr\\"o'd.*\\\\+(eu)"`);
    await expect(page.locator('[data-test="variable-query-error-pods"]')).toHaveCount(0);
  });

  test("E3: a custom PromQL variable saves query_type and query only", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await startCustomPromql(qv, { name: "pods" });
    await qv.fillQuery(PODS_QUERY);
    await expect(qv.valueFieldTrigger).toBeHidden();
    await qv.save();

    const pods = await fx.getVariable(id, "pods");
    expect(pods.query_data).toEqual({
      stream_type: "metrics",
      stream: "",
      field: "",
      max_record_size: null,
      filter: [],
      query_type: "promql",
      query: PODS_QUERY,
    });

    await qv.editVariable("pods");
    await qv.expectMode("custom");
    await qv.expectLanguage("promql");
    await expect.poll(() => qv.queryText()).toBe(PODS_QUERY);
  });

  test("max record size caps Custom PromQL and Auto PromQL options", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const autoVar = fx.queryValuesVariable("auto_ns", {
      stream_type: "metrics",
      stream: UP,
      field: "namespace",
      max_record_size: 2,
      filter: [],
      query_type: "promql",
    });
    const id = await startCustomPromql(qv, { name: "pods", variables: [autoVar] });
    await qv.fillQuery(PODS_QUERY);
    await qv.setMaxRecordSize(1);
    await qv.runPreview();
    await expect(qv.previewCount).toHaveText("1 value");
    await expect(qv.previewCapped).toHaveText(/Capped at 1/);
    await qv.save();
    expect((await fx.getVariable(id, "pods")).query_data.max_record_size).toBe(1);
    await qv.closeSettings();

    await expect.poll(async () => (await qv.readOptions("pods")).length, { timeout: 45000 }).toBe(1);
    await expect.poll(async () => (await qv.readOptions("auto_ns")).length, { timeout: 45000 }).toBe(2);
  });

  test("a custom PromQL variable saved without a selector lists the label across the metric", async ({ page }) => {
    const qv = new PageManager(page).dashboardQueryVariable;
    const id = await fx.createDashboard(fx.dashboardBody(uniqueTitle("e2e_qv_promql_api"), {
      variables: [customPromql("jobs", `label_values(${UP}, job)`)],
    }));
    await qv.openDashboard(fx.dashboardUrl(id));
    await qv.expectOptionValues("jobs", ["kubelet", "node"]);
  });
});
