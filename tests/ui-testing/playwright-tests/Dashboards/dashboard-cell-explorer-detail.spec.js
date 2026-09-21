// E2E — Dashboard Cell Explorer Log Detail (in-place log-detail surface)
// Feature slug: dashboard-cell-explorer-log-detail
//
// Covers the detail view INSIDE the cell-explorer drawer: open detail from a
// result row, back/Escape return, JSON/Table tabs, prev/next push-nav,
// copy-link URL share, surrounding-events window, deep-link restore, and KV
// search. Reuses the same e2e_automate fixture + drillable table panel as
// interactive-dashboard-table.spec.js (drawer-open path), which this spec does
// NOT duplicate.

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
 * Build a drillable table panel, save it, and land on the dashboard VIEW page
 * with the table rendered.
 */
async function buildDrillableTableAndView(page, pm, dashboardName) {
  await setupTablePanelWithDimension(page, pm, dashboardName);
  await pm.dashboardPanelActions.waitForChartToRender();
  await pm.dashboardPanelActions.savePanel();
  await pm.dashboardCellExplorer.waitForTableOnViewPage();
}

/**
 * Drill into the first cell, then open the detail view for the first result.
 */
async function openDetail(pm) {
  await pm.dashboardCellExplorer.openDrawerFromFirstDrillableCell();
  await pm.dashboardCellExplorer.openDetailFromFirstRow();
}

test.describe("Dashboard Cell Explorer Log Detail", { tag: ["@all", "@dashboard", "@dashboard-cell-explorer-log-detail"] }, () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("open detail from a drilled result row renders the detail surface", {
    tag: ["@smoke", "@P0"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildDrillableTableAndView(page, pm, dashboardName);
    await openDetail(pm);

    await pm.dashboardCellExplorer.expectDetailOpen();
    await pm.dashboardCellExplorer.expectAnomalyProfileVisible();
    await pm.dashboardCellExplorer.expectDetailTabsVisible();
    testLogger.info("Detail surface rendered with back header, insights, and tabs");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("back returns to the results list and keeps the drawer open", {
    tag: ["@smoke", "@P0"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildDrillableTableAndView(page, pm, dashboardName);
    await openDetail(pm);

    await pm.dashboardCellExplorer.clickBack();
    await pm.dashboardCellExplorer.expectDetailClosedDrawerOpen();
    testLogger.info("Back returned to the results list without closing the drawer");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("JSON and Table tabs switch and render their content", {
    tag: ["@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildDrillableTableAndView(page, pm, dashboardName);
    await openDetail(pm);

    await pm.dashboardCellExplorer.clickJsonTab();
    await pm.dashboardCellExplorer.expectWrapToggleHidden();

    await pm.dashboardCellExplorer.clickTableTab();
    await pm.dashboardCellExplorer.expectWrapToggleVisible();
    testLogger.info("JSON and Table tabs render content; wrap toggle gated to table tab");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("prev/next steps between events and respects the position bounds", {
    tag: ["@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildDrillableTableAndView(page, pm, dashboardName);
    await openDetail(pm);

    const total = await pm.dashboardCellExplorer.getPositionTotal();
    expect(total).toBeGreaterThanOrEqual(2);

    await pm.dashboardCellExplorer.expectNextEnabled();
    await pm.dashboardCellExplorer.clickNext();
    await pm.dashboardCellExplorer.expectPrevEnabled();
    expect(await pm.dashboardCellExplorer.getPositionCurrent()).toBe(2);

    await pm.dashboardCellExplorer.clickPrev();
    await pm.dashboardCellExplorer.expectPrevDisabled();
    expect(await pm.dashboardCellExplorer.getPositionCurrent()).toBe(1);
    testLogger.info("Prev/next steps between events with correct bound handling");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("copy link exposes a shareable URL with cell_event_ts", {
    tag: ["@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    await buildDrillableTableAndView(page, pm, dashboardName);
    await openDetail(pm);

    await pm.dashboardCellExplorer.expectCellEventTsInUrl();
    await pm.dashboardCellExplorer.expectCopyLinkVisible();
    await pm.dashboardCellExplorer.clickCopyLink();
    await expect
      .poll(() => pm.dashboardCellExplorer.getClipboardText(), { timeout: 10000 })
      .toBe(page.url());
    testLogger.info("Copy link shares a URL carrying cell_event_ts");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("surrounding events section and window dropdown render and re-fetch", {
    tag: ["@functional", "@P1"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildDrillableTableAndView(page, pm, dashboardName);
    await openDetail(pm);

    await pm.dashboardCellExplorer.expectSurroundingSectionVisible();
    await pm.dashboardCellExplorer.changeSurroundWindow("5");
    await pm.dashboardCellExplorer.expectSurroundingResolved();
    testLogger.info("Surrounding events section rendered and re-fetched on window change");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("deep-link reload restores the detail view via cell_event_ts", {
    tag: ["@functional", "@P2"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildDrillableTableAndView(page, pm, dashboardName);
    await openDetail(pm);
    await pm.dashboardCellExplorer.expectCellEventTsInUrl();

    await pm.dashboardCellExplorer.reloadAndWaitForDetail();
    await pm.dashboardCellExplorer.expectDetailOpen();
    testLogger.info("Detail view restored after reload from cell_event_ts URL param");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("Escape returns to the results list without closing the drawer", {
    tag: ["@functional", "@P2"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildDrillableTableAndView(page, pm, dashboardName);
    await openDetail(pm);

    await pm.dashboardCellExplorer.pressEscape();
    await pm.dashboardCellExplorer.expectDetailClosedDrawerOpen();
    testLogger.info("Escape returned to the list while the drawer stayed open");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("Table tab KV search filters the field list", {
    tag: ["@functional", "@P2"],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await buildDrillableTableAndView(page, pm, dashboardName);
    await openDetail(pm);
    await pm.dashboardCellExplorer.clickTableTab();

    await pm.dashboardCellExplorer.expectKvKeyVisible("level");
    await pm.dashboardCellExplorer.fillKvSearch("kubernetes_namespace_name");
    await pm.dashboardCellExplorer.expectKvKeyVisible("kubernetes_namespace_name");
    await pm.dashboardCellExplorer.expectKvKeyHidden("level");
    testLogger.info("KV table search narrows the field list to matching keys");

    await pm.dashboardCellExplorer.closeDrawer();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
