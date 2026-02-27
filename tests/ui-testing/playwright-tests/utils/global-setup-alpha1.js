const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const testLogger = require('./test-logger.js');

/**
 * Global setup for Alpha1 cloud tests
 * Handles Dex "Continue with Email" login flow:
 *   alpha1.dev.zinclabs.dev → dex-alpha1.dev.zinclabs.dev → email/password → approval → redirect back
 */
async function globalSetup() {
  testLogger.info('[alpha1] Starting global setup - Dex email login');

  // Create auth storage directory
  const authDir = path.join(__dirname, 'auth');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  const authFile = path.join(authDir, 'user.json');

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1024 },
  });
  const page = await context.newPage();

  // Log all navigations for debugging
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      testLogger.debug(`[alpha1] [nav] ${frame.url()}`);
    }
  });

  try {
    const baseUrl = (process.env.ZO_BASE_URL || '').replace(/\/$/, '');
    if (!baseUrl) {
      throw new Error('ZO_BASE_URL must be set');
    }
    const userEmail = (process.env.ALPHA1_USER_EMAIL || '').trim();
    const userPassword = (process.env.ALPHA1_USER_PASSWORD || '').trim();

    if (!userEmail || !userPassword) {
      throw new Error('ALPHA1_USER_EMAIL and ALPHA1_USER_PASSWORD must be set');
    }

    // Step 1: Navigate to alpha1 — this redirects to Dex login page
    const loginUrl = `${baseUrl}/web/`;
    testLogger.info(`[alpha1] Navigating to ${loginUrl}`);
    await page.goto(loginUrl);
    await page.waitForLoadState('domcontentloaded');

    testLogger.info(`[alpha1] Current URL: ${page.url()}`);

    // Step 2: Click "Continue with Email" on the Dex page
    const continueWithEmail = page.getByText('Continue with Email');
    await continueWithEmail.waitFor({ state: 'visible', timeout: 15000 });
    testLogger.info('[alpha1] Clicking "Continue with Email"...');
    await continueWithEmail.click();
    await page.waitForLoadState('domcontentloaded');

    testLogger.info(`[alpha1] On Dex local login page: ${page.url()}`);

    // Step 3: Fill in the Dex local login form
    const emailField = page.locator(
      'input[name="login"], input[name="email"], input[name="username"], ' +
      'input[type="email"], input[type="text"][id="login"]'
    );
    const passwordField = page.locator(
      'input[name="password"], input[type="password"]'
    );

    await emailField.first().waitFor({ state: 'visible', timeout: 10000 });
    await emailField.first().fill(userEmail);
    testLogger.info('[alpha1] Email entered');

    await passwordField.first().waitFor({ state: 'visible', timeout: 5000 });
    await passwordField.first().fill(userPassword);
    testLogger.info('[alpha1] Password entered');

    // Step 4: Submit and wait for redirect back to alpha1
    const submitButton = page.locator('form').locator(
      'button:has-text("Login"), button:has-text("Sign In"), button:has-text("Log In")'
    );

    await submitButton.first().click();
    await page.waitForURL(
      /web\/|dex\/approval|dex\/auth.*error/,
      { timeout: 15000 }
    );

    // Check if login failed (Dex error page)
    if (/dex\/.*error/.test(page.url())) {
      throw new Error(`Login failed — Dex returned error page: ${page.url()}`);
    }
    testLogger.info(`[alpha1] After submit navigation: ${page.url()}`);

    // Step 5: Check if we're on a Dex approval page
    const currentUrl = page.url();
    if (currentUrl.includes('dex/approval') || currentUrl.includes('dex/auth')) {
      testLogger.info('[alpha1] On Dex approval/auth page, looking for grant button...');

      const grantButton = page.locator(
        'button:has-text("Grant Access"), button:has-text("Approve"), button[value="approve"], ' +
        'input[type="submit"][value="Approve"], button[type="submit"]'
      );

      try {
        await grantButton.first().waitFor({ state: 'visible', timeout: 5000 });
        testLogger.info('[alpha1] Found grant/approve button, clicking...');
        await grantButton.first().click();
        await page.waitForURL(
          url => !url.toString().includes('dex'),
          { timeout: 15000 }
        );
        testLogger.info(`[alpha1] After grant approval: ${page.url()}`);
      } catch (e) {
        if (e.name === 'TimeoutError') {
          testLogger.info('[alpha1] No grant button found, continuing...');
        } else {
          throw e;
        }
      }
    }

    // Step 6: Wait for the app to fully load
    await page.waitForLoadState('domcontentloaded');
    testLogger.info(`[alpha1] After settling: ${page.url()}`);

    // If still on Dex, wait longer for the redirect
    if (page.url().includes('dex')) {
      testLogger.info('[alpha1] Still on Dex, waiting for redirect...');
      await page.waitForURL(
        url => !url.toString().includes('dex'),
        { timeout: 30000 }
      );
    }

    // If stuck on callback URL (/web/cb#id_token=...), the auth cookies are set
    // but the client-side router may not complete the redirect.
    // Navigate directly to /web/ — the auth state is already persisted.
    if (page.url().includes('/cb#') || page.url().includes('/cb?')) {
      testLogger.info('[alpha1] On callback URL — auth cookies set, navigating to /web/...');
      await page.goto(`${baseUrl}/web/`, { waitUntil: 'domcontentloaded' });
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch((e) => testLogger.warn('[alpha1] networkidle timeout:', { error: e.message }));

    // Step 7: Verify login success
    testLogger.info(`[alpha1] Verifying login at: ${page.url()}`);

    const menuItem = page.locator('[data-test="menu-link-\\/-item"]');
    await menuItem.waitFor({ state: 'visible', timeout: 15000 });
    testLogger.info('[alpha1] Login successful — main menu visible');

    // Save authentication state for tests to reuse
    await context.storageState({ path: authFile });
    testLogger.info(`[alpha1] Auth state saved to ${authFile}`);

  } catch (error) {
    const debugDir = path.join(__dirname, '..', '..', 'test-results');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    const screenshotPath = path.join(debugDir, 'debug-alpha1-login.png');
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    testLogger.error(`[alpha1] Login failed. Screenshot: ${screenshotPath}`);
    testLogger.error(`[alpha1] Current URL: ${page.url()}`);
    testLogger.error(`[alpha1] Error: ${error.message}`);
    // Clean up stale auth file on failure so it's not reused
    if (fs.existsSync(authFile)) {
      fs.unlinkSync(authFile);
    }
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }

  testLogger.info('[alpha1] Global setup completed successfully');
}

module.exports = globalSetup;
