// Copyright 2026 OpenObserve Inc.

// Enrichment rows carry their upload time, so a panel must show them on any dashboard range (#15875).

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import PageManager from "../../pages/page-manager";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import { generateDashboardName } from "./utils/configPanelHelpers.js";
import {
  addEnrichmentPanel,
  deleteEnrichmentTable,
  expectFirstColumn,
  expectPlottedCount,
  openOnLastWeek,
  uploadEnrichmentTable,
  waitForRowCount,
} from "./utils/enrichmentTableHelpers.js";

const INITIAL_CSV = "country,city,population\nIndia,Bengaluru,13\nUSA,Austin,1\nGermany,Berlin,4";
const REPLACED_CSV = "country,city,population\nJapan,Tokyo,14\nBrazil,Recife,2";

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard panel on an enrichment table", () => {
  let tableName;

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    tableName = `e2e_enrich_panel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await uploadEnrichmentTable(page, tableName, INITIAL_CSV);
    await waitForRowCount(page, tableName, 3);
  });

  test.afterEach(async ({ page }) => {
    await deleteEnrichmentTable(page, tableName);
  });

  test(
    "TC-ENR-001: builder table panel shows every row and keeps them on a range before the upload",
    { tag: ["@dashboard-enrichment-table", "@smoke", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await addEnrichmentPanel(page, pm, dashboardName, tableName, "table");
      await pm.chartTypeSelector.removeField("x_axis_1", "x");
      await pm.chartTypeSelector.searchAndAddField("country", "x");
      await pm.dashboardPanelActions.addPanelName("Countries");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);
      await expectFirstColumn(page, ["Germany", "India", "USA"]);

      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);

      await openOnLastWeek(page, tableName);
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);
      await expectFirstColumn(page, ["Germany", "India", "USA"]);
      testLogger.info("Enrichment table panel renders on a range before the upload");

      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "TC-ENR-002: custom SQL panel on an enrichment table",
    { tag: ["@dashboard-enrichment-table", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await addEnrichmentPanel(page, pm, dashboardName, tableName, "table");
      await pm.chartTypeSelector.setCustomSQL(
        `SELECT city AS x_axis_1, count(_timestamp) AS y_axis_1 FROM "${tableName}" GROUP BY x_axis_1`,
      );
      await pm.chartTypeSelector.waitForCustomQueryAxes("x_axis_1", "y_axis_1");
      await pm.dashboardPanelActions.addPanelName("Cities");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);
      await expectFirstColumn(page, ["Austin", "Bengaluru", "Berlin"]);

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "TC-ENR-003: builder bar chart with the default fields renders, also on a range before the upload",
    { tag: ["@dashboard-enrichment-table", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await addEnrichmentPanel(page, pm, dashboardName, tableName, "bar");
      await pm.dashboardPanelActions.addPanelName("Uploads");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.verifyChartRenders(expect);
      await expect(pm.dashboardPanelActions.getNoDataLocator()).toBeHidden({ timeout: 30000 });
      await pm.dashboardPanelActions.verifyChartHasData(expect);
      await expectPlottedCount(pm, 3);

      await pm.dashboardPanelActions.savePanel();
      await openOnLastWeek(page, tableName);
      await pm.dashboardPanelActions.verifyChartRenders(expect);
      await expectPlottedCount(pm, 3);

      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );

  test(
    "TC-ENR-004: re-uploading the table replaces the rows the panel shows",
    { tag: ["@dashboard-enrichment-table", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await addEnrichmentPanel(page, pm, dashboardName, tableName, "table");
      await pm.chartTypeSelector.removeField("x_axis_1", "x");
      await pm.chartTypeSelector.searchAndAddField("country", "x");
      await pm.dashboardPanelActions.addPanelName("Countries");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);
      await expectFirstColumn(page, ["Germany", "India", "USA"]);

      await uploadEnrichmentTable(page, tableName, REPLACED_CSV);
      await waitForRowCount(page, tableName, 2);
      await pm.dashboardAutoRun.clickRefresh();
      await pm.dashboardPanelActions.waitForTablePanelWithData(30000);
      await expectFirstColumn(page, ["Brazil", "Japan"]);

      await cleanupTestDashboard(page, pm, dashboardName);
    },
  );
});
