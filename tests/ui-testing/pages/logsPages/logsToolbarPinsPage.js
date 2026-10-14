// Copyright 2026 OpenObserve Inc.
//
// Page object for the Logs search-bar "More" menu and the controls an operator
// pins out of it onto the toolbar. The pin choice is persisted in localStorage
// by web/src/composables/useToolbarPins.ts, so this object also owns reading and
// seeding those keys — a pin that renders but is not persisted looks identical
// on screen and silently reverts next session.

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class LogsToolbarPinsPage {
  constructor(page) {
    this.page = page;

    // ===== STORAGE CONTRACT (useToolbarPins.ts) =====
    this.pinsKey = 'logs_toolbar_pinned_items';
    this.histogramDecidedKey = 'logs_toolbar_histogram_pin_decided';
    this.tracesPinsKey = 'traces_toolbar_pinned_items';

    // ===== LOCATORS =====
    this.moreMenuButton = '[data-test="logs-search-bar-utilities-menu-btn"]';
    this.savedViewsMenuListButton = '[data-test="logs-search-bar-menu-list-saved-views-btn"]';

    // Pin toggle for each control, inside the More menu.
    this.pinToggle = {
      histogram: '[data-test="logs-search-bar-menu-pin-histogram-btn"]',
      sqlMode: '[data-test="logs-search-bar-menu-pin-sql-mode-btn"]',
      quickMode: '[data-test="logs-search-bar-menu-pin-quick-mode-btn"]',
      functionEditor: '[data-test="logs-search-bar-menu-pin-function-editor-btn"]',
      savedViews: '[data-test="logs-search-bar-menu-pin-saved-views-btn"]',
      syntaxGuide: '[data-test="logs-search-bar-menu-pin-syntax-guide-btn"]',
    };

    // Where each control renders once pinned out onto the toolbar.
    this.pinnedControl = {
      histogram: '[data-test="logs-search-bar-histogram-btn"]',
      sqlMode: '[data-test="logs-search-bar-sql-mode-pinned-btn"]',
      quickMode: '[data-test="logs-search-bar-quick-mode-pinned-btn"]',
      savedViews: '[data-test="logs-search-bar-saved-views-pinned"]',
      syntaxGuide: '[data-test="logs-search-bar-syntax-guide-pinned-btn"]',
      // Lives on the right toolbar, so it is outside the left-section width
      // budget and is the one pin that renders at any viewport width.
      functionEditor: '[data-test="logs-search-bar-function-editor-pinned-btn"]',
    };

    // Priority order the left section keeps pinned items in — histogram is kept
    // longest, the syntax guide is dropped first. Also the canonical render order.
    this.leftSectionOrder = ['histogram', 'sqlMode', 'quickMode', 'savedViews', 'syntaxGuide'];

    // The syntax guide is pinnable but not assertable: SearchBar.vue passes
    // data-test="logs-search-bar-syntax-guide-pinned-btn" (and ...-syntax-guide-btn
    // in the menu) to the SyntaxGuide component, whose root is an ODropdown, so
    // neither attribute ever reaches the DOM — every variant renders only
    // data-cy="syntax-guide-button". Assertions use the controls that do carry a
    // hook; savedViews is then the last of them in priority order.
    this.assertablePinOrder = this.leftSectionOrder.filter((key) => key !== 'syntaxGuide');
  }

  // ===== SETUP =====

  /**
   * Seeds pin storage before the app boots.
   * `pins` is written verbatim when a string, so a test can seed corrupt JSON;
   * `decided` controls the histogram default-pin flag. Pass undefined to clear.
   */
  async seedPinStorage({ pins, decided } = {}) {
    await this.page.addInitScript(
      ([key, value, decidedKey, decidedValue]) => {
        try {
          // addInitScript re-runs on every navigation, a reload included. Seeding
          // twice would wipe whatever the test just pinned, so the sentinel makes
          // this a one-shot: sessionStorage survives a reload in the same tab.
          if (sessionStorage.getItem('__pinSeedApplied') === '1') return;
          sessionStorage.setItem('__pinSeedApplied', '1');
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
          if (decidedValue === null) localStorage.removeItem(decidedKey);
          else localStorage.setItem(decidedKey, decidedValue);
        } catch (_) {
          // Private mode / quota — the app falls back to in-memory pins.
        }
      },
      [
        this.pinsKey,
        pins === undefined ? null : typeof pins === 'string' ? pins : JSON.stringify(pins),
        this.histogramDecidedKey,
        decided === undefined ? null : String(decided),
      ],
    );
  }

  async navigateToLogs(orgIdentifier) {
    await this.page.goto(
      `${process.env.ZO_BASE_URL}/web/logs?org_identifier=${orgIdentifier}`,
    );
    await this.expectToolbarReady();
  }

  async reload() {
    await this.page.reload();
    await this.expectToolbarReady();
  }

  async setViewportWidth(width) {
    await this.page.setViewportSize({ width, height: 1024 });
  }

  // ===== ACTIONS =====

  async openMoreMenu() {
    await this.page.locator(this.moreMenuButton).click();
    await expect(this.page.locator(this.pinToggle.histogram)).toBeVisible();
  }

  async closeMoreMenu() {
    await this.page.keyboard.press('Escape');
    await expect(this.page.locator(this.pinToggle.histogram)).toBeHidden();
  }

  /** Toggles one control's pin from the More menu and closes the menu again. */
  async togglePin(key) {
    await this.openMoreMenu();
    await this.page.locator(this.pinToggle[key]).click();
    await this.closeMoreMenu();
    testLogger.debug(`Toggled toolbar pin: ${key}`);
  }

  // ===== STATE READS =====

  async readPins() {
    return this.page.evaluate((key) => {
      try {
        return JSON.parse(localStorage.getItem(key) ?? 'null');
      } catch (_) {
        return localStorage.getItem(key);
      }
    }, this.pinsKey);
  }

  async readHistogramDecidedFlag() {
    return this.page.evaluate((key) => localStorage.getItem(key), this.histogramDecidedKey);
  }

  async readTracesPins() {
    return this.page.evaluate((key) => localStorage.getItem(key), this.tracesPinsKey);
  }

  /** Assertable pinned controls currently on the toolbar, left to right. */
  async getVisiblePinnedOrder() {
    const seen = [];
    for (const key of this.assertablePinOrder) {
      const locator = this.page.locator(this.pinnedControl[key]);
      if (await locator.isVisible().catch(() => false)) {
        const box = await locator.boundingBox();
        if (box) seen.push({ key, x: box.x });
      }
    }
    return seen.sort((a, b) => a.x - b.x).map((item) => item.key);
  }

  // ===== ASSERTIONS =====

  /** The More button is always present, so it marks the toolbar as rendered. */
  async expectToolbarReady() {
    await expect(this.page.locator(this.moreMenuButton)).toBeVisible();
  }

  async expectPinnedVisible(key) {
    await expect(this.page.locator(this.pinnedControl[key])).toBeVisible();
  }

  async expectPinnedHidden(key) {
    await expect(this.page.locator(this.pinnedControl[key])).toBeHidden();
  }

  /** A control collapsed off the toolbar must still be reachable in the More menu. */
  async expectSavedViewsReachableInMenu() {
    await this.openMoreMenu();
    await expect(this.page.locator(this.savedViewsMenuListButton)).toBeVisible();
  }
}

export default LogsToolbarPinsPage;
