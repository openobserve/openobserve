const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

const PAGE_TIMEOUT_MS = 30000;

class FleetManagerPage {
  constructor(page) {
    this.page = page;
    this.navDataTile = '[data-test="menu-link-\\/streams-item"]';
    this.navFleetItem = '[data-test="nav-group-item-fleet"]';
    this.managerPage = '[data-test="fleet-manager-page"]';
    this.flowOverview = '[data-test="fleet-flow-overview"]';
    this.flowError = '[data-test="fleet-flow-overview-error"]';
    this.flowNoFleets = '[data-test="fleet-flow-overview-no-fleets"]';
    this.fleetsArea = '[data-test="fleet-fleets"]';
    this.fleetsNoAccess = '[data-test="fleet-fleets-no-access"]';
    this.fleetsNotFound = '[data-test="fleet-fleets-not-found"]';
    this.fleetsPanel = '[data-test="fleet-fleets-panel"]';
    this.tableForbidden = '[data-test="o2-table-forbidden"]';
    this.collectorsScopeAll = '[data-test="fleet-collectors-scope-all"]';
    this.columnToggleBtn = '[data-test="o2-table-column-toggle-btn"]';
    this.columnTogglePanel = '[data-test="o2-table-column-toggle-panel"]';
    this.columnResetBtn = '[data-test="o2-table-column-toggle-reset-btn"]';
    this.settingsRoot = '[data-test="fleet-settings"]';
    this.settingsTargetVersion = '[data-test="fleet-settings-target-version"]';
    this.settingsAlerts = '[data-test="fleet-settings-alerts"]';
    this.settingsAlertLibrary = '[data-test="fleet-settings-alert-library"]';
    this.errorToast = '[data-test^="o-toast-"][data-test-variant="error"]';
  }

  tab(name) {
    return this.page.locator(`[data-test="fleet-manager-tab-${name}"]`);
  }

  createButton(tab) {
    return this.page.locator(`[data-test="fleet-manager-create-${tab}"]`);
  }

  collectorStat(key) {
    return this.page.locator(`[data-test="fleet-collectors-stat-${key}"]`);
  }

  tableHeader(columnId) {
    return this.page.locator(`th[data-test="o2-table-th-${columnId}"]`);
  }

  columnToggleCheckbox(columnId) {
    return this.page.locator(`[data-test="o2-table-column-toggle-item-${columnId}"] button[role="checkbox"]`);
  }

  columnToggleItem(columnId) {
    return this.page.locator(`[data-test="o2-table-column-toggle-item-${columnId}"]`);
  }

  // Fail loudly, never skip: these specs run only on an enterprise build with fleet management on.
  async assertEnabled() {
    const base = process.env.ZO_BASE_URL.replace(/\/$/, '');
    const config = await this.page.request.get(`${base}/config`);
    const fleetEnabled = config.ok() ? (await config.json())?.fleet_enabled : undefined;
    const list = await this.page.request.get(`${base}/api/${getOrgIdentifier()}/fleet/fleets?offset=0&limit=1`, {
      headers: getAuthHeaders(),
    });
    if (fleetEnabled !== true || list.status() !== 200) {
      throw new Error(
        `Fleet management is NOT available on ${base} (/config fleet_enabled=${fleetEnabled}, GET /fleet/fleets -> ${list.status()}). ` +
          'These specs are enterprise-only and must never be skipped: run them on an enterprise build with O2_FLEET_ENABLED=true.',
      );
    }
  }

  async gotoFleet(query = {}) {
    const params = new URLSearchParams({ org_identifier: getOrgIdentifier(), ...query });
    await this.page.goto(`${process.env.ZO_BASE_URL}/web/fleet?${params}`, { waitUntil: 'domcontentloaded' });
    await expect(this.page.locator(this.managerPage)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async openFromNav() {
    const tile = this.page.locator(this.navDataTile);
    const item = this.page.locator(this.navFleetItem);
    await expect(tile).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    // The flyout opens on hover after a delay and closes on scroll, so open-and-reveal retries as a unit.
    await expect(async () => {
      await this.page.mouse.move(0, 0);
      await tile.hover();
      await expect(item).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: PAGE_TIMEOUT_MS });
    await item.click({ force: true });
    await expect(this.page.locator(this.managerPage)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async clickCreate(tab) {
    await this.createButton(tab).click();
  }

  async clickTab(name) {
    await this.tab(name).click();
    await this.expectTabActive(name);
  }

  async expectTabActive(name) {
    await expect(this.tab(name)).toHaveAttribute('data-state', 'active', { timeout: PAGE_TIMEOUT_MS });
  }

  async expectOnFleetRoute(query = {}) {
    await expect
      .poll(() => {
        const url = new URL(this.page.url());
        if (!url.pathname.replace(/\/+$/, '').endsWith('/fleet')) return `path ${url.pathname}`;
        for (const [k, v] of Object.entries(query)) {
          if (url.searchParams.get(k) !== v) return `${k}=${url.searchParams.get(k)}`;
        }
        return 'ok';
      }, { timeout: PAGE_TIMEOUT_MS, message: `URL never matched /web/fleet ${JSON.stringify(query)}` })
      .toBe('ok');
  }

  async expectQueryParam(key, value) {
    await expect.poll(() => new URL(this.page.url()).searchParams.get(key), { timeout: PAGE_TIMEOUT_MS }).toBe(value);
  }

  async goBackAndExpectLeftFleet() {
    await this.page.goBack({ waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => new URL(this.page.url()).pathname, { timeout: PAGE_TIMEOUT_MS })
      .not.toMatch(/\/fleet\/?$/);
  }

  async expectOverviewVisible() {
    await this.expectTabActive('overview');
    await expect(this.page.locator(this.flowOverview)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async expectOverviewNoFleetsWithoutErrorBanner() {
    await expect(this.page.locator(this.flowNoFleets)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator(this.flowError)).toHaveCount(0);
  }

  async expectFleetNoAccess(text) {
    const panel = this.page.locator(this.fleetsNoAccess);
    await expect(panel).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    if (text) await expect(panel).toContainText(text);
  }

  async expectCollectorsForbidden() {
    await expect(this.page.locator(this.fleetsArea).locator(this.tableForbidden)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async expectCollectorsNotForbidden() {
    await expect(this.page.locator(this.fleetsArea).locator(this.tableForbidden)).toHaveCount(0);
  }

  async expectFleetNotFound(text) {
    const panel = this.page.locator(this.fleetsNotFound);
    await expect(panel).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await expect(panel).toContainText(text);
  }

  async expectFleetPanelHidden() {
    await expect(this.page.locator(this.fleetsPanel)).toHaveCount(0);
  }

  async expectAllFleetsScope() {
    await expect(this.page.locator(this.collectorsScopeAll)).toHaveAttribute('data-state', 'on', { timeout: PAGE_TIMEOUT_MS });
    await expect(this.tableHeader('fleet')).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async expectStatPressed(key) {
    await expect(this.collectorStat(key)).toHaveAttribute('aria-pressed', 'true', { timeout: PAGE_TIMEOUT_MS });
  }

  async openColumnMenu() {
    const panel = this.page.locator(this.columnTogglePanel);
    await expect(async () => {
      if (!(await panel.isVisible())) await this.page.locator(this.columnToggleBtn).first().click();
      await expect(panel).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: PAGE_TIMEOUT_MS });
  }

  async expectColumnChecked(columnId, checked) {
    await this.openColumnMenu();
    await expect(this.columnToggleCheckbox(columnId)).toHaveAttribute('data-state', checked ? 'checked' : 'unchecked');
  }

  async toggleColumn(columnId) {
    await this.openColumnMenu();
    await this.columnToggleItem(columnId).click();
  }

  async resetColumns() {
    await this.openColumnMenu();
    await this.page.locator(this.columnResetBtn).click();
  }

  async expectColumnShown(columnId, shown) {
    if (shown) await expect(this.tableHeader(columnId)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    else await expect(this.tableHeader(columnId)).toHaveCount(0);
  }

  async expectSettingsWithoutFleetAlerts(removedTexts) {
    await expect(this.page.locator(this.settingsTargetVersion)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator(this.settingsAlerts)).toHaveCount(0);
    await expect(this.page.locator(this.settingsAlertLibrary)).toHaveCount(0);
    const settings = this.page.locator(this.settingsRoot);
    for (const text of removedTexts) await expect(settings).not.toContainText(text);
  }

  async expectErrorToast(text) {
    await expect(this.page.locator(this.errorToast).filter({ hasText: text }).first()).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    testLogger.info('Error toast shown', { text });
  }

  async expectAnyErrorToast() {
    await expect(this.page.locator(this.errorToast).first()).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }
}

module.exports = FleetManagerPage;
