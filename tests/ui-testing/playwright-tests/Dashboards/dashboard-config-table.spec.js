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
