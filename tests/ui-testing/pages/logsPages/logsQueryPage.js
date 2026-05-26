import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class LogsQueryPage {
  constructor(page) {
    this.page = page;
    this.queryEditor = '[data-test="logs-search-bar-query-editor"]';
    this.dateTimeButton = '[data-test="date-time-btn"]';
    this.relative15MinButton = '[data-test="date-time-relative-15-m-btn"]';
    this.refreshButton = '[data-test="logs-search-bar-refresh-btn"]';
    this.errorMessage = '[data-test="logs-search-error-message"]';
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
    await this.page.locator(this.refreshButton).click();
  }

  async clickErrorMessage() {
    await expect(this.page.locator(this.errorMessage)).toBeVisible({ timeout: 30000 });
    await this.page.locator(this.errorMessage).click();
  }

  async clickResetFilters() {
    // Reset filters button is now directly on the toolbar
    await this.page.locator(this.resetFiltersButton).click();
  }

  async clickNoDataFound() {
    // Try data-test selectors in priority order:
    //   logs-search-no-data-histogram — SearchResult.vue histogram empty state
    //   logs-search-error-message     — Index.vue "No events found" heading
    //   logs-search-result-not-found-text — Index.vue "Result not found" div
    const locators = [
      this.page.locator('[data-test="logs-search-no-data-histogram"]'),
      this.page.locator('[data-test="logs-search-error-message"]'),
      this.page.locator('[data-test="logs-search-result-not-found-text"]'),
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
    throw new Error('No "no data" message found — checked: logs-search-no-data-histogram, logs-search-error-message, logs-search-result-not-found-text');
  }

  async clickResultDetail() {
    await this.page.locator(this.resultDetail).click();
  }

  async waitForTimeout(milliseconds) {
    await this.page.waitForTimeout(milliseconds);
  }

  async toggleHistogram() {
    // Histogram toggle is now directly visible in the toolbar (moved out of utilities menu)
    await this.page.locator(this.histogramToggle).click();
  }

  async isHistogramOn() {
    // Histogram toggle is now directly visible in the toolbar (moved out of utilities menu)
    // OSwitch wrapper carries data-test, inner button carries data-state="checked|unchecked".
    return (await this.page.locator(this.histogramToggleCheckedBtn).count()) > 0;
  }

  async ensureHistogramState(desiredState) {
    const isOn = await this.isHistogramOn();
    if (isOn !== desiredState) {
      await this.toggleHistogram();
    }
  }

  /** Open the utilities dropdown so the SQL mode menu item becomes visible. Returns true if opened. */
  async _openUtilitiesMenuForSqlMode() {
    const sqlModeMenuItem = this.page.locator('[data-test="logs-search-bar-menu-sql-mode-btn"]');
    const isVisible = await sqlModeMenuItem.isVisible({ timeout: 500 }).catch(() => false);
    if (!isVisible) {
      await this.page.locator(this.utilitiesMenuButton).click();
      await sqlModeMenuItem.waitFor({ state: 'visible', timeout: 5000 });
      return true;
    }
    return false;
  }

  async isSQLModeOn() {
    // Open the dropdown to read the OSwitch inner button's data-state, then close it.
    const menuOpened = await this._openUtilitiesMenuForSqlMode();
    const stateEl = this.page.locator('[data-test="logs-search-bar-menu-sql-mode-btn"] [data-state]').first();
    await stateEl.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    const state = await stateEl.getAttribute('data-state').catch(() => null);
    if (menuOpened) { await this.page.keyboard.press('Escape'); await this.page.waitForTimeout(100); }
    return state === 'checked';
  }

  async ensureSQLMode() {
    const menuOpened = await this._openUtilitiesMenuForSqlMode();
    const stateEl = this.page.locator('[data-test="logs-search-bar-menu-sql-mode-btn"] [data-state]').first();
    await stateEl.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    const isOn = (await stateEl.getAttribute('data-state').catch(() => null)) === 'checked';
    if (!isOn) {
      await this.page.locator('[data-test="logs-search-bar-menu-sql-mode-btn"]').click();
      await expect.poll(async () => {
        const s = await stateEl.getAttribute('data-state').catch(() => null);
        return s === 'checked';
      }, { timeout: 5000 }).toBe(true);
    }
    if (menuOpened) { await this.page.keyboard.press('Escape'); await this.page.waitForTimeout(100); }
  }

  async ensureFTSMode() {
    const menuOpened = await this._openUtilitiesMenuForSqlMode();
    const stateEl = this.page.locator('[data-test="logs-search-bar-menu-sql-mode-btn"] [data-state]').first();
    await stateEl.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    const isOn = (await stateEl.getAttribute('data-state').catch(() => null)) === 'checked';
    if (isOn) {
      await this.page.locator('[data-test="logs-search-bar-menu-sql-mode-btn"]').click();
      await expect.poll(async () => {
        const s = await stateEl.getAttribute('data-state').catch(() => null);
        return s === 'unchecked';
      }, { timeout: 5000 }).toBe(true);
    }
    if (menuOpened) { await this.page.keyboard.press('Escape'); await this.page.waitForTimeout(100); }
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