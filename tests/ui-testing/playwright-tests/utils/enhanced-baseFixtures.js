const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test: baseTest } = require('@playwright/test');
const testLogger = require('./test-logger.js');
const { waitUtils } = require('./wait-helpers.js');

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
            console.error('Failed to collect coverage on page unload:', error);
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
          console.error('Failed to write coverage data:', error);
        }
      });
      
      await use(context);
      
      // Collect final coverage
      await Promise.all(context.pages().map(async (page) => {
        try {
          await page.evaluate(() => (window).collectIstanbulCoverage(JSON.stringify((window).__coverage__)))
        } catch (error) {
          console.error('Failed to collect final coverage for page:', error);
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
    
    // Add console logging for CI debugging
    if (process.env.CI) {
      console.log(`🔍 [CI DEBUG] Creating new page in CI environment`);
      
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          console.error(`🔍 [CI DEBUG] Browser console error:`, msg.text());
        }
        if (msg.type() === 'warn') {
          console.warn(`🔍 [CI DEBUG] Browser console warning:`, msg.text());
        }
      });
      
      // Capture page errors
      page.on('pageerror', (error) => {
        console.error(`🔍 [CI DEBUG] Page error:`, error.message);
        console.error(`🔍 [CI DEBUG] Page error stack:`, error.stack);
      });
      
      // Capture request failures
      page.on('requestfailed', (request) => {
        console.error(`🔍 [CI DEBUG] Request failed:`, request.url(), request.failure()?.errorText);
      });
    }
    
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
    await page.waitHelpers.waitForElementVisible('[data-test="menu-link-\\/-item"]', {
      timeout: 5000,
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
  testLogger.info('Navigating to base URL', { url: process.env["ZO_BASE_URL"] });
  
  await page.goto(process.env["ZO_BASE_URL"]);
  await page.waitForLoadState('domcontentloaded');
  
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