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
  setupTablePanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
import {
  TABLE_SELECTOR,
  TABLE_DATA_ROW_SELECTOR,
  getColumnFilterBtn,
  openColumnFilter,
  columnFilter,
  waitForPanelTableSettled,
} from "../../pages/dashboardPages/dashboard-table-helpers.js";
const testLogger = require("../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

test.describe("Dashboard Table — Column Filtering (PR #12531)", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("filtering toggle: enabling shows a filter icon in every column header", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);
    await expect(getColumnFilterBtn(page, 0)).not.toBeVisible();

    await pm.dashboardPanelConfigs.toggleTableFiltering();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Table filtering enabled");

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();
    await expect(getColumnFilterBtn(page, 0)).toBeVisible();
    testLogger.info("Filter icon visible in column header");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("filter by value: checking a value narrows the table to matching rows only", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.toggleTableFiltering();
    await pm.dashboardPanelActions.applyDashboardBtn();

    // Apply re-runs the query. Counting rows or clicking a filter value before it lands
    // works against the previous table, and the value list is rebuilt under the cursor
    // mid-click — see waitForPanelTableSettled.
    await waitForPanelTableSettled(page);

    const rows = page.locator(TABLE_DATA_ROW_SELECTOR);
    await rows.first().waitFor({ state: "visible", timeout: 15000 });
    const totalRowCount = await rows.count();
    expect(totalRowCount).toBeGreaterThan(0);

    const panel = await openColumnFilter(page, 0);
    const firstValueItem = columnFilter.valueItems(panel).first();
    const filterText = (await firstValueItem.textContent())?.trim();
    await columnFilter.selectValueByIndex(panel, 0);
    testLogger.info("Selected first filter value", { filterText });

    // Verify the filter icon switches to its "active" state (isColFiltered →
    // primary-colored icon) while the panel is still open — checking before
    // Escape avoids a race with the dropdown's close/portal-unmount transition.
    const activeFilterIcon = getColumnFilterBtn(page, 0).locator('[class*="color-primary-600"]');
    await expect(activeFilterIcon).toBeVisible();
    await page.keyboard.press("Escape");

    const filteredRowCount = await rows.count();
    expect(filteredRowCount).toBeGreaterThan(0);
    expect(filteredRowCount).toBeLessThanOrEqual(totalRowCount);
    testLogger.info("Row count narrowed after filter applied", { totalRowCount, filteredRowCount });

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("clear filter: restores all rows and resets the filter icon state", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.toggleTableFiltering();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await waitForPanelTableSettled(page);

    const rows = page.locator(TABLE_DATA_ROW_SELECTOR);
    await rows.first().waitFor({ state: "visible", timeout: 15000 });
    const totalRowCount = await rows.count();

    // Keep the same panel handle open across select + clear — closing and
    // reopening the dropdown between the two actions raced with the table's
    // reactive re-render and intermittently detached the "Clear filter" node.
    const panel = await openColumnFilter(page, 0);
    await columnFilter.selectValueByIndex(panel, 0);
    expect(await rows.count()).toBeLessThanOrEqual(totalRowCount);

    await columnFilter.clear(panel);
    await page.keyboard.press("Escape");
    testLogger.info("Filter cleared");

    await expect(rows).toHaveCount(totalRowCount);
    testLogger.info("All rows restored after clearing filter", { totalRowCount });

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("filtering persistence: table_filtering toggle state survives save and reopen", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);
    expect(await pm.dashboardPanelConfigs.isTableFilteringEnabled()).toBe(false);
    await pm.dashboardPanelConfigs.toggleTableFiltering();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await expect(getColumnFilterBtn(page, 0)).toBeVisible();

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Panel saved with filtering enabled");
    await reopenPanelConfig(page, pm);

    // reopenPanelConfig only waits for the sidebar shell to render, not for the
    // panel's async data fetch (AddPanel.vue onMounted → getPanel() → Object.assign)
    // to land — poll until the saved config value has actually been applied.
    await expect(async () => {
      expect(await pm.dashboardPanelConfigs.isTableFilteringEnabled()).toBe(true);
    }).toPass({ timeout: 10000 });
    testLogger.info("Filtering toggle still ON after reopening panel config");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("filter search: typing in the search box narrows the value list", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.toggleTableFiltering();
    await pm.dashboardPanelActions.applyDashboardBtn();
    await waitForPanelTableSettled(page);

    const panel = await openColumnFilter(page, 0);
    const items = columnFilter.valueItems(panel);
    const initialCount = await items.count();
    // Must have more than the eventual 1-item "no matches" placeholder, otherwise a
    // panel that failed to load any values at all would be indistinguishable from
    // "search narrowed the list down to nothing".
    expect(initialCount).toBeGreaterThan(1);

    // A search term that matches nothing real should collapse the list to the
    // "no matches" placeholder row.
    await columnFilter.search(panel, "zzz_no_such_value_zzz");
    await expect(items).toHaveCount(1);
    const narrowedCount = await items.count();
    expect(narrowedCount).toBeLessThan(initialCount);
    await expect(items.first()).toContainText(/no matches/i);
    testLogger.info("Filter search narrowed value list to no-matches placeholder", { initialCount, narrowedCount });

    await page.keyboard.press("Escape");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
