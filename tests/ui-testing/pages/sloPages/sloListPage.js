/**
 * SloListPage - the SLO list (views/slos/SloList.vue)
 *
 * Row-level controls interpolate the SLO NAME, not its id:
 *   slos-slolist-edit-<name> / -delete-<name> / -move-<name> / -toggle-<name>
 * so every fixture in these specs uses a unique generated name. Two SLOs
 * sharing a name would produce colliding selectors, and the app does not
 * prevent that (see the open name-validation defect).
 */

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class SloListPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      title: '[data-test="slos-slolist-title"]',
      newButton: '[data-test="slos-slolist-new"]',
      search: '[data-test="slos-slolist-search"]',
      refresh: '[data-test="slos-slolist-refresh"]',
      table: '[data-test="slos-slolist-table"]',
      stats: '[data-test="slos-slolist-stats"]',
      deleteDialog: '[data-test="slos-slolist-delete-dialog"]',
      deleteConfirm: '[data-test="slos-slolist-delete-confirm"]',
      deleteAlertCount: '[data-test="slos-slolist-delete-alert-count"]',
      deleteAlertCountLoading: '[data-test="slos-slolist-delete-alert-count-loading"]',
      deleteAlertCountUnknown: '[data-test="slos-slolist-delete-alert-count-unknown"]',
    };
  }

  // Row-scoped selectors are built, not stored, because they carry the name.
  editButton(name) { return `[data-test="slos-slolist-edit-${name}"]`; }
  deleteButton(name) { return `[data-test="slos-slolist-delete-${name}"]`; }
  moveButton(name) { return `[data-test="slos-slolist-move-${name}"]`; }
  toggleButton(name) { return `[data-test="slos-slolist-toggle-${name}"]`; }
  typeFilterOption(value) { return `[data-test="slos-slolist-type-filter-${value}"]`; }

  // ---------------------------------------------------------------- navigation

  async goto(orgId) {
    await this.page.goto(`/web/slos?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.title)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('SLO list');
  }

  async refresh() {
    await this.page.locator(this.locators.refresh).click();
  }

  // ------------------------------------------------------------------- actions

  async search(text) {
    const field = this.page.locator(`${this.locators.search} [data-test$="-field"]`).first();
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await field.fill(text);
    // Debounced filter; let it settle rather than racing the next assertion.
    await this.page.waitForTimeout(600);
  }

  /**
   * Narrow the list by SLI type.
   *
   * The type filter is an OToggleGroup, NOT an OSelect — there is no popover to
   * open, and the items report `data-state` so the click is verifiable rather
   * than assumed.
   */
  async filterByType(value) {
    const item = this.page.locator(this.typeFilterOption(value));
    await item.waitFor({ state: 'visible', timeout: 20000 });
    await item.click();
    await expect(item).toHaveAttribute('data-state', 'on', { timeout: 10000 });
    await this.page.waitForTimeout(400);
  }

  async openRow(name) {
    // The name cell navigates to detail; scope by the row's own edit control so
    // a substring match on another SLO's name cannot pick the wrong row.
    await this.page.locator(`text="${name}"`).first().click();
  }

  async clickEdit(name) {
    await this.page.locator(this.editButton(name)).click();
  }

  /** Open the delete confirmation without confirming it. */
  async openDeleteDialog(name) {
    await this.page.locator(this.deleteButton(name)).click();
    await expect(this.page.locator(this.locators.deleteDialog)).toBeVisible({ timeout: 15000 });
  }

  /**
   * Toggle the SLO and assert its pressed state actually changed.
   *
   * Reading the state before and after is the point: the enable call goes to the
   * server, and a silent failure would leave the control exactly as it was while
   * the click itself still "succeeded".
   */
  async expectToggleFlips(name) {
    const toggle = this.page.locator(this.toggleButton(name));
    await toggle.waitFor({ state: 'visible', timeout: 20000 });
    const before = await toggle.getAttribute('aria-pressed');
    await toggle.click();
    await expect(toggle).not.toHaveAttribute('aria-pressed', before ?? '', { timeout: 20000 });
    testLogger.info('SLO enabled-state toggled', { name, before });
  }

  /**
   * Delete an SLO through the UI, including the confirm dialog.
   *
   * The dialog reports how many alerts depend on the SLO, and that count is
   * fetched asynchronously — we wait for it to stop loading so the confirm
   * click cannot land while the dialog is still rearranging itself.
   */
  async deleteSlo(name) {
    await this.page.locator(this.deleteButton(name)).click();
    await expect(this.page.locator(this.locators.deleteDialog)).toBeVisible({ timeout: 15000 });
    await expect(
      this.page.locator(this.locators.deleteAlertCountLoading),
    ).toHaveCount(0, { timeout: 20000 });
    await this.page.locator(this.locators.deleteConfirm).click();
    await expect(this.page.locator(this.locators.deleteDialog)).toHaveCount(0, { timeout: 20000 });
    testLogger.info('SLO deleted via UI', { name });
  }

  // ---------------------------------------------------------------- assertions

  async expectListVisible() {
    await expect(this.page.locator(this.locators.title)).toBeVisible();
    await expect(this.page.locator(this.locators.table)).toBeVisible();
    await expect(this.page.locator(this.locators.newButton)).toBeVisible();
  }

  async expectRowVisible(name) {
    await expect(this.page.locator(this.editButton(name))).toBeVisible({ timeout: 30000 });
  }

  /**
   * The row is not in the CURRENT view.
   *
   * Never reloads — this is what search and type filters are asserted with, and
   * a reload would clear the very filter under test.
   */
  async expectRowAbsent(name) {
    await expect(this.page.locator(this.editButton(name))).toHaveCount(0, { timeout: 30000 });
  }

  /**
   * The SLO is gone from the SERVER, not merely from the rendered list.
   *
   * Re-reads the list between checks rather than trusting the asynchronous
   * client-side refresh that follows a delete; racing that refresh makes a
   * correctly-deleted SLO look like it survived. A reload cannot rescue a row
   * that genuinely still exists, so this stays honest.
   *
   * Distinct from `expectRowAbsent` on purpose: reloading is only safe when no
   * filter is in play.
   */
  async expectRowDeleted(name, { timeout = 30000 } = {}) {
    const locator = this.editButton(name);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if ((await this.page.locator(locator).count()) === 0) return;
      await this.page.reload();
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.locator(this.locators.table).waitFor({ state: 'visible', timeout: 20000 });
    }
    await expect(this.page.locator(locator)).toHaveCount(0, { timeout: 5000 });
  }

  /** The async dependent-alert check has finished (the checking banner is gone). */
  async expectAlertCheckResolved() {
    await expect(this.page.locator(this.locators.deleteDialog)).toBeVisible({ timeout: 15000 });
    await expect(
      this.page.locator(this.locators.deleteAlertCountLoading),
    ).toHaveCount(0, { timeout: 20000 });
  }

  /** No dependents -> no warning. Silence here is the correct behaviour. */
  async expectNoAlertCountWarning() {
    await expect(this.page.locator(this.locators.deleteAlertCount)).toHaveCount(0);
    await expect(this.page.locator(this.locators.deleteAlertCountUnknown)).toHaveCount(0);
  }

  /**
   * Click a health stat tile, which doubles as a filter.
   *
   * Keys: budget_blown | at_risk | meeting | no_data | total.
   * `total` clears the filter rather than applying one.
   */
  async clickStat(key) {
    const tile = this.page.locator(`[data-test="slos-slolist-stat-${key}"]`);
    await tile.waitFor({ state: 'visible', timeout: 20000 });
    await tile.click();
    await this.page.waitForTimeout(500);
  }

  async closeDialogIfOpen() {
    const dialog = this.page.locator(this.locators.deleteDialog);
    if (await dialog.count() > 0 && await dialog.isVisible()) {
      await this.page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0, { timeout: 10000 });
    }
  }
}

export default SloListPage;
