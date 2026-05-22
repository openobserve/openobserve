// servicesCatalogPage.js
// Page object for Service Catalog feature in Traces module
// Selectors verified against: ServicesCatalog.vue
//
// Strict selector policy:
//   - data-test only (no element/class/text/role/label locators)
//   - All locators live in constructor as class members
//   - OInput convention: wrapper "X", inner input "X-field" (auto-derived)
//   - OSelect option convention: "X-option" + data-test-value="<value>"
//   - OPagination convention: "X-prev", "X-next", "X-page-{n}" (parent forwards)

import { expect } from '@playwright/test';

export class ServicesCatalogPage {
  constructor(page) {
    this.page = page;

    // =====================================================================
    // Selector strings (kept for parameterized cell lookups)
    // =====================================================================
    this.serviceLinkPrefix = 'services-catalog-service-link-';
    this.statusBadgePrefix = 'services-catalog-status-';
    this.errorRatePrefix = 'services-catalog-error-rate-';
    this.requestsPrefix = 'services-catalog-requests-';
    this.errorsPrefix = 'services-catalog-errors-';
    this.rowsPerPageDataTest = 'services-catalog-records-per-page';
    this.paginationDataTest = 'services-catalog-pagination';
    this.filterInputDataTest = 'services-catalog-filter-input';

    // =====================================================================
    // Toolbar locators
    // =====================================================================
    this.streamSelector = page.locator('[data-test="services-catalog-stream-selector"]');
    this.streamSelectorPopover = page.locator('[data-test="services-catalog-stream-selector-popover"]');
    // OInput convention: wrapper has data-test, inner native input has data-test-field
    this.filterInputWrapper = page.locator(`[data-test="${this.filterInputDataTest}"]`);
    this.filterInputField = page.locator(`[data-test="${this.filterInputDataTest}-field"]`);
    this.filterClearBtn = page.locator(`[data-test="${this.filterInputDataTest}-clear"]`);
    this.statusPill = page.locator('[data-test="services-catalog-status-pill"]');

    // Status chips
    this.pillCritical = page.locator('[data-test="services-catalog-pill-critical"]');
    this.pillWarning = page.locator('[data-test="services-catalog-pill-warning"]');
    this.pillDegraded = page.locator('[data-test="services-catalog-pill-degraded"]');

    // =====================================================================
    // Table locators
    // =====================================================================
    this.table = page.locator('[data-test="services-catalog-table"]');
    this.emptyState = page.locator('[data-test="services-catalog-empty"]');
    this.loading = page.locator('[data-test="services-catalog-loading"]');
    this.allServiceLinks = page.locator(`[data-test^="${this.serviceLinkPrefix}"]`);
    this.firstServiceLink = page.locator(`[data-test^="${this.serviceLinkPrefix}"]`).first();

    // =====================================================================
    // Pagination locators
    // =====================================================================
    this.paginationBar = page.locator('[data-test="services-catalog-pagination-bar"]');
    this.rowsPerPage = page.locator(`[data-test="${this.rowsPerPageDataTest}"]`);
    this.rowsPerPagePopover = page.locator(`[data-test="${this.rowsPerPageDataTest}-popover"]`);
    this.pagination = page.locator(`[data-test="${this.paginationDataTest}"]`);
    this.prevPageBtn = page.locator(`[data-test="${this.paginationDataTest}-prev"]`);
    this.nextPageBtn = page.locator(`[data-test="${this.paginationDataTest}-next"]`);
    // All page-number buttons rendered inside the pagination component
    this.pageNumberButtons = page.locator(
      `[data-test^="${this.paginationDataTest}-page-"]`,
    );

    // =====================================================================
    // Legend locators
    // =====================================================================
    this.legend = page.locator('[data-test="services-catalog-status-legend"]');
    this.legendCritical = page.locator('[data-test="services-catalog-legend-critical"]');
    this.legendWarning = page.locator('[data-test="services-catalog-legend-warning"]');
    this.legendDegraded = page.locator('[data-test="services-catalog-legend-degraded"]');
    this.legendHealthy = page.locator('[data-test="services-catalog-legend-healthy"]');

    // =====================================================================
    // Side panel — uses ServiceGraphNodeSidePanel.vue root data-test
    // (parent's "services-catalog-node-side-panel" is overridden by Vue 3
    // attribute inheritance — the root <div> renders with
    // data-test="service-graph-side-panel" from ServiceGraphNodeSidePanel.vue)
    // =====================================================================
    this.sidePanel = page.locator('[data-test="service-graph-side-panel"]');

    // =====================================================================
    // Service-catalog tab (in traces module)
    // =====================================================================
    this.servicesCatalogTabBtn = page.locator(
      '[data-test="traces-search-mode-services-catalog-btn"]',
    );
  }

  // =========================================================================
  // NAVIGATION
  // =========================================================================

  async navigate(period = '24h') {
    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    await this.page.goto(
      `${baseUrl}/web/traces?tab=services-catalog&org_identifier=${org}&period=${period}`,
      { timeout: 60000 },
    );
    // Use load instead of networkidle — networkidle hangs on SPAs with websockets
    await this.page.waitForLoadState('load', { timeout: 15000 });
  }

  async clickServiceCatalogTab() {
    await this.servicesCatalogTabBtn.click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async waitForLoad() {
    // Wait for loading spinner to disappear
    await this.loading.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    // Wait for the data to be ready: either at least one row rendered, or the empty state.
    // The table data-test renders even while loading with 0 rows — waiting on it alone races the data.
    await Promise.race([
      this.firstServiceLink.waitFor({ state: 'attached', timeout: 30000 }),
      this.emptyState.waitFor({ state: 'visible', timeout: 30000 }),
    ]).catch(() => {});
  }

  // =========================================================================
  // TOOLBAR — stream selector / filter input
  // =========================================================================

  async selectStream(streamName) {
    await this.streamSelector.click();
    // Wait for OSelect popover to mount
    await this.page.waitForTimeout(200);
    // Option uses OSelect convention: data-test="${parent}-option" + data-test-value
    const opt = this.page.locator(
      '[data-test="services-catalog-stream-selector-option"]'
      + `[data-test-value="${streamName}"]`,
    );
    await opt.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await opt.click().catch(() => {});
    // Dismiss the popover by pressing Escape (avoids body.click violation)
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page.waitForTimeout(300);
  }

  async filterByServiceName(text) {
    await this.filterInputField.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    await this.filterInputField.fill(text);
    await this.page.waitForTimeout(500); // 300ms debounce + buffer
  }

  async getFilterInputLocator() {
    return this.filterInputField;
  }

  async typeFilterCharByChar(text) {
    await this.filterInputField.click();
    await this.filterInputField.fill('');
    for (const char of text) {
      await this.filterInputField.press(char);
      await this.page.waitForTimeout(50);
    }
    // Wait for 300ms debounce
    await this.page.waitForTimeout(500);
  }

  async clearFilter() {
    // Use fill('') instead of clicking Quasar's clear icon which sets value to null (bug #11689)
    await this.filterInputField.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    await this.filterInputField.fill('');
    await this.page.waitForTimeout(500);
  }

  async clickFilterClearButton() {
    const visible = await this.filterClearBtn.isVisible().catch(() => false);
    if (!visible) {
      // Fallback: clear via fill('')
      await this.clearFilter();
      return false;
    }
    await this.filterClearBtn.click();
    await this.page.waitForTimeout(300);
    return true;
  }

  async getFilterInputValue() {
    return await this.filterInputField.inputValue();
  }

  // =========================================================================
  // STATUS PILLS
  // =========================================================================

  async getServiceCount() {
    const text = await this.statusPill.textContent().catch(() => '0');
    // Match all numbers; return the last one (total in "N/M", "N of M", "N services", etc.)
    const matches = text.match(/\d+/g);
    if (!matches || matches.length === 0) return 0;
    return parseInt(matches[matches.length - 1], 10);
  }

  async getFilteredCount() {
    const text = await this.statusPill.textContent().catch(() => '0/0');
    // Match "N/M" (filtered) or just "N" (unfiltered total)
    const filteredMatch = text.match(/^(\d+)\//);
    if (filteredMatch) return parseInt(filteredMatch[1], 10);
    // Unfiltered state — pill shows just the total, so "filtered" equals total
    const totalMatch = text.match(/^(\d+)/);
    return totalMatch ? parseInt(totalMatch[1], 10) : 0;
  }

  async getCriticalCount() {
    const text = await this.pillCritical.textContent().catch(() => '0');
    const match = text.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async getWarningCount() {
    const text = await this.pillWarning.textContent().catch(() => '0');
    const match = text.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async getDegradedCount() {
    const text = await this.pillDegraded.textContent().catch(() => '0');
    const match = text.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async isStatusPillVisible() {
    // Wait briefly for the pill to appear — it renders once services are loaded
    return await this.statusPill
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
  }

  async isCriticalPillVisible() {
    return await this.pillCritical.isVisible().catch(() => false);
  }

  async isWarningPillVisible() {
    return await this.pillWarning.isVisible().catch(() => false);
  }

  async isDegradedPillVisible() {
    return await this.pillDegraded.isVisible().catch(() => false);
  }

  // =========================================================================
  // TABLE — row helpers
  // =========================================================================

  async getRowCount() {
    // Count service-name links (one per row, scoped to TenstackTable body)
    // Uses service-link prefix to avoid matching status-pill / status-legend in the toolbar
    // Wait briefly for at least one row to render — virtual scrolling may delay row DOM
    await this.firstServiceLink.waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
    return await this.allServiceLinks.count();
  }

  async getVisibleServiceNames() {
    return await this.allServiceLinks.allTextContents();
  }

  async getServiceCellText(serviceName) {
    return await this.page
      .locator(`[data-test="${this.serviceLinkPrefix}${serviceName}"]`)
      .textContent();
  }

  async getErrorRate(serviceName) {
    return await this.page
      .locator(`[data-test="${this.errorRatePrefix}${serviceName}"]`)
      .textContent();
  }

  async getRequests(serviceName) {
    return await this.page
      .locator(`[data-test="${this.requestsPrefix}${serviceName}"]`)
      .textContent();
  }

  async getErrors(serviceName) {
    return await this.page
      .locator(`[data-test="${this.errorsPrefix}${serviceName}"]`)
      .textContent();
  }

  async getStatusBadge(serviceName) {
    return await this.page
      .locator(`[data-test="${this.statusBadgePrefix}${serviceName}"]`)
      .textContent()
      .catch(() => '');
  }

  async serviceRowExists(serviceName) {
    return await this.page
      .locator(`[data-test="${this.serviceLinkPrefix}${serviceName}"]`)
      .isVisible()
      .catch(() => false);
  }

  // =========================================================================
  // ROW CLICK / SIDE PANEL
  // =========================================================================

  async clickServiceRow(serviceName) {
    // Click the service name cell which has a direct @click.stop="handleRowClick(item)"
    // handler on the <TraceServiceCell> — this bypasses TenstackTable's row-level
    // emission layer (ServicesCatalog.vue:279). The status badge is also clickable
    // (bubbles to @click:dataRow on <tr>) but the direct cell handler is more reliable.
    await this.page
      .locator(`[data-test="${this.serviceLinkPrefix}${serviceName}"]`)
      .click();
    await this.page.waitForTimeout(300);
  }

  async isSidePanelVisible() {
    return await this.sidePanel.isVisible({ timeout: 5000 }).catch(() => false);
  }

  async expectSidePanelVisible() {
    await expect(this.sidePanel).toBeVisible({ timeout: 30000 });
  }

  // =========================================================================
  // PAGINATION
  // =========================================================================

  async getRowsPerPage() {
    await this.rowsPerPage.waitFor({ state: 'attached', timeout: 5000 });
    const text = await this.rowsPerPage.textContent();
    const val = parseInt(text, 10);
    if (Number.isNaN(val)) throw new Error(`getRowsPerPage: could not parse "${text}"`);
    return val;
  }

  async setRowsPerPage(count) {
    await this.rowsPerPage.click();
    await this.page.waitForTimeout(300);
    // OSelect option uses data-test="${parent}-option" + data-test-value=<value>
    const opt = this.page.locator(
      `[data-test="${this.rowsPerPageDataTest}-option"][data-test-value="${count}"]`,
    );
    await opt.waitFor({ state: 'visible', timeout: 5000 });
    await opt.click();
    await this.page.waitForTimeout(500);
  }

  async getPageCount() {
    // Page-number buttons emitted by OPagination as parent-page-{n}
    return await this.pageNumberButtons.count();
  }

  async goToPage(n) {
    const pageBtn = this.page.locator(
      `[data-test="${this.paginationDataTest}-page-${n}"]`,
    );
    await pageBtn.waitFor({ state: 'visible', timeout: 5000 });
    await pageBtn.click();
    await this.page.waitForTimeout(500);
  }

  async isPrevDisabled() {
    return await this.prevPageBtn.isDisabled().catch(() => true);
  }

  async isNextDisabled() {
    return await this.nextPageBtn.isDisabled().catch(() => true);
  }

  async getCurrentPage() {
    // OPagination sets aria-current="page" on the active button.
    // The page-number buttons all carry data-test-value="<page>" so we use that
    // combined with the aria-current attribute filter — both are non-class,
    // non-element selectors permitted by the policy.
    const el = this.page.locator(
      `[data-test^="${this.paginationDataTest}-page-"][aria-current="page"]`,
    );
    await el.waitFor({ state: 'attached', timeout: 5000 });
    const val = await el.getAttribute('data-test-value');
    const parsed = parseInt(val, 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`getCurrentPage: could not parse data-test-value "${val}"`);
    }
    return parsed;
  }

  async isPaginationVisible() {
    return await this.paginationBar.isVisible().catch(() => false);
  }

  // =========================================================================
  // COLUMN SORTING
  // =========================================================================

  async sortByColumn(columnKey) {
    // Click the sortable inner div which has @click="handleHeaderSortClick",
    // NOT the <th> — TenstackTable's sort handler is on the child div with
    // data-test="o2-table-th-sort-{id}" (TenstackTable.vue:228-236).
    // JavaScript's el.click() on the <th> dispatches a click that bubbles UP
    // to ancestors and never reaches the child div's handler.
    await this.page.locator(`[data-test="o2-table-th-sort-${columnKey}"]`).click();
    await this.page.waitForTimeout(300);
  }

  async getSortIcon(columnKey) {
    // TenstackTable renders one of two icons inside the column header,
    // scoped per-column via `data-test="o2-table-sort-icon-{columnId}"`:
    //   - data-test-sort-state="active"   with data-test-sort-direction "asc" | "desc"
    //   - data-test-sort-state="inactive" with data-test-sort-direction "none"
    // Test legacy convention used 'arrow_downward' / 'arrow_upward' / 'unfold_more'
    // (Quasar material-icons text content). Normalize the OIcon sort attribute to
    // that form so existing test assertions keep working.
    const icon = this.page.locator(
      `[data-test="o2-table-sort-icon-${columnKey}"]`,
    );

    if (!(await icon.count())) return '';
    const state = await icon.getAttribute('data-test-sort-state').catch(() => null);
    const dir = await icon.getAttribute('data-test-sort-direction').catch(() => null);

    if (state === 'active') {
      if (dir === 'desc') return 'arrow_downward';
      if (dir === 'asc') return 'arrow_upward';
      return 'arrow_unknown';
    }
    if (state === 'inactive') return 'unfold_more';
    return '';
  }

  async getFirstServiceName() {
    const text = await this.firstServiceLink.textContent().catch(() => '');
    return text.trim();
  }

  // =========================================================================
  // LEGEND
  // =========================================================================

  async isLegendVisible() {
    return await this.legend.isVisible().catch(() => false);
  }

  async getLegendCount(status) {
    const el = this.page.locator(`[data-test="services-catalog-legend-${status}"]`);
    const text = await el.textContent().catch(() => '0');
    const match = text.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  // =========================================================================
  // EMPTY STATE / TABLE VISIBILITY
  // =========================================================================

  async isTableVisible() {
    // Wait briefly for the table to settle — after filter changes the DOM may flicker
    return await this.table
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }

  async isEmptyStateVisible() {
    return await this.emptyState.isVisible().catch(() => false);
  }
}
