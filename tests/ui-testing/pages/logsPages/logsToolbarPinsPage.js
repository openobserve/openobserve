// Copyright 2026 OpenObserve Inc.
//
// Page object for the Logs search-bar "More" menu and the controls pinned out of
// it onto the toolbar. useToolbarPins.ts persists the choice in localStorage, so
// this object also owns reading and seeding those keys.

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class LogsToolbarPinsPage {
  constructor(page) {
    this.page = page;

    // ===== STORAGE KEYS (useToolbarPins.ts) =====
    this.pinsKey = 'logs_toolbar_pinned_items';
    this.histogramDecidedKey = 'logs_toolbar_histogram_pin_decided';
    this.savedViewsDecidedKey = 'logs_toolbar_saved_views_pin_decided';
    this.tracesPinsKey = 'traces_toolbar_pinned_items';

    // ===== LOCATORS =====
    this.moreMenuButton = '[data-test="logs-search-bar-utilities-menu-btn"]';

    // Traces uses the same composable under its own scope. Cross-scope tests move
    // by nav-rail click, never page.goto, so both scopes share one document.
    this.logsNavLink = '[data-test="menu-link-\\/logs-item"]';
    this.tracesNavLink = '[data-test="menu-link-\\/traces-item"]';
    this.tracesMoreMenuButton = '[data-test="traces-search-bar-more-menu-btn"]';
    this.tracesPinToggle = {
      histogram: '[data-test="traces-search-bar-menu-pin-metrics-btn"]',
      savedViews: '[data-test="traces-search-bar-menu-pin-saved-views-btn"]',
    };
    this.tracesMetricsPinnedControl = '[data-test="traces-search-bar-metrics-pinned-btn"]';

    // The pin button's title is the only rendered signal of pin state.
    this.pinTitle = { pinned: 'Unpin from toolbar', unpinned: 'Pin to toolbar' };

    // Pin toggles, inside the More menu.
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
      // No syntaxGuide entry on purpose — see assertablePinOrder below.
      // functionEditor sits on the right toolbar, outside the width budget, so it
      // is the one pin that renders at any viewport width.
      functionEditor: '[data-test="logs-search-bar-function-editor-pinned-btn"]',
    };

    // Fit priority, and the canonical render order: histogram is kept longest.
    this.leftSectionOrder = ['histogram', 'sqlMode', 'quickMode', 'savedViews', 'syntaxGuide'];

    // The syntax guide is pinnable but not assertable: SearchBar.vue hands its
    // data-test to the SyntaxGuide component, whose ODropdown root drops it, so it
    // never reaches the DOM. Derived from pinnedControl so a control only becomes
    // assertable by having a selector that actually renders.
    this.assertablePinOrder = this.leftSectionOrder.filter((key) => key in this.pinnedControl);
  }

  // ===== SETUP =====

  /** Seeds pin storage before boot; a string `pins` is written verbatim, `decided` sets both default-pin flags. */
  async seedPinStorage({ pins, decided } = {}) {
    await this.page.addInitScript(
      ([key, value, decidedKeys, decidedValue]) => {
        try {
          // addInitScript re-runs on every navigation, so seed once or a reload
          // would wipe what the test just pinned.
          if (sessionStorage.getItem('__pinSeedApplied') === '1') return;
          sessionStorage.setItem('__pinSeedApplied', '1');
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
          for (const decidedKey of decidedKeys) {
            if (decidedValue === null) localStorage.removeItem(decidedKey);
            else localStorage.setItem(decidedKey, decidedValue);
          }
        } catch (_) {
          // Private mode / quota — the app falls back to in-memory pins.
        }
      },
      [
        this.pinsKey,
        pins === undefined ? null : typeof pins === 'string' ? pins : JSON.stringify(pins),
        [this.histogramDecidedKey, this.savedViewsDecidedKey],
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

  /** Marks the document; a full load wipes `window`, so the stamp surviving
   * proves routing stayed client-side and the scopeStates map was shared. */
  async stampDocument() {
    await this.page.evaluate(() => {
      window.__pinDocStamp = 'logs-toolbar-pins';
    });
  }

  async expectSameDocument() {
    const stamp = await this.page.evaluate(() => window.__pinDocStamp);
    expect(
      stamp,
      'the document was reloaded, so the two pin scopes never shared one scopeStates map',
    ).toBe('logs-toolbar-pins');
  }

  /** Client-side route change — keeps the document alive. */
  async gotoTracesViaNav() {
    await this.page.locator(this.tracesNavLink).click();
    await expect(this.page.locator(this.tracesMoreMenuButton)).toBeVisible();
    await this.expectSameDocument();
  }

  async gotoLogsViaNav() {
    await this.page.locator(this.logsNavLink).click();
    await this.expectToolbarReady();
    await this.expectSameDocument();
  }

  async openTracesMoreMenu() {
    await this.page.locator(this.tracesMoreMenuButton).click();
    await expect(this.page.locator(this.tracesPinToggle.savedViews)).toBeVisible();
  }

  async toggleTracesPin(key) {
    await this.openTracesMoreMenu();
    await this.page.locator(this.tracesPinToggle[key]).click();
    await this.page.keyboard.press('Escape');
    await expect(this.page.locator(this.tracesPinToggle.savedViews)).toBeHidden();
    testLogger.debug(`Toggled traces toolbar pin: ${key}`);
  }

  /**
   * Resizes, then waits for the pinned set to stop changing: availableLeftWidth
   * comes from a ResizeObserver, so reading layout at once races the recompute.
   */
  async setViewportWidthAndSettle(width) {
    await this.page.setViewportSize({ width, height: 1024 });
    // Two frames lets the observer fire and Vue flush before polling.
    await this.page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))),
        ),
    );
    let previous = null;
    let settled = null;
    await expect
      .poll(
        async () => {
          const current = (await this.getVisiblePinnedOrder()).join(',');
          const isStable = current === previous;
          previous = current;
          if (isStable) settled = current;
          return isStable;
        },
        {
          timeout: 15000,
          intervals: [150, 250, 400, 600, 800],
          message: `pinned set never settled at ${width}px`,
        },
      )
      .toBe(true);
    return settled ? settled.split(',').filter(Boolean) : [];
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

  /** Clicks a pin toggle directly, keeping the More menu open for follow-up reads. */
  async clickPinToggle(key) {
    await this.page.locator(this.pinToggle[key]).click();
    testLogger.debug(`Clicked toolbar pin toggle: ${key}`);
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

  async readSavedViewsDecidedFlag() {
    return this.page.evaluate((key) => localStorage.getItem(key), this.savedViewsDecidedKey);
  }

  async readTracesPins() {
    return this.page.evaluate((key) => localStorage.getItem(key), this.tracesPinsKey);
  }

  /** Assertable pinned controls on the toolbar, left to right. */
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

  /** The More button is always present, so it marks the toolbar rendered. */
  async expectToolbarReady() {
    await expect(this.page.locator(this.moreMenuButton)).toBeVisible();
  }

  async expectPinnedVisible(key) {
    await expect(this.page.locator(this.pinnedControl[key])).toBeVisible();
  }

  async expectPinnedHidden(key) {
    await expect(this.page.locator(this.pinnedControl[key])).toBeHidden();
  }

  /** A collapsed control must still be pinned — only its rendering moved. */
  async expectCollapsedButStillPinned(key) {
    await this.expectPinnedHidden(key);
    await this.openMoreMenu();
    // The toggle in the menu is "still reachable"; its title, "still pinned".
    await expect(this.page.locator(this.pinToggle[key])).toHaveAttribute(
      'title',
      this.pinTitle.pinned,
    );
    await this.closeMoreMenu();
  }

  /** Asserts a pin toggle's title while the More menu is open — the only rendered
   * pin-state signal for controls whose pinned button never reaches the DOM. */
  async expectPinToggleTitle(key, title) {
    await expect(this.page.locator(this.pinToggle[key])).toHaveAttribute('title', title);
  }

  async expectTracesPinState(key, pinned) {
    await this.openTracesMoreMenu();
    await expect(this.page.locator(this.tracesPinToggle[key])).toHaveAttribute(
      'title',
      pinned ? this.pinTitle.pinned : this.pinTitle.unpinned,
    );
    await this.page.keyboard.press('Escape');
  }

  async expectTracesMetricsPinnedHidden() {
    await expect(this.page.locator(this.tracesMetricsPinnedControl)).toBeHidden();
  }
}

export default LogsToolbarPinsPage;
