const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import {
  setupTestDashboard,
  cleanupTestDashboard,
} from "./utils/dashCreation.js";
import { generateDashboardName } from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");
const { ensureMetricsIngested } = require("../utils/shared-metrics-setup.js");

test.describe("Dashboard Add Panel Query Type Selector testcases", () => {
  test.describe.configure({ mode: "parallel" });

  // Metrics data is required to reveal the PromQL toggle and fire the auto-select
  // watcher on a fresh panel; established once for the whole run.
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test(
    "fresh panel defaults to SQL + Builder with PromQL absent on a logs stream",
    { tag: ["@dashboard-query-type-selector", "@all", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();

      testLogger.info("Asserting fresh panel defaults: SQL + Builder selected, PromQL absent");

      await pm.queryTypeSelector.expectSqlSelected();
      await pm.queryTypeSelector.expectBuilderSelected();
      await pm.queryTypeSelector.expectPromqlAbsent();
      await pm.queryTypeSelector.expectCustomNotSelected();

      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "selecting the metrics stream type reveals PromQL and auto-selects it on a fresh panel",
    { tag: ["@dashboard-query-type-selector", "@all", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();

      // Fresh panel on a logs stream type: PromQL is not in the DOM.
      await pm.queryTypeSelector.expectSqlSelected();
      await pm.queryTypeSelector.expectPromqlAbsent();

      await pm.chartTypeSelector.selectStreamType("metrics");

      testLogger.info("Asserting PromQL is revealed and auto-selected with no confirmation dialog");

      await pm.queryTypeSelector.expectPromqlVisible();
      await pm.queryTypeSelector.expectPromqlSelected();
      await pm.queryTypeSelector.expectSqlNotSelected();
      await pm.queryTypeSelector.expectConfirmDialogHidden();

      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "Builder to Custom switches immediately with no dialog and mounts the query editor",
    { tag: ["@dashboard-query-type-selector", "@all", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();

      await pm.queryTypeSelector.switchToCustom();

      testLogger.info("Asserting Builder to Custom is immediate and mounts the editor");

      await pm.queryTypeSelector.expectCustomSelected();
      await pm.queryTypeSelector.expectBuilderNotSelected();
      await pm.queryTypeSelector.expectConfirmDialogHidden();
      await pm.queryTypeSelector.expectQueryEditorVisible();

      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "Custom to Builder with a written query prompts; Cancel preserves, OK commits",
    { tag: ["@dashboard-query-type-selector", "@all", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();
      const sqlQuery = "SELECT * FROM e2e_automate";

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();

      await pm.queryTypeSelector.switchToCustom();
      await pm.queryTypeSelector.writeCustomQuery(sqlQuery);

      // Custom -> Builder with a non-empty query must open the confirmation dialog.
      await pm.queryTypeSelector.switchToBuilder();
      await pm.queryTypeSelector.expectConfirmDialogVisible();

      // Cancel keeps Custom mode and the written query intact.
      await pm.queryTypeSelector.confirmCancel();
      await pm.queryTypeSelector.expectConfirmDialogHidden();
      await pm.queryTypeSelector.expectCustomSelected();
      expect(await pm.queryTypeSelector.getQueryEditorValue()).toBe(sqlQuery);

      // OK commits the Builder mode.
      await pm.queryTypeSelector.switchToBuilder();
      await pm.queryTypeSelector.confirmOk();
      await pm.queryTypeSelector.expectBuilderSelected();
      await pm.queryTypeSelector.expectCustomNotSelected();

      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "Custom to Builder with an empty query switches immediately with no dialog",
    { tag: ["@dashboard-query-type-selector", "@all", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();

      await pm.queryTypeSelector.switchToCustom();
      await pm.queryTypeSelector.switchToBuilder();

      testLogger.info("Asserting Custom to Builder with an empty query skips the dialog");

      await pm.queryTypeSelector.expectBuilderSelected();
      await pm.queryTypeSelector.expectCustomNotSelected();
      await pm.queryTypeSelector.expectConfirmDialogHidden();

      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "switching PromQL custom back to SQL clears the query with no dialog",
    { tag: ["@dashboard-query-type-selector", "@all", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();

      // Reveal PromQL (auto-selected on a metrics stream type) then write a custom query.
      await pm.chartTypeSelector.selectStreamType("metrics");
      await pm.queryTypeSelector.expectPromqlVisible();
      await pm.queryTypeSelector.expectPromqlSelected();
      await pm.queryTypeSelector.switchToCustom();
      await pm.queryTypeSelector.writeCustomQuery("cpu_usage{}");

      testLogger.info("Asserting the SQL <-> PromQL switch is destructive and never prompts");

      await pm.queryTypeSelector.switchToSql();
      await pm.queryTypeSelector.expectSqlSelected();
      await pm.queryTypeSelector.expectPromqlNotSelected();
      await pm.queryTypeSelector.expectConfirmDialogHidden();

      // The custom PromQL query is cleared by the query-type switch.
      await expect
        .poll(async () => await pm.queryTypeSelector.getQueryEditorValue(), { timeout: 10000 })
        .toBe("");

      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );
});
