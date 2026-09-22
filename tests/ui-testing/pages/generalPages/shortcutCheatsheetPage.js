// shortcutCheatsheetPage.js - Page Object for the global "Keyboard Shortcuts" cheatsheet dialog.
// Covers ShortcutCheatsheet.vue and, specifically, the OSS visibility gates on the AI Chat
// entry, fully-gated module chips, and flag-gated page rows (shortcutRegistry.ts `visible`
// helpers keyed off config.isEnterprise + the runtime zoConfig flags).
//
// Strict selector policy: data-test only, no text matching.
import { expect } from '@playwright/test';

export class ShortcutCheatsheetPage {
  constructor(page) {
    this.page = page;

    this.dialog = page.locator('[data-test="shortcut-cheatsheet-dialog"]');
    this.helpItem = page.locator('[data-test="menu-link-help-item"]');
    this.shortcutsItem = page.locator('[data-test="menu-link-shortcuts-item"]');
    // OInput exposes the editable control under `-field`; the bare data-test is the non-editable wrapper.
    this.searchInput = page.locator('[data-test="shortcut-cheatsheet-search-field"]');
    this.closeBtn = page.locator('[data-test="shortcut-cheatsheet-close-btn"]');
    this.noResults = page.locator('[data-test="shortcut-cheatsheet-no-results"]');
  }

  /** Locator for a single shortcut entry row by its registry entry id (e.g. `aiChatToggle`). */
  row(id) {
    return this.page.locator(`[data-test="shortcut-cheatsheet-row-${id}"]`);
  }

  /** Locator for a module chip by its slugged English title (e.g. "Online Evals" → `online-evals`). */
  chip(title) {
    return this.page.locator(`[data-test="shortcut-cheatsheet-chip-${title}"]`);
  }

  /** Open the cheatsheet via the deterministic Help-menu path and confirm the dialog mounted. */
  async openViaHelpMenu() {
    await this.helpItem.click();
    await expect(this.shortcutsItem).toBeVisible({ timeout: 10000 });
    await this.shortcutsItem.click();
    await expect(this.dialog).toBeVisible({ timeout: 15000 });
  }

  /** Toggle the cheatsheet via the global `shift+?` binding and confirm the dialog mounted. */
  async openViaShortcut() {
    await this.page.keyboard.press('Shift+?');
    await expect(this.dialog).toBeVisible({ timeout: 15000 });
  }

  /** Close the cheatsheet via the close button and confirm the dialog is removed. */
  async close() {
    await this.closeBtn.click();
    await expect(this.dialog).toBeHidden({ timeout: 10000 });
  }

  /** Assert a shortcut entry row is present (count === 1). */
  async expectRowPresent(id) {
    await expect(this.row(id), `shortcut row "${id}" should be present`).toHaveCount(1);
  }

  /** Assert a shortcut entry row is gated off (count === 0). */
  async expectRowAbsent(id) {
    await expect(this.row(id), `shortcut row "${id}" should be gated off`).toHaveCount(0);
  }

  /** Assert a module chip is present (count === 1). */
  async expectChipPresent(title) {
    await expect(this.chip(title), `module chip "${title}" should be present`).toHaveCount(1);
  }

  /** Assert a module chip is gated off (count === 0). */
  async expectChipAbsent(title) {
    await expect(this.chip(title), `module chip "${title}" should be gated off`).toHaveCount(0);
  }

  /** Type a filter query into the search box. */
  async search(query) {
    await this.searchInput.fill(query);
  }

  /** Clear the search box. */
  async clearSearch() {
    await this.searchInput.fill('');
  }

  /** Assert the no-results empty state is shown. */
  async expectNoResultsVisible() {
    await expect(this.noResults).toBeVisible({ timeout: 10000 });
  }

  /** Assert the no-results empty state is not shown. */
  async expectNoResultsHidden() {
    await expect(this.noResults).toBeHidden({ timeout: 10000 });
  }
}
