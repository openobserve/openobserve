import { expect } from '@playwright/test';

/**
 * Page object for the "Scheduled Dashboards" drawer opened from a dashboard's
 * view toolbar (web/src/views/Dashboards/ScheduledDashboards.vue, opened by
 * ViewDashboard.vue's `view-dashboard-scheduled-reports` button).
 *
 * Covers the two regressions fixed in PR #13569:
 *   1. rows duplicating each time the drawer is reopened
 *   2. reports saved in a custom REPORT folder being filtered out
 */
export class ScheduledReportsDrawerPage {
  constructor(page) {
    this.page = page;

    // Toolbar trigger on the dashboard view page (ViewDashboard.vue:195).
    this.openDrawerBtn = page.locator('[data-test="view-dashboard-scheduled-reports"]');

    // ODrawer sets its DialogContent data-test from the consumer's attr
    // (parentDataTest), so the panel itself carries `scheduled-dashboards-drawer`.
    this.drawer = page.locator('[data-test="scheduled-dashboards-drawer"]');
    this.drawerCloseBtn = this.drawer.locator('[data-test="o-drawer-close-btn"]');
    this.drawerOverlay = page.locator('[data-test="o-drawer-overlay"]');

    // Drawer body. OTable does not set inheritAttrs:false, so the table's own
    // `o2-table-root` and the consumer's `scheduled-dashboard-table` land on the
    // same element — scope row lookups through the container to stay unambiguous.
    this.container = page.locator('[data-test="scheduled-dashboards-container"]');
    this.table = this.container.locator('[data-test="scheduled-dashboard-table"]');
    // `tr` qualifier keeps the drag-handle button (`o2-table-row-drag-handle`,
    // OTableBodyRow.vue:247) out of the prefix match.
    this.rows = this.container.locator('tr[data-test^="o2-table-row-"]');
    // ScheduledDashboards now renders the shared OEmptyState through OTable's
    // empty slot. Scope through the table wrapper so this cannot match another
    // empty state elsewhere in the drawer/page.
    this.emptyState = this.table
      .locator('[data-test="o2-table-empty"]')
      .locator('[data-test="o2-empty-state"]');
    this.loadingBanner = this.container.locator('[data-test="o2-table-loading-banner"]');

    // AppTabs renders `tab-<value>`; values are "cached" / "shared"
    // (ScheduledDashboards.vue:167-170).
    this.cachedTab = this.drawer.locator('[data-test="tab-cached"]');
    this.scheduledTab = this.drawer.locator('[data-test="tab-shared"]');

    // OSearchInput wrapper carries `alert-list-search-input`; OInput forwards the
    // native input as `<parent>-field`.
    this.searchInput = this.drawer.locator('[data-test="alert-list-search-input-field"]');
    this.newReportBtn = this.drawer.locator('[data-test="alert-list-add-alert-btn"]');
  }

  /**
   * Row locator for a named report. The drawer's OTable rows have no per-name
   * data-test (only `o2-table-row-<index>`), so the name is matched on row text.
   * Safe here because report names in these tests are unique random strings.
   */
  rowByReportName(reportName) {
    return this.rows.filter({ hasText: reportName });
  }

  /**
   * Open a dashboard's view page directly by id.
   */
  async openDashboard(dashboardId, { folderId = 'default', tabId = 'default' } = {}) {
    const url =
      `${process.env["ZO_BASE_URL"]}/web/dashboards/view` +
      `?org_identifier=${process.env["ORGNAME"]}` +
      `&dashboard=${dashboardId}&folder=${folderId}&tab=${tabId}`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await expect(this.openDrawerBtn).toBeVisible({ timeout: 30000 });
  }

  /**
   * Click the toolbar button and wait for the reports list call to settle.
   * @returns {Promise<string>} the URL of the `GET /api/{org}/reports` request,
   *          so a test can assert the query contract (no `folder_id=`).
   */
  async openDrawer() {
    const listResponse = this.page.waitForResponse(
      (response) =>
        /\/api\/[^/]+\/reports(\?|$)/.test(response.url()) &&
        response.request().method() === 'GET',
      { timeout: 30000 }
    );
    await this.openDrawerBtn.click();
    const response = await listResponse;
    expect(response.status()).toBe(200);

    await expect(this.drawer).toBeVisible({ timeout: 15000 });
    await this.loadingBanner.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    return response.url();
  }

  async closeDrawer() {
    await this.drawerCloseBtn.click();
    await expect(this.drawer).toBeHidden({ timeout: 15000 });
    // The overlay fades out after the panel detaches; wait so the next click on
    // the toolbar button is not swallowed by the backdrop.
    await this.drawerOverlay.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async selectCachedTab() {
    await this.cachedTab.click();
  }

  async selectScheduledTab() {
    await this.scheduledTab.click();
  }

  async searchReports(query) {
    await this.searchInput.fill(query);
  }

  async clearSearch() {
    await this.searchInput.fill('');
  }

  async getRowCount() {
    return await this.rows.count();
  }

  async expectDrawerVisible() {
    await expect(this.drawer).toBeVisible({ timeout: 15000 });
    await expect(this.table).toBeVisible({ timeout: 15000 });
  }

  async expectRowCount(expected) {
    await expect(this.rows).toHaveCount(expected, { timeout: 20000 });
  }

  async expectReportVisible(reportName) {
    await expect(this.rowByReportName(reportName)).toHaveCount(1, { timeout: 20000 });
  }

  async expectReportNotVisible(reportName) {
    await expect(this.rowByReportName(reportName)).toHaveCount(0, { timeout: 15000 });
  }

  async expectEmptyState() {
    await expect(this.emptyState).toBeVisible({ timeout: 15000 });
    await expect(this.rows).toHaveCount(0);
  }

  /**
   * PR #13569 (bug 2): the list request must NOT carry `folder_id`, because that
   * param filters by the REPORT's own folder rather than the dashboard's folder.
   */
  expectNoFolderIdInListRequest(requestUrl) {
    expect(requestUrl).toContain('dashboard_id=');
    expect(requestUrl).not.toContain('folder_id=');
  }
}
