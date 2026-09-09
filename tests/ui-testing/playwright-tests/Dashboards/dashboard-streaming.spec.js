const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const { gotoWithRetry } = require("../utils/navigation.js");
import logData from "../../fixtures/log.json";
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "./utils/dashCreation.js";

test.describe.configure({ mode: "serial" });

// Dashboard variable values always go over _values_stream. Which field a call
// reloaded is what lets the assertions below name the variable that refetched
// instead of counting anonymous requests — and the variable path (type "values" in
// useStreamingSearch) puts it in the POST body, not in the URL like the logs/panel
// filter path does, so read both.
const valuesStreamFields = (request) => {
  const urlFields = new URL(request.url()).searchParams.get("fields");
  if (urlFields) return urlFields.split(",");
  try {
    return JSON.parse(request.postData() ?? "{}").fields ?? [];
  } catch {
    return [];
  }
};

const captureValuesStreamCalls = (page) => {
  const calls = [];
  page.on("response", (response) => {
    const url = response.url();
    if (!url.includes("/_values_stream")) return;
    calls.push({
      url,
      status: response.status(),
      fields: valuesStreamFields(response.request()),
    });
  });
  return calls;
};

// Generated per test, not per module: on a retry the previous attempt may have left
// its dashboard behind, and a duplicate name makes search/delete ambiguous.
const uniqueDashboardName = (suffix) =>
  `Dashboard_${Math.random().toString(36).substring(2, 11)}_${suffix}`;

// dashCreation's deleteDashboard resolves the row by name; dashboardCreate's takes
// whichever row is first, which on the shared cloud org can belong to a test still
// running in another worker. Cleanup must also never mask the assertion that failed
// before it.
const deleteDashboardSafely = async (page, pm, name) => {
  try {
    await pm.dashboardCreate.backToDashboardList();
    await pm.dashboardCreate.searchDashboard(name);
    await deleteDashboard(page, name);
  } catch (e) {
    testLogger.warn("Dashboard cleanup failed", { name, error: e?.message });
  }
};

test.describe("dashboard streaming testcases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);

    await gotoWithRetry(
      page,
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`,
      { waitUntil: "domcontentloaded" }
    );
  });

  test("should verify the custom value search from variable dropdown with streaming enabled", async ({
    page,
  }) => {
    const valuesResponses = captureValuesStreamCalls(page);
    const pm = new PageManager(page);
    const dashboardName = uniqueDashboardName("streaming");
    const panelName = pm.dashboardPanelActions.generateUniquePanelName(
      "panel-test-streaming"
    );

    try {
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);

      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();
      await pm.dashboardSetting.openSetting();
      await pm.dashboardVariables.addDashboardVariable(
        "variablename",
        "logs",
        "e2e_automate",
        "kubernetes_container_name",
        true, // customValueSearch
        null, // filterConfig
        true // showMultipleValues
      );

      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      await waitForDateTimeButtonToBeEnabled(page);
      await pm.dashboardTimeRefresh.setRelative("30", "m");
      await pm.dashboardPanelActions.waitForChartToRender();

      await pm.dashboardVariables
        .variableWrapper("variablename")
        .waitFor({ state: "visible", timeout: 15000 });

      await pm.dashboardVariables.clickVariableTrigger("variablename");

      // Partial terms, each one a separate streamed values query for the field.
      for (const term of ["zi", "zio", "ziox"]) {
        await pm.dashboardVariables.fillVariableSearch("variablename", term);
      }

      await pm.dashboardVariables.selectVariableOption("variablename", "ziox");
      // A multi-select selector stays open after a pick, and its portal covers the
      // field list the next step clicks into.
      await pm.dashboardVariables.closeVariableDropdown("variablename");

      await expect
        .poll(() => valuesResponses.length, { timeout: 15000 })
        .toBeGreaterThan(0);

      for (const res of valuesResponses) {
        expect(res.status).toBe(200);
      }

      // The values queries went out over the streaming endpoint for the field the
      // variable is bound to.
      const fieldCalls = valuesResponses.filter((res) =>
        res.fields.includes("kubernetes_container_name")
      );
      expect(fieldCalls.length).toBeGreaterThan(0);

      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "filter"
      );

      await pm.dashboardFilter.addFilterCondition(
        0,
        "kubernetes_container_name",
        "",
        "IN",
        "$variablename"
      );

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await deleteDashboardSafely(page, pm, dashboardName);
    }
  });

  test("should add dashboard variable with filter configuration", async ({
    page,
  }) => {
    const valuesResponses = captureValuesStreamCalls(page);
    const pm = new PageManager(page);
    const dashboardName = uniqueDashboardName("filter");
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("panel-filter-test");

    // Reloaded when "variablename" changes: variablename12 depends on it, and
    // variablename123 depends on variablename12.
    const dependentFields = ["kubernetes_namespace_name", "kubernetes_pod_name"];

    try {
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);

      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();
      await pm.dashboardSetting.openSetting();

      await pm.dashboardVariables.addDashboardVariable(
        "variablename",
        "logs",
        "e2e_automate",
        "kubernetes_container_name"
      );

      await pm.dashboardSetting.openSetting();
      await pm.dashboardVariables.addDashboardVariable(
        "variablename12",
        "logs",
        "e2e_automate",
        "kubernetes_namespace_name",
        false,
        {
          filterName: "kubernetes_container_name",
          operator: "=",
          value: "$variablename",
        }
      );

      await pm.dashboardSetting.openSetting();
      await pm.dashboardVariables.addDashboardVariable(
        "variablename123",
        "logs",
        "e2e_automate",
        "kubernetes_pod_name",
        false,
        {
          filterName: "kubernetes_namespace_name",
          operator: "=",
          value: "$variablename12",
        }
      );

      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "filter"
      );
      await pm.dashboardFilter.addFilterCondition(
        0,
        "kubernetes_container_name",
        "",
        "=",
        "$variablename"
      );

      await pm.dashboardPanelActions.applyDashboardBtn();
      await waitForDateTimeButtonToBeEnabled(page);
      await pm.dashboardTimeRefresh.setRelative("30", "m");
      await pm.dashboardPanelActions.waitForChartToRender();

      await pm.dashboardPanelActions.savePanel();

      const parentTrigger =
        pm.dashboardVariables.variableTrigger("variablename");
      await parentTrigger.waitFor({ state: "visible", timeout: 15000 });
      await expect(parentTrigger).toBeVisible();

      // All three selectors load on their own as the dashboard opens; a baseline
      // taken before that settles counts those calls as dependent reloads.
      await page
        .waitForLoadState("networkidle", { timeout: 15000 })
        .catch(() => {});
      const callsBeforeChange = valuesResponses.length;

      await pm.dashboardVariables.selectValueFromVariableDropDown(
        "variablename",
        "ziox"
      );

      // Assert the dependency chain actually re-ran, by field, rather than waiting
      // on a count of unattributed requests.
      await expect
        .poll(
          () => {
            const reloaded = new Set(
              valuesResponses
                .slice(callsBeforeChange)
                .flatMap((res) => res.fields)
            );
            return dependentFields.filter((field) => reloaded.has(field));
          },
          { timeout: 30000, intervals: [500, 1000, 2000, 3000, 5000] }
        )
        .toEqual(dependentFields);

      const newCalls = valuesResponses.slice(callsBeforeChange);
      testLogger.info("values calls after parent variable change", {
        count: newCalls.length,
        fields: newCalls.map((res) => res.fields.join(",")),
      });
      expect(newCalls.length).toBeGreaterThanOrEqual(dependentFields.length);

      for (const res of valuesResponses) {
        expect(res.status).toBe(200);
      }
    } finally {
      await deleteDashboardSafely(page, pm, dashboardName);
    }
  });
});
