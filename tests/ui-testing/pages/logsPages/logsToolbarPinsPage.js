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

    // Traces runs the same composable under its own scope, so cross-scope
    // isolation is only observable with both pages visited in one session.
    this.tracesMoreMenuButton = '[data-test="traces-search-bar-more-menu-btn"]';
    this.tracesPinToggle = {
      histogram: '[data-test="traces-search-bar-menu-pin-metrics-btn"]',
      savedViews: '[data-test="traces-search-bar-menu-pin-saved-views-btn"]',
    };
    this.tracesMetricsPinnedControl = '[data-test="traces-search-bar-metrics-pinned-btn"]';

    // The pin button's title is the only rendered signal of pin state, so it is
    // how a collapsed-but-still-pinned control is told from an unpinned one.
    this.pinTitle = { pinned: 'Unpin from toolbar', unpinned: 'Pin to toolbar' };

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

  async navigateToTraces(orgIdentifier) {
    await this.page.goto(
      `${process.env.ZO_BASE_URL}/web/traces?org_identifier=${orgIdentifier}`,
    );
    await expect(this.page.locator(this.tracesMoreMenuButton)).toBeVisible();
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
   * Resizes, then waits for the pinned set to stop changing.
   * availableLeftWidth is recomputed from a ResizeObserver, so the fitted set
   * settles a frame or more after the viewport changes — reading layout straight
   * away races that recompute and flakes the prefix assertion on a slower host.
   */
  async setViewportWidthAndSettle(width) {
    await this.page.setViewportSize({ width, height: 1024 });
    // Two frames lets the observer fire and Vue flush before polling starts.
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

  /**
   * A control collapsed off the toolbar must still be *pinned* — only its
   * rendering moved. The More menu's pin button title is the rendered signal:
   * asserting the menu entry alone would pass whatever the pin state, since that
   * entry is unconditional.
   */
  async expectCollapsedButStillPinned(key) {
    await this.expectPinnedHidden(key);
    await this.openMoreMenu();
    await expect(this.page.locator(this.savedViewsMenuListButton)).toBeVisible();
    await expect(this.page.locator(this.pinToggle[key])).toHaveAttribute(
      'title',
      this.pinTitle.pinned,
    );
    await this.closeMoreMenu();
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
