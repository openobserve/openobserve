// loginPage.js
import { expect } from '@playwright/test';
export class LoginPage {
  constructor(page) {
    this.page = page;

    // Login form selectors (VERIFIED from source)
    this.userIdInput = page.locator('[data-cy="login-user-id"]');
    this.passwordInput = page.locator('[data-cy="login-password"]');
    this.loginButton = page.locator('[data-cy="login-sign-in"]');

    // SSO selectors (VERIFIED from Login.vue)
    this.ssoLoginButton = page.locator('[data-test="sso-login-btn"]');
    this.loginAsInternalLink = page.getByText('Login as internal user');

    // Logout selector (VERIFIED from Header.vue)
    this.logoutMenuItem = page.locator('[data-test="menu-link-logout-item"]');

    // Home indicator (VERIFIED - indicates successful login)
    this.homeMenuItem = page.locator('[data-test="menu-link-\\/-item"]');
  }

  /**
   * Check if SSO login button is visible
   * SSO is only available when isEnterprise="true" AND sso_enabled=true
   */
  async isSsoEnabled() {
    await this.page.waitForLoadState('domcontentloaded');
    return await this.ssoLoginButton.isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Check if internal login form is visible
   */
  async isInternalLoginVisible() {
    return await this.userIdInput.isVisible({ timeout: 5000 }).catch(() => false);
  }

  /**
   * Click SSO login button and handle redirect
   * Note: This will redirect to external identity provider
   */
  async clickSsoLogin() {
    await this.ssoLoginButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.ssoLoginButton.click();
  }

  /**
   * Perform SSO authentication flow
   * This handles the complete SSO flow including redirect and callback
   * @param {Object} options - SSO options
   * @param {string} options.ssoUrl - Expected SSO URL pattern for navigation wait
   * @param {number} options.timeout - Timeout for SSO flow (default: 60000)
   * @returns {Promise<boolean>} - True if SSO login successful
   */
  async performSsoLogin(options = {}) {
    const { timeout = 60000 } = options;

    try {
      // Check if SSO button is available
      const ssoAvailable = await this.isSsoEnabled();
      if (!ssoAvailable) {
        console.log('SSO not available, falling back to internal login');
        return false;
      }

      // Click SSO login - this triggers /config/dex_login API call
      // and redirects to external identity provider
      await this.clickSsoLogin();

      // Wait for redirect back to app (callback route /cb)
      // The app will process the token and redirect to home
      await this.page.waitForURL(
        (url) => url.pathname.includes('/web/') || url.pathname === '/',
        { timeout, waitUntil: 'networkidle' }
      );

      // Verify login success
      await this.homeMenuItem.waitFor({ state: 'visible', timeout: 10000 });

      return true;
    } catch (error) {
      console.error('SSO login failed:', error.message);
      return false;
    }
  }

  /**
   * Perform authentication with automatic detection of SSO vs internal login
   * Prioritizes internal login for test stability
   * @param {Object} options - Authentication options
   * @param {boolean} options.preferSso - Prefer SSO over internal login (default: false)
   * @param {string} options.email - Email for internal login
   * @param {string} options.password - Password for internal login
   */
  async authenticate(options = {}) {
    const {
      preferSso = false,
      email = process.env["ZO_ROOT_USER_EMAIL"],
      password = process.env["ZO_ROOT_USER_PASSWORD"]
    } = options;

    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1000);

    const ssoAvailable = await this.isSsoEnabled();
    const internalVisible = await this.isInternalLoginVisible();

    // If preferSso and SSO is available, try SSO first
    if (preferSso && ssoAvailable) {
      const ssoSuccess = await this.performSsoLogin();
      if (ssoSuccess) return true;
      // Fall through to internal login if SSO fails
    }

    // Use internal login
    if (ssoAvailable && !internalVisible) {
      // Need to click "Login as internal user" to show the form
      await this.loginAsInternalUser();
    }

    await this.loginWithCredentials(email, password);
    return true;
  }

  /**
   * Login with email/password credentials
   * @param {string} email
   * @param {string} password
   */
  async loginWithCredentials(email, password) {
    await this.userIdInput.waitFor({ state: 'visible', timeout: 15000 });
    await this.passwordInput.waitFor({ state: 'visible', timeout: 15000 });

    await this.userIdInput.fill(email);
    await this.passwordInput.fill(password);

    const waitForLogin = this.page.waitForResponse(
      (response) =>
        response.url().includes("/auth/login") && response.status() === 200,
      { timeout: 60000 }
    );

    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(500);

    // Click with retry logic
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
    await this.page.waitForURL(
      (url) => url.pathname.includes('/web/') && !url.pathname.includes('/login'),
      { waitUntil: "networkidle", timeout: 60000 }
    );
  }

  /**
   * Verify user is logged in by checking for home menu item
   */
  async expectLoggedIn() {
    await expect(this.homeMenuItem).toBeVisible({ timeout: 10000 });
  }

  /**
   * Logout the current user
   */
  async logout() {
    // Open user menu and click logout
    const userMenuButton = this.page.locator('[data-test="navbar-user-menu-button"]').or(
      this.page.locator('.q-avatar').first()
    );
    await userMenuButton.click();
    await this.logoutMenuItem.waitFor({ state: 'visible' });
    await this.logoutMenuItem.click();

    // Wait for redirect to login page
    await this.page.waitForURL((url) => url.pathname.includes('/login'), { timeout: 10000 });
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
    // Wait for page to stabilize before checking for internal login button
    await this.page.waitForLoadState('domcontentloaded');

    const loginAsInternalLink = this.page.getByText('Login as internal user');

    // Wait for the link with a reasonable timeout
    try {
      await loginAsInternalLink.waitFor({ state: 'visible', timeout: 10000 });
      await loginAsInternalLink.click();
      await this.page.waitForURL(process.env["ZO_BASE_URL"] + "/web/login", {
        waitUntil: "networkidle",
      });

      // Additional wait to ensure login form is fully rendered
      await this.page.waitForLoadState('domcontentloaded');
    } catch (error) {
      // If "Login as internal user" link is not found, form might already be visible
      console.log('Login as internal user link not found, form may already be visible');
    }
  }

  async login() {
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
      waitUntil: "networkidle",
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

    await this.page.waitForLoadState('networkidle');
    console.log("ZO_BASE_URL_SC_UI", process.env["ZO_BASE_URL_SC_UI"]);
  }

  async loginAsInternalUserSC() {
    // Wait for page to stabilize before checking for internal login button
    await this.page.waitForLoadState('domcontentloaded');
    
    if (await this.page.getByText('Login as internal user').isVisible()) {
      await this.page.getByText('Login as internal user').click();
      await this.page.waitForURL(process.env["ZO_BASE_URL_SC_UI"] + "/web/login", {
        waitUntil: "networkidle",
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
      waitUntil: "networkidle",
      timeout: 60000
    });
  }



}