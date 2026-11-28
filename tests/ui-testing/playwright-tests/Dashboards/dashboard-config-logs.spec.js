const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import {
  ingestion,
  ingestionForLogsPanel,
  LOGS_PANEL_STREAM as STREAM,
  LOGS_PANEL_XSS_SEQS,
  LOGS_PANEL_LONG_SEQ,
  logsPanelStarterSql,
  logsPanelRowsSql,
  logsPanelSeqSql,
  logsPanelNoRowsSql,
  logsPanelInvalidSql,
  logsPanelMessages,
} from "./utils/dashIngestion.js";
import { cleanupTestDashboard, setupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  reopenPanelConfig,
  discardAndCleanupTestDashboard,
  setupLogsPanelWithConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");

// Feature: Logs panel type (PR #15927), a log list from custom SQL with field, order, time, wrap and JSON options.
// Known open bugs are tracked in #17298.

const STARTER_SQL = logsPanelStarterSql();

// Option labels (en-US) and the OSelect value of an option left on Default.
const DEFAULT_CHOICE = "__default__";
const ORDER_LABELS = ["Default (Newest first)", "Newest first", "Oldest first"];
const FIELD_PLACEHOLDER = "Default (auto from data)";
// Header of the time column, e.g. "timestamp (Asia/Calcutta)".
const TIME_HEADER = /^timestamp \(.+\)$/i;
// Same format the Logs page shows times in.
const TIME_CELL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;

// Severity rail per ingested level; the rail names warn "warning".
const RAIL_BY_LEVEL = { info: "info", warn: "warning", error: "error", debug: "debug" };
const RAIL_BY_LVL = { err: "error", warn: "warning" };

test.describe.configure({ mode: "parallel" });

test.describe("ConfigPanel — Logs Panel Settings", () => {
  let run;

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    run = await ingestionForLogsPanel(page, STREAM);
  });

  test(
    "starter: Logs seeds a newest-first query, finds the time and message columns, starts every option on Default, and keeps the defaults after save",
    { tag: ["@dashboards", "@logsPanelConfig", "@P0", "@smoke"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const logsPanel = pm.dashboardLogsPanel;
      const dashboardName = generateDashboardName();

      await setupLogsPanelWithConfig(page, pm, dashboardName, { streamName: STREAM });
      await pm.chartTypeSelector.expectChartTypeSelected("logs");
      await logsPanel.waitForRows();
      await expect(pm.dashboardPanelActions.dashboardErrorItems).toHaveCount(0);

      // No field is configured, so the columns come from the data: the stream's _timestamp and its message column.
      const headers = await logsPanel.getHeaderLabels();
      expect(headers).toHaveLength(2);
      expect(headers[0]).toMatch(TIME_HEADER);
      expect(headers[1]).toBe("message");

      // Newest first: the rendered times never increase down the list.
      const times = (await logsPanel.getRenderedRows()).map((row) => row.cells._timestamp);
      times.forEach((time) => expect(time).toMatch(TIME_CELL));
      expect(times).toEqual([...times].sort().reverse());

      const expectDefaults = async () => {
        for (const field of ["message", "level", "time"]) {
          await configs.expectLogsField(field, "");
          await expect(configs.logsFieldInput(field)).toHaveAttribute("placeholder", FIELD_PLACEHOLDER);
        }
        await configs.expectConfigSelectValue(configs.logsOrderTrigger, DEFAULT_CHOICE);
        await configs.expectConfigToggle(configs.logsShowTime, true);
        await configs.expectConfigToggle(configs.logsWrap, false);
        await configs.expectConfigToggle(configs.logsPrettifyJson, true);
      };
      await expectDefaults();
      expect(await configs.getLogsOrderOptionLabels()).toEqual(ORDER_LABELS);

      await pm.dashboardPanelActions.savePanel();
      testLogger.info("Verifying the Logs panel and its defaults persist after save");
      await reopenPanelConfig(page, pm);
      await pm.chartTypeSelector.expectQueryEditorText(STARTER_SQL);
      await expectDefaults();
      await logsPanel.waitForRows();
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "rows: shows exactly the query's rows, newest first, with a severity rail per level",
    { tag: ["@dashboards", "@logsPanelConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logsPanel = pm.dashboardLogsPanel;
      const dashboardName = generateDashboardName();

      await setupLogsPanelWithConfig(page, pm, dashboardName, { streamName: STREAM, sql: logsPanelRowsSql(run.runId, { limit: 8 }) });
      await logsPanel.waitForRows(8);
      await logsPanel.scrollToTop();

      const rows = await logsPanel.getRenderedRows();
      expect(rows.map((row) => row.cells.message)).toEqual(logsPanelMessages(0, 7));

      // Rows are one second apart, newest first.
      const seconds = rows.map((row) => Number(row.cells._timestamp.slice(17, 19)));
      seconds.slice(1).forEach((second, i) => expect((seconds[i] - second + 60) % 60).toBe(1));

      // Levels cycle info, warn, error, debug from row 0.
      for (const seq of [0, 1, 2, 3]) {
        const level = ["info", "warn", "error", "debug"][seq];
        expect(await logsPanel.getRailLevel(`logs-panel row ${seq}`)).toBe(RAIL_BY_LEVEL[level]);
      }

      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );

  test(
    "order: Oldest first rewrites an untouched starter, re-sorts an edited query without touching its SQL, persists, and Default resets it",
    { tag: ["@dashboards", "@logsPanelConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const selector = pm.chartTypeSelector;
      const logsPanel = pm.dashboardLogsPanel;
      const dashboardName = generateDashboardName();

      await setupLogsPanelWithConfig(page, pm, dashboardName, { streamName: STREAM });

      // The starter fetches newest rows; reversing those would never show the oldest, so its ORDER BY is rewritten.
      await configs.selectLogsOrder("Oldest first");
      await selector.expectQueryEditorText(logsPanelStarterSql(STREAM, "ASC"));
      await configs.selectLogsOrder(ORDER_LABELS[0]);
      await selector.expectQueryEditorText(STARTER_SQL);

      // A query the user wrote keeps its SQL; the order only sorts the rows it returns.
      const editedSql = logsPanelRowsSql(run.runId, { limit: 5 });
      await selector.enterCustomSQL(editedSql);
      await pm.dashboardPanelActions.applyAndWaitForSqlQuery();
      await logsPanel.waitForRows(5);
      await expect.poll(() => logsPanel.getMessages()).toEqual(logsPanelMessages(0, 4));

      await configs.selectLogsOrder("Oldest first");
      await configs.expectConfigSelectValue(configs.logsOrderTrigger, "oldest");
      await expect.poll(() => logsPanel.getMessages()).toEqual(logsPanelMessages(4, 0));
      await selector.expectQueryEditorText(editedSql);

      await pm.dashboardPanelActions.savePanel();
      testLogger.info("Verifying Order = Oldest first persists after save");
      await reopenPanelConfig(page, pm);
      await configs.expectConfigSelectValue(configs.logsOrderTrigger, "oldest");
      await logsPanel.waitForRows(5);
      await expect.poll(() => logsPanel.getMessages()).toEqual(logsPanelMessages(4, 0));

      await configs.selectLogsOrder(ORDER_LABELS[0]);
      await configs.expectConfigSelectValue(configs.logsOrderTrigger, DEFAULT_CHOICE);
      await expect.poll(() => logsPanel.getMessages()).toEqual(logsPanelMessages(0, 4));
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "fields: message, level and time pickers drive the columns and rail, Show time off drops the time column, and all persist and clear back to Default",
    { tag: ["@dashboards", "@logsPanelConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const actions = pm.dashboardPanelActions;
      const logsPanel = pm.dashboardLogsPanel;
      const dashboardName = generateDashboardName();
      const seqs = [0, 1, 2, 3, 4, 5];

      await setupLogsPanelWithConfig(page, pm, dashboardName, { streamName: STREAM, sql: logsPanelRowsSql(run.runId, { limit: 6 }) });
      await logsPanel.waitForRows(6);
      await logsPanel.scrollToTop();
      const autoTimes = (await logsPanel.getRenderedRows()).map((row) => row.cells._timestamp);

      await configs.setLogsField("message", "svc");
      await configs.setLogsField("level", "lvl");
      await configs.setLogsField("time", "ts_ms");
      await actions.applyAndWaitForSqlQuery();

      const expectOverrides = async () => {
        await expect.poll(() => logsPanel.getHeaderLabels()).toEqual([expect.stringMatching(TIME_HEADER), "svc"]);
        await logsPanel.scrollToTop();
        const rows = await logsPanel.getRenderedRows();
        expect(rows.map((row) => row.cells.svc)).toEqual(seqs.map((seq) => `svc-${seq % 3}`));
        // ts_ms holds the same instant as _timestamp, so the shown times are identical.
        expect(rows.map((row) => row.cells.ts_ms)).toEqual(autoTimes);
        for (const seq of [0, 1]) {
          expect(await logsPanel.getRailLevel(`svc-${seq % 3}`)).toBe(RAIL_BY_LVL[seq % 2 === 0 ? "err" : "warn"]);
        }
      };
      await expectOverrides();

      await configs.setConfigToggle(configs.logsShowTime, false);
      await actions.applyAndWaitForSqlQuery();
      await expect.poll(() => logsPanel.getHeaderLabels()).toEqual(["svc"]);

      await actions.savePanel();
      testLogger.info("Verifying field overrides and Show time persist after save");
      await reopenPanelConfig(page, pm);
      await configs.expectLogsField("message", "svc");
      await configs.expectLogsField("level", "lvl");
      await configs.expectLogsField("time", "ts_ms");
      await configs.expectConfigToggle(configs.logsShowTime, false);
      await logsPanel.waitForRows(6);
      await expect.poll(() => logsPanel.getHeaderLabels()).toEqual(["svc"]);

      await configs.setConfigToggle(configs.logsShowTime, true);
      await actions.applyAndWaitForSqlQuery();
      await expectOverrides();

      // Clearing a picker hands the column back to auto-detection.
      for (const field of ["message", "level", "time"]) await configs.setLogsField(field, "");
      await actions.applyAndWaitForSqlQuery();
      await expect.poll(() => logsPanel.getHeaderLabels()).toEqual([expect.stringMatching(TIME_HEADER), "message"]);
      await actions.savePanel();

      await reopenPanelConfig(page, pm);
      for (const field of ["message", "level", "time"]) await configs.expectLogsField(field, "");
      await configs.expectConfigToggle(configs.logsShowTime, true);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "rows open in place: the JSON preview hides _o2_id, Prettify JSON off shows the raw row, and Wrap lines grows a long line; both persist",
    { tag: ["@dashboards", "@logsPanelConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const actions = pm.dashboardPanelActions;
      const logsPanel = pm.dashboardLogsPanel;
      const dashboardName = generateDashboardName();
      // Row 0 and the 2,000-character line.
      const sql = logsPanelSeqSql(run.runId, [0, LOGS_PANEL_LONG_SEQ]);

      await setupLogsPanelWithConfig(page, pm, dashboardName, { streamName: STREAM, sql });
      await logsPanel.waitForRows(2);

      // Prettify JSON (default): the Logs page's JSON preview with its copy button, without the internal _o2_id.
      await logsPanel.openRow("logs-panel row 0");
      await expect(logsPanel.jsonPreviews).toHaveCount(1);
      const [pretty] = await logsPanel.getExpandedJsonTexts();
      expect(pretty).toContain("logs-panel row 0");
      expect(pretty).toContain(run.runId);
      expect(pretty).not.toContain("_o2_id");
      await expect(logsPanel.jsonCopyButton).toBeVisible();
      await logsPanel.closeRow("logs-panel row 0");
      await expect(logsPanel.jsonPreviews).toHaveCount(0);

      await configs.setConfigToggle(configs.logsPrettifyJson, false);
      await actions.applyAndWaitForSqlQuery();
      await logsPanel.openRow("logs-panel row 0");
      await expect(logsPanel.jsonPreviews).toHaveCount(1);
      expect((await logsPanel.getExpandedJsonTexts())[0]).toContain('"message":"logs-panel row 0"');
      await expect(logsPanel.jsonCopyButton).toHaveCount(0);
      await logsPanel.closeRow("logs-panel row 0");

      const unwrapped = await logsPanel.getRowHeight("LONG");
      await configs.setConfigToggle(configs.logsWrap, true);
      await actions.applyAndWaitForSqlQuery();
      await expect.poll(() => logsPanel.getRowHeight("LONG")).toBeGreaterThan(unwrapped * 3);

      await actions.savePanel();
      testLogger.info("Verifying Wrap lines and Prettify JSON persist after save");
      await reopenPanelConfig(page, pm);
      await configs.expectConfigToggle(configs.logsWrap, true);
      await configs.expectConfigToggle(configs.logsPrettifyJson, false);
      await logsPanel.waitForRows(2);
      await expect.poll(() => logsPanel.getRowHeight("LONG")).toBeGreaterThan(unwrapped * 3);
      await actions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "security: HTML in log lines stays text in the cells and in both JSON views, and never runs",
    { tag: ["@dashboards", "@logsPanelConfig", "@P1", "@security"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const logsPanel = pm.dashboardLogsPanel;
      const dashboardName = generateDashboardName();
      const payloads = ["XSS-IMG", "XSS-SVG", "XSS-SCRIPT"];
      const sql = logsPanelSeqSql(run.runId, LOGS_PANEL_XSS_SEQS);

      await setupLogsPanelWithConfig(page, pm, dashboardName, { streamName: STREAM, sql });
      await logsPanel.waitForRows(3);

      const messages = await logsPanel.getMessages();
      expect(messages).toEqual(
        expect.arrayContaining([
          '<img src=x onerror="window.__lpXss=1">XSS-IMG',
          '"><svg onload="window.__lpXss=2">XSS-SVG',
          "<script>window.__lpXss=3</script>XSS-SCRIPT",
        ])
      );
      expect(await logsPanel.countInjectedElements()).toBe(0);

      for (const prettify of [true, false]) {
        await configs.setConfigToggle(configs.logsPrettifyJson, prettify);
        await pm.dashboardPanelActions.applyAndWaitForSqlQuery();
        // One row at a time: an open preview is taller than this list, so opening several reflows the rows under the pointer.
        for (const payload of payloads) {
          await logsPanel.openRow(payload);
          await expect(logsPanel.jsonPreviews).toHaveCount(1);
          expect((await logsPanel.getExpandedJsonTexts())[0]).toContain(payload);
          expect(await logsPanel.countInjectedElements()).toBe(0);
          await logsPanel.closeRow(payload);
          await expect(logsPanel.jsonPreviews).toHaveCount(0);
        }
      }
      testLogger.info("XSS payloads stayed text in cells, JSON preview and raw JSON");
      expect(await page.evaluate(() => window.__lpXss)).toBeUndefined();

      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );

  test(
    "switching type: Logs to Table keeps the typed SQL and hides the Logs options; back to Logs restores them",
    { tag: ["@dashboards", "@logsPanelConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const configs = pm.dashboardPanelConfigs;
      const selector = pm.chartTypeSelector;
      const logsPanel = pm.dashboardLogsPanel;
      const dashboardName = generateDashboardName();
      const sql = logsPanelRowsSql(run.runId, { limit: 4 });

      await setupLogsPanelWithConfig(page, pm, dashboardName, { streamName: STREAM, sql });
      await logsPanel.waitForRows(4);
      await configs.setLogsField("message", "svc");
      await configs.setConfigToggle(configs.logsWrap, true);

      await selector.selectChartType("table");
      await configs.expandAllConfigSections();
      await expect(configs.logsOrder).toHaveCount(0);
      await expect(configs.logsWrap).toHaveCount(0);
      await selector.expectQueryEditorText(sql);

      await selector.selectChartType("logs");
      await configs.expandAllConfigSections();
      await configs.expectLogsField("message", "svc");
      await configs.expectConfigToggle(configs.logsWrap, true);
      await selector.expectQueryEditorText(sql);
      await pm.dashboardPanelActions.applyAndWaitForSqlQuery();
      await logsPanel.waitForRows(4);
      await expect.poll(() => logsPanel.getHeaderLabels()).toEqual([expect.stringMatching(TIME_HEADER), "svc"]);

      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );

  test(
    "empty and invalid: no rows shows No Data, and invalid SQL shows the parser error until the query is fixed",
    { tag: ["@dashboards", "@logsPanelConfig", "@P2"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const selector = pm.chartTypeSelector;
      const actions = pm.dashboardPanelActions;
      const logsPanel = pm.dashboardLogsPanel;
      const dashboardName = generateDashboardName();

      await setupLogsPanelWithConfig(page, pm, dashboardName, {
        streamName: STREAM,
        sql: logsPanelNoRowsSql(),
      });
      await expect(logsPanel.noData.first()).toBeVisible({ timeout: 30000 });
      await expect(logsPanel.table).toHaveCount(0);

      await selector.enterCustomSQL(logsPanelInvalidSql());
      await actions.applyAndWaitForSqlQuery();
      await expect(actions.dashboardErrorItems.first()).toContainText("ParserError", { timeout: 30000 });

      await selector.enterCustomSQL(logsPanelRowsSql(run.runId, { limit: 3 }));
      await actions.applyAndWaitForSqlQuery();
      await logsPanel.waitForRows(3);
      await expect(actions.dashboardErrorItems).toHaveCount(0);

      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );

  // #17298 item 1: the virtual list lands at its bottom on first render, hiding the newest rows.
  test.fixme(
    "opens at the top: a saved Logs panel with more rows than fit starts at its first (newest) row (#17298)",
    { tag: ["@dashboards", "@logsPanelConfig", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const logsPanel = pm.dashboardLogsPanel;
      const dashboardName = generateDashboardName();

      await setupLogsPanelWithConfig(page, pm, dashboardName, { streamName: STREAM, sql: logsPanelRowsSql(run.runId, { limit: 30 }) });
      await pm.dashboardPanelActions.savePanel();
      await page.reload();
      await logsPanel.waitForRows();
      await expect.poll(async () => (await logsPanel.getScrollState()).scrollTop).toBe(0);
      expect((await logsPanel.getMessages())[0]).toBe("logs-panel row 0");
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // #17298 item 2: the starter is only seeded when the chart type changes, not when the stream does.
  test.fixme(
    "stream change: picking another stream after Logs rewrites the untouched starter for that stream (#17298)",
    { tag: ["@dashboards", "@logsPanelConfig", "@P2"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const selector = pm.chartTypeSelector;
      const dashboardName = generateDashboardName();

      await ingestion(page);
      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await selector.selectStreamType("logs");
      await selector.selectStream("e2e_automate");
      await selector.selectChartType("logs");
      await selector.expectQueryEditorText(logsPanelStarterSql("e2e_automate"));
      await selector.selectStream(STREAM);
      await selector.expectQueryEditorText(STARTER_SQL);
      expect(await selector.getQueryEditorText()).not.toContain("e2e_automate");
      await discardAndCleanupTestDashboard(page, dashboardName);
    }
  );
});
