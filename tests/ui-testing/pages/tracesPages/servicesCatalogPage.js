// servicesCatalogPage.js
// Page object for Service Catalog feature in Traces module
// Selectors verified against: ServicesCatalog.vue

import { expect } from '@playwright/test';

export class ServicesCatalogPage {
  constructor(page) {
    this.page = page;

    // Toolbar
    this.streamSelector = '[data-test="services-catalog-stream-selector"]';
    this.filterInputWrapper = '[data-test="services-catalog-filter-input"]';
    this.filterClearBtn = '[data-test="services-catalog-filter-input"] [aria-label="Clear"]';
    this.filterInput = `${this.filterInputWrapper} input`;
    this.statusPill = '[data-test="services-catalog-status-pill"]';

    // Status chips
    this.pillCritical = '[data-test="services-catalog-pill-critical"]';
    this.pillWarning = '[data-test="services-catalog-pill-warning"]';
    this.pillDegraded = '[data-test="services-catalog-pill-degraded"]';

    // Table
    this.table = '[data-test="services-catalog-table"]';
    this.emptyState = '[data-test="services-catalog-empty"]';
    this.loading = '[data-test="services-catalog-loading"]';

    // Pagination
    this.paginationBar = '[data-test="services-catalog-pagination-bar"]';
    this.rowsPerPage = '[data-test="services-catalog-records-per-page"]';
    this.pagination = '[data-test="services-catalog-pagination"]';

    // Legend
    this.legend = '[data-test="services-catalog-status-legend"]';
    this.legendCritical = '[data-test="services-catalog-legend-critical"]';
    this.legendWarning = '[data-test="services-catalog-legend-warning"]';
    this.legendDegraded = '[data-test="services-catalog-legend-degraded"]';
    this.legendHealthy = '[data-test="services-catalog-legend-healthy"]';

    // Side panel
    this.sidePanel = '[data-test="services-catalog-node-side-panel"]';
  }

  // ===== NAVIGATION =====

  async navigate(period = '24h') {
    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    await this.page.goto(`${baseUrl}/web/traces?tab=services-catalog&org_identifier=${org}&period=${period}`, {
      timeout: 60000,
    });
    // Use load instead of networkidle — networkidle hangs on SPAs with websockets
    await this.page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  }

  async waitForLoad() {
    // Wait for loading spinner to disappear
    await this.page.locator(this.loading)
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
    // Wait for either table or empty state
    await Promise.race([
      this.page.locator(this.table).waitFor({ state: 'visible', timeout: 10000 }),
      this.page.locator(this.emptyState).waitFor({ state: 'visible', timeout: 10000 }),
    ]).catch(() => {});
  }

  // ===== TOOLBAR =====

  async selectStream(streamName) {
    await this.page.locator(this.streamSelector).click();
    // Wait for the option to appear (stream may be newly created)
    const option = this.page.getByRole('option', { name: streamName });
    await option.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await option.click().catch(() => {});
    // Dismiss the dropdown to prevent portal interference with subsequent clicks
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page.waitForTimeout(300);
  }

  async filterByServiceName(text) {
    const input = this.page.locator(this.filterInput);
    await input.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    await input.fill(text);
    await this.page.waitForTimeout(500); // 300ms debounce + buffer
  }

  async getFilterInputLocator() {
    return this.page.locator(this.filterInput);
  }

  async typeFilterCharByChar(text) {
    const input = this.page.locator(this.filterInput);
    await input.click();
    await input.fill('');
    for (const char of text) {
      await input.press(char);
      await this.page.waitForTimeout(50);
    }
    // Wait for 300ms debounce
    await this.page.waitForTimeout(500);
  }

  async clearFilter() {
    // Use fill('') instead of clicking Quasar's clear icon which sets value to null (bug #11689)
    const input = this.page.locator(this.filterInput);
    await input.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    await input.fill('');
    await this.page.waitForTimeout(500);
  }

  async getFilterInputValue() {
    return await this.page.locator(this.filterInput).inputValue();
  }

  // ===== STATUS PILLS =====

  async getServiceCount() {
    const text = await this.page.locator(this.statusPill).textContent().catch(() => '0');
    const match = text.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  async getFilteredCount() {
    const text = await this.page.locator(this.statusPill).textContent().catch(() => '0/0');
    // Match "N/M" (filtered) or just "N" (unfiltered total)
    const filteredMatch = text.match(/^(\d+)\//);
    if (filteredMatch) return parseInt(filteredMatch[1]);
    // Unfiltered state — pill shows just the total, so "filtered" equals total
    const totalMatch = text.match(/^(\d+)/);
    return totalMatch ? parseInt(totalMatch[1]) : 0;
  }

  async getCriticalCount() {
    const text = await this.page.locator(this.pillCritical).textContent().catch(() => '0');
    const match = text.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  async getWarningCount() {
    const text = await this.page.locator(this.pillWarning).textContent().catch(() => '0');
    const match = text.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  async getDegradedCount() {
    const text = await this.page.locator(this.pillDegraded).textContent().catch(() => '0');
    const match = text.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  async isStatusPillVisible() {
    return await this.page.locator(this.statusPill).isVisible().catch(() => false);
  }

  async isCriticalPillVisible() {
    return await this.page.locator(this.pillCritical).isVisible().catch(() => false);
  }

  async isWarningPillVisible() {
    return await this.page.locator(this.pillWarning).isVisible().catch(() => false);
  }

  async isDegradedPillVisible() {
    return await this.page.locator(this.pillDegraded).isVisible().catch(() => false);
  }

  // ===== TABLE =====

  async getRowCount() {
    // Count status badges (one per row) — these are rendered inside TenstackTable
    return await this.page.locator('[data-test^="services-catalog-status-"]').count();
  }

  async getServiceCellText(serviceName) {
    return await this.page.locator(`[data-test="services-catalog-service-link-${serviceName}"]`).textContent();
  }

  async getErrorRate(serviceName) {
    const text = await this.page.locator(`[data-test="services-catalog-error-rate-${serviceName}"]`).textContent();
    return text;
  }

  async getRequests(serviceName) {
    const text = await this.page.locator(`[data-test="services-catalog-requests-${serviceName}"]`).textContent();
    return text;
  }

  async getErrors(serviceName) {
    const text = await this.page.locator(`[data-test="services-catalog-errors-${serviceName}"]`).textContent();
    return text;
  }

  async getStatusBadge(serviceName) {
    const el = this.page.locator(`[data-test="services-catalog-status-${serviceName}"]`);
    return await el.textContent().catch(() => '');
  }

  async serviceRowExists(serviceName) {
    return await this.page.locator(`[data-test="services-catalog-service-link-${serviceName}"]`)
      .isVisible().catch(() => false);
  }

  // ===== ROW CLICK / SIDE PANEL =====

  async clickServiceRow(serviceName) {
    // Click the status badge — a plain <span> in the row that reliably triggers
    // TenstackTable's @click:dataRow handler (unlike TraceServiceCell which is a child component)
    await this.page.locator(`[data-test="services-catalog-status-${serviceName}"]`).click();
    await this.page.waitForTimeout(300);
  }

  async isSidePanelVisible() {
    return await this.page.locator(this.sidePanel).isVisible({ timeout: 5000 }).catch(() => false);
  }

  async expectSidePanelVisible() {
    await expect(this.page.locator(this.sidePanel)).toBeVisible({ timeout: 30000 });
  }

  async closeSidePanel() {
    // Click the close button inside the side panel
    const closeBtn = this.page.locator(`${this.sidePanel} button[aria-label="Close"]`);
    await closeBtn.click().catch(() => {});
    await this.page.locator(this.sidePanel)
      .waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  // ===== PAGINATION =====

  async getRowsPerPage() {
    const el = this.page.locator(this.rowsPerPage);
    const text = await el.textContent().catch(() => '25');
    return parseInt(text) || 25;
  }

  async setRowsPerPage(count) {
    await this.page.locator(this.rowsPerPage).click();
    await this.page.waitForTimeout(300);
    // Use exact match to avoid "10" matching "100"
    await this.page.getByRole('option', { name: String(count), exact: true }).click();
    await this.page.waitForTimeout(500);
  }

  async getPageCount() {
    const pageBtns = this.page.locator(`${this.pagination} button`);
    const count = await pageBtns.count();
    const texts = [];
    for (let i = 0; i < count; i++) {
      const t = (await pageBtns.nth(i).textContent() ?? '').trim();
      texts.push(t);
    }
    return texts.filter(t => /^\d+$/.test(t)).length;
  }

  async goToPage(n) {
    // Quasar q-pagination sets aria-label="Page N" on page number buttons.
    // We also try a fallback for other rendering modes.
    const pageBtn = this.page.locator(`${this.pagination} button[aria-label="Page ${n}"]`);
    const count = await pageBtn.count();
    if (count > 0) {
      await pageBtn.click();
    } else {
      // Fallback: click button with exact text (avoids "2" matching "12" or "20")
      const allBtns = this.page.locator(`${this.pagination} button`);
      const btnCount = await allBtns.count();
      for (let i = 0; i < btnCount; i++) {
        const text = (await allBtns.nth(i).textContent()).trim();
        if (text === String(n)) {
          await allBtns.nth(i).click();
          break;
        }
      }
    }
    await this.page.waitForTimeout(500);
  }

  async isPrevDisabled() {
    const prevBtn = this.page.locator(`${this.pagination} button[aria-label="Previous page"]`);
    return await prevBtn.isDisabled().catch(() => true);
  }

  async isNextDisabled() {
    const nextBtn = this.page.locator(`${this.pagination} button[aria-label="Next page"]`);
    return await nextBtn.isDisabled().catch(() => true);
  }

  async getCurrentPage() {
    // Quasar QPagination sets aria-current="true" on the active button
    const text = await this.page.locator(`${this.pagination} button[aria-current="true"]`)
      .textContent().catch(() => '1');
    return parseInt(text) || 1;
  }

  async isPaginationVisible() {
    return await this.page.locator(this.paginationBar).isVisible().catch(() => false);
  }

  // ===== COLUMN SORTING =====

  async sortByColumn(columnKey) {
    const header = this.page.locator(`[data-test="o2-table-th-${columnKey}"]`);
    await header.scrollIntoViewIfNeeded();
    await header.click();
    await this.page.waitForTimeout(300);
  }

  async getSortIcon(columnKey) {
    const th = this.page.locator(`[data-test="o2-table-th-${columnKey}"]`);
    const icon = th.locator('.material-icons, .q-icon');
    const text = await icon.textContent().catch(() => '');
    return text;
  }

  async getFirstServiceName() {
    const firstCell = this.page.locator('[data-test^="services-catalog-service-link-"]').first();
    const text = await firstCell.textContent().catch(() => '');
    return text.trim();
  }

  // ===== LEGEND =====

  async isLegendVisible() {
    return await this.page.locator(this.legend).isVisible().catch(() => false);
  }

  async getLegendCount(status) {
    const el = this.page.locator(`[data-test="services-catalog-legend-${status}"]`);
    const text = await el.textContent().catch(() => '0');
    const match = text.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  // ===== EMPTY STATE =====

  async isTableVisible() {
    return await this.page.locator(this.table).isVisible().catch(() => false);
  }

  async isEmptyStateVisible() {
    return await this.page.locator(this.emptyState).isVisible().catch(() => false);
  }

}
