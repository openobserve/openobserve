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
  page: async ({ context }, use, testInfo) => {
    const page = await context.newPage();

    // Add wait helpers to page
    page.waitHelpers = waitUtils.create(page);

    testLogger.debug('New page created with global session and wait helpers');

    await use(page);

    // On failure, click "Click for error details" before the framework takes its auto-screenshot.
    // This ensures the expanded error dialog is visible in the failure screenshot.
    if (testInfo.status === 'failed' || testInfo.status === 'timedOut') {
      try {
        const errorBtn = page.getByRole('button', { name: /click for error details/i });
        const isVisible = await errorBtn.isVisible({ timeout: 2000 }).catch(() => false);
        if (isVisible) {
          await errorBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(800);
        }
      } catch (_) {}
    }
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
  
  const isAuthenticated = await verifyAuthentication(page);
  
  if (!isAuthenticated) {
    testLogger.error('User not authenticated - global setup might have failed');
    throw new Error('User not authenticated. Global setup might have failed.');
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