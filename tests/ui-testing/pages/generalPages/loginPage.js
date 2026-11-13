// loginPage.js
import { expect } from '@playwright/test';
const { isCloudEnvironment } = require('../../playwright-tests/utils/cloud-auth.js');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
export class LoginPage {
  constructor(page) {
    this.page = page;
    // OInput wrapper has data-test="<name>"; the inner native input is "<name>-field"
    this.userIdInput = page.locator('[data-test="login-user-id-field"]');
    this.passwordInput = page.locator('[data-test="login-password-field"]');
    this.loginButton = page.locator('[data-test="login-sign-in"]');
    // OInput renders a field's validation message as "<name>-error" (role="alert");
    // its text content is the i18n message. Used by the login-validation specs.
    this.userIdError = page.locator('[data-test="login-user-id-error"]');
    this.passwordError = page.locator('[data-test="login-password-error"]');
    // Home menu item is only present once the SPA has an authenticated session;
    // used to confirm a saved/warm session actually loaded.
    this.homeMenuItem = page.locator('[data-test="menu-link-\\/-item"]');
    this.mainNav = page.locator('[data-test="navbar-main-nav"]');
  }

  // A form login lands in the user's default org; reload with ORGNAME so menu navigation stays in the test org.
  async openOrgHome(baseUrl = process.env["ZO_BASE_URL"]) {
    const org = process.env["ORGNAME"] || 'default';
    await this.page.goto(`${baseUrl}/web/?org_identifier=${encodeURIComponent(org)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await expect(this.mainNav).toBeVisible({ timeout: 30000 });
  }

  // Aborts dashboard/report/folder writes to the shared default org, so a lost org context fails the test instead of leaking objects there.
  async blockDefaultOrgWrites() {
    if (!process.env["ORGNAME"] || process.env["ORGNAME"] === 'default') return;
    await this.page.route(/\/api\/(v2\/)?default\/(dashboards|reports|folders)(\/|\?|$)/, async (route) => {
      if (route.request().method() === 'GET') return route.continue();
      testLogger.error('Blocked write to the default org', { method: route.request().method(), url: route.request().url() });
      return route.abort('blockedbyclient');
    });
  }

  // Assert the authenticated Home menu item is visible — proves the SPA loaded
  // with a valid session (used by the auth-warm spec).
  async expectHomeMenuVisible(timeout = 30000) {
    await expect(this.homeMenuItem).toBeVisible({ timeout });
  }

  // ── Login-form validation helpers ─────────────────────────────────────────
  // Open the internal-user login form on a fresh (unauthenticated) page and wait
  // until both fields are interactable. On enterprise/SSO builds this clicks
  // "Login as internal user"; on single-org builds the form is already visible
  // (loginAsInternalUser() no-ops gracefully).
  async openInternalLoginForm() {
    await this.gotoLoginPage();
    await this.loginAsInternalUser();
    await this.userIdInput.waitFor({ state: 'visible', timeout: 15000 });
    await this.passwordInput.waitFor({ state: 'visible', timeout: 15000 });
  }

  async fillLoginForm(email, password) {
    await this.userIdInput.fill(email);
    await this.passwordInput.fill(password);
  }

  async submitLoginForm() {
    await this.loginButton.click();
  }
  async gotoLoginPage() {
    // Force navigation to correct URL (overrides any app redirect to localhost)
    await this.page.goto(process.env["ZO_BASE_URL"], {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    console.log("ZO_BASE_URL", process.env["ZO_BASE_URL"]);
  }

  async loginAsInternalUser() {
    // Cloud uses Dex OIDC — no internal user login form exists
    if (isCloudEnvironment()) return;

    // Wait for page to stabilize before checking for internal login button
    await this.page.waitForLoadState('domcontentloaded');

    const loginAsInternalLink = this.page.locator('[data-test="login-as-internal-user"]');

    // Wait for the link with a reasonable timeout
    try {
      await loginAsInternalLink.waitFor({ state: 'visible', timeout: 10000 });
      await loginAsInternalLink.click();
      await this.page.waitForURL(process.env["ZO_BASE_URL"] + "/web/login", {
        waitUntil: "domcontentloaded",
      });

      // Additional wait to ensure login form is fully rendered
      await this.page.waitForLoadState('domcontentloaded');
    } catch (error) {
      // If "Login as internal user" link is not found, form might already be visible
      console.log('Login as internal user link not found, form may already be visible');
    }
  }

  async login() {
    // Cloud uses saved auth state (cookies from storageState) — no form login needed.
    // org_identifier query param is required — without it the SPA defaults to
    // _meta (system org) instead of the active org from saved state.
    if (isCloudEnvironment()) {
      const orgParam = process.env["ORGNAME"]
        ? `?org_identifier=${encodeURIComponent(process.env["ORGNAME"])}`
        : '';
      await this.page.goto(`${process.env["ZO_BASE_URL"]}/web/${orgParam}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await this.page.waitForURL(/\/web\//, { timeout: 15000 });
      return;
    }

    // Already authenticated (serial mode: cookies persist between tests).
    // If the login form still isn't visible after 3s, we're already at the app — skip re-login.
    const loginFormVisible = await this.userIdInput
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!loginFormVisible) return;
    await this.passwordInput.waitFor({ state: 'visible', timeout: 15000 });

    await this.userIdInput.fill(process.env["ZO_ROOT_USER_EMAIL"]);
    await this.passwordInput.fill(process.env["ZO_ROOT_USER_PASSWORD"]);

    const waitForLogin = this.page.waitForResponse(
      (response) =>
        response.url().includes("/auth/login") && response.status() === 200,
      { timeout: 60000 }
    );

    // Wait for page to be fully loaded before clicking
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1000);

    // Check if login button is visible, if not click "Login as internal user" first
    const isLoginButtonVisible = await this.loginButton.isVisible().catch(() => false);
    if (!isLoginButtonVisible) {
      if (await this.page.locator('[data-test="login-as-internal-user"]').isVisible()) {
        await this.page.locator('[data-test="login-as-internal-user"]').click();
        await this.page.waitForTimeout(1000);
      }
    }

    // Click with retry logic to handle DOM detachment
    for (let i = 0; i < 3; i++) {
      try {
        await this.loginButton.click({ timeout: 5000 });
        break;
      } catch (error) {
        if (i === 2) throw error;
        await this.page.waitForTimeout(1000);
      }
    }

    await waitForLogin;
    await this.page.waitForTimeout(2000);
    await this.page.waitForURL(process.env["ZO_BASE_URL"] + "/web/", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
  }

  async gotoLoginPageSC() {
    // Force navigation to correct URL (overrides any app redirect to localhost)
    await this.page.goto(process.env["ZO_BASE_URL_SC_UI"], {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Clear session state on the correct page
    await this.page.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {
        console.log('Could not clear storage:', e);
      }
    });

    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    console.log("ZO_BASE_URL_SC_UI", process.env["ZO_BASE_URL_SC_UI"]);
  }

  async loginAsInternalUserSC() {
    // Wait for page to stabilize before checking for internal login button
    await this.page.waitForLoadState('domcontentloaded');
    
    // getByText resolves to OButton's display:contents label span, which has no box, so Firefox reports it outside the viewport.
    const internalUserButton = this.page.locator('[data-test="login-as-internal-user"]');
    if (await internalUserButton.isVisible()) {
      await internalUserButton.click();
      await this.page.waitForURL(process.env["ZO_BASE_URL_SC_UI"] + "/web/login", {
        waitUntil: "domcontentloaded",
      });
    }
    
    // Additional wait to ensure login form is fully rendered
    await this.page.waitForLoadState('domcontentloaded');
  }

  async loginSC() {
    // Wait for login form elements to be available
    await this.userIdInput.waitFor({ state: 'visible', timeout: 15000 });
    await this.passwordInput.waitFor({ state: 'visible', timeout: 15000 });

    await this.userIdInput.fill(process.env["ZO_ROOT_USER_EMAIL"]);
    await this.passwordInput.fill(process.env["ZO_ROOT_USER_PASSWORD"]);

    const waitForLogin = this.page.waitForResponse(
      (response) =>
        response.url().includes("/auth/login") && response.status() === 200,
      { timeout: 60000 }
    );

    await this.loginButton.click();
    await waitForLogin;
    await this.page.waitForTimeout(2000);
    await this.page.waitForURL(process.env["ZO_BASE_URL_SC_UI"] + "/web/", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
  }



}