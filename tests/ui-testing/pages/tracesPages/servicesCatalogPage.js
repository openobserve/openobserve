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
    // TenstackTable forwards the consumer's `data-test` onto its root <div>
    // (no `inheritAttrs: false`), and the inner <table> carries its own
    // `data-test="o2-table"`. We use `[data-test*="services-catalog-table"]`
    // composite to match either — keeps the wait deterministic if the source
    // ever forwards the attribute only to one element.
    // =====================================================================
    this.table = page.locator('[data-test="services-catalog-table"]');
    // Inner TenstackTable <table> — always rendered once the wrapper mounts.
    this.tableInner = page.locator('[data-test="services-catalog-table"] [data-test="o2-table"]');
    this.emptyState = page.locator('[data-test="services-catalog-empty"]');
    this.loading = page.locator('[data-test="services-catalog-loading"]');
    this.allServiceLinks = page.locator(`[data-test^="${this.serviceLinkPrefix}"]`);
    this.firstServiceLink = page.locator(`[data-test^="${this.serviceLinkPrefix}"]`).first();
    // Inner service-name span — rendered by TraceServiceCell as
    // `<span data-test="trace-row-service-name">{{ item.service_name }}</span>`.
    // Reading from this span avoids picking up whitespace / icon alt-text in the
    // service-link cell's textContent.
    this.firstServiceNameSpan = page.locator(
      `[data-test^="${this.serviceLinkPrefix}"] [data-test="trace-row-service-name"]`,
    ).first();

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

    // =====================================================================
    // Factory locators — runtime-bound (allowed by POM strict policy)
    // =====================================================================
    /** @param {string} name */
    this.getServiceLink = (name) =>
      page.locator(`[data-test="${this.serviceLinkPrefix}${name}"]`);
    /** @param {string} name */
    this.getStatusBadgeLocator = (name) =>
      page.locator(`[data-test="${this.statusBadgePrefix}${name}"]`);
    /** @param {string} name */
    this.getErrorRateLocator = (name) =>
      page.locator(`[data-test="${this.errorRatePrefix}${name}"]`);
    /** @param {string} name */
    this.getRequestsLocator = (name) =>
      page.locator(`[data-test="${this.requestsPrefix}${name}"]`);
    /** @param {string} name */
    this.getErrorsLocator = (name) =>
      page.locator(`[data-test="${this.errorsPrefix}${name}"]`);
    /** @param {string|number} n */
    this.getPageButton = (n) =>
      page.locator(`[data-test="${this.paginationDataTest}-page-${n}"]`);
    // OPagination marks the current page with data-test-active="true". Combined
    // with the data-test^= page-prefix this stays strictly data-test only.
    this.currentPageButton = page.locator(
      `[data-test^="${this.paginationDataTest}-page-"][data-test-active="true"]`,
    );
    /** @param {string} columnId */
    this.getColumnSortClickTarget = (columnId) =>
      page.locator(`[data-test="o2-table-th-sort-${columnId}"]`);
    /** @param {string} columnId — TenstackTable session-shipped icon data-test. */
    this.getColumnSortIcon = (columnId) =>
      page.locator(`[data-test="o2-table-sort-icon-${columnId}"]`);
    /** @param {string} status */
    this.getLegendItem = (status) =>
      page.locator(`[data-test="services-catalog-legend-${status}"]`);
    /** @param {string} parentDataTest @param {string|number} count */
    this.getRowsPerPageOption = (parentDataTest, count) =>
      page.locator(
        `[data-test="${parentDataTest}-option"][data-test-value="${count}"]`,
      );
    /** @param {string} parent @param {string} streamName */
    this.getStreamOption = (parent, streamName) =>
      page.locator(
        `[data-test="${parent}-option"][data-test-value="${streamName}"]`,
      );
  }

  // =========================================================================
  // NAVIGATION
  // =========================================================================

  async navigate(period = '24h') {
    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    // Use the trailing-slash form `/web/traces/` — without it some dev servers
    // route the request to the SPA fallback and drop query params before the
    // Vue router can read them. The trailing-slash form is what Vue Router
    // canonicalises to and what the index.vue page reads from on mount.
    await this.page.goto(
      `${baseUrl}/web/traces/?tab=services-catalog&org_identifier=${org}&period=${period}`,
      { timeout: 60000 },
    );
    // Use load instead of networkidle — networkidle hangs on SPAs with websockets
    await this.page.waitForLoadState('load', { timeout: 15000 });
    // Ensure the services-catalog tab is the active one. If the URL param was
    // dropped (e.g. due to a router replace during mount), click the tab button
    // explicitly. This is defensive — keeps the tab activation deterministic.
    const filterVisible = await this.filterInputField
      .waitFor({ state: 'attached', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!filterVisible) {
      // Fallback: click the services-catalog tab button explicitly.
      await this.servicesCatalogTabBtn
        .waitFor({ state: 'visible', timeout: 8000 })
        .catch(() => {});
      await this.servicesCatalogTabBtn.click().catch(() => {});
      await this.filterInputField
        .waitFor({ state: 'attached', timeout: 15000 })
        .catch(() => {});
    }
  }

  async clickServiceCatalogTab() {
    await this.servicesCatalogTabBtn.click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async waitForLoad() {
    // Wait for the services-catalog toolbar (filter input) to be attached —
    // this is the canonical "ServicesCatalog mounted" signal. The toolbar
    // renders synchronously once the tab is active, before any data resolves.
    await this.filterInputField
      .waitFor({ state: 'attached', timeout: 30000 })
      .catch(() => {});
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
    // Option uses OSelect convention: data-test="${parent}-option" + data-test-value
    const opt = this.getStreamOption('services-catalog-stream-selector', streamName);
    // Wait for OSelect popover to mount + render the option (deterministic).
    await opt.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await opt.click().catch(() => {});
    // Dismiss the popover by pressing Escape (avoids body.click violation)
    await this.page.keyboard.press('Escape').catch(() => {});
    // Wait for popover to detach so subsequent interactions are not occluded.
    await this.streamSelectorPopover
      .waitFor({ state: 'detached', timeout: 5000 })
      .catch(() => {});
  }

  async filterByServiceName(text) {
    await this.filterInputField.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    await this.filterInputField.fill(text);
    // Confirm the native input value reflects the typed text.
    await expect.poll(
      async () => await this.filterInputField.inputValue(),
      { timeout: 5000, intervals: [50, 100, 200] },
    ).toBe(text);
    // Wait for OInput's 300ms debounce to fire AND the filtered table to settle.
    // We cannot just wait for firstServiceLink to be attached — it was already
    // attached before the filter was applied, so that Promise.race resolves
    // immediately and the unfiltered rows are still visible.
    // Instead, poll until all visible service-name cells contain the filter text
    // (filter applied with matches) OR no cells are visible (filter applied, 0 matches).
    await expect.poll(
      async () => {
        const names = await this.allServiceLinks.allTextContents();
        // 0 rows means the filter has applied and there are no matches — settled.
        if (names.length === 0) return true;
        // All rows contain the filter text — filter has settled with matches.
        return names.every((n) => n.toLowerCase().includes(text.toLowerCase()));
      },
      { timeout: 5000, intervals: [100, 200, 300] },
    ).toBeTruthy();
  }

  async getFilterInputLocator() {
    return this.filterInputField;
  }

  async typeFilterCharByChar(text) {
    await this.filterInputField.waitFor({ state: 'visible', timeout: 10000 });
    await this.filterInputField.click();
    await this.filterInputField.fill('');
    for (const char of text) {
      await this.filterInputField.press(char);
    }
    // Wait for the input to reflect the full typed string (deterministic).
    await expect.poll(
      async () => await this.filterInputField.inputValue(),
      { timeout: 5000, intervals: [50, 100, 200] },
    ).toBe(text);
    // Wait for OInput's 300ms debounce to settle: poll until the table either
    // renders the filtered set or shows the empty state. Both are deterministic.
    await Promise.race([
      this.firstServiceLink.waitFor({ state: 'attached', timeout: 3000 }),
      this.emptyState.waitFor({ state: 'attached', timeout: 3000 }),
    ]).catch(() => {});
  }

  async clearFilter() {
    // Use fill('') instead of clicking Quasar's clear icon which sets value to null (bug #11689)
    await this.filterInputField.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    await this.filterInputField.fill('');
    // Wait for input to reflect the cleared value (deterministic).
    await expect.poll(
      async () => await this.filterInputField.inputValue(),
      { timeout: 5000, intervals: [50, 100, 200] },
    ).toBe('');
    // Wait for the unfiltered table to settle.
    await Promise.race([
      this.firstServiceLink.waitFor({ state: 'attached', timeout: 3000 }),
      this.emptyState.waitFor({ state: 'attached', timeout: 3000 }),
    ]).catch(() => {});
  }

  async clickFilterClearButton() {
    const visible = await this.filterClearBtn.isVisible().catch(() => false);
    if (!visible) {
      // Fallback: clear via fill('')
      await this.clearFilter();
      return false;
    }
    await this.filterClearBtn.click();
    // After clearing, wait for the input to be empty (deterministic).
    await expect.poll(
      async () => await this.filterInputField.inputValue(),
      { timeout: 5000, intervals: [50, 100, 200] },
    ).toBe('');
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
    // Use the inner service-name span (data-test="trace-row-service-name") for clean
    // text without trailing whitespace or icon alt-text from the outer link element.
    const nameSpans = this.page.locator(
      `[data-test^="${this.serviceLinkPrefix}"] [data-test="trace-row-service-name"]`,
    );
    const spanCount = await nameSpans.count();
    if (spanCount > 0) {
      return (await nameSpans.allTextContents()).map((n) => (n || '').trim());
    }
    return (await this.allServiceLinks.allTextContents()).map((n) => (n || '').trim());
  }

  async getServiceCellText(serviceName) {
    return await this.getServiceLink(serviceName).textContent();
  }

  async getErrorRate(serviceName) {
    return await this.getErrorRateLocator(serviceName).textContent();
  }

  async getRequests(serviceName) {
    return await this.getRequestsLocator(serviceName).textContent();
  }

  async getErrors(serviceName) {
    return await this.getErrorsLocator(serviceName).textContent();
  }

  async getStatusBadge(serviceName) {
    return await this.getStatusBadgeLocator(serviceName)
      .textContent()
      .catch(() => '');
  }

  async serviceRowExists(serviceName) {
    return await this.getServiceLink(serviceName)
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
    // If the caller passes an empty / falsy name (because getFirstServiceName()
    // didn't have data yet at call time), fall back to clicking the first
    // available service link — keeps the test deterministic instead of waiting
    // on a `[data-test="services-catalog-service-link-"]` selector that will
    // never match.
    const link = serviceName ? this.getServiceLink(serviceName) : this.firstServiceLink;
    await link.waitFor({ state: 'visible', timeout: 15000 });
    await link.click();
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
    // OSelect option uses data-test="${parent}-option" + data-test-value=<value>
    const opt = this.getRowsPerPageOption(this.rowsPerPageDataTest, count);
    // Wait for popover + option to render (deterministic).
    await opt.waitFor({ state: 'visible', timeout: 5000 });
    await opt.click();
    // After selection, the OSelect trigger reflects the new value — poll until it does.
    await expect.poll(
      async () => await this.rowsPerPage.textContent().then((t) => (t || '').trim()),
      { timeout: 5000, intervals: [50, 100, 200] },
    ).toContain(String(count));
  }

  async getPageCount() {
    // Page-number buttons emitted by OPagination as parent-page-{n}
    return await this.pageNumberButtons.count();
  }

  async goToPage(n) {
    const pageBtn = this.getPageButton(n);
    await pageBtn.waitFor({ state: 'visible', timeout: 5000 });
    await pageBtn.click();
    // After navigation, the OPagination sets data-test-active="true" on the
    // clicked button — wait for that to converge before returning.
    await expect.poll(
      async () => await pageBtn.getAttribute('data-test-active'),
      { timeout: 5000, intervals: [50, 100, 200] },
    ).toBe('true');
  }

  async isPrevDisabled() {
    return await this.prevPageBtn.isDisabled().catch(() => true);
  }

  async isNextDisabled() {
    return await this.nextPageBtn.isDisabled().catch(() => true);
  }

  async getCurrentPage() {
    // OPagination sets data-test-active="true" on the active page button.
    // Combined with the data-test^= page-prefix and data-test-value="<page>"
    // it lets us identify the active page using only data-test attributes.
    await this.currentPageButton.waitFor({ state: 'attached', timeout: 5000 });
    const val = await this.currentPageButton.getAttribute('data-test-value');
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
    //
    // Resilient fallback: if the `o2-table-th-sort-{id}` div isn't attached
    // (older / pivot header layouts), click the visible sort icon instead —
    // it sits inside the same div and the click bubbles to the handler.
    const sortDiv = this.getColumnSortClickTarget(columnKey);
    const sortIcon = this.getColumnSortIcon(columnKey);
    // Capture current icon state so we can poll for change after click —
    // this gives a deterministic wait instead of a fixed sleep.
    const before = await sortIcon
      .getAttribute('data-test-sort-direction')
      .catch(() => null);
    const target = (await sortDiv.count()) > 0 ? sortDiv : sortIcon;
    await target.waitFor({ state: 'visible', timeout: 15000 });
    await target.click();
    // Wait for sort state to actually change (direction attribute flips).
    await expect.poll(
      async () =>
        await sortIcon.getAttribute('data-test-sort-direction').catch(() => null),
      { timeout: 5000, intervals: [50, 100, 200] },
    ).not.toBe(before);
  }

  async getSortIcon(columnKey) {
    // TenstackTable renders one of two icons inside the column header,
    // scoped per-column via `data-test="o2-table-sort-icon-{columnId}"`:
    //   - data-test-sort-state="active"   with data-test-sort-direction "asc" | "desc"
    //   - data-test-sort-state="inactive" with data-test-sort-direction "none"
    // Test legacy convention used 'arrow_downward' / 'arrow_upward' / 'unfold_more'
    // (Quasar material-icons text content). Normalize the OIcon sort attribute to
    // that form so existing test assertions keep working.
    const icon = this.getColumnSortIcon(columnKey);

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
    // Prefer reading the inner service-name span — its textContent is just the
    // service_name without the icon's whitespace / surrounding template noise.
    // Falls back to the link's textContent when the span hasn't mounted yet
    // (e.g. virtual-scroll race) so the caller still gets a usable value.
    await this.firstServiceLink
      .waitFor({ state: 'attached', timeout: 10000 })
      .catch(() => {});
    const nameSpanCount = await this.firstServiceNameSpan.count();
    if (nameSpanCount > 0) {
      const text = await this.firstServiceNameSpan.textContent().catch(() => '');
      const trimmed = (text || '').trim();
      if (trimmed) return trimmed;
    }
    const text = await this.firstServiceLink.textContent().catch(() => '');
    return (text || '').trim();
  }

  // =========================================================================
  // LEGEND
  // =========================================================================

  async isLegendVisible() {
    return await this.legend.isVisible().catch(() => false);
  }

  async getLegendCount(status) {
    const el = this.getLegendItem(status);
    const text = await el.textContent().catch(() => '0');
    const match = text.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  // =========================================================================
  // EMPTY STATE / TABLE VISIBILITY
  // =========================================================================

  async isTableVisible() {
    // TenstackTable forwards `data-test="services-catalog-table"` to its root
    // <div> via attribute inheritance. The inner `<table data-test="o2-table">`
    // is always rendered once the wrapper mounts. Check either selector — the
    // wrapper is the canonical match; the inner table is the fallback if the
    // attribute forwarding changes in a future TenstackTable refactor.
    const wrapper = this.table;
    const inner = this.tableInner;
    const visible = await wrapper
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (visible) return true;
    return await inner
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
  }

  async isEmptyStateVisible() {
    // Use waitFor instead of a point-in-time isVisible() snapshot.
    // The empty state v-if="!isLoading && services.length === 0" renders only
    // after isLoading flips to false AND Vue flushes the DOM update. An instant
    // snapshot taken immediately after waitForLoad() can land in that
    // microtask gap and return false even when there is no data, causing
    // test.skip guards to not fire and subsequent sortByColumn calls to timeout.
    return await this.emptyState
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }
}
