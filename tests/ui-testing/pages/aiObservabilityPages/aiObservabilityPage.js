// aiObservabilityPage.js — Page object for AI Observability header tests
import { expect } from '@playwright/test';

export class AIObservabilityPage {
  constructor(page) {
    this.page = page;

    // ===== NAVIGATION SELECTORS =====
    this.aiMonitoringNavLink = '[data-test="menu-link-aiObservability-item"]';

    // ===== PER-PAGE SELECTOR PREFIXES =====
    this.pagePrefixes = {
      'llm-insights': 'ai-llm-insights',
      'sessions': 'ai-sessions',
      'agent-graph': 'ai-agent-graph',
      'agent-behavior': 'ai-agent-behavior',
    };

    // ===== QUALITY TAB SELECTORS =====
    this.qualityPage = '[data-test="quality-page"]';
    this.qualityLastRefreshed = '[data-test="quality-last-refreshed"]';
    this.qualityTimeRangePicker = '[data-test="quality-time-range-picker"]';
    this.qualityRefreshBtn = '[data-test="quality-refresh-btn"]';
  }

  // Build a full data-test selector for a given page prefix and suffix
  _selector(prefix, suffix) {
    return `[data-test="${prefix}-${suffix}"]`;
  }

  // ===== NAVIGATION METHODS =====

  /**
   * Navigate to an AI page via direct URL.
   * @param {string} pageSlug - e.g. 'llm-insights', 'sessions', 'agent-graph', 'agent-behavior'
   * @param {string} orgIdentifier - org identifier (defaults to ORGNAME env var)
   */
  async gotoPage(pageSlug, orgIdentifier) {
    const org = orgIdentifier || process.env['ORGNAME'];
    await this.page.goto(`/ai/${pageSlug}?org_identifier=${org}`);
    const prefix = this.pagePrefixes[pageSlug] || `ai-${pageSlug}`;
    await this.page.locator(this._selector(prefix, 'page')).waitFor({ state: 'visible', timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  /**
   * Navigate to the Quality tab inside the AI Observability shell via direct URL.
   * @param {string} orgIdentifier - org identifier (defaults to ORGNAME env var)
   */
  async gotoQualityTab(orgIdentifier) {
    const org = orgIdentifier || process.env['ORGNAME'];
    await this.page.goto(`/ai/evaluations?org_identifier=${org}&tab=quality`);
    await this.page.locator(this.qualityPage).waitFor({ state: 'visible', timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  /**
   * Click the "AI Monitoring" nav link in the left navbar.
   */
  async clickNavLink() {
    await this.page.locator(this.aiMonitoringNavLink).click();
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  /**
   * Click a secondary rail (SectionRail) navigation item by its data-test value.
   * @param {string} dataTest - e.g. 'ai-secondary-nav-sessions', 'ai-secondary-nav-agent-graph'
   */
  async clickSecondaryNav(dataTest) {
    const selector = `[data-test="${dataTest}"]`;
    await this.page.locator(selector).click();
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  // ===== ASSERTION METHODS — AiPageShell Header =====

  /**
   * Assert that all four header elements are visible for a given page.
   * @param {string} pageSlug - e.g. 'sessions', 'llm-insights', 'agent-graph', 'agent-behavior'
   */
  async expectHeaderVisible(pageSlug) {
    const p = this.pagePrefixes[pageSlug] || pageSlug;
    await expect(this.page.locator(this._selector(p, 'page'))).toBeVisible();
    await expect(this.page.locator(this._selector(p, 'date-time'))).toBeVisible();
    await expect(this.page.locator(this._selector(p, 'refresh-btn'))).toBeVisible();
    await expect(this.page.locator(this._selector(p, 'refresh-btn'))).toContainText('Refresh');
  }

  /**
   * Assert that the last-refreshed indicator is NOT visible (absent or hidden).
   * When no data has been fetched, AiLastRefreshed's v-if gate removes the element from the DOM.
   * @param {string} pageSlug - page slug
   */
  async expectLastRefreshedHidden(pageSlug) {
    const p = this.pagePrefixes[pageSlug] || pageSlug;
    await expect(this.page.locator(this._selector(p, 'last-refreshed'))).not.toBeVisible();
  }

  /**
   * Assert that the last-refreshed indicator IS visible.
   * @param {string} pageSlug - page slug
   */
  async expectLastRefreshedVisible(pageSlug) {
    const p = this.pagePrefixes[pageSlug] || pageSlug;
    await expect(this.page.locator(this._selector(p, 'last-refreshed'))).toBeVisible();
  }

  /**
   * Click the Refresh button for a given page.
   * @param {string} pageSlug - page slug
   */
  async clickRefresh(pageSlug) {
    const p = this.pagePrefixes[pageSlug] || pageSlug;
    await this.page.locator(this._selector(p, 'refresh-btn')).click();
  }

  /**
   * Dispatch a click event on the Refresh button WITHOUT Playwright actionability checks.
   * Used for double-click guard tests where the button is already disabled from the first click.
   * @param {string} pageSlug - page slug
   */
  async dispatchRefreshClick(pageSlug) {
    const p = this.pagePrefixes[pageSlug] || pageSlug;
    await this.page.dispatchEvent(this._selector(p, 'refresh-btn'), 'click');
  }

  /**
   * Assert the Refresh button is disabled and shows a spinner (loading state). Belt-and-suspenders: check
   * both the `disabled` attribute and `aria-busy="true"`.
   * @param {string} pageSlug - page slug
   */
  async expectRefreshButtonSpinning(pageSlug) {
    const p = this.pagePrefixes[pageSlug] || pageSlug;
    const btn = this.page.locator(this._selector(p, 'refresh-btn'));
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveAttribute('aria-busy', 'true');
  }

  /**
   * Assert the Refresh button is enabled (not loading).
   * @param {string} pageSlug - page slug
   */
  async expectRefreshButtonReady(pageSlug) {
    const p = this.pagePrefixes[pageSlug] || pageSlug;
    const btn = this.page.locator(this._selector(p, 'refresh-btn'));
    await expect(btn).toBeEnabled();
  }

  /**
   * Assert the staleness dot inside the last-refreshed indicator has the expected CSS class.
   * @param {string} pageSlug - page slug
   * @param {string} dotClass - e.g. 'bg-refresh-dot-fresh', 'bg-refresh-dot-stale', 'bg-refresh-dot-critical', 'bg-refresh-dot-idle'
   */
  async expectDotColor(pageSlug, dotClass) {
    const p = this.pagePrefixes[pageSlug] || pageSlug;
    const lastRefreshed = this.page.locator(this._selector(p, 'last-refreshed'));
    const dot = lastRefreshed.locator(`.${dotClass}`);
    await expect(dot).toBeVisible();
  }

  // ===== QUALITY TAB ASSERTION METHODS =====

  /**
   * Assert that all three Quality header controls are visible plus the page container.
   */
  async expectQualityHeaderVisible() {
    await expect(this.page.locator(this.qualityPage)).toBeVisible();
    await expect(this.page.locator(this.qualityTimeRangePicker)).toBeVisible();
    await expect(this.page.locator(this.qualityRefreshBtn)).toBeVisible();
    await expect(this.page.locator(this.qualityRefreshBtn)).toContainText('Refresh');
  }

  /**
   * Assert the Quality last-refreshed indicator is visible.
   */
  async expectQualityLastRefreshedVisible() {
    await expect(this.page.locator(this.qualityLastRefreshed)).toBeVisible();
  }

  /**
   * Assert the Quality last-refreshed indicator is hidden/absent.
   */
  async expectQualityLastRefreshedHidden() {
    await expect(this.page.locator(this.qualityLastRefreshed)).not.toBeVisible();
  }

  /**
   * Click the Quality tab Refresh button.
   */
  async clickQualityRefresh() {
    await this.page.locator(this.qualityRefreshBtn).click();
  }

  /**
   * Assert the Quality Refresh button is disabled + spinning.
   */
  async expectQualityRefreshSpinning() {
    const btn = this.page.locator(this.qualityRefreshBtn);
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveAttribute('aria-busy', 'true');
  }

  /**
   * Assert the Quality Refresh button is enabled (ready).
   */
  async expectQualityRefreshReady() {
    const btn = this.page.locator(this.qualityRefreshBtn);
    await expect(btn).toBeEnabled();
  }

  /**
   * Assert the Quality staleness dot has the expected CSS class.
   * @param {string} dotClass - e.g. 'bg-refresh-dot-fresh'
   */
  async expectQualityDotColor(dotClass) {
    const lastRefreshed = this.page.locator(this.qualityLastRefreshed);
    const dot = lastRefreshed.locator(`.${dotClass}`);
    await expect(dot).toBeVisible();
  }

  // ===== WAIT / POLLING HELPERS =====

  /**
   * Wait for the Refresh button to become enabled (i.e. the fetch has settled).
   * Uses expect.toPass for auto-retry with a 35s total budget.
   * @param {string} pageSlug - page slug
   */
  async waitForRefreshToSettle(pageSlug) {
    const p = this.pagePrefixes[pageSlug] || pageSlug;
    const btn = this.page.locator(this._selector(p, 'refresh-btn'));
    await expect(async () => {
      await expect(btn).toBeEnabled({ timeout: 30000 });
    }).toPass({ timeout: 35000 });
  }

  /**
   * Wait for the Quality Refresh button to become enabled after a refresh cycle.
   */
  async waitForQualityRefreshToSettle() {
    const btn = this.page.locator(this.qualityRefreshBtn);
    await expect(async () => {
      await expect(btn).toBeEnabled({ timeout: 30000 });
    }).toPass({ timeout: 35000 });
  }

  /**
   * Check whether the last-refreshed indicator is currently visible for a page.
   * Returns false if the element is absent, hidden, or the check errors (e.g. detached).
   * @param {string} pageSlug - page slug
   * @returns {Promise<boolean>}
   */
  async isLastRefreshedIndicatorVisible(pageSlug) {
    const p = this.pagePrefixes[pageSlug] || pageSlug;
    return await this.page.locator(this._selector(p, 'last-refreshed')).isVisible().catch(() => false);
  }

  /**
   * Check whether the Quality last-refreshed indicator is currently visible.
   * @returns {Promise<boolean>}
   */
  async isQualityLastRefreshedVisible() {
    return await this.page.locator(this.qualityLastRefreshed).isVisible().catch(() => false);
  }
}
