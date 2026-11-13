import { expect } from '@playwright/test';

export class LogsAutoRefreshPage {
  constructor(page) {
    this.page = page;
    this.trigger = '[data-test^="logs-search-bar-refresh-interval-btn"]';
    this.panel = '[data-test="auto-refresh-panel"]';
    this.subtitle = '[data-test="auto-refresh-subtitle"]';
    this.footer = '[data-test="auto-refresh-footer"]';
    this.offSwitch = '[data-test="logs-search-off-refresh-interval"]';
    this.offSwitchRole = '[data-test="logs-search-off-refresh-interval"] [role="switch"]';
    this.intervalOption = (secs) => `[data-test="logs-search-bar-refresh-time-${secs}"]`;
    // SearchBar.vue has no running-state data-test; the run button takes this class while a search is in flight.
    this.runInFlight = '[data-test="logs-search-bar-refresh-btn"][class*="bg-cancel-query-bg"]';
    this.firstResultRow = '[data-test="logs-search-result-logs-table"] tbody tr';
    this.histogram = '[data-test="logs-search-result-bar-chart"]';
    this.histogramCanvas = '[data-test="logs-search-result-bar-chart"] canvas';
    this.orgSelectTrigger = '[data-test="navbar-organizations-select-trigger"]';
    this.orgMenuItem = (orgId) => `[data-test="organization-menu-item-label-item-label"][data-test-org-identifier="${orgId}"]`;
  }

  async waitForIdleResults(timeout = 30000) {
    await expect(this.page.locator(this.firstResultRow).first()).toBeVisible({ timeout });
    await expect(this.page.locator(this.runInFlight)).toHaveCount(0, { timeout });
  }

  async openPopover() {
    await this.page.locator(this.trigger).first().click();
    await expect(this.page.locator(this.panel)).toBeVisible();
  }

  async openPopoverIfClosed() {
    if (!(await this.page.locator(this.panel).isVisible())) await this.openPopover();
  }

  async closePopover() {
    await this.page.keyboard.press('Escape');
  }

  async pickInterval(secs) {
    await this.page.locator(this.intervalOption(secs)).click();
  }

  async clickOffSwitch() {
    await this.page.locator(this.offSwitch).first().click();
  }

  async expectSwitchChecked(checked) {
    await expect(this.page.locator(this.offSwitchRole).first()).toHaveAttribute('aria-checked', String(checked));
  }

  async expectSubtitle(pattern) {
    await expect(this.page.locator(this.subtitle)).toContainText(pattern);
  }

  async expectFooterVisible() {
    await expect(this.page.locator(this.footer)).toBeVisible();
  }

  async expectTriggerLabel(pattern) {
    await expect(this.page.locator(this.trigger).first()).toHaveAttribute('aria-label', pattern);
  }

  async getTriggerLabel() {
    return this.page.locator(this.trigger).first().getAttribute('aria-label');
  }

  async expectHistogramRendered(timeout = 30000) {
    await expect(this.page.locator(this.histogramCanvas).first()).toBeVisible({ timeout });
  }

  async expectHistogramHasData() {
    await expect(this.page.locator(this.histogram)).not.toContainText(/no data/i);
  }

  /** Returns a live list of the URLs of every search POST the page sends from now on. */
  trackSearchUrls() {
    const urls = [];
    this.page.on('request', (req) => {
      if (req.method() === 'POST' && /\/_search(_stream)?\?/.test(req.url())) urls.push(req.url());
    });
    return urls;
  }

  /** Returns a live list of { org, histogram } for every search POST whose body names `stream`. */
  trackStreamSearches(stream) {
    const log = [];
    this.page.on('request', (req) => {
      const url = req.url();
      if (req.method() === 'POST' && /\/_search(_stream)?\?/.test(url) && (req.postData() || '').includes(stream)) {
        log.push({ org: url.split('/api/')[1].split('/')[0], histogram: url.includes('is_ui_histogram=true') });
      }
    });
    return log;
  }

  async switchOrg(orgId) {
    await this.page.locator(this.orgSelectTrigger).click();
    await this.page.locator(this.orgMenuItem(orgId)).first().click();
    await expect(this.page).toHaveURL(new RegExp(`org_identifier=${orgId}(&|$)`), { timeout: 30000 });
  }
}

export default LogsAutoRefreshPage;
