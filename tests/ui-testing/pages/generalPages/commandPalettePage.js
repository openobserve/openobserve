import { expect } from '@playwright/test';

// Strict selector policy: data-test only, no text matching.
export class CommandPalettePage {
  constructor(page) {
    this.page = page;
    this.dialog = page.locator('[data-test="command-palette"]');
    this.searchInput = page.locator('[data-test="command-palette-search-field"]');
    this.list = page.locator('[data-test="command-palette-list"]');
    this.rows = page.locator('[data-test="command-palette-list"] [role="option"]');
    this.recentGroup = page.locator('[data-test="command-palette-group-h:recent"]');
    this.emptyState = page.locator('[data-test="command-palette-empty"]');
    this.headerTrigger = page.locator('[data-test="header-command-palette-trigger"]');
  }

  async openWithKeyboard() {
    await this.page.keyboard.press('ControlOrMeta+k');
    await this.expectOpen();
  }

  async openFromHeader() {
    await this.headerTrigger.click();
    await this.expectOpen();
  }

  async expectOpen() {
    await expect(this.dialog).toBeVisible({ timeout: 10000 });
    await expect(this.searchInput).toBeFocused({ timeout: 5000 });
  }

  async expectClosed() {
    await expect(this.dialog).toBeHidden({ timeout: 10000 });
  }

  async close() {
    await this.page.keyboard.press('Escape');
    await this.expectClosed();
  }

  async type(query) {
    await this.searchInput.fill(query);
  }

  row(itemId) {
    return this.list.locator(`[role="option"][data-item-id="${itemId}"]`);
  }

  async expectFirstRow(itemId) {
    await expect(this.rows.first()).toHaveAttribute('data-item-id', itemId, { timeout: 5000 });
  }

  async pressEnter() {
    await this.page.keyboard.press('Enter');
  }

  async expectUrl(pathPattern, orgId) {
    await expect(this.page).toHaveURL(pathPattern, { timeout: 15000 });
    const url = new URL(this.page.url());
    expect(url.searchParams.get('org_identifier')).toBe(orgId);
  }
}
