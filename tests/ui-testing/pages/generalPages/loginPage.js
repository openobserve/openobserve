// loginPage.js
import { expect } from '@playwright/test';
const { isCloudEnvironment } = require('../../playwright-tests/utils/cloud-auth.js');
export class LoginPage {
  constructor(page) {
    this.page = page;
    this.userIdInput = page.locator('[data-cy="login-user-id"]');
    this.passwordInput = page.locator('[data-cy="login-password"]');
    this.loginButton = page.locator('[data-cy="login-sign-in"]');
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

    const loginAsInternalLink = this.page.getByText('Login as internal user');

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
      if (await this.page.getByText('Login as internal user').isVisible()) {
        await this.page.getByText('Login as internal user').click();
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
    
    if (await this.page.getByText('Login as internal user').isVisible()) {
      await this.page.getByText('Login as internal user').click();
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