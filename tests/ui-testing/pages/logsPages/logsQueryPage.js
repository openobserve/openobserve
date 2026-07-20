import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class LogsQueryPage {
  constructor(page) {
    this.page = page;
    this.queryEditor = '[data-test="logs-search-bar-query-editor"]';
    this.dateTimeButton = '[data-test="date-time-btn"]';
    this.relative15MinButton = '[data-test="date-time-relative-15-m-btn"]';
    this.refreshButton = '[data-test="logs-search-bar-refresh-btn"]';
    this.errorMessage = '[data-test="logs-search-error-state"]';
    this.utilitiesMenuButton = '[data-test="logs-search-bar-utilities-menu-btn"]';
    this.resetFiltersButton = '[data-test="logs-search-bar-reset-filters-btn"]';
    this.resultDetail = '[data-test="logs-search-result-detail-undefined"]';
    this.histogramToggle = '[data-test="logs-search-bar-show-histogram-toggle-btn"]';
    // OSwitch renders the wrapper data-test on a div and the state on an inner
    // <button data-state="checked|unchecked"> — drill into that button. Note: a sibling
    // OTooltip grace-area span also carries `data-state="closed"`, so we filter on the
    // OSwitch states explicitly to avoid the strict-mode collision.
    this.histogramToggleCheckedBtn = '[data-test="logs-search-bar-show-histogram-toggle-btn"] [data-state="checked"]';
    this.histogramToggleUncheckedBtn = '[data-test="logs-search-bar-show-histogram-toggle-btn"] [data-state="unchecked"]';
    this.sqlModeToggle = '[data-test="logs-search-bar-sql-mode-toggle-btn"]';
    this.sqlModeToggleCheckedBtn = '[data-test="logs-search-bar-sql-mode-toggle-btn"] [data-state="checked"]';
    this.sqlModeToggleUncheckedBtn = '[data-test="logs-search-bar-sql-mode-toggle-btn"] [data-state="unchecked"]';
    this.autoRunDropdownBtn = '[data-test="logs-search-bar-refresh-btn"] ~ button';
    this.autoRunToggleItem = '[data-test="logs-search-bar-live-mode-toggle-btn"]';
    this._autoQueryEnabledCache = undefined;
  }

  async setDateTimeFilter() {
    await this.page.locator(this.dateTimeButton).click({ force: true });
    await this.page.locator(this.relative15MinButton).click({ force: true });
  }

  async typeQuery(query) {
    const queryEditor = this.page.locator(this.queryEditor);
    await expect(queryEditor).toBeVisible();
    await queryEditor.locator(".inputarea").fill(query);
  }

  async clickRefresh() {
    // Same button as logsPage.clickRefreshButton: it swaps to a "Cancel query" variant
    // while a prior / auto search is in flight. A plain click during that window cancels
    // the in-flight search instead of starting a new one, so a subsequent
    // waitForResponse('/_search') never fires (60s timeout on the histogram tests).
    // Wait for the run-mode variant to be visible AND idle before clicking.
    const btn = this.page.locator(this.refreshButton);
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForFunction((selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const disabled = el.hasAttribute('disabled')
        || el.getAttribute('aria-disabled') === 'true'
        || el.getAttribute('aria-busy') === 'true';
      const text = (el.textContent || '').trim();
      const title = (el.getAttribute('title') || '').trim();
      const isCancel = text.includes('Cancel') || title.toLowerCase().includes('cancel');
      return !disabled && !isCancel;
    }, this.refreshButton, { timeout: 30000 });
    await btn.click();
  }

  async clickErrorMessage() {
    // Try selectors in priority order:
    //   logs-search-no-events-found-text — LogsNoEventsState (0 results, no error)
    //   logs-search-error-state          — LogsErrorState (query/backend error)
    const candidates = [
      this.page.locator('[data-test="logs-search-no-events-found-text"]'),
      this.page.locator(this.errorMessage),
    ];
    for (const locator of candidates) {
      try {
        await locator.waitFor({ state: 'visible', timeout: 10000 });
        await locator.click({ force: true });
        return;
      } catch (e) {
        continue;
      }
    }
    throw new Error('No error/no-results message found — checked: logs-search-no-events-found-text, logs-search-error-state');
  }

  async clickResetFilters() {
    // Reset filters button is now directly on the toolbar
    await this.page.locator(this.resetFiltersButton).click();
  }

  async clickNoDataFound() {
    // Try data-test selectors in priority order:
    //   logs-search-no-events-found-text — Index.vue LogsNoEventsState (0 hits, search applied)
    //   logs-search-no-data-histogram    — SearchResult.vue histogram empty state
    //   logs-search-error-state          — Index.vue error banner (SQL parse / backend error)
    const locators = [
      this.page.locator('[data-test="logs-search-no-events-found-text"]'),
      this.page.locator('[data-test="logs-search-no-data-histogram"]'),
      this.page.locator('[data-test="logs-search-error-state"]'),
    ];
    for (const locator of locators) {
      try {
        await locator.waitFor({ state: 'visible', timeout: 10000 });
        await locator.click({ force: true });
        return;
      } catch (e) {
        continue;
      }
    }
    throw new Error('No "no data" message found — checked: logs-search-no-events-found-text, logs-search-no-data-histogram, logs-search-error-state');
  }

  async clickResultDetail() {
    await this.page.locator(this.resultDetail).click();
  }

  async waitForTimeout(milliseconds) {
    await this.page.waitForTimeout(milliseconds);
  }

  async toggleHistogram() {
    // In normal viewport the histogram is a standalone toolbar button (inline).
    // In narrow viewport it moves into the More menu.
    await this.page.keyboard.press('Escape').catch(() => {});
    const inlineBtn = this.page.locator('[data-test="logs-search-bar-histogram-btn"]');
    const isInline = await inlineBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (isInline) {
      await inlineBtn.click();
      return;
    }
    // Narrow-viewport fallback: open utilities menu and click the menu item.
    await this.page.locator(this.utilitiesMenuButton).click();
    const histogramMenuItem = this.page.locator('[data-test="logs-search-bar-menu-histogram-btn"]');
    await histogramMenuItem.waitFor({ state: 'visible', timeout: 5000 });
    await histogramMenuItem.click();
  }

  async isHistogramOn() {
    // In normal viewport the histogram is a standalone inline toolbar button.
    // Check its OSwitch state directly without opening the More menu.
    await this.page.keyboard.press('Escape').catch(() => {});
    const inlineBtn = this.page.locator('[data-test="logs-search-bar-histogram-btn"]');
    const isInline = await inlineBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (isInline) {
      const switchChecked = inlineBtn.locator('[data-state="checked"]');
      return (await switchChecked.count()) > 0;
    }
    // Narrow-viewport fallback: check state via the More menu item.
    await this.page.locator(this.utilitiesMenuButton).click();
    const histogramMenuItem = this.page.locator('[data-test="logs-search-bar-menu-histogram-btn"]');
    await histogramMenuItem.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const switchChecked = this.page.locator('[data-test="logs-search-bar-menu-histogram-btn"] [data-state="checked"]');
    const count = await switchChecked.count();
    await this.page.keyboard.press('Escape').catch(() => {});
    return count > 0;
  }

  async ensureHistogramState(desiredState) {
    const isOn = await this.isHistogramOn();
    if (isOn !== desiredState) {
      await this.toggleHistogram();
    }
  }

  /** SQL mode toggle was removed from the UI — no-op, always returns false. */
  async _openUtilitiesMenuForSqlMode() {
    // SQL mode is now auto-detected from query content (SELECT...FROM = SQL ON, else OFF).
    // There is no longer a dedicated SQL mode toggle button in the utilities menu.
    return false;
  }

  async isSQLModeOn() {
    // SQL mode is auto-detected: if the Monaco editor contains SELECT...FROM, SQL mode is ON.
    const text = await this.page.evaluate((selector) => {
      const host = document.querySelector(selector);
      if (!host) return null;
      const editors = window.monaco?.editor?.getEditors?.() ?? [];
      for (const ed of editors) {
        const node = ed.getDomNode?.();
        if (node && host.contains(node)) return ed.getValue();
      }
      return null;
    }, '[data-test="logs-search-bar-query-editor"]');
    if (!text) return false;
    const lower = text.toLowerCase().trim();
    return lower.includes('select') && lower.includes('from');
  }

  async ensureSQLMode() {
    // SQL mode toggle removed from UI. SQL mode is auto-detected from SELECT...FROM in query.
    // Callers that need SQL mode should set a SELECT query via the editor after this call.
    testLogger.info('ensureSQLMode: SQL mode toggle removed — SQL mode is auto-detected from query content');
  }

  async ensureFTSMode() {
    // SQL mode toggle removed from UI. SQL mode is auto-detected from SELECT...FROM in query.
    // Callers that need FTS mode should set a non-SELECT query via the editor after this call.
    testLogger.info('ensureFTSMode: SQL mode toggle removed — SQL mode is auto-detected from query content');
  }

  async _isAutoQueryEnabled() {
    if (this._autoQueryEnabledCache !== undefined) return this._autoQueryEnabledCache;
    this._autoQueryEnabledCache = await this.page.evaluate(async () => {
      try {
        const res = await fetch('/config', { credentials: 'include' });
        if (!res.ok) return false;
        const cfg = await res.json();
        return cfg?.auto_query_enabled === true;
      } catch {
        return false;
      }
    });
    return this._autoQueryEnabledCache;
  }

  async _toggleAutoRun(expectedLabel) {
    if (!(await this._isAutoQueryEnabled())) {
      testLogger.info(`auto_query_enabled=false on this env — skipping ${expectedLabel === 'Turn off' ? 'disableAutoRun' : 'enableAutoRun'}`);
      return;
    }
    await this.page.locator(this.autoRunDropdownBtn).first().click();
    const toggle = this.page.locator(this.autoRunToggleItem);
    await expect(toggle).toBeVisible({ timeout: 5000 });
    if (((await toggle.textContent()) || '').includes(expectedLabel)) {
      await toggle.click();
      // After clicking, the toggle menu closes — wait for it to be detached/hidden.
      await toggle.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    } else {
      await this.page.keyboard.press('Escape');
      await toggle.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  }

  async disableAutoRun() {
    await this._toggleAutoRun('Turn off');
  }

  async enableAutoRun() {
    await this._toggleAutoRun('Turn on');
  }
}