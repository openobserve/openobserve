/**
 * Profiles Menu Feature Flag
 *
 * The continuous-profiling module ships its ingestion API and UI page
 * unconditionally in OSS, but its left-rail menu entry is hidden by default
 * behind zoConfig.profiling_enabled (ZO_FEATURE_PROFILING_ENABLED, default
 * false), sourced from the authenticated /api/{org}/config response.
 * MainLayout.vue inserts/removes the "Profiles" rail tile based on that flag
 * alone (no enterprise/cloud conjunct); the /profiles route itself is NOT
 * flag-gated and stays reachable by direct URL.
 *
 * Exactly one of the two gate-state tests runs per environment: the flag is
 * read directly from the live config (ProfilesPage.detectProfilingEnabled),
 * mirroring StatusPagesPage.detectBuildType — so a flag-off backend runs the
 * hidden test and self-skips the shown test, and a future flag-on shard flips
 * which one runs. The direct-URL test runs in both states.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe('Profiles Menu Feature Flag testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test('Profiles rail tile is hidden when profiling is disabled', {
    tag: ['@profilesMenu', '@all'],
  }, async () => {
    const profilingEnabled = await pm.profilesPage.detectProfilingEnabled();
    test.skip(profilingEnabled === true, 'Runs only when the Profiles flag is OFF');

    testLogger.info('Verifying the Profiles rail tile is absent while profiling is disabled');
    await pm.profilesPage.expectMenuItemAbsent();
    testLogger.info('Profiles rail tile confirmed absent');
  });

  test('Profiles page is reachable by direct URL even when the menu is hidden', {
    tag: ['@profilesMenu', '@all'],
  }, async () => {
    testLogger.info('Navigating directly to /profiles');
    await pm.profilesPage.navigate();

    testLogger.info('Verifying the Profiles page mounts (route is not flag-gated)');
    await pm.profilesPage.expectPageMounted();
    testLogger.info('Profiles page mounted via direct URL');
  });

  test('Profiles rail tile appears after the Traces group when profiling is enabled', {
    tag: ['@profilesMenu', '@all'],
  }, async ({ page }) => {
    const profilingEnabled = await pm.profilesPage.detectProfilingEnabled();
    test.skip(profilingEnabled !== true, 'profiling_enabled=false — shown state not reachable in this env');

    testLogger.info('Verifying the Profiles rail tile is visible');
    await pm.profilesPage.expectMenuItemVisible();

    testLogger.info('Verifying the Profiles tile is ordered after the Traces group');
    await pm.profilesPage.expectMenuItemOrderedAfterTracesGroup();

    testLogger.info('Clicking the Profiles tile and confirming navigation to /profiles');
    await pm.profilesPage.clickMenuItem();
    await expect(page).toHaveURL(/\/profiles/);
    await pm.profilesPage.expectPageMounted();
    testLogger.info('Profiles rail tile shown and clickable');
  });
});
