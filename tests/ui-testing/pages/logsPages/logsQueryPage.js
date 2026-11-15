import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class LogsQueryPage {
  constructor(page) {
    this.page = page;
    this.queryEditor = '[data-test="logs-search-bar-query-editor"]';
    this.dateTimeButton = '[data-test="date-time-btn"]';
    this.relative15MinButton = '[data-test="date-time-relative-15-m-btn"]';
    this.refreshButton = '[data-test="logs-search-bar-refresh-btn"]';
    this.streamSwitchSkeleton = '[data-test="logs-search-result-loading-skeleton"]';
    this.errorMessage = '[data-test="logs-search-error-state"]';
    this.utilitiesMenuButton = '[data-test="logs-search-bar-utilities-menu-btn"]';
    this.resetFiltersButton = '[data-test="logs-search-bar-reset-filters-btn"]';
    this.resultDetail = '[data-test="o2-table-row-0"]';
    this.histogramToggle = '[data-test="logs-search-bar-show-histogram-toggle-btn"]';
    // OSwitch renders the wrapper data-test on a div and the state on an inner
    // <button data-state="checked|unchecked"> — drill into that button. Note: a sibling
    // OTooltip grace-area span also carries `data-state="closed"`, so we filter on the
    // OSwitch states explicitly to avoid the strict-mode collision.
    this.histogramToggleCheckedBtn = '[data-test="logs-search-bar-show-histogram-toggle-btn"] [data-state="checked"]';
    this.histogramToggleUncheckedBtn = '[data-test="logs-search-bar-show-histogram-toggle-btn"] [data-state="unchecked"]';
    // The toolbar's "Filter | SQL" tray; each segment carries data-state="on|off" itself.
    this.sqlModeToggle = '[data-test="logs-search-bar-query-mode-sql"]';
    this.filterModeToggle = '[data-test="logs-search-bar-query-mode-filter"]';
    this.sqlModeToggleCheckedBtn = '[data-test="logs-search-bar-query-mode-sql"][data-state="on"]';
    this.sqlModeToggleUncheckedBtn = '[data-test="logs-search-bar-query-mode-sql"][data-state="off"]';
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
    await queryEditor.locator(".inputarea").fill(query, { force: true });
  }

  async clickRefresh() {
    // Same button as logsPage.clickRefreshButton: it swaps to a "Cancel query" variant
    // while a prior / auto search is in flight. A plain click during that window cancels
    // the in-flight search instead of starting a new one, so a subsequent
    // waitForResponse('/_search') never fires (60s timeout on the histogram tests).
    // Wait for the run-mode variant to be visible AND idle before clicking.
    const btn = this.page.locator(this.refreshButton);
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    // A stream pick starts its auto-run only after the schema fetch this skeleton covers, so the button reads idle until then.
    await this.page.locator(this.streamSwitchSkeleton).waitFor({ state: 'hidden', timeout: 30000 });
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
    // Re-resolved at click time, because a run can still swap in the Cancel variant after the check above.
    await btn.filter({ hasNotText: /cancel/i }).click();
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
    // The ⋯ item, or the toolbar copy when the user pinned it.
    await this.page.keyboard.press('Escape').catch(() => {});
    const inlineBtn = this.page.locator('[data-test="logs-search-bar-histogram-btn"]');
    const isInline = await inlineBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (isInline) {
      await inlineBtn.click();
      return;
    }
    await this.page.locator(this.utilitiesMenuButton).click();
    const histogramMenuItem = this.page.locator('[data-test="logs-search-bar-menu-histogram-btn"]');
    await histogramMenuItem.waitFor({ state: 'visible', timeout: 5000 });
    await histogramMenuItem.click();
  }

  async isHistogramOn() {
    // A pinned toolbar copy reports aria-pressed; otherwise read the ⋯ item's switch.
    await this.page.keyboard.press('Escape').catch(() => {});
    const inlineBtn = this.page.locator('[data-test="logs-search-bar-histogram-btn"]');
    const isInline = await inlineBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (isInline) {
      return (await inlineBtn.getAttribute('aria-pressed')) === 'true';
    }
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

  /** SQL mode now lives in the toolbar's "Filter | SQL" tray, not the utilities menu. */
  async _openUtilitiesMenuForSqlMode() {
    return false;
  }

  /**
   * Switches the query language through the tray, clicking only when the mode differs.
   * @returns {Promise<boolean>} false when the tray is not on screen (callers then type the query)
   */
  async _setQueryMode(sql) {
    const sqlSegment = this.page.locator(this.sqlModeToggle);
    if (!(await sqlSegment.isVisible({ timeout: 3000 }).catch(() => false))) return false;
    const isSql = (await sqlSegment.getAttribute('data-state')) === 'on';
    if (isSql !== sql) {
      await this.page.locator(sql ? this.sqlModeToggle : this.filterModeToggle).click();
      await expect(sqlSegment).toHaveAttribute('data-state', sql ? 'on' : 'off', { timeout: 10000 });
    }
    return true;
  }

  async isSQLModeOn() {
    const sqlSegment = this.page.locator(this.sqlModeToggle);
    if (await sqlSegment.isVisible({ timeout: 2000 }).catch(() => false)) {
      return (await sqlSegment.getAttribute('data-state')) === 'on';
    }
    // Tray folded into ⋯ on a narrow window: fall back to the editor text.
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
    const switched = await this._setQueryMode(true);
    testLogger.info('ensureSQLMode: ' + (switched ? 'SQL selected in the query mode tray' : 'tray not shown; the next query decides'));
  }

  async ensureFTSMode() {
    const switched = await this._setQueryMode(false);
    testLogger.info('ensureFTSMode: ' + (switched ? 'Filter selected in the query mode tray' : 'tray not shown; the next query decides'));
  }

  async _isAutoQueryEnabled() {
    if (this._autoQueryEnabledCache !== undefined) return this._autoQueryEnabledCache;
    this._autoQueryEnabledCache = await this.page.evaluate(async () => {
      try {
        // auto_query_enabled lives on the AUTHENTICATED per-org config; the
        // unauthenticated /config bootstrap no longer carries flags.
        const org = new URLSearchParams(location.search).get('org_identifier') || 'default';
        const res = await fetch(`/api/${org}/config`, { credentials: 'include' });
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