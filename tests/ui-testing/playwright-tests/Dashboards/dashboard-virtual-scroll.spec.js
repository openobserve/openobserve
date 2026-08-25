import {
  test,
  expect,
  navigateToBase,
} from "../utils/enhanced-baseFixtures.js";
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard, setupTestDashboard } from "./utils/dashCreation.js";
import { generateDashboardName } from "./utils/configPanelHelpers.js";
import testLogger from "../utils/test-logger.js";
import {
  getRenderedRowIndexes,
  getSpacerRowCount,
  scrollTableTo,
  readTotalRowCount,
  waitForWindowMinIndexToExceed,
  isRowsPerPageLabelVisible,
} from "../../pages/dashboardPages/dashboard-table-helpers.js";

/**
 * Dashboard Table Virtual Scroll Row Windowing
 *
 * Dashboard table panels render through TenstackTable with use-virtual-scroll=false,
 * which enables "dashboard virtual scroll": only the rows visible in the scroll
 * viewport (plus ~20 overscan) are rendered into the DOM, with top/bottom spacer
 * rows (<tr aria-hidden="true">) reserving the full scroll height. Scrolling slides
 * the window; enabling Wrap cells or Pagination disables this path.
 *
 * This spec verifies (all WIRED):
 * 1. A large dataset renders only a bounded window of DOM rows, not the full set.
 * 2. Scrolling slides the render window (data-index advances toward the tail).
 * 3. Wrap cells and Pagination bypass virtual scroll (no spacers; unbounded/paged rows).
 * 4. A small dataset (< viewport) renders fully with no spacer rows.
 */

/**
 * Build a large-row table panel via Custom SQL `SELECT * FROM "e2e_automate"`
 * (~3848 rows) so the panel returns more rows than fit the viewport and dashboard
 * virtual scroll is exercised. Wrap and pagination are left at their defaults (OFF)
 * so dashVirtualEnabled === true.
 */
async function buildLargeTablePanel(page, pm, dashboardName, panelName = "Virtual Scroll Table") {
  await setupTestDashboard(page, pm, dashboardName);
  await pm.dashboardCreate.addPanel();
  await pm.dashboardPanelActions.addPanelName(panelName);
  await pm.chartTypeSelector.selectChartType("table");
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream("e2e_automate");
  await pm.chartTypeSelector.switchToCustomSQLMode();
  await pm.chartTypeSelector.enterCustomSQL('SELECT * FROM "e2e_automate"');
  await pm.chartTypeSelector.searchAndAddField("log", "y");
  await pm.dashboardPanelActions.applyDashboardBtn();
  await pm.dashboardPanelActions.waitForChartToRender();
  await pm.chartTypeSelector.waitForTableDataLoad();
}

test.describe("Dashboard Table Virtual Scroll Row Windowing", () => {
  test.describe.configure({ mode: "parallel", retries: 1 });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    pm = new PageManager(page);
    testLogger.info("Test setup completed");
  });

  // ===== P0 — Bounded window + scrolling =====

  test(
    "should render a bounded window of rows with spacer rows for a large dataset",
    { tag: ["@dashboard-table-virtual-windowing", "@tableChart", "@all", "@P0"] },
    async ({ page }) => {
      const dashboardName = generateDashboardName();
      await buildLargeTablePanel(page, pm, dashboardName);

      const indexes = await getRenderedRowIndexes(page);
      const spacers = await getSpacerRowCount(page);
      const total = await readTotalRowCount(page);

      testLogger.info("Virtual-scroll window read", {
        rendered: indexes.length,
        spacers,
        total,
        firstIndex: indexes[0],
        lastIndex: indexes[indexes.length - 1],
      });

      // Bounded window: viewport + overscan (~40-60), never the full dataset
      expect(indexes.length).toBeGreaterThan(0);
      expect(indexes.length).toBeLessThanOrEqual(100);
      expect(total).toBeGreaterThan(100);
      expect(indexes.length).toBeLessThan(total);

      // Contiguous ascending window starting at index 0 (initial scroll position)
      expect(indexes[0]).toBe(0);
      for (let i = 1; i < indexes.length; i++) {
        expect(indexes[i]).toBe(indexes[i - 1] + 1);
      }

      // Spacer rows reserve the scroll height (3848 >> viewport)
      expect(spacers).toBeGreaterThanOrEqual(1);

      testLogger.info("Test completed");
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "should slide the render window toward the tail when scrolling to the bottom",
    { tag: ["@dashboard-table-virtual-windowing", "@tableChart", "@all", "@P0"] },
    async ({ page }) => {
      const dashboardName = generateDashboardName();
      await buildLargeTablePanel(page, pm, dashboardName);

      const topIndexes = await getRenderedRowIndexes(page);
      expect(topIndexes.length).toBeGreaterThan(0);
      const minTop = Math.min(...topIndexes);

      await scrollTableTo(page, "bottom");
      await waitForWindowMinIndexToExceed(page, minTop);

      const bottomIndexes = await getRenderedRowIndexes(page);
      const total = await readTotalRowCount(page);
      const minBottom = Math.min(...bottomIndexes);
      const maxBottom = Math.max(...bottomIndexes);
      const spacers = await getSpacerRowCount(page);

      testLogger.info("Scroll window advanced", {
        minTop,
        minBottom,
        maxBottom,
        total,
        spacers,
      });

      // Top row left the window; window slid down
      expect(minBottom).toBeGreaterThan(minTop);
      // Window reaches the tail of the dataset
      expect(maxBottom).toBeGreaterThanOrEqual(total - 100);
      // Top spacer present while scrolled away from the top
      expect(spacers).toBeGreaterThanOrEqual(1);

      testLogger.info("Test completed");
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Fallback paths (wrap / pagination disable virtual scroll) =====

  test(
    "should disable virtual scroll when wrap cells is enabled (no spacers, unbounded rows)",
    { tag: ["@dashboard-table-virtual-windowing", "@tableChart", "@all", "@P1"] },
    async ({ page }) => {
      const dashboardName = generateDashboardName();
      await buildLargeTablePanel(page, pm, dashboardName);

      await pm.dashboardPanelConfigs.openConfigPanel();
      await pm.dashboardPanelConfigs.selectWrapCell();
      // Guard: confirm the toggle actually took effect before asserting the effect
      expect(await pm.dashboardPanelConfigs.isWrapCellEnabled()).toBe(true);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.chartTypeSelector.waitForTableDataLoad();

      const spacers = await getSpacerRowCount(page);
      const indexes = await getRenderedRowIndexes(page);

      testLogger.info("Wrap cells bypasses virtual scroll", {
        spacers,
        rendered: indexes.length,
      });

      expect(spacers).toBe(0);
      // Unbounded rows: well beyond the ~40-60 window (wrap renders all rows)
      expect(indexes.length).toBeGreaterThan(100);

      testLogger.info("Test completed");
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "should disable virtual scroll when pagination is enabled (paged rows, no spacers)",
    { tag: ["@dashboard-table-virtual-windowing", "@tableChart", "@all", "@P1"] },
    async ({ page }) => {
      const dashboardName = generateDashboardName();
      await buildLargeTablePanel(page, pm, dashboardName);

      await pm.dashboardPanelConfigs.openConfigPanel();
      await pm.dashboardPanelConfigs.selectShowPagination();
      // Guard: confirm the toggle took effect before setting rows-per-page
      expect(await pm.dashboardPanelConfigs.isShowPaginationEnabled()).toBe(true);
      await pm.dashboardPanelConfigs.setRowsPerPage(10);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.chartTypeSelector.waitForTableDataLoad();

      const spacers = await getSpacerRowCount(page);
      const indexes = await getRenderedRowIndexes(page);

      testLogger.info("Pagination bypasses virtual scroll", {
        spacers,
        rendered: indexes.length,
      });

      // Exactly rowsPerPage DOM rows, no spacers
      expect(indexes.length).toBe(10);
      expect(spacers).toBe(0);
      // Pagination footer is active (Records per page label only shows when paged)
      expect(await isRowsPerPageLabelVisible(page)).toBe(true);

      testLogger.info("Test completed");
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P2 — Small dataset renders fully =====

  test(
    "should render all rows with no spacers for a small dataset that fits the viewport",
    { tag: ["@dashboard-table-virtual-windowing", "@tableChart", "@all", "@P2"] },
    async ({ page }) => {
      const dashboardName = generateDashboardName();
      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Small Dataset Table");
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
      await pm.chartTypeSelector.searchAndAddField("code", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.chartTypeSelector.waitForTableDataLoad();

      const spacers = await getSpacerRowCount(page);
      const indexes = await getRenderedRowIndexes(page);

      testLogger.info("Small dataset window read", {
        spacers,
        rendered: indexes.length,
        firstIndex: indexes[0],
        lastIndex: indexes[indexes.length - 1],
      });

      // Window covers the full set [0, total) -> zero padding, no spacers
      expect(spacers).toBe(0);
      expect(indexes.length).toBeGreaterThan(0);
      expect(Math.min(...indexes)).toBe(0);

      testLogger.info("Test completed");
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );
});
