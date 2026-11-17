// The "Review and add N alerts" drawer, opened from its test-build harness page, by data-test only.
const { expect } = require('@playwright/test');

const BASE = () => (process.env.ZO_BASE_URL || '').replace(/\/$/, '');

class BulkReviewPage {
  constructor(page) {
    this.page = page;
    this.harness = page.locator('[data-test="bulk-review-harness"]');
    this.drawer = page.locator('[data-test="bulk-review-drawer"]');
    this.title = page.locator('[data-test="bulk-review-title"]');
    this.rule = page.locator('[data-test="bulk-review-rule"]');
    this.footer = page.locator('[data-test="bulk-review-footer"]');
    this.create = page.locator('[data-test="bulk-review-create"]');
    this.cancel = page.locator('[data-test="bulk-review-cancel"]');
    this.failures = page.locator('[data-test="bulk-review-failures"]');
    this.rights = page.locator('[data-test="bulk-review-rights"]');
    this.toastAction = page.locator('[data-test="o-toast-action-btn"]');
  }

  async goto(org, query = '') {
    await this.page.goto(`${BASE()}/web/autoobserve/dev/bulk-review?org_identifier=${org}${query ? `&${query}` : ''}`);
  }

  openButton(scenario) {
    return this.page.locator(`[data-test="bulk-review-harness-open-${scenario}"]`);
  }

  async open(org, scenario = 'm12', query = '') {
    await this.goto(org, query);
    await this.openButton(scenario).click();
    await expect(this.drawer).toBeVisible({ timeout: 30000 });
  }

  groupTick(group) {
    return this.page.locator(`[data-test="bulk-review-group-tick-${group}"] [role="checkbox"]`);
  }

  rowTick(key) {
    return this.page.locator(`[data-test="bulk-review-tick-${key}"] [role="checkbox"]`);
  }

  rowResult(key, status) {
    return this.page.locator(`[data-test="bulk-review-tick-${key}-${status}"]`);
  }

  reason(key) {
    return this.page.locator(`[data-test="bulk-review-cant-${key}"]`);
  }

  failure(key) {
    return this.page.locator(`[data-test="bulk-review-failure-${key}"]`);
  }

  retry(key) {
    return this.page.locator(`[data-test="bulk-review-retry-${key}"]`);
  }

  toast(text) {
    return this.page.locator('[data-test^="o-toast-"][data-test-message]').filter({ hasText: text });
  }

  // Leaves exactly `keys` ticked: every group off, then the named rows on.
  async tickOnly(groups, keys) {
    for (const group of groups) {
      const tick = this.groupTick(group);
      // An indeterminate tick turns fully on at the first click, so it can take two.
      for (let i = 0; i < 2 && (await tick.getAttribute('data-state')) !== 'unchecked'; i++) await tick.click();
      await expect(tick).toHaveAttribute('data-state', 'unchecked');
    }
    for (const key of keys) await this.rowTick(key).click();
  }
}

module.exports = { BulkReviewPage, BASE };
