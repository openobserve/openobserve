// shortcutCheatsheetPage.js - Page Object for the global keyboard-shortcut cheatsheet dialog.
// Covers the ShortcutCheatsheet.vue dialog: help-menu / shift+? open paths, edition
// gating of module chips + page rows, live search / empty state, and chip highlight.
import { expect } from '@playwright/test';

// The 12 module chips that always render on an OSS build. Slugs are derived from the
// translated module title (lowercased, non-alphanumeric runs collapsed to '-'), e.g.
// "Online Evals" -> "online-evals". See ShortcutCheatsheet.vue chip data-test template.
export const OSS_CORE_CHIP_SLUGS = [
  'global',
  'logs',
  'dashboards',
  'metrics',
  'traces',
  'alerts',
  'streams',
  'pipelines',
  'functions',
  'reports',
  'iam',
  'rum',
];

// The 4 module chips that are fully gated off on OSS (every page inside them is
// enterprise/cloud/flag-gated, so allModules filters them out entirely).
export const OSS_GATED_CHIP_SLUGS = [
  'settings',
  'online-evals',
  'actions',
  'running-queries',
];

// Representative enterprise/cloud/flag-gated shortcut rows that must NOT render on OSS.
// Each id maps to a shortcutRegistry entry whose `visible` gate is false on OSS.
export const OSS_GATED_ROW_IDS = [
  'regexPatternsRefresh',
  'cipherKeysRefresh',
  'alertSourcesAdd',
  'alertIncidentsRefresh',
  'pipelineDestinationsRefresh',
  'iamRolesAdd',
  'iamGroupsAdd',
  'iamInvitationsRefresh',
  'searchSchedulersRefresh',
  'actionsRefresh',
  'modelPricingRefresh',
  'runningQueriesRefresh',
];

export class ShortcutCheatsheetPage {
  constructor(page) {
    this.page = page;

    // Dialog + header controls
    this.dialog = page.locator('[data-test="shortcut-cheatsheet-dialog"]');
    this.searchField = page.locator('[data-test="shortcut-cheatsheet-search-field"]');
    this.closeButton = page.locator('[data-test="shortcut-cheatsheet-close-btn"]');
    this.chipsContainer = page.locator('[data-test="shortcut-cheatsheet-chips"]');
    this.noResults = page.locator('[data-test="shortcut-cheatsheet-no-results"]');

    // Help menu entry points
    this.helpMenuItem = page.locator('[data-test="menu-link-help-item"]');
    this.shortcutsMenuItem = page.locator('[data-test="menu-link-shortcuts-item"]');
  }

  chip(slug) {
    return this.page.locator(`[data-test="shortcut-cheatsheet-chip-${slug}"]`);
  }

  row(rowId) {
    return this.page.locator(`[data-test="shortcut-cheatsheet-row-${rowId}"]`);
  }

  moduleBlock(title) {
    return this.page.locator(`[data-module="${title}"]`);
  }

  // Opens the dialog via the header Help menu -> "Keyboard shortcuts" item.
  async openViaHelpMenu() {
    await expect(this.helpMenuItem, 'Help menu trigger should be visible').toBeVisible();
    await this.helpMenuItem.click();
    await expect(this.shortcutsMenuItem, 'Keyboard shortcuts menu item should be visible').toBeVisible();
    await this.shortcutsMenuItem.click();
    await this.expectOpen();
  }

  // Toggles the dialog via the global shift+? combo. `?` is Shift+/ on a US layout,
  // so a single press produces the shift+? keydown the manager matches.
  async pressToggleKey() {
    await this.page.keyboard.press('?');
  }

  async expectOpen() {
    await expect(this.dialog, 'Shortcut cheatsheet dialog should be open').toBeVisible();
  }

  async expectClosed() {
    await expect(this.dialog, 'Shortcut cheatsheet dialog should be closed').toBeHidden();
  }

  async closeViaButton() {
    await this.closeButton.click();
    await this.expectClosed();
  }

  async closeViaEscape() {
    await this.page.keyboard.press('Escape');
    await this.expectClosed();
  }

  // Asserts every OSS core module chip is present.
  async expectCoreChipsPresent() {
    for (const slug of OSS_CORE_CHIP_SLUGS) {
      await expect(this.chip(slug), `OSS core chip "${slug}" should be visible`).toBeVisible();
    }
  }

  // Asserts the 4 fully-gated module chips are ABSENT from the DOM (not disabled).
  async expectGatedChipsAbsent() {
    for (const slug of OSS_GATED_CHIP_SLUGS) {
      await expect(this.chip(slug), `gated chip "${slug}" should be absent`).toHaveCount(0);
    }
  }

  async expectRowVisible(rowId) {
    await expect(this.row(rowId), `shortcut row "${rowId}" should be visible`).toBeVisible();
  }

  // Asserts the representative enterprise/cloud/flag-gated rows never render on OSS.
  async expectGatedRowsAbsent() {
    for (const rowId of OSS_GATED_ROW_IDS) {
      await expect(this.row(rowId), `gated row "${rowId}" should be absent`).toHaveCount(0);
    }
  }

  async search(text) {
    await expect(this.searchField, 'cheatsheet search input should be visible').toBeVisible();
    await this.searchField.fill(text);
  }

  // No-results state: empty-state text shows AND the chip container is removed.
  async expectNoResults() {
    await expect(this.noResults, 'no-results empty state should be visible').toBeVisible();
    await expect(this.chipsContainer, 'chip container should be removed on empty search').toHaveCount(0);
  }

  async clickChip(slug) {
    await this.chip(slug).click();
  }

  async expectChipAbsent(slug) {
    await expect(this.chip(slug), `chip "${slug}" should be absent`).toHaveCount(0);
  }

  // The clicked module block briefly gains bg-shortcut-highlight-bg (~280ms after the
  // click, fading out ~1.6s later). Poll via toHaveClass so the transient class is
  // caught without asserting on exact timing.
  async expectModuleHighlighted(title) {
    await expect(
      this.moduleBlock(title),
      `module block "${title}" should gain the highlight class`,
    ).toHaveClass(/bg-shortcut-highlight-bg/, { timeout: 3000 });
  }
}
