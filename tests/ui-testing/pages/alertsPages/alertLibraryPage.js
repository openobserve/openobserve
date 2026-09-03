/**
 * AlertLibraryPage - Page object for the Alert Library (browse / filter / preview / install).
 *
 * Covers the gallery page, the left rail (severity + category facets), the
 * readiness stat strip, cross-surface selection, the detail drawer and the
 * 5-step install wizard. Selectors are the feature's own data-test attributes.
 *
 * Reuses: OSelect dropdown helper (reka trigger gotcha) and the O2 OInput
 * `-field` inner-input gotcha for text/number inputs.
 */

import { expect } from '@playwright/test';
import { openOSelectDropdown } from './oselectHelpers.js';
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

export class AlertLibraryPage {
  constructor(page) {
    this.page = page;
    this.l = {
      page: '[data-test="alert-library-page"]',
      title: '[data-test="alert-library-title"]',
      refresh: '[data-test="alert-library-refresh"]',
      contribute: '[data-test="alert-library-contribute"]',
      tab: '[data-test="alert-section-tab-alertLibrary"]',
      // toolbar
      search: '[data-test="alert-library-search"]',
      searchField: '[data-test="alert-library-search"] input',
      selectAllInView: '[data-test="alert-library-select-all-in-view"]',
      selectionBar: '[data-test="alert-library-selection-bar"]',
      clearSelection: '[data-test="alert-library-clear-selection"]',
      addSelected: '[data-test="alert-library-add-selected"]',
      // stat strip (readiness filter)
      statReady: '[data-test="alert-library-stat-ready"]',
      statNeedsData: '[data-test="alert-library-stat-missing"]',
      statAll: '[data-test="alert-library-stat-all"]',
      // grid + rail
      grid: '[data-test="alert-library-grid"]',
      railSeverity: '[data-test="alert-library-rail-severity"]',
      railSearchCategories: '[data-test="alert-library-rail-search-categories"]',
      railClearCategories: '[data-test="alert-library-rail-clear-categories"]',
      // page states
      error: '[data-test="alert-library-error"]',
      emptyCatalog: '[data-test="alert-library-empty-catalog"]',
      noResults: '[data-test="alert-library-no-results"]',
      // drawer
      drawer: '[data-test="alert-library-drawer"]',
      drawerLoading: '[data-test="alert-library-drawer-loading"]',
      drawerLoadFailed: '[data-test="alert-library-drawer-load-failed"]',
      drawerPreview: '[data-test="alert-library-drawer-preview"]',
      drawerEvaluation: '[data-test="alert-library-drawer-evaluation"]',
      drawerInstall: '[data-test="alert-library-drawer-install"]',
      drawerCustomize: '[data-test="alert-library-drawer-customize"]',
      // install wizard
      dialog: '[data-test="alert-library-install-dialog"]',
      destinationStep: '[data-test="alert-library-install-destination-step"]',
      destination: '[data-test="alert-library-install-destination"]',
      destinationsEmpty: '[data-test="alert-library-install-destinations-empty"]',
      installSelectAll: '[data-test="alert-library-install-select-all"]',
      installClear: '[data-test="alert-library-install-clear"]',
      installCount: '[data-test="alert-library-install-count"]',
      tuneToggle: '[data-test="alert-library-install-tune-toggle"]',
      tuneFrequency: '[data-test="alert-library-install-tune-frequency"]',
      tuneSilence: '[data-test="alert-library-install-tune-silence"]',
      summary: '[data-test="alert-library-install-summary"]',
      confirmLarge: '[data-test="alert-library-install-confirm-large"]',
      next: '[data-test="alert-library-install-next"]',
      back: '[data-test="alert-library-install-back"]',
      run: '[data-test="alert-library-install-run"]',
      retry: '[data-test="alert-library-install-retry"]',
      done: '[data-test="alert-library-install-done"]',
      cancel: '[data-test="alert-library-install-cancel"]',
    };
  }

  // ── navigation ────────────────────────────────────────────────────────────
  async openViaUrl() {
    const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
    await this.page.goto(`${base}/web/alert-library?org_identifier=${getOrgIdentifier()}`);
    await this.waitForGallery();
  }

  async openViaTab() {
    await this.page.locator(this.l.tab).click();
    await this.waitForGallery();
  }

  async waitForGallery() {
    await expect(this.page.locator(this.l.page)).toBeVisible({ timeout: 30000 });
    // Grid OR a terminal empty/error state — never hang on the skeleton.
    await this.page
      .locator(`${this.l.grid}, ${this.l.error}, ${this.l.emptyCatalog}, ${this.l.noResults}`)
      .first()
      .waitFor({ state: 'visible', timeout: 30000 });
  }

  // ── browse / filter / search ──────────────────────────────────────────────
  async search(text) {
    const field = this.page.locator(this.l.searchField);
    await field.waitFor({ state: 'attached', timeout: 10000 });
    await field.fill(text, { force: true });
    await this.page.waitForTimeout(400); // 200ms debounce + render
  }

  async filterReady() { await this.page.locator(this.l.statReady).click(); }
  async filterNeedsData() { await this.page.locator(this.l.statNeedsData).click(); }
  async filterAll() { await this.page.locator(this.l.statAll).click(); }

  async selectSeverity(id) {
    await this.page.locator(`[data-test="alert-library-rail-severity-${id}"]`).click();
  }

  async toggleCategory(id) {
    await this.page.locator(`[data-test="alert-library-rail-category-${id}"]`).click();
  }

  async cardCount() {
    return this.page.locator('[data-test^="alert-library-card-"][data-selected]').count();
  }

  // ── cards / selection ─────────────────────────────────────────────────────
  card(id) { return this.page.locator(`[data-test="alert-library-card-${id}"]`); }
  cardTitle(id) { return this.page.locator(`[data-test="alert-library-card-title-${id}"]`); }
  needsDataChip(id) {
    return this.card(id).locator('[data-test="alert-library-card-needs-data"]');
  }

  async firstCardId() {
    const first = this.page.locator('[data-test^="alert-library-card-title-"]').first();
    await first.waitFor({ state: 'visible', timeout: 15000 });
    const dt = await first.getAttribute('data-test');
    return dt.replace('alert-library-card-title-', '');
  }

  async selectCard(id) {
    await this.page.locator(`[data-test="alert-library-select-${id}"]`).click();
  }

  async selectAllInViewToggle() {
    await this.page.locator(this.l.selectAllInView).click();
  }

  async selectGroup(id) {
    await this.page.locator(`[data-test="alert-library-select-group-${id}"]`).click();
  }

  async addSelected() {
    await this.page.locator(this.l.addSelected).click();
    await expect(this.page.locator(this.l.dialog)).toBeVisible({ timeout: 15000 });
  }

  async clearSelection() { await this.page.locator(this.l.clearSelection).click(); }

  async selectedCountInBar() {
    const bar = this.page.locator(this.l.selectionBar);
    if (!(await bar.isVisible().catch(() => false))) return 0;
    return Number((await bar.getAttribute('data-selected')) || 0);
  }

  // ── drawer ────────────────────────────────────────────────────────────────
  async openCard(id) {
    await this.cardTitle(id).click();
    await expect(this.page.locator(this.l.drawer)).toBeVisible({ timeout: 15000 });
    await this.waitDrawerLoaded();
  }

  async waitDrawerLoaded() {
    // Install button enables only once the file GET resolves.
    await expect(this.page.locator(this.l.drawerInstall)).toBeEnabled({ timeout: 20000 });
  }

  async installFromDrawer() {
    await this.page.locator(this.l.drawerInstall).click();
    await expect(this.page.locator(this.l.dialog)).toBeVisible({ timeout: 15000 });
  }

  async customizeFromDrawer() {
    await this.page.locator(this.l.drawerCustomize).click();
  }

  // ── install wizard ────────────────────────────────────────────────────────
  async pickDestination(name) {
    const root = this.page.locator(this.l.destination);
    await root.waitFor({ state: 'visible', timeout: 10000 });
    await openOSelectDropdown(this.page, root);
    await this.page.waitForTimeout(500);
    // Options are virtualized; narrow via the popover search box (the -search
    // data-test IS the input) so the target row is actually rendered.
    const search = this.page.locator('[data-test="alert-library-install-destination-search"]');
    if (await search.isVisible({ timeout: 2000 }).catch(() => false)) {
      await search.fill(name, { force: true });
      await this.page.waitForTimeout(400);
    }
    const options = this.page.locator('[data-test$="-popover"] [data-test$="-option"]');
    await expect(options.first()).toBeVisible({ timeout: 8000 });
    const match = options.filter({ hasText: name }).first();
    if (await match.isVisible({ timeout: 3000 }).catch(() => false)) {
      await match.click();
    } else {
      testLogger.warn('destination option not found by name; selecting first', { name });
      await options.first().click();
    }
  }

  async next() { await this.page.locator(this.l.next).click(); }
  async back() { await this.page.locator(this.l.back).click(); }

  async enableTune() {
    const toggle = this.page.locator(this.l.tuneToggle);
    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  }

  async setFrequency(minutes) { await this._fillField(this.l.tuneFrequency, minutes); }
  async setSilence(minutes) { await this._fillField(this.l.tuneSilence, minutes); }

  async confirmLargeBatch() {
    const box = this.page.locator(this.l.confirmLarge);
    if ((await box.getAttribute('aria-checked')) !== 'true') await box.click();
  }

  isLargeConfirmVisible() { return this.page.locator(this.l.confirmLarge).isVisible(); }

  async run() { await this.page.locator(this.l.run).click(); }

  async waitResult(id, status = 'installed', timeout = 30000) {
    await expect(this.page.locator(`[data-test="alert-library-install-result-${id}"]`))
      .toHaveAttribute('data-status', status, { timeout });
  }

  async done() {
    await this.page.locator(this.l.done).click();
    await expect(this.page.locator(this.l.dialog)).toBeHidden({ timeout: 10000 });
  }

  // ── API verification (read the installed alert back) ──────────────────────
  async getInstalledAlert(alertName) {
    const base = process.env.ZO_BASE_URL || 'http://localhost:5080';
    const org = getOrgIdentifier();
    const headers = getAuthHeaders();
    // The list endpoint returns a summary; fetch the alert detail for the full
    // body (destinations, context_attributes, trigger_condition).
    const listResp = await this.page.request.get(`${base}/api/v2/${org}/alerts`, { headers });
    if (!listResp.ok()) {
      testLogger.warn('alerts list read-back not ok', { status: listResp.status() });
      return null;
    }
    const listBody = await listResp.json().catch(() => null);
    const arr = Array.isArray(listBody) ? listBody : listBody?.list || [];
    const meta = arr.find((a) => (a.name || a.alert_name) === alertName);
    if (!meta) return null;
    const id = meta.alert_id || meta.id;
    if (!id) return meta;
    const detailResp = await this.page.request.get(`${base}/api/v2/${org}/alerts/${id}`, { headers });
    if (!detailResp.ok()) return meta;
    return (await detailResp.json().catch(() => meta)) || meta;
  }

  // ── internals ─────────────────────────────────────────────────────────────
  async _fillField(rootSelector, value) {
    // O2 OInput: the data-test is on a wrapper; the real input is the inner node.
    const inner = this.page.locator(`${rootSelector} input`);
    await inner.waitFor({ state: 'attached', timeout: 10000 });
    await inner.fill(String(value), { force: true });
  }
}

export default AlertLibraryPage;
