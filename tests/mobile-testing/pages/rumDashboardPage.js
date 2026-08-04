// Page object for the OpenObserve RUM dashboard — the "can a user SEE it?" layer.
// This is why we validate the UI and not just the API: nearly every mobile-RUM bug
// found (Error Tracking, Web Vitals, breadcrumbs, Traces) was a display-layer bug
// where the data was correct in _rumdata but the dashboard failed to show it.
const { expect } = require('@playwright/test');
const cfg = require('../utils/config');

class RumDashboardPage {
  constructor(page) {
    this.page = page;
    this.org = cfg.OO_ORG;
  }

  async login() {
    await this.page.goto(`${cfg.OO_URL}/web/login`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const userField = this.page.locator('[data-test="login-user-id-field"]');
    // Internal-user form is collapsed by default (SSO shown first) — reveal it.
    if (!(await userField.isVisible().catch(() => false))) {
      await this.page.getByText('Login as internal user').click();
    }
    await userField.waitFor({ state: 'visible', timeout: 20000 });
    await userField.fill(cfg.OO_USER);
    const pwd = this.page.locator('[data-test="login-password-field"]');
    await pwd.fill(cfg.OO_PASS);
    // The submit button enables only once the form validates — wait for it, then
    // click; fall back to Enter (submits the form) if the button stays unstable.
    const signIn = this.page.locator('[data-test="login-sign-in"]');
    await expect(signIn).toBeEnabled({ timeout: 15000 }).catch(() => {});
    await signIn.click({ timeout: 15000 }).catch(() => pwd.press('Enter'));
    await this.page.waitForURL(/\/web\/(?!login)/, { timeout: 30000 });
  }

  // This SPA keeps connections open (its own telemetry), so 'load'/'networkidle'
  // never fire — navigate on 'domcontentloaded' and wait for real elements instead.
  async _goto(path) {
    await this.page.goto(`${cfg.OO_URL}${path}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  }

  async openSession(sessionId, windowMs = 2 * 60 * 60 * 1000) {
    // The session-view page needs a time window (microseconds) to load the session.
    const endUs = Date.now() * 1000;
    const startUs = (Date.now() - windowMs) * 1000;
    await this._goto(
      `/web/rum/sessions/view/${sessionId}?start_time=${startUs}&end_time=${endUs}&org_identifier=${this.org}`,
    );
  }

  async openErrorTracking(periodMin = 30) {
    await this._goto(`/web/rum/errors?period=${periodMin}m&org_identifier=${this.org}`);
  }

  /**
   * The session detail rendered. The page hydrates slowly, so settle then assert the stable
   * tab bar (Breadcrumbs), with one reload as a self-heal.
   */
  async expectSessionViewable() {
    const breadcrumbs = this.page.getByRole('button', { name: 'Breadcrumbs' });
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.page.waitForTimeout(3000);
      if (await breadcrumbs.isVisible().catch(() => false)) return;
      if (attempt === 0) {
        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }
    }
    await expect(breadcrumbs).toBeVisible({ timeout: 30000 });
  }

  /** No PII string leaked into the session-replay DOM (masking guard). */
  async expectNoPiiInReplay(piiStrings) {
    for (const pii of piiStrings) {
      await expect(this.page.getByText(pii, { exact: false })).toHaveCount(0);
    }
  }
}

module.exports = { RumDashboardPage };
