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

  // Frecency is per user and accumulates across parallel workers and runs, so the
  // Recent group's ORDER is not stable; membership between its header and the next one is.
  async expectInRecent(itemId) {
    await expect(this.recentGroup).toBeVisible({ timeout: 5000 });
    await expect
      .poll(
        () =>
          this.list.evaluate((list, id) => {
            const children = Array.from(list.children);
            const start = children.findIndex((el) => el.dataset.test === 'command-palette-group-h:recent');
            const end = children.findIndex((el, i) => i > start && el.dataset.test && el.dataset.test.startsWith('command-palette-group-'));
            return children
              .slice(start + 1, end === -1 ? undefined : end)
              .some((el) => el.getAttribute('data-item-id') === id);
          }, itemId),
        { timeout: 5000 },
      )
      .toBe(true);
  }

  scopeChip(scope) {
    return this.page.locator(`[data-test="command-palette-scope-${scope}"]`);
  }

  async toggleScopes() {
    await this.page.keyboard.press('Tab');
  }

  async selectScope(scope) {
    if (!(await this.page.locator('[data-test="command-palette-scopes"]').isVisible())) await this.toggleScopes();
    await this.scopeChip(scope).click();
    await expect(this.scopeChip(scope)).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
  }

  async deselectScope(scope) {
    await this.scopeChip(scope).click();
    await expect(this.scopeChip(scope)).toHaveAttribute('aria-pressed', 'false', { timeout: 5000 });
  }

  // Enterprise builds replace the empty state with an "Ask O2 AI" row; either is a valid no-match state.
  async expectNoMatches() {
    await expect
      .poll(
        async () =>
          (await this.emptyState.isVisible()) ||
          (await this.list.locator('[role="option"][data-item-id="ai:ask"]').count()) === 1,
        { timeout: 10000 },
      )
      .toBe(true);
    await expect(this.rows.filter({ hasNot: this.page.locator('[data-item-id="ai:ask"]') })).toHaveCount(0);
  }

  async expectRowsOfType(type, min = 1) {
    await expect
      .poll(() => this.list.locator(`[role="option"][data-test="command-palette-row-${type}"]`).count(), { timeout: 15000 })
      .toBeGreaterThanOrEqual(min);
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
