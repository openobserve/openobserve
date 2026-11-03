const { expect } = require('@playwright/test');

const PAGE_TIMEOUT_MS = 30000;

class FleetRolloutPage {
  constructor(page) {
    this.page = page;
    this.dialog = '[data-test="fleet-new-rollout-dialog"]';
    this.fleetTrigger = '[data-test="fleet-new-rollout-dialog-fleet-trigger"]';
    this.fleetError = '[data-test="fleet-new-rollout-dialog-fleet-error"]';
    this.start = '[data-test="fleet-new-rollout-dialog-start"]';
    // The start and batching items have no data-test; reka renders each item's value on its button.
    this.startAt = '[data-test="fleet-new-rollout-dialog-start"] button[value="at"]';
    this.firstField = '[data-test="fleet-new-rollout-dialog-first-field"]';
    this.firstError = '[data-test="fleet-new-rollout-dialog-first-error"]';
    this.initialField = '[data-test="fleet-new-rollout-dialog-initial-field"]';
    this.maxField = '[data-test="fleet-new-rollout-dialog-max-field"]';
    this.maxError = '[data-test="fleet-new-rollout-dialog-max-error"]';
    this.primaryBtn = '[data-test="o-dialog-primary-btn"]';
  }

  batchingItem(kind) {
    return this.page.locator(`[data-test="fleet-new-rollout-dialog-batching"] button[value="${kind}"]`);
  }

  async expectReady() {
    await expect(this.page.locator(this.dialog)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator(this.start)).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  }

  async expectNoFleetPicked() {
    await expect(this.page.locator(this.fleetTrigger)).toHaveAttribute('data-test-selected-value', '');
  }

  async submit() {
    await this.page.locator(this.dialog).locator(this.primaryBtn).click();
  }

  async expectFleetError(text) {
    await expect(this.page.locator(this.fleetError)).toHaveText(text, { timeout: PAGE_TIMEOUT_MS });
    await expect(this.page.locator(this.dialog)).toBeVisible();
  }

  async expectScheduledDisabled() {
    await expect(this.page.locator(this.startAt)).toBeDisabled({ timeout: PAGE_TIMEOUT_MS });
  }

  async chooseBatching(kind) {
    if ((await this.batchingItem(kind).getAttribute('data-state')) !== 'on') await this.batchingItem(kind).click();
    await expect(this.batchingItem(kind)).toHaveAttribute('data-state', 'on');
  }

  async setCanaryFirst(value) {
    await this.page.locator(this.firstField).fill(String(value));
  }

  async setProgressive(initial, max) {
    await this.page.locator(this.initialField).fill(String(initial));
    await this.page.locator(this.maxField).fill(String(max));
  }

  async expectFirstError(text) {
    await expect(this.page.locator(this.firstError)).toHaveText(text, { timeout: PAGE_TIMEOUT_MS });
  }

  async expectMaxError(text) {
    await expect(this.page.locator(this.maxError)).toHaveText(text, { timeout: PAGE_TIMEOUT_MS });
  }
}

module.exports = FleetRolloutPage;
