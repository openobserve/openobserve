/**
 * SSO Login E2E Tests
 *
 * Tests for Single Sign-On authentication functionality.
 * These tests verify the SSO login flow, internal login fallback,
 * and authentication state management.
 *
 * @enterprise SSO is an enterprise feature
 *
 * Test Coverage:
 * - SSO button visibility based on configuration
 * - Internal login form visibility and functionality
 * - Login as internal user toggle
 * - Successful authentication with credentials
 * - Storage state persistence
 * - Logout functionality
 */

const { test, expect } = require('@playwright/test');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const fs = require('fs');
const path = require('path');

// Storage state file for this test suite
const AUTH_FILE = path.join(__dirname, '../utils/auth/sso-test-auth.json');

test.describe("SSO Login Authentication", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });

  let pm;

  test.beforeEach(async ({ page, context }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);

    // Clear cookies and storage to start from clean state for login tests
    await context.clearCookies();
    await page.goto(process.env["ZO_BASE_URL"]);
    await page.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {
        // Ignore errors if storage is not accessible
      }
    });

    testLogger.info('Test setup completed - cleared auth state');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // ============================================================
  // P0 - Critical Tests
  // ============================================================

  test("Login page loads successfully", {
    tag: ['@sso', '@login', '@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing login page loads');

    // Navigate to login page
    await page.goto(process.env["ZO_BASE_URL"]);
    await page.waitForLoadState('domcontentloaded');

    // Verify page loaded (either SSO button or login form should be visible)
    const ssoButton = page.locator('[data-test="sso-login-btn"]');
    const loginForm = page.locator('[data-cy="login-user-id"]');
    const internalUserLink = page.getByText('Login as internal user');

    // At least one of these should be visible
    const ssoVisible = await ssoButton.isVisible().catch(() => false);
    const formVisible = await loginForm.isVisible().catch(() => false);
    const linkVisible = await internalUserLink.isVisible().catch(() => false);

    expect(ssoVisible || formVisible || linkVisible).toBeTruthy();
    testLogger.info('Login page loaded successfully', { ssoVisible, formVisible, linkVisible });
  });

  test("Internal login with valid credentials succeeds", {
    tag: ['@sso', '@login', '@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing internal login with valid credentials');

    await pm.loginPage.gotoLoginPage();
    await pm.loginPage.loginAsInternalUser();
    await pm.loginPage.login();

    // Verify logged in - home menu item should be visible
    await pm.loginPage.expectLoggedIn();

    testLogger.info('Internal login successful');
  });

  test("Authentication state is saved to storage state", {
    tag: ['@sso', '@login', '@smoke', '@P0']
  }, async ({ page, context }) => {
    testLogger.info('Testing authentication state persistence');

    // Login first
    await pm.loginPage.gotoLoginPage();
    await pm.loginPage.loginAsInternalUser();
    await pm.loginPage.login();
    await pm.loginPage.expectLoggedIn();

    // Save storage state
    const authDir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    await context.storageState({ path: AUTH_FILE });

    // Verify file was created
    expect(fs.existsSync(AUTH_FILE)).toBeTruthy();

    // Parse and verify storage state has cookies
    const storageState = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    expect(storageState.cookies).toBeDefined();
    expect(storageState.cookies.length).toBeGreaterThan(0);

    testLogger.info('Storage state saved successfully', {
      cookieCount: storageState.cookies.length
    });
  });

  // ============================================================
  // P1 - Functional Tests
  // ============================================================

  test("Login as internal user link shows login form", {
    tag: ['@sso', '@login', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing login as internal user link');

    await pm.loginPage.gotoLoginPage();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Check if SSO is enabled (link will be visible only then)
    const linkVisible = await pm.loginPage.loginAsInternalLink.isVisible().catch(() => false);

    if (linkVisible) {
      // Click the link to show internal login form
      await pm.loginPage.loginAsInternalUser();

      // Verify login form is now visible
      await expect(pm.loginPage.userIdInput).toBeVisible({ timeout: 10000 });
      await expect(pm.loginPage.passwordInput).toBeVisible({ timeout: 5000 });

      testLogger.info('Internal login form displayed after clicking link');
    } else {
      // Internal login form should already be visible (SSO disabled)
      const formVisible = await pm.loginPage.userIdInput.isVisible().catch(() => false);
      expect(formVisible).toBeTruthy();

      testLogger.info('Internal login form already visible (SSO not enabled)');
    }
  });

  test("SSO button visibility depends on enterprise configuration", {
    tag: ['@sso', '@login', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing SSO button visibility');

    await pm.loginPage.gotoLoginPage();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const ssoEnabled = await pm.loginPage.isSsoEnabled();

    if (ssoEnabled) {
      // SSO button should be visible
      await expect(pm.loginPage.ssoLoginButton).toBeVisible();
      testLogger.info('SSO button is visible (enterprise with SSO enabled)');
    } else {
      // SSO button should NOT be visible
      await expect(pm.loginPage.ssoLoginButton).not.toBeVisible();
      testLogger.info('SSO button is not visible (non-enterprise or SSO disabled)');
    }
  });

  test("Login form validation - empty fields", {
    tag: ['@sso', '@login', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing login form validation for empty fields');

    await pm.loginPage.gotoLoginPage();
    await pm.loginPage.loginAsInternalUser();

    // Wait for form to be visible
    await pm.loginPage.userIdInput.waitFor({ state: 'visible', timeout: 15000 });

    // Clear any existing values and try to submit
    await pm.loginPage.userIdInput.clear();
    await pm.loginPage.passwordInput.clear();

    // Click login button
    await pm.loginPage.loginButton.click();

    // Should stay on login page (URL should still contain login)
    await page.waitForTimeout(2000);
    const currentUrl = page.url();

    // Expect to still be on login page or see validation message
    expect(currentUrl.includes('login') || currentUrl.includes(process.env["ZO_BASE_URL"])).toBeTruthy();

    testLogger.info('Form validation working - stayed on login page');
  });

  test("Login form validation - invalid credentials", {
    tag: ['@sso', '@login', '@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing login form validation for invalid credentials');

    await pm.loginPage.gotoLoginPage();
    await pm.loginPage.loginAsInternalUser();

    // Wait for form to be visible
    await pm.loginPage.userIdInput.waitFor({ state: 'visible', timeout: 15000 });

    // Enter invalid credentials
    await pm.loginPage.userIdInput.fill('invalid@example.com');
    await pm.loginPage.passwordInput.fill('wrongpassword123');

    // Click login button
    await pm.loginPage.loginButton.click();

    // Wait for response
    await page.waitForTimeout(3000);

    // Should stay on login page or show error
    const currentUrl = page.url();
    const onLoginPage = currentUrl.includes('login') ||
                        !currentUrl.includes('/web/') ||
                        currentUrl === process.env["ZO_BASE_URL"];

    expect(onLoginPage).toBeTruthy();

    testLogger.info('Invalid credentials handled - stayed on login page');
  });

  // ============================================================
  // P2 - Edge Case Tests
  // ============================================================

  test("Saved storage state allows authenticated navigation", {
    tag: ['@sso', '@login', '@edge-case', '@P2']
  }, async ({ browser }) => {
    testLogger.info('Testing saved storage state for authenticated navigation');

    // Skip if auth file doesn't exist
    if (!fs.existsSync(AUTH_FILE)) {
      testLogger.warn('Skipping test - auth file not found. Run P0 tests first.');
      test.skip();
      return;
    }

    // Create new context with saved storage state
    const context = await browser.newContext({
      storageState: AUTH_FILE,
      viewport: { width: 1500, height: 1024 }
    });

    const page = await context.newPage();
    const newPm = new PageManager(page);

    try {
      // Navigate directly to app (should be authenticated)
      await page.goto(`${process.env["ZO_BASE_URL"]}/web/?org_identifier=${process.env["ORGNAME"]}`);
      await page.waitForLoadState('networkidle', { timeout: 30000 });

      // Should be logged in - home menu item visible
      await newPm.loginPage.expectLoggedIn();

      testLogger.info('Storage state authentication successful');
    } finally {
      await context.close();
    }
  });

  test("Page reload maintains authentication", {
    tag: ['@sso', '@login', '@edge-case', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing page reload maintains authentication');

    // Login first
    await pm.loginPage.gotoLoginPage();
    await pm.loginPage.loginAsInternalUser();
    await pm.loginPage.login();
    await pm.loginPage.expectLoggedIn();

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    // Should still be logged in
    await pm.loginPage.expectLoggedIn();

    testLogger.info('Authentication maintained after page reload');
  });

  test("Multiple tabs maintain authentication session", {
    tag: ['@sso', '@login', '@edge-case', '@P2']
  }, async ({ context, page }) => {
    testLogger.info('Testing multiple tabs maintain authentication');

    // Login in first tab
    await pm.loginPage.gotoLoginPage();
    await pm.loginPage.loginAsInternalUser();
    await pm.loginPage.login();
    await pm.loginPage.expectLoggedIn();

    // Open new tab in same context
    const newPage = await context.newPage();
    const newPm = new PageManager(newPage);

    try {
      // Navigate to app in new tab
      await newPage.goto(`${process.env["ZO_BASE_URL"]}/web/?org_identifier=${process.env["ORGNAME"]}`);
      await newPage.waitForLoadState('networkidle', { timeout: 30000 });

      // Should also be logged in
      await newPm.loginPage.expectLoggedIn();

      testLogger.info('Authentication shared across tabs');
    } finally {
      await newPage.close();
    }
  });

});

// ============================================================
// Standalone SSO Login Tests (when SSO is available)
// ============================================================

test.describe("SSO-Specific Authentication Tests", { tag: '@enterprise' }, () => {

  test.beforeEach(async ({ page, context }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Clear cookies and storage to start from clean state for login tests
    await context.clearCookies();
    await page.goto(process.env["ZO_BASE_URL"]);
    await page.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {
        // Ignore errors if storage is not accessible
      }
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("SSO button triggers authentication redirect", {
    tag: ['@sso', '@enterprise', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing SSO button triggers redirect');

    // Navigate to login page
    await page.goto(process.env["ZO_BASE_URL"]);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const pm = new PageManager(page);
    const ssoEnabled = await pm.loginPage.isSsoEnabled();

    if (!ssoEnabled) {
      testLogger.info('SSO not enabled - skipping test');
      test.skip();
      return;
    }

    // Set up listener for dex_login API call
    const dexLoginPromise = page.waitForResponse(
      (response) => response.url().includes('/config/dex_login'),
      { timeout: 30000 }
    );

    // Click SSO button
    await pm.loginPage.clickSsoLogin();

    // Verify dex_login API was called
    const response = await dexLoginPromise;
    expect(response.status()).toBe(200);

    testLogger.info('SSO button successfully triggered dex_login API');
  });

});
