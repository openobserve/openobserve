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
  setupBarPanelWithConfig,
  setupTablePanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');
const { DashboardPanelTablePage } = require("../../pages/dashboardPages/dashboard-panel-table.js");
const {
  orgIdentifier,
  ingestLogRows,
  createDashboard,
  deleteSeededTablePanel,
  statusRows,
  uniqueValueColorDashboard,
} = require("../utils/dashboard-seed-api.js");

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

test.describe("ConfigPanel — Table Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("wrap cells: visible for table → enable → apply → table renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    const wrapCellsToggle = pm.dashboardPanelConfigs.wrapcell;
    await expect(wrapCellsToggle).toBeVisible();
    await pm.dashboardPanelConfigs.selectWrapCell();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    testLogger.info("Wrap cells enabled for table chart");
    await expect(pm.dashboardPanelActions.dashboardTable).toBeVisible();

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying wrap cells toggle persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.wrapcell.locator('[data-test$="-btn"]')).toHaveAttribute("aria-checked", "true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("transpose: visible for table → enable → apply → table renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    const transposeToggle = pm.dashboardPanelConfigs.transpose;
    await expect(transposeToggle).toBeVisible();
    await pm.dashboardPanelConfigs.selectTranspose();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    testLogger.info("Transpose enabled");
    await expect(pm.dashboardPanelActions.dashboardTable).toBeVisible();

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying transpose toggle persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.transpose.locator('[data-test$="-btn"]')).toHaveAttribute("aria-checked", "true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("dynamic columns: visible for table → enable → apply → table renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    const dynamicColsToggle = pm.dashboardPanelConfigs.dynamicColumn;
    await expect(dynamicColsToggle).toBeVisible();
    await pm.dashboardPanelConfigs.selectDynamicColumns();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    testLogger.info("Dynamic columns enabled");
    await expect(pm.dashboardPanelActions.dashboardTable).toBeVisible();

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying dynamic columns toggle persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.dynamicColumn.locator('[data-test$="-btn"]')).toHaveAttribute("aria-checked", "true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("pagination: enable → rows-per-page input appears + set 25 → apply → controls visible → disable → input hidden", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    const paginationToggle = pm.dashboardPanelConfigs.paginationToggle;
    const rowsPerPageInput = pm.dashboardPanelConfigs.rowsPerPageWrapper;

    await expect(paginationToggle).toBeVisible();
    await expect(rowsPerPageInput).not.toBeVisible();

    // Enable pagination → rows per page appears
    await paginationToggle.click();
    await expect(rowsPerPageInput).toBeVisible();

    // Set rows per page to 25
    await rowsPerPageInput.locator('[data-test$="-field"]').fill("25");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    testLogger.info("Pagination enabled, rows per page set to 25");
    await expect(pm.dashboardPanelConfigs.tablePagination).toBeVisible();

    // Re-open config and disable pagination → input hidden again
    await paginationToggle.click();
    await expect(rowsPerPageInput).not.toBeVisible();

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying pagination disabled state persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.paginationToggle.locator('[data-test$="-btn"]')).toHaveAttribute("aria-checked", "false");
    await expect(pm.dashboardPanelConfigs.rowsPerPageWrapper).not.toBeVisible();
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});

test.describe("Table — unique value color (ENT#702)", { tag: ["@dashboards", "@regression", "@P2"] }, () => {
  const STATUSES = ["active", "active", "active", "inactive", "inactive", "pending"];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test("each distinct status renders its own background, equal values share one", async ({ page }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const stream = `ovn_c702_${stamp}`;
    let dashboardId = null;
    try {
      await ingestLogRows(page, stream, statusRows(STATUSES));
      dashboardId = await createDashboard(page, uniqueValueColorDashboard(stamp, stream));

      const panelTable = new DashboardPanelTablePage(page);
      await panelTable.gotoDashboardView(dashboardId, { org: orgIdentifier(), period: "15m" });
      await expect(panelTable.cell(/^pending$/)).toBeVisible({ timeout: 60000 });

      const active = await panelTable.cellBackgrounds("active");
      const inactive = await panelTable.cellBackgrounds("inactive");
      const pending = await panelTable.cellBackgrounds("pending");
      expect(active).toHaveLength(3);
      expect(inactive).toHaveLength(2);
      expect(pending).toHaveLength(1);

      const svcBg = await panelTable.cellBackground("svc0");
      for (const colors of [active, inactive, pending]) {
        expect(new Set(colors).size, `one colour per value, got ${colors}`).toBe(1);
        expect(colors[0], "a coloured status cell differs from an uncoloured cell").not.toBe(svcBg);
      }
      expect(new Set([active[0], inactive[0], pending[0]]).size, "each distinct value gets its own colour").toBe(3);
    } finally {
      await deleteSeededTablePanel(page, { stream, dashboardId });
    }
  });
});
