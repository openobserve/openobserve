import { expect } from '@playwright/test';

export class LogsRecentSearchesPage {
  constructor(page) {
    this.page = page;
    this.openBtn = '[data-test="logs-search-bar-recent-searches-btn"]';
    this.drawer = '[data-test="recent-searches-drawer"]';
    this.searchInput = '[data-test="recent-searches-search"] input';
    this.rows = '[data-test^="recent-searches-drawer-row-"]';
    this.runCount = '[data-test="recent-searches-span"]';
    this.statusLabel = '[data-test^="recent-searches-status-label-"]';
    this.starToggle = '[data-test^="recent-searches-star-"]';
    this.showing = '[data-test="recent-searches-showing"]';
    this.statusChip = (status) => `[data-test="recent-searches-status-${status}"]`;
    this.clearBtn = '[data-test="recent-searches-clear-btn"]';
    this.clearDialog = '[data-test="recent-searches-clear-dialog"]';
    this.clearConfirm = '[data-test="recent-searches-clear-confirm"]';
  }

  drawerLocator() {
    return this.page.locator(this.drawer);
  }

  allRows() {
    return this.drawerLocator().locator(this.rows);
  }

  rowWithText(text) {
    return this.allRows().filter({ hasText: text });
  }

  async openAndFilter(text) {
    await this.page.locator(this.openBtn).click();
    await expect(this.drawerLocator()).toBeVisible({ timeout: 15000 });
    await this.drawerLocator().locator(this.searchInput).fill(text);
  }

  async expectRowCount(n, timeout = 15000) {
    await expect(this.allRows()).toHaveCount(n, { timeout });
  }

  async expectRowRunCount(text, pattern) {
    await expect(this.rowWithText(text).locator(this.runCount)).toContainText(pattern);
  }

  async expectRowStatus(text, status) {
    await expect(this.rowWithText(text).locator(this.statusLabel)).toContainText(status);
  }

  async expectShowing(pattern) {
    await expect(this.drawerLocator().locator(this.showing)).toContainText(pattern);
  }

  async clickStatusChip(status) {
    await this.drawerLocator().locator(this.statusChip(status)).click();
  }

  async toggleStar(text) {
    await this.rowWithText(text).locator(this.starToggle).click();
  }

  /** Opens the Clear confirmation and dismisses it with Escape, so the shared history is kept. */
  async openAndDismissClearConfirm() {
    await this.drawerLocator().locator(this.clearBtn).click();
    const dialog = this.page.locator(this.clearDialog);
    await expect(dialog).toBeVisible();
    await expect(this.page.locator(this.clearConfirm)).toBeVisible();
    await this.page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
}

export default LogsRecentSearchesPage;
