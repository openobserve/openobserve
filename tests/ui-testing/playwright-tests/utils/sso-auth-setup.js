/**
 * SSO Authentication Setup for Playwright Tests
 *
 * This module provides SSO authentication functionality that:
 * 1. Detects if SSO is enabled (Enterprise deployment)
 * 2. Performs SSO or internal login based on configuration
 * 3. Saves authenticated state to storage state file for reuse
 *
 * Usage:
 *   - As global setup: Configure in playwright.config.js
 *   - As standalone: Import and call performAuthentication()
 *   - In tests: Use the saved storage state
 *
 * @enterprise This supports enterprise SSO authentication
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const testLogger = require('./test-logger.js');

// Storage state file paths
const AUTH_DIR = path.join(__dirname, 'auth');
const DEFAULT_AUTH_FILE = path.join(AUTH_DIR, 'user.json');
const SSO_AUTH_FILE = path.join(AUTH_DIR, 'sso-user.json');

/**
 * Ensure auth directory exists
 */
function ensureAuthDir() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    testLogger.debug('Created auth directory', { path: AUTH_DIR });
  }
}

/**
 * Check if SSO is enabled by inspecting the login page
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
async function checkSsoEnabled(page) {
  try {
    const ssoButton = page.locator('[data-test="sso-login-btn"]');
    await ssoButton.waitFor({ state: 'visible', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if internal login form is visible
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
async function checkInternalLoginVisible(page) {
  try {
    const userIdField = page.locator('[data-cy="login-user-id"]');
    await userIdField.waitFor({ state: 'visible', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Perform internal (username/password) login
 * @param {import('@playwright/test').Page} page
 * @param {Object} credentials
 * @param {string} credentials.email
 * @param {string} credentials.password
 */
async function performInternalLogin(page, credentials) {
  const { email, password } = credentials;

  testLogger.info('Performing internal login', { email });

  // Check if we need to click "Login as internal user" first
  const internalLinkVisible = await page.getByText('Login as internal user').isVisible().catch(() => false);
  if (internalLinkVisible) {
    await page.getByText('Login as internal user').click();
    testLogger.debug('Clicked "Login as internal user" link');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
  }

  // Fill credentials
  const userIdField = page.locator('[data-cy="login-user-id"]');
  const passwordField = page.locator('[data-cy="login-password"]');
  const signInButton = page.locator('[data-cy="login-sign-in"]');

  await userIdField.waitFor({ state: 'visible', timeout: 15000 });
  await userIdField.fill(email);
  testLogger.debug('Filled email field');

  await passwordField.waitFor({ state: 'visible' });
  await passwordField.fill(password);
  testLogger.debug('Filled password field');

  // Set up response listener before clicking
  const loginResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/auth/login') && response.status() === 200,
    { timeout: 60000 }
  );

  await signInButton.waitFor({ state: 'visible' });
  await signInButton.click();
  testLogger.debug('Clicked sign-in button');

  // Wait for login response
  await loginResponsePromise;
  testLogger.debug('Received login response');

  // Wait for navigation to complete
  await page.waitForLoadState('networkidle', { timeout: 15000 });
}

/**
 * Perform SSO login
 * Note: This handles the flow where clicking SSO button triggers redirect
 * to external identity provider, then callback back to the app
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} options
 * @param {number} options.timeout - Timeout for SSO flow
 * @returns {Promise<boolean>} - True if SSO login successful
 */
async function performSsoLogin(page, options = {}) {
  const { timeout = 120000 } = options;

  testLogger.info('Performing SSO login');

  try {
    // Click SSO button - this triggers /config/dex_login API
    const ssoButton = page.locator('[data-test="sso-login-btn"]');
    await ssoButton.waitFor({ state: 'visible', timeout: 10000 });

    // Intercept the dex_login API call to see where it redirects
    const dexLoginPromise = page.waitForResponse(
      (response) => response.url().includes('/config/dex_login'),
      { timeout: 30000 }
    );

    await ssoButton.click();
    testLogger.debug('Clicked SSO login button');

    // Wait for the dex_login response which contains the SSO URL
    const dexResponse = await dexLoginPromise;
    const ssoUrl = await dexResponse.text();
    testLogger.debug('Received SSO URL from dex_login', { ssoUrl: ssoUrl.substring(0, 100) + '...' });

    // The browser should redirect to the SSO URL
    // Wait for the SSO flow to complete and redirect back to /cb (callback)
    // Then the app processes the token and redirects to home

    // Wait for the final redirect to home page
    await page.waitForURL(
      (url) => {
        const pathname = url.pathname;
        return (pathname.includes('/web/') || pathname === '/') &&
               !pathname.includes('/login') &&
               !pathname.includes('/cb');
      },
      { timeout, waitUntil: 'networkidle' }
    );

    testLogger.info('SSO login successful');
    return true;
  } catch (error) {
    testLogger.error('SSO login failed', { error: error.message });
    return false;
  }
}

/**
 * Verify login was successful
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
async function verifyLoginSuccess(page) {
  try {
    // Look for home menu item which indicates logged-in state
    const homeMenuItem = page.locator('[data-test="menu-link-\\/-item"]');
    await homeMenuItem.waitFor({ state: 'visible', timeout: 10000 });
    testLogger.debug('Login verified - home menu item visible');
    return true;
  } catch (error) {
    testLogger.warn('Login verification failed', { error: error.message });
    return false;
  }
}

/**
 * Main authentication function
 * Automatically detects SSO vs internal login and performs appropriate auth
 *
 * @param {Object} options
 * @param {boolean} options.preferSso - Prefer SSO over internal login (default: false)
 * @param {string} options.email - Email for internal login
 * @param {string} options.password - Password for internal login
 * @param {string} options.baseUrl - Base URL for the application
 * @param {string} options.orgName - Organization identifier
 * @param {string} options.storageStatePath - Path to save storage state
 * @param {boolean} options.headless - Run browser in headless mode (default: true)
 * @returns {Promise<{success: boolean, authType: string, storageStatePath: string}>}
 */
async function performAuthentication(options = {}) {
  const {
    preferSso = false,
    email = process.env["ZO_ROOT_USER_EMAIL"],
    password = process.env["ZO_ROOT_USER_PASSWORD"],
    baseUrl = process.env["ZO_BASE_URL"],
    orgName = process.env["ORGNAME"],
    storageStatePath = DEFAULT_AUTH_FILE,
    headless = true
  } = options;

  testLogger.info('Starting authentication', { preferSso, baseUrl, email });

  ensureAuthDir();

  // Launch browser
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1024 }
  });
  const page = await context.newPage();

  let authType = 'unknown';
  let success = false;

  try {
    // Navigate to login page with org context
    const loginUrl = `${baseUrl}?org_identifier=${orgName}`;
    await page.goto(loginUrl);
    testLogger.debug('Navigated to login page', { url: loginUrl });

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Check authentication options available
    const ssoEnabled = await checkSsoEnabled(page);
    const internalVisible = await checkInternalLoginVisible(page);

    testLogger.debug('Authentication options detected', { ssoEnabled, internalVisible });

    // Determine authentication method
    if (preferSso && ssoEnabled) {
      // Try SSO first
      success = await performSsoLogin(page);
      if (success) {
        authType = 'sso';
      } else {
        // Fall back to internal login
        testLogger.warn('SSO login failed, falling back to internal login');
        // Need to navigate back to login page
        await page.goto(loginUrl);
        await page.waitForLoadState('domcontentloaded');
        await performInternalLogin(page, { email, password });
        authType = 'internal-fallback';
        success = true;
      }
    } else {
      // Use internal login
      await performInternalLogin(page, { email, password });
      authType = 'internal';
      success = true;
    }

    // Verify login success
    if (success) {
      success = await verifyLoginSuccess(page);
    }

    if (success) {
      // Save storage state
      await context.storageState({ path: storageStatePath });
      testLogger.info('Authentication successful, storage state saved', {
        authType,
        storageStatePath
      });
    } else {
      testLogger.error('Authentication failed');
    }

  } catch (error) {
    testLogger.error('Authentication error', { error: error.message, stack: error.stack });
    success = false;
  } finally {
    await context.close();
    await browser.close();
    testLogger.debug('Browser closed after authentication');
  }

  return {
    success,
    authType,
    storageStatePath
  };
}

/**
 * Load existing storage state if valid, otherwise perform fresh authentication
 * @param {Object} options - Same as performAuthentication
 * @returns {Promise<{success: boolean, authType: string, storageStatePath: string, cached: boolean}>}
 */
async function getOrCreateAuthState(options = {}) {
  const { storageStatePath = DEFAULT_AUTH_FILE, ...authOptions } = options;

  // Check if storage state exists and is recent (less than 1 hour old)
  if (fs.existsSync(storageStatePath)) {
    const stats = fs.statSync(storageStatePath);
    const ageMs = Date.now() - stats.mtimeMs;
    const maxAgeMs = 60 * 60 * 1000; // 1 hour

    if (ageMs < maxAgeMs) {
      testLogger.info('Using cached authentication state', {
        path: storageStatePath,
        ageMinutes: Math.round(ageMs / 60000)
      });
      return {
        success: true,
        authType: 'cached',
        storageStatePath,
        cached: true
      };
    } else {
      testLogger.info('Cached auth state expired, performing fresh authentication');
    }
  }

  const result = await performAuthentication({ ...authOptions, storageStatePath });
  return { ...result, cached: false };
}

/**
 * Create a new browser context with pre-loaded authentication
 * @param {import('@playwright/test').Browser} browser
 * @param {string} storageStatePath - Path to storage state file
 * @returns {Promise<import('@playwright/test').BrowserContext>}
 */
async function createAuthenticatedContext(browser, storageStatePath = DEFAULT_AUTH_FILE) {
  if (!fs.existsSync(storageStatePath)) {
    throw new Error(`Storage state file not found: ${storageStatePath}. Run authentication first.`);
  }

  return browser.newContext({
    storageState: storageStatePath,
    viewport: { width: 1500, height: 1024 }
  });
}

// Export functions
module.exports = {
  performAuthentication,
  getOrCreateAuthState,
  createAuthenticatedContext,
  checkSsoEnabled,
  performSsoLogin,
  performInternalLogin,
  verifyLoginSuccess,
  DEFAULT_AUTH_FILE,
  SSO_AUTH_FILE,
  AUTH_DIR
};