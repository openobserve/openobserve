const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test: baseTest } = require('@playwright/test');
const testLogger = require('./test-logger.js');
const { waitUtils } = require('./wait-helpers.js');
const { gotoWithRetry } = require('./navigation.js');
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
          viewport: { width: 1500, height: 1024 },
          // browser.newContext() does NOT inherit the project's `use.permissions`,
          // so overriding this fixture silently drops them. Specs that read the
          // clipboard (share-link, legends-copy, table-copy-cell) then fail on a
          // rejected navigator.clipboard.readText().
          permissions: ['clipboard-read', 'clipboard-write']
        });
      } else {
        testLogger.warn('No saved auth state found, creating fresh context');
        context = await browser.newContext({
          viewport: { width: 1500, height: 1024 },
          permissions: ['clipboard-read', 'clipboard-write']
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
    // Verify against the nav rail container rather than a specific item. The
    // Home tile's `menu-link-/-item` no longer renders on the current rail
    // (only Slack/Help still use that pattern), so keying auth off it made
    // every suite fail setup even when login had succeeded.
    await page.waitHelpers.waitForElementVisible('[data-test="navbar-main-nav"]', {
      timeout: 15000,
      description: 'main nav rail (auth verification)'
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
  // Must include the /web/ SPA path. Navigating to the bare domain
  // (`${ZO_BASE_URL}?org_identifier=X`) redirects to /web/ and DROPS the query
  // string, so the app falls back to the user's DEFAULT org instead of ORGNAME.
  // On cloud that default org can be a different, trial-expired org, which then
  // redirects to /web/billings/plans where the home menu never renders and auth
  // verification fails. Every other navigation in the suite already uses /web/.
  const baseUrlWithOrg = `${process.env["ZO_BASE_URL"]}/web/?org_identifier=${process.env["ORGNAME"]}`;
  testLogger.info('Navigating to base URL with org identifier', { url: baseUrlWithOrg });

  // Use 60s navigation timeout for all environments (dev/staging can be slow to load)
  const navTimeout = 60000;
  await gotoWithRetry(page, baseUrlWithOrg, navTimeout);
  await page.waitForLoadState('domcontentloaded');
  // Cloud needs full hydration before sidebar clicks — without this, clicks trigger Dex redirect
  if (isCloudEnvironment()) {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }
  
  let isAuthenticated = await verifyAuthentication(page);

  // Self-heal on cloud: the shared session token is minted once at the start of the run
  // and reused by every shard, so on long runs (or when shards sharing an org contend on
  // the same credential) it can expire/invalidate mid-run — surfacing as this auth check
  // failing. Rather than fail the test, re-authenticate (fresh Dex login + org switch +
  // passcode refresh) in this context and resume.
  if (!isAuthenticated && isCloudEnvironment()) {
    testLogger.warn('Auth check failed — attempting re-authentication and resume');
    const { reauthenticateAlpha1 } = require('./reauth-alpha1.js');
    const recovered = await reauthenticateAlpha1(page);
    if (recovered) {
      await gotoWithRetry(page, baseUrlWithOrg, navTimeout);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      isAuthenticated = await verifyAuthentication(page);
    }
  }

  if (!isAuthenticated) {
    testLogger.error('User not authenticated - global setup might have failed (re-auth also failed or unavailable)');
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