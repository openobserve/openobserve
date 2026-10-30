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

  // True only if this OpenObserve actually serves its web dashboard. A minimal from-source binary
  // can serve /api (ingest + query work) yet return "Not Found" for /web/* (UI not embedded). The
  // dashboard UI tests skip gracefully when this is false — the SDK/data layer is still fully asserted.
  async dashboardServed() {
    try {
      await this.page.goto(`${cfg.OO_URL}/web/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const loginForm = this.page
        .locator('[data-test="login-user-id-field"]')
        .or(this.page.getByText('Login as internal user'));
      return await loginForm.first().isVisible({ timeout: 8000 }).catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Gate the UI-layer assertions on the dashboard actually being served. In CI the from-source build
   * always ships the embedded web UI, so a NOT-served dashboard is a real regression → fail hard (else
   * the UI tests would silently skip and the run stays green). Locally, skip gracefully — a minimal
   * from-source binary may not embed the UI. Pass the spec's `test` object in.
   */
  async ensureServedOrSkip(test) {
    const served = await this.dashboardServed();
    if (process.env.CI) {
      expect(served, 'CI build must serve /web — dashboard UI tests must not silently skip').toBe(true);
    } else {
      test.skip(!served, 'OpenObserve web UI not served by this build');
    }
  }

  async login() {
    await this.page.goto(`${cfg.OO_URL}/web/login`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const userField = this.page.locator('[data-test="login-user-id-field"]');
    // Enterprise builds collapse the internal-user form behind an SSO screen — reveal it ONLY if
    // that toggle is actually present. OSS builds (e.g. a from-source CI instance) show the form
    // directly and have no such toggle, so we must not block on it.
    const internalToggle = this.page.getByText('Login as internal user');
    if (await internalToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await internalToggle.click().catch(() => {});
    }
    await userField.waitFor({ state: 'visible', timeout: 30000 });
    await userField.fill(cfg.OO_USER);
    const pwd = this.page.locator('[data-test="login-password-field"]');
    await pwd.fill(cfg.OO_PASS);
    // The submit button enables only once the form validates — wait (not an assertion) for it, then
    // click; fall back to Enter (submits the form) if the button stays unstable.
    const signIn = this.page.locator('[data-test="login-sign-in"]');
    await signIn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
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

  /** After openErrorTracking(), assert an error carrying `message` is listed. */
  async expectErrorListed(message) {
    await expect(this.page.getByText(message, { exact: false }).first()).toBeVisible({ timeout: 30000 });
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

  /**
   * Did the mobile session-replay player actually render? Used as the POSITIVE CONTROL for masking:
   * wireframe text is real DOM text (MobileSessionPlayer.vue), so if the player never hydrates there
   * are zero text nodes and a naive `toHaveCount(0)` for PII would pass vacuously. The playback bar is
   * the stable "replay rendered" signal. (Observed: renders for Android, but not always for iOS in CI.)
   */
  async replayRendered(timeoutMs = 30000) {
    return this.page
      .locator('[data-test="rum-mobile-replay-playback-bar"]')
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
  }

  /** No PII string leaked into the rendered session-replay DOM (masking guard). Call only after the
   *  replay is confirmed rendered (see replayRendered) so the scan isn't vacuous. Scanned WITHIN the
   *  replay player only — the session header legitimately shows the user's email (setUserInfo), so a
   *  whole-page scan would false-red on the identity email, which is unrelated to replay masking. */
  async expectNoPiiInReplay(piiStrings) {
    await this.page.waitForTimeout(2000); // brief settle for the wireframes to paint
    const player = this.page.locator('[data-test="rum-mobile-replay-player"]');
    for (const pii of piiStrings) {
      await expect(player.getByText(pii, { exact: false })).toHaveCount(0);
    }
  }
}

module.exports = { RumDashboardPage };
