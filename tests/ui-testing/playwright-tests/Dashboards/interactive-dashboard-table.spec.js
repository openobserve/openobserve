// E2E — Interactive Dashboard Table ("explore cell in logs" drilldown drawer)
// Feature branch: feature/interactive-dashboard-table
//
// Covers the core drilldown path: a table panel built with a plain group-by
// dimension column exposes a per-cell search icon; clicking it opens the
// cell-explorer drawer (DashboardLogDrawer) scoped to `field = value`, syncs
// cell_* params to the URL, and closing it cleans those params up.

const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupTablePanelWithDimension,
} from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

/**
 * Build a table panel with a drillable dimension column, save it, and land on
 * the dashboard VIEW page with the table rendered.
 */
async function buildTableAndView(page, pm, dashboardName) {
  await setupTablePanelWithDimension(page, pm, dashboardName);
  await pm.dashboardPanelActions.waitForChartToRender();
  await pm.dashboardPanelActions.savePanel();
  await pm.dashboardCellExplorer.waitForTableOnViewPage();
}

test.describe("Interactive Dashboard Table — cell drilldown", { tag: ["@all", "@dashboard", "@interactiveTable"] }, () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("table cell exposes a drilldown search icon", {
    tag: ["@smoke", "@P0"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildTableAndView(page, pm, dashboardName);

    await pm.dashboardCellExplorer.expectDrillableCellVisible();
    expect(await pm.dashboardCellExplorer.hasDrillableCell()).toBe(true);
    testLogger.info("Drillable cell search icon present");

    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("clicking the cell drilldown icon opens the log explorer drawer with results", {
    tag: ["@smoke", "@P0"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildTableAndView(page, pm, dashboardName);

    await pm.dashboardCellExplorer.openDrawerFromFirstDrillableCell();
    await expect(pm.dashboardCellExplorer.resultsTable).toBeVisible();
    testLogger.info("Cell-explorer drawer opened with results table");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("cell drilldown syncs cell_* params to the URL", {
    tag: ["@functional", "@P0"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildTableAndView(page, pm, dashboardName);

    await pm.dashboardCellExplorer.openDrawerFromFirstDrillableCell();
    await pm.dashboardCellExplorer.expectCellParamsInUrl();
    testLogger.info("cell_* params synced to URL");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("SQL toggle reveals the editor and Run re-executes the query", {
    tag: ["@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildTableAndView(page, pm, dashboardName);

    await pm.dashboardCellExplorer.openDrawerFromFirstDrillableCell();
    await pm.dashboardCellExplorer.toggleSql();
    await pm.dashboardCellExplorer.runQuery();
    testLogger.info("SQL editor toggled and query re-run");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("Open in Logs control is available in the drawer", {
    tag: ["@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildTableAndView(page, pm, dashboardName);

    await pm.dashboardCellExplorer.openDrawerFromFirstDrillableCell();
    await expect(pm.dashboardCellExplorer.openInLogsButton).toBeVisible();
    testLogger.info("Open in Logs control visible");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("editable time range control is present in the drawer", {
    tag: ["@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildTableAndView(page, pm, dashboardName);

    await pm.dashboardCellExplorer.openDrawerFromFirstDrillableCell();
    await expect(pm.dashboardCellExplorer.dateTime).toBeVisible();
    testLogger.info("Drawer time-range control visible");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("closing the drawer removes all cell_* URL params", {
    tag: ["@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildTableAndView(page, pm, dashboardName);

    await pm.dashboardCellExplorer.openDrawerFromFirstDrillableCell();
    await pm.dashboardCellExplorer.expectCellParamsInUrl();

    await pm.dashboardCellExplorer.closeDrawer();
    await pm.dashboardCellExplorer.expectNoCellParamsInUrl();
    testLogger.info("cell_* params cleaned up on drawer close");

    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
