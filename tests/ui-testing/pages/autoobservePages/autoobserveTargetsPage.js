// The alert form as an AutoObserve CTA opens it: a prefill in sessionStorage, then the add route with prefill=autoobserve.
const { expect } = require('@playwright/test');

const BASE = () => (process.env.ZO_BASE_URL || '').replace(/\/$/, '');
const PREFILL_KEY = 'o2:alertPrefill';

class AutoObserveTargetsPage {
  constructor(page) {
    this.page = page;
    this.toast = page.locator('[data-test="o-toast-message"]').first();
    this.description = page.locator('[name="description"]').first();
    this.body = page.locator('body');
  }

  // Seeds the prefill once per tab, as the launcher writes it before navigating, so a reload does not re-seed it.
  async openAlertFormWith(org, prefill) {
    await this.page.addInitScript(
      ([key, value]) => {
        if (sessionStorage.getItem('u0-seeded')) return;
        sessionStorage.setItem(key, value);
        sessionStorage.setItem('u0-seeded', '1');
      },
      [PREFILL_KEY, JSON.stringify(prefill)],
    );
    await this.page.goto(`${BASE()}/web/alerts/add?org_identifier=${org}&folder=default&prefill=autoobserve`);
  }

  async expectToast(text) {
    await expect(this.toast).toContainText(text, { timeout: 30000 });
  }

  async expectQuery(text) {
    await expect(this.body).toContainText(text, { timeout: 30000 });
  }

  async descriptionValue() {
    return this.description.inputValue();
  }
}

module.exports = { AutoObserveTargetsPage, BASE };
