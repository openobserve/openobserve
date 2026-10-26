import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class IncidentsPage {
  constructor(page) {
    this.page = page;
    this.statusFilterGroup = '[data-test="incident-status-filter-group"]';
    this.incidentTable = '[data-test="incident-list-table"]';
    this.emptyState = '[data-test="o2-table-empty"]';
  }

  statusTab(status) {
    return this.page.locator(`[data-test="incident-status-filter-${status}"]`);
  }

  // Severity tiles are plain buttons carrying aria-pressed, not OToggleGroup items.
  severityTile(key) {
    return this.page.locator(`[data-test="incident-severity-${key}"]`);
  }

  async goto(status = null) {
    const org = process.env.ORGNAME || 'default';
    const base = (process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
    const suffix = status ? `&status=${status}` : '';
    await this.page.goto(`${base}/web/incidents?org_identifier=${org}${suffix}`);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await expect(this.page.locator(this.statusFilterGroup)).toBeVisible({ timeout: 30000 });
  }

  /** OToggleGroupItem puts data-state on the wrapper or an inner node. */
  async statusTabState(status) {
    return await this.page.evaluate((s) => {
      const el = document.querySelector(`[data-test="incident-status-filter-${s}"]`);
      if (!el) return null;
      return el.getAttribute('data-state')
        || el.querySelector('[data-state]')?.getAttribute('data-state')
        || null;
    }, status);
  }

  async expectOnlyStatusSelected(expected, all = ['active', 'resolved', 'all']) {
    for (const status of all) {
      const state = await this.statusTabState(status);
      const want = status === expected ? 'on' : 'off';
      expect(state, `status tab "${status}" should be ${want}`).toBe(want);
    }
    testLogger.info(`Status filter is on "${expected}" only`);
  }

  async clickStatusTab(status) {
    await this.statusTab(status).click({ force: true });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async clickSeverityTile(key) {
    await this.severityTile(key).click({ force: true });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async expectSeverityPressed(key) {
    await expect(this.severityTile(key),
      `severity tile "${key}" should be the selected facet`
    ).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
  }

  async expectSeverityNotPressed(key) {
    await expect(this.severityTile(key),
      `severity tile "${key}" should not be the selected facet`
    ).toHaveAttribute('aria-pressed', 'false', { timeout: 10000 });
  }

  async expectListUsable() {
    const table = this.page.locator(this.incidentTable);
    const empty = this.page.locator(this.emptyState);
    const ok = (await table.isVisible().catch(() => false))
      || (await empty.isVisible().catch(() => false));
    expect(ok, 'the incident list must render either rows or its empty state').toBe(true);
  }

  _incidentRow(text) {
    return this.page.locator(this.incidentTable).locator('[data-test^="o2-table-row-"]').filter({ hasText: text });
  }

  async searchIncidents(text) {
    await this.page.locator('[data-test="incident-search-input-field"]').fill(text);
    await expect(this._incidentRow(text).first()).toBeVisible({ timeout: 20000 });
  }

  async expectMutedTag(rowText, label) {
    await expect(this._incidentRow(rowText).first().locator('[data-test="incident-list-muted"]')).toHaveText(label, { timeout: 20000 });
  }

  async expectNoMutedTag(rowText) {
    await expect(this._incidentRow(rowText).first()).toBeVisible({ timeout: 20000 });
    await expect(this._incidentRow(rowText).first().locator('[data-test="incident-list-muted"]')).toHaveCount(0);
  }

  async openIncidentRow(rowText) {
    await this._incidentRow(rowText).first().click();
  }

  async expectMutedBanner(prefix) {
    await expect(this.page.locator('[data-test="incident-detail-muted-banner"]')).toContainText(prefix, { timeout: 20000 });
  }

  async clickMutedViewDowntime() {
    await this.page.locator('[data-test="incident-detail-muted-view"]').click();
  }
}
