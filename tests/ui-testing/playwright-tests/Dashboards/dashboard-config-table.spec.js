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

    const wrapCellsToggle = page.locator('[data-test="dashboard-config-wrap-table-cells"]');
    await expect(wrapCellsToggle).toBeVisible();
    await pm.dashboardPanelConfigs.selectWrapCell();
    await pm.dashboardPanelActions.applyDashboardBtn();

    testLogger.info("Wrap cells enabled for table chart");
    await expect(page.locator('[data-test="dashboard-panel-table"]')).toBeVisible();

    testLogger.info("Verifying wrap cells toggle persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-wrap-table-cells"]')).toHaveAttribute("aria-checked", "true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("transpose: visible for table → enable → apply → table renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    const transposeToggle = page.locator('[data-test="dashboard-config-table_transpose"]');
    await expect(transposeToggle).toBeVisible();
    await pm.dashboardPanelConfigs.selectTranspose();
    await pm.dashboardPanelActions.applyDashboardBtn();

    testLogger.info("Transpose enabled");
    await expect(page.locator('[data-test="dashboard-panel-table"]')).toBeVisible();

    testLogger.info("Verifying transpose toggle persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-table_transpose"]')).toHaveAttribute("aria-checked", "true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("dynamic columns: visible for table → enable → apply → table renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    const dynamicColsToggle = page.locator('[data-test="dashboard-config-table_dynamic_columns"]');
    await expect(dynamicColsToggle).toBeVisible();
    await pm.dashboardPanelConfigs.selectDynamicColumns();
    await pm.dashboardPanelActions.applyDashboardBtn();

    testLogger.info("Dynamic columns enabled");
    await expect(page.locator('[data-test="dashboard-panel-table"]')).toBeVisible();

    testLogger.info("Verifying dynamic columns toggle persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-table_dynamic_columns"]')).toHaveAttribute("aria-checked", "true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("pagination: enable → rows-per-page input appears + set 25 → apply → controls visible → disable → input hidden", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');

    await expect(paginationToggle).toBeVisible();
    await expect(rowsPerPageInput).not.toBeVisible();

    // Enable pagination → rows per page appears
    await paginationToggle.click();
    await expect(rowsPerPageInput).toBeVisible();

    // Set rows per page to 25
    await rowsPerPageInput.click();
    await rowsPerPageInput.fill("25");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Pagination enabled, rows per page set to 25");
    await expect(page.locator(".q-table__bottom")).toBeVisible();

    // Re-open config and disable pagination → input hidden again
    await pm.dashboardPanelConfigs.openConfigPanel();
    await paginationToggle.click();
    await expect(rowsPerPageInput).not.toBeVisible();

    testLogger.info("Verifying pagination disabled state persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-show-pagination"]')).toHaveAttribute("aria-checked", "false");
    await expect(page.locator('[data-test="dashboard-config-rows-per-page"]')).not.toBeVisible();
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
