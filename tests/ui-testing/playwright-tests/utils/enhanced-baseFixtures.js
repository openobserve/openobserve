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
      const res = await originalGoto(resolved.toString(), options);
      await settleNavRail(page, resolved.pathname);
      return res;
    }

    const res = await originalGoto(url, options);
    if (sameApp && isAppRoute) await settleNavRail(page, resolved.pathname);
    return res;
  };
}

/**
 * Best-effort: give the nav rail a chance to populate after an in-app navigation.
 *
 * Page objects all over the suite click `menu-link-*` items directly, and those
 * items do not exist until MainLayout's menuReady flips on GET /config. In run
 * 30552638159 that produced 45s click timeouts on menu-link-/streams-item and
 * menu-link-/metrics-item, and killed every enrichment test when the nav-group
 * tile behind the flyout never appeared. Settling here means a navigation hands
 * back a page whose rail is usable, without ~10 page objects each having to know.
 *
 * Deliberately non-fatal and reload-free: this is a synchronization aid, not an
 * assertion. If the rail genuinely never arrives, the caller's own assertion still
 * fails with its own message, and the explicit entry points (navigateToBase,
 * openNavFlyoutChild, the Alerts settings navigation) do the reload recovery.
 */
async function settleNavRail(page, pathname) {
  // /web/login and the OIDC callback have no rail by design.
  if (/\/(login|cb)$/.test(pathname || '')) return;

  // 5s, deliberately short. This runs on EVERY in-app navigation, and
  // languageTranslation.spec.js crawls many pages across 10 parallel workers with
  // its OOM safety resting on keeping each heavy page's live-at-peak-memory dwell
  // near ~3s (see the comment in that spec). An earlier 20s budget here extended
  // that dwell by up to 20s per navigation and GeneralTests — which had produced a
  // report the run before — was killed mid-step with no artifact in the first run
  // that included it.
  //
  // Short is enough: this is only an optimisation for page objects that click a
  // menu-link straight after navigating. The paths that genuinely depend on the
  // rail (navigateToBase, openNavFlyoutChild, the Alerts settings navigation) each
  // do their own longer wait with reload recovery.
  const appeared = await page.locator(NAV_RAIL_SELECTOR).first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    testLogger.debug('Nav rail not populated 5s after navigation', { pathname });
  }
}

/**
 * Escalating waits for the nav rail, with a page reload between attempts.
 * First attempt is short because the common case is instant; the reloads exist
 * only for the hung-/config case.
 */
// Five attempts with SHORT windows, not three long ones.
//
// Measured in run 30576576717 (Logs-Core): the rail recovered after a reload 8
// times and was never populated 4 times, i.e. reloading works ~2 times in 3. Since
// a healthy rail lands in ~1s, a long window buys nothing — what raises the
// recovery rate is more reload attempts. 20s is already 20x the healthy case.
//
// Worst case 110s, still inside the 300s test budget with room for the test itself.
const NAV_RAIL_ATTEMPTS = [20000, 20000, 20000, 25000, 25000];
// ANY menu link inside the rail, not the home item specifically.
// MainLayout.filterMenus() drops entries listed in the server's custom_hide_menus
// config, so pinning the readiness check on one particular item risks waiting
// forever for a link that environment has hidden. A non-empty navLinks renders at
// least one MenuLink, which is exactly the condition callers depend on. Scoped to
// navbar-main-nav so the header's own menu-link-help/slack items cannot satisfy it.
const NAV_RAIL_SELECTOR = '[data-test="navbar-main-nav"] [data-test^="menu-link-"]';

/**
 * Wait for MainLayout to populate the nav rail, reloading to retry a hung GET
 * /config. Returns whether the rail appeared.
 *
 * @param {import('@playwright/test').Page} page
 */
async function waitForNavRail(page) {
  for (let i = 0; i < NAV_RAIL_ATTEMPTS.length; i++) {
    const appeared = await page.locator(NAV_RAIL_SELECTOR).first()
      .waitFor({ state: 'visible', timeout: NAV_RAIL_ATTEMPTS[i] })
      .then(() => true)
      .catch(() => false);
    if (appeared) {
      if (i > 0) testLogger.info(`Nav rail populated after ${i} reload(s)`);
      return true;
    }
    if (i < NAV_RAIL_ATTEMPTS.length - 1) {
      testLogger.warn(
        `Nav rail still empty after ${NAV_RAIL_ATTEMPTS[i]}ms — reloading to reissue GET /config ` +
        `(attempt ${i + 1}/${NAV_RAIL_ATTEMPTS.length - 1})`
      );
      // Reload keeps the current URL, so this shard's org_identifier is preserved.
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }
  }
  return false;
}

/**
 * Utility function to check if user is authenticated
 * @param {import('@playwright/test').Page} page
 */
async function verifyAuthentication(page) {
  try {
    // STEP 1 — is the session actually valid?
    //
    // The app shell (header + nav rail) mounts as soon as the SPA boots with a
    // valid session. If we were unauthenticated we would be on Dex or /web/login
    // and neither would exist. This is the real auth signal.
    await page.waitHelpers.waitForElementVisible('[data-test="navbar-main-nav"]', {
      timeout: 30000,
      description: 'app shell / nav rail (auth verification)'
    });

    // STEP 2 — has the nav rail been populated yet?
    //
    // This is NOT an auth concern, it is a config-loading one, and conflating the
    // two is why a slow backend used to report as "User not authenticated. Global
    // setup might have failed." — sending every investigation down the wrong path.
    //
    // MainLayout.vue gates the rail on `menuReady`, which only flips once GET
    // /config has resolved (`zoConfig.version` non-empty); until then `navLinks`
    // is [] and ONavbar renders NO MenuLink items at all — the element is absent
    // from the DOM, not merely hidden.
    //
    // A flat 90s wait was NOT enough on its own: run 30552638159 attempt 2 still
    // produced "Timeout 90000ms exceeded" waiting on this element. MainLayout fails
    // open when /config *errors*, so a rail that is still empty after a minute+
    // means the request is hung, not slow — and no amount of extra waiting recovers
    // a hung request. Reloading issues a fresh /config, which does.
    if (!(await waitForNavRail(page))) {
      throw new Error(
        `Nav rail never populated: no ${NAV_RAIL_SELECTOR} after ` +
        `${NAV_RAIL_ATTEMPTS.length} attempts with reloads. The app shell rendered, so the session is ` +
        'valid — GET /config never resolved and MainLayout never set menuReady.'
      );
    }
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