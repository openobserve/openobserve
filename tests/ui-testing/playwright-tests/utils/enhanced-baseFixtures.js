const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test: baseTest } = require('@playwright/test');
const testLogger = require('./test-logger.js');
const { waitUtils } = require('./wait-helpers.js');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');

const istanbulCLIOutput = path.join(process.cwd(), '.nyc_output');
const authFile = path.join(__dirname, 'auth', 'user.json');

function generateUUID() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Enhanced test fixture with global session management
 * Uses saved authentication state from global setup
 */
const test = baseTest.extend({
  // Enhanced context with saved authentication state
  context: async ({ browser }, use) => {
    let context;
    
    try {
      // Check if auth file exists from global setup
      if (fs.existsSync(authFile)) {
        testLogger.info('Using saved authentication state');
        context = await browser.newContext({
          storageState: authFile,
          viewport: { width: 1500, height: 1024 }
        });
      } else {
        testLogger.warn('No saved auth state found, creating fresh context');
        context = await browser.newContext({
          viewport: { width: 1500, height: 1024 }
        });
      }
      
      // Add coverage collection (from original baseFixtures)
      await context.addInitScript(() =>
        window.addEventListener('beforeunload', () => {
          try {
            (window).collectIstanbulCoverage(JSON.stringify((window).__coverage__))
          } catch (error) {
            testLogger.error('Failed to collect coverage on page unload', { error });
          }
        }),
      );
      
      await fs.promises.mkdir(istanbulCLIOutput, { recursive: true });
      await context.exposeFunction('collectIstanbulCoverage', async (coverageJSON) => {
        if (!coverageJSON) return;
        const filename = path.join(istanbulCLIOutput, `playwright_coverage_${generateUUID()}.json`);
        try {
          await fs.promises.writeFile(filename, coverageJSON);
        } catch (error) {
          testLogger.error('Failed to write coverage data', { error });
        }
      });
      
      await use(context);
      
      // Collect final coverage
      await Promise.all(context.pages().map(async (page) => {
        try {
          await page.evaluate(() => (window).collectIstanbulCoverage(JSON.stringify((window).__coverage__)))
        } catch (error) {
          testLogger.error('Failed to collect final coverage for page', { error });
        }
      }));
      
    } finally {
      if (context) {
        await context.close();
      }
    }
  },

  // Enhanced page fixture
  page: async ({ context }, use) => {
    const page = await context.newPage();
    
    // Add wait helpers to page
    page.waitHelpers = waitUtils.create(page);
    
    testLogger.debug('New page created with global session and wait helpers');
    
    await use(page);
  }
});

const expect = test.expect;

/**
 * Utility function to check if user is authenticated
 * @param {import('@playwright/test').Page} page 
 */
async function verifyAuthentication(page) {
  try {
    // Increase timeout for authentication verification, especially important for first test in suite
    await page.waitHelpers.waitForElementVisible('[data-test="menu-link-\\/-item"]', {
      timeout: 15000,
      description: 'home menu link (auth verification)'
    });
    return true;
  } catch (error) {
    testLogger.warn('Authentication verification failed', { error: error.message });
    return false;
  }
}

/**
 * Re-authenticate via Dex when the OIDC session has expired mid-run.
 * Performs the full Dex login flow on the current page, then saves
 * the refreshed storage state so subsequent tests pick it up.
 */
async function reAuthenticateViaDex(page) {
  const userEmail = (process.env.ALPHA1_USER_EMAIL || '').trim();
  const userPassword = (process.env.ALPHA1_USER_PASSWORD || '').trim();

  if (!userEmail || !userPassword) {
    throw new Error('Cannot re-authenticate: ALPHA1_USER_EMAIL/PASSWORD not set');
  }

  testLogger.info('[reauth] Session expired — performing Dex re-authentication');

  // If we're on the app's login page, click through to Dex
  const continueWithEmail = page.getByText('Continue with Email');
  const continueVisible = await continueWithEmail.isVisible().catch(() => false);
  if (continueVisible) {
    await continueWithEmail.click();
    await page.waitForLoadState('domcontentloaded');
  }

  // Fill credentials on Dex login form
  const emailField = page.locator(
    'input[name="login"], input[name="email"], input[name="username"], ' +
    'input[type="email"], input[type="text"][id="login"]'
  );
  const passwordField = page.locator(
    'input[name="password"], input[type="password"]'
  );

  await emailField.first().waitFor({ state: 'visible', timeout: 10000 });
  await emailField.first().fill(userEmail);

  const passwordVisible = await passwordField.first().isVisible().catch(() => false);
  if (!passwordVisible) {
    const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Next")').first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      await page.waitForLoadState('domcontentloaded');
    }
  }

  await passwordField.first().waitFor({ state: 'visible', timeout: 10000 });
  await passwordField.first().fill(userPassword);

  // Submit via Enter key (most reliable — cursor already in password field)
  try {
    await passwordField.first().press('Enter');
  } catch {
    const submitButton = page.locator(
      'button[type="submit"], form button:has-text("Login"), form button:has-text("Sign In")'
    ).first();
    await submitButton.click({ force: true, timeout: 5000 });
  }

  // Wait for redirect away from Dex
  await page.waitForURL(
    url => !url.toString().includes('dex') || url.toString().includes('dex/approval'),
    { timeout: 60000 }
  );

  // Handle Dex approval page if present
  if (page.url().includes('dex/approval') || page.url().includes('dex/auth')) {
    const grantButton = page.locator(
      'button:has-text("Grant Access"), button:has-text("Approve"), ' +
      'button[value="approve"], button[type="submit"]'
    );
    try {
      await grantButton.first().waitFor({ state: 'visible', timeout: 5000 });
      await grantButton.first().click();
      await page.waitForURL(url => !url.toString().includes('dex'), { timeout: 15000 });
    } catch {
      // No approval needed
    }
  }

  // Handle SPA callback URL (/web/cb#id_token=...)
  if (page.url().includes('/cb#') || page.url().includes('/cb?')) {
    await page.waitForURL(url => !url.toString().includes('/cb'), { timeout: 90000 }).catch(() => {});
  }

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // Navigate to correct org
  const targetOrg = process.env.ORGNAME;
  if (targetOrg && targetOrg !== 'default') {
    const orgUrl = `${process.env.ZO_BASE_URL}/web/?org_identifier=${targetOrg}`;
    await page.goto(orgUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  // Save refreshed auth state for subsequent tests
  await page.context().storageState({ path: authFile });
  testLogger.info('[reauth] Dex re-authentication successful, auth state saved');
}

/**
 * Utility function to navigate to base URL with authentication check
 * @param {import('@playwright/test').Page} page
 */
async function navigateToBase(page) {
  const baseUrlWithOrg = `${process.env["ZO_BASE_URL"]}?org_identifier=${process.env["ORGNAME"]}`;
  testLogger.info('Navigating to base URL with org identifier', { url: baseUrlWithOrg });

  // Cloud with parallel workers needs a longer navigation timeout than the default 30s
  const navTimeout = isCloudEnvironment() ? 60000 : undefined;
  await page.goto(baseUrlWithOrg, navTimeout ? { timeout: navTimeout } : undefined);
  await page.waitForLoadState('domcontentloaded');
  // Cloud needs full hydration before sidebar clicks — without this, clicks trigger Dex redirect
  if (isCloudEnvironment()) {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  let isAuthenticated = await verifyAuthentication(page);

  // On cloud, session may have expired mid-run — re-authenticate via Dex
  if (!isAuthenticated && isCloudEnvironment()) {
    await reAuthenticateViaDex(page);
    await page.goto(baseUrlWithOrg, { timeout: navTimeout || 30000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    isAuthenticated = await verifyAuthentication(page);
  }

  if (!isAuthenticated) {
    testLogger.error('User not authenticated after re-authentication attempt');
    throw new Error('User not authenticated. Re-authentication via Dex also failed.');
  }

  testLogger.info('Successfully navigated to base URL with authentication');
}

module.exports = {
  test,
  expect,
  generateUUID,
  verifyAuthentication,
  navigateToBase
};