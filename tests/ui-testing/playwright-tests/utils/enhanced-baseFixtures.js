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

    enforceOrgOnNavigation(page);

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
 * Guarantee every in-app navigation carries this shard's `org_identifier`.
 *
 * WHY THIS IS A HARNESS CONCERN, NOT A PER-CALL-SITE ONE
 * -----------------------------------------------------
 * The active org is a function of the URL, not of the session. MainLayout.vue
 * resolves it in onBeforeMount from `url.searchParams.get("org_identifier")`, and
 * `useLocalOrganization` (utils/storage.ts) is an in-memory module ref — so it is
 * wiped on every page load and `storageState` cannot carry it. A navigation with
 * no `org_identifier` therefore lands on the USER'S DEFAULT org.
 *
 * While the whole alpha1 suite ran in a single org that was invisible. Now that
 * the matrix spreads 13 shards over 6 orgs, ANY bare `/web/...` navigation puts a
 * test in the wrong org — and it fails only if that test happens to assert on
 * something org-specific, so the rest corrupt or read another shard's data in
 * silence. cloudLogin.spec.js was simply the first to assert on org-specific UI.
 *
 * Rather than trust ~200 call sites to remember the param, this wraps page.goto
 * and adds it when it is missing. External navigations (Dex, the callback URL) and
 * URLs that already specify an org are passed through untouched.
 */
function enforceOrgOnNavigation(page) {
  const targetOrg = process.env['ORGNAME'];
  if (!targetOrg || targetOrg === 'default') return;

  const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
  if (!baseUrl) return;

  const originalGoto = page.goto.bind(page);

  page.goto = async (url, options) => {
    let resolved;
    try {
      resolved = new URL(url, `${baseUrl}/`);
    } catch {
      return await originalGoto(url, options);
    }

    const sameApp = resolved.origin === new URL(baseUrl).origin;
    const isAppRoute = resolved.pathname === '/' || resolved.pathname.startsWith('/web');
    const hasOrg = resolved.searchParams.has('org_identifier');

    if (sameApp && isAppRoute && !hasOrg) {
      resolved.searchParams.set('org_identifier', targetOrg);
      testLogger.debug('Added missing org_identifier to navigation', {
        original: String(url),
        navigated: resolved.toString(),
      });
      return await originalGoto(resolved.toString(), options);
    }

    return await originalGoto(url, options);
  };
}

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

  // Use 60s navigation timeout for all environments (dev/staging can be slow to load)
  const navTimeout = 60000;
  await page.goto(baseUrlWithOrg, { timeout: navTimeout });
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