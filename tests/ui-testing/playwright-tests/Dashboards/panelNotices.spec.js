// Dashboard Panel Notices (panel-notices). Dashboard-view host (PanelContainer):
// notice chips + tooltips + actions, the Query Inspector notice banners, the
// legacy query-error icon, and the last-refreshed clock. Max-query-range and
// exemplar-error warnings are intentionally NOT re-tested here — they already
// have dedicated specs (maxquery.spec.js / dashboard-exemplars.spec.js).
const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import { ingestion, ingestionHighCardinality } from "./utils/dashIngestion.js";
import {
  waitForDashboardPage,
  deleteDashboard,
  addSimplePanel,
} from "./utils/dashCreation.js";
import { generateDashboardName } from "./utils/configPanelHelpers.js";
import PageManager from "../../pages/page-manager";
const testLogger = require("../utils/test-logger.js");

// A breakdown field with >100 distinct values drives the series-cap notice
// (max_dashboard_series defaults to 100); the generated high-cardinality stream
// is the only deterministic route to it.
const SERIES_BREAKDOWN_FIELD = "breakdown";
const SERIES_MEASURE_FIELD = "metric_value";
const SERIES_CAP = 100;
const SERIES_COUNT = 150;

test.describe("Dashboard Panel Notices testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    // Establish the shared read-only stream (deduped across tests in this worker).
    await ingestion(page);
    await pm.dashboardMaxQueryRange.waitForStreamReady("e2e_automate");
  });

  // --------------------------------------------------------------------------
  // P0 — healthy panel
  // --------------------------------------------------------------------------
  test(
    "should show the last-refreshed clock with no notices and no error icon on a healthy panel",
    { tag: ["@panel-notices", "@all", "@P0"] },
    async () => {
      const dashboardName = generateDashboardName();

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(pm.page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await addSimplePanel(pm, "HealthyPanel", {
        chartType: "area",
        streamName: "e2e_automate",
        yAxisField: "kubernetes_namespace_name",
      });

      await pm.dashboardMaxQueryRange.waitForPanelsIdle();

      await expect(pm.dashboardNotices.lastRefreshed).toBeVisible({
        timeout: 15000,
      });
      // The header clock renders the 🕑 icon plus a relative age ("now"); the
      // "Last Refreshed At" label lives in the hover tooltip title, not text.
      await expect(pm.dashboardNotices.lastRefreshed).toContainText("🕑");
      await expect(pm.dashboardNotices.noticesContainer).toHaveCount(0);
      await expect(pm.dashboardNotices.errorIcon).toHaveCount(0);

      testLogger.info("Healthy panel shows last-refreshed clock with no notices");

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(pm.page, dashboardName);
    }
  );

  // --------------------------------------------------------------------------
  // P0 — series-cap notice + "Use Top N"
  // --------------------------------------------------------------------------
  test(
    'should render the series-cap notice with correct counts and route "Use Top N" to the editor',
    { tag: ["@panel-notices", "@all", "@P0"] },
    async () => {
      const dashboardName = generateDashboardName();
      const streamName = `e2e_panel_notices_sc_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      await ingestionHighCardinality(pm.page, streamName, { count: SERIES_COUNT });
      await pm.dashboardMaxQueryRange.waitForStreamReady(streamName);

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(pm.page);
      await pm.dashboardCreate.createDashboard(dashboardName);

      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.selectChartType("bar");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(streamName);
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField(SERIES_MEASURE_FIELD, "y");
      await pm.chartTypeSelector.searchAndAddField(SERIES_BREAKDOWN_FIELD, "b");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.addPanelName("SeriesCapPanel");
      await pm.dashboardPanelActions.savePanel();

      await pm.dashboardMaxQueryRange.waitForPanelsIdle();

      const chip = pm.dashboardNotices.noticeChip("series-cap");
      await expect(chip).toBeVisible({ timeout: 20000 });
      await expect(chip).toContainText(new RegExp(`\\b${SERIES_CAP}/${SERIES_COUNT} series$`));

      await pm.dashboardNotices.openNoticeTooltip("series-cap");
      await expect(
        pm.dashboardNotices.noticeContent("series-cap")
      ).toContainText("Series limit reached");
      await expect(
        pm.dashboardNotices.noticeAction("use-top-n")
      ).toBeVisible();

      await pm.dashboardNotices.clickNoticeAction("series-cap", "use-top-n");
      await pm.page.waitForURL(/add_panel/, { timeout: 20000 });
      const url = new URL(pm.page.url());
      expect(url.searchParams.get("focus")).toBe("top-n");
      expect(url.searchParams.get("panelId")).toBeTruthy();

      testLogger.info("Series-cap notice rendered and Use Top N routed to editor");

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(pm.page, dashboardName);
    }
  );

  // --------------------------------------------------------------------------
  // P1 — Query Inspector series-cap banner (query 0)
  // --------------------------------------------------------------------------
  test(
    "should show the series-cap banner on query 0 in the Query Inspector",
    { tag: ["@panel-notices", "@all", "@P1"] },
    async () => {
      const dashboardName = generateDashboardName();
      const streamName = `e2e_panel_notices_sc_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      await ingestionHighCardinality(pm.page, streamName, { count: SERIES_COUNT });
      await pm.dashboardMaxQueryRange.waitForStreamReady(streamName);

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(pm.page);
      await pm.dashboardCreate.createDashboard(dashboardName);

      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.selectChartType("bar");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(streamName);
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField(SERIES_MEASURE_FIELD, "y");
      await pm.chartTypeSelector.searchAndAddField(SERIES_BREAKDOWN_FIELD, "b");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.addPanelName("SeriesCapPanel");
      await pm.dashboardPanelActions.savePanel();

      await pm.dashboardMaxQueryRange.waitForPanelsIdle();

      await pm.dashboardPanelActions.selectPanelAction("SeriesCapPanel", "Inspector");

      await expect(pm.dashboardNotices.inspectorDialog).toBeVisible({
        timeout: 15000,
      });
      await expect(
        pm.dashboardNotices.inspectorNotice("series-cap", 0)
      ).toBeVisible({ timeout: 10000 });
      await expect(
        pm.dashboardNotices.inspectorNotice("series-cap", 0)
      ).toContainText("A chart draws at most");
      await expect(pm.dashboardNotices.inspectorOriginalQuery(0)).toBeVisible();
      await expect(pm.dashboardNotices.inspectorExecutedQuery(0)).toBeVisible();

      testLogger.info("Query Inspector shows the series-cap banner on query 0");

      await pm.dashboardNotices.closeInspector();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(pm.page, dashboardName);
    }
  );

  // --------------------------------------------------------------------------
  // P1 — function-error notice
  // --------------------------------------------------------------------------
  test(
    'should render the function-error notice with verbatim detail, "Copy error" and "Edit function"',
    { tag: ["@panel-notices", "@all", "@P1"] },
    async () => {
      const dashboardName = generateDashboardName();
      const functionErrorMessage = "VRL function failed: division by zero on row 5";

      await pm.dashboardNotices.installSearchResultMetaMock({
        function_error: [functionErrorMessage],
      });

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(pm.page);
      await pm.dashboardCreate.createDashboard(dashboardName);

      await pm.dashboardCreate.addPanel();
      await pm.chartTypeSelector.selectChartType("line");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "y");
      // The classifier only routes function_error to this notice when the panel
      // query carries a VRL function.
      await pm.dashboardNotices.addPanelVrlFunction(".foo = 1");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      await pm.dashboardPanelActions.addPanelName("FunctionErrorPanel");
      await pm.dashboardPanelActions.savePanel();

      await pm.dashboardMaxQueryRange.waitForPanelsIdle();

      await expect(
        pm.dashboardNotices.noticeChip("function-error")
      ).toBeVisible({ timeout: 20000 });

      await pm.dashboardNotices.openNoticeTooltip("function-error");
      await expect(
        pm.dashboardNotices.noticeContent("function-error")
      ).toContainText("VRL function failed");
      await expect(
        pm.dashboardNotices.noticeDetail("function-error")
      ).toContainText(functionErrorMessage);
      await expect(
        pm.dashboardNotices.noticeAction("edit-function")
      ).toBeVisible();
      await expect(pm.dashboardNotices.copyErrorBtn).toBeVisible();

      // "Copy error" puts the joined server messages on the clipboard.
      await pm.dashboardNotices.clickNoticeAction("function-error", "copy-error");
      await expect
        .poll(() => pm.page.evaluate(() => navigator.clipboard.readText()), {
          timeout: 10000,
        })
        .toBe(functionErrorMessage);

      // "Copy error" closes the tooltip (PanelErrorButtons `closeTooltip`), so
      // click "Edit function" via the helper that re-opens and stabilises it.
      await pm.dashboardNotices.clickNoticeAction("function-error", "edit-function");
      await pm.page.waitForURL(/add_panel/, { timeout: 20000 });
      expect(new URL(pm.page.url()).searchParams.get("focus")).toBe("vrl");

      testLogger.info("Function-error notice rendered and actions routed");

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(pm.page, dashboardName);
    }
  );

  // --------------------------------------------------------------------------
  // P1 — partial notice + "Refresh"
  // --------------------------------------------------------------------------
  test(
    'should render the partial notice and re-run the panel on "Refresh"',
    { tag: ["@panel-notices", "@all", "@P1"] },
    async () => {
      const dashboardName = generateDashboardName();

      await pm.dashboardNotices.installSearchResultMetaMock({ is_partial: true });

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(pm.page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await addSimplePanel(pm, "PartialPanel", {
        chartType: "line",
        streamName: "e2e_automate",
        yAxisField: "kubernetes_namespace_name",
      });

      await pm.dashboardMaxQueryRange.waitForPanelsIdle();

      await expect(pm.dashboardNotices.noticeChip("partial")).toBeVisible({
        timeout: 20000,
      });

      await pm.dashboardNotices.openNoticeTooltip("partial");
      await expect(
        pm.dashboardNotices.noticeContent("partial")
      ).toContainText("Partial results");
      await expect(pm.dashboardNotices.noticeAction("refresh")).toBeVisible();

      // "Refresh" re-runs the panel — a new search fires.
      const searchDone = pm.dashboardMaxQueryRange.createSearchResponsePromise();
      await pm.dashboardNotices.clickNoticeAction("partial", "refresh");
      await searchDone;

      testLogger.info("Partial notice rendered and Refresh re-ran the panel");

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(pm.page, dashboardName);
    }
  );

  // --------------------------------------------------------------------------
  // P1 — legacy query-error icon
  // --------------------------------------------------------------------------
  test(
    "should show the query-error icon on an erroring panel",
    { tag: ["@panel-notices", "@all", "@P1"] },
    async () => {
      const dashboardName = generateDashboardName();

      await pm.dashboardNotices.installSearchErrorMock();

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(pm.page);
      await pm.dashboardCreate.createDashboard(dashboardName);
      await addSimplePanel(pm, "ErrorPanel", {
        chartType: "line",
        streamName: "e2e_automate",
        yAxisField: "kubernetes_namespace_name",
      });

      await pm.dashboardMaxQueryRange.waitForPanelsIdle();

      await expect(pm.dashboardNotices.errorIcon).toBeVisible({ timeout: 20000 });

      testLogger.info("Query-error icon shown on erroring panel");

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(pm.page, dashboardName);
    }
  );

  // --------------------------------------------------------------------------
  // P2 — UNWIRED feature gap (feature-incomplete, parked as fixme)
  // --------------------------------------------------------------------------
  test.fixme(
    "x-alias inconsistency warning on dashboard view — not wired: PanelContainer.vue/ViewPanel.vue do not pass xAliasInconsistencyWarning (only PanelEditor.vue:267/588 wires hasInconsistentXAlias)",
    { tag: ["@panel-notices", "@all", "@P2"] },
    async () => {
      await expect(pm.dashboardNotices.xAliasWarning).toBeVisible({ timeout: 15000 });
    }
  );
});
