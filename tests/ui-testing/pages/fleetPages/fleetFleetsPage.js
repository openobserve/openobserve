const { expect } = require('@playwright/test');

const PAGE_TIMEOUT_MS = 30000;
const DASH = '—';

class FleetFleetsPage {
  constructor(page) {
    this.page = page;
    this.rail = '[data-test="fleet-rail"]';
    this.panel = '[data-test="fleet-fleets-panel"]';
    this.panelName = '[data-test="fleet-fleets-name"]';
    this.addCollectorBtn = '[data-test="fleet-fleets-add-collector"]';
    this.deployBtn = '[data-test="fleet-fleets-change-version"]';
    this.nameDialog = '[data-test="fleet-rail-name-dialog"]';
    this.nameDialogField = '[data-test="fleet-rail-name-dialog-name-field"]';
    this.dialogPrimaryBtn = '[data-test="o-dialog-primary-btn"]';
    this.rolloutsDrawer = '[data-test="fleet-rollouts-drawer"]';
    this.rolloutStatus = '[data-test="fleet-rollouts-status"]';
  }

  railItem(fleetId) {
    return this.page.locator(`[data-test="fleet-rail-item-${fleetId}"]`);
  }

  async expectPanelFor(name) {
    await expect(this.page.locator(this.panel)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator(this.panelName)).toHaveText(name);
  }

  async expectRailItemActive(fleetId) {
    await expect(this.railItem(fleetId)).toHaveAttribute('data-state', 'active', { timeout: PAGE_TIMEOUT_MS });
  }

  // The rail shows a collector count only for a fleet the caller may read, and a dash otherwise.
  async expectRailItemReadable(fleetId, readable) {
    const item = this.railItem(fleetId);
    await expect(item).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    if (readable) await expect(item).not.toContainText(DASH);
    else await expect(item).toContainText(DASH);
  }

  async openAddCollector() {
    await expect(this.page.locator(this.panel)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await this.page.locator(this.addCollectorBtn).click();
  }

  async openDeploy() {
    await expect(this.page.locator(this.panel)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await this.page.locator(this.deployBtn).click();
  }

  async submitNewFleet(name) {
    const dialog = this.page.locator(this.nameDialog);
    await expect(dialog).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await dialog.locator(this.nameDialogField).fill(name);
    await dialog.locator(this.dialogPrimaryBtn).click();
  }

  async expectRolloutDrawerStatus(text) {
    await expect(this.page.locator(this.rolloutsDrawer)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator(this.rolloutStatus)).toHaveText(text, { timeout: PAGE_TIMEOUT_MS });
  }
}

module.exports = FleetFleetsPage;
