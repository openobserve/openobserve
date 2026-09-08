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

  // Mirrors the app's isMacOS(): the test config forces a Windows user agent, so the app
  // binds Ctrl+K there even on a Mac host; the modifier must follow the page, not the runner.
  async openWithKeyboard() {
    const isMac = await this.page.evaluate(() => {
      const source =
        (navigator.userAgentData && navigator.userAgentData.platform) ||
        navigator.platform ||
        navigator.userAgent ||
        '';
      return /mac|iphone|ipad|ipod/i.test(source);
    });
    await this.page.keyboard.press(isMac ? 'Meta+k' : 'Control+k');
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
