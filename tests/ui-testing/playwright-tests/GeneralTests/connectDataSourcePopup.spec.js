/**
 * Connect Data Source Onboarding Popup — OSS negative gating
 *
 * ConnectDataSourcePopup and CommunitySlackInvite are two Cloud-only onboarding
 * popups mounted once in MainLayout.vue:213-214. Every user-visible behavior is
 * gated on the build-time flag config.isCloud === "true" (VITE_OPENOBSERVE_CLOUD).
 * On the OSS build that flag is the literal string "false", so both components
 * bail out in onMounted (ConnectDataSourcePopup.vue:186-190,
 * CommunitySlackInvite.vue:72) and never render any DOM.
 *
 * The E2E test is a negative gating assertion: after authenticated navigation,
 * both dialog panels must have count 0. Closed reka-ui dialogs mount no DOM, so
 * toHaveCount(0) (not toBeHidden()) is the correct race-free assertion. The test
 * self-skips on a Cloud deployment (where the dialogs are expected) so a shared
 * matrix that happens to run against Cloud can never produce a false red.
 */

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');

test.describe('Connect Data Source Onboarding Popup testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test('Connect and Slack onboarding popups never render on the OSS build', {
    tag: ['@connectDataSourcePopup', '@all', '@oss'],
  }, async ({ page }) => {
    test.skip(isCloudEnvironment(), 'Runs only on OSS/self-hosted (Cloud dialogs are expected)');

    testLogger.info('Verifying both onboarding dialogs are absent on first paint');
    await pm.connectDataSourcePopupPage.expectBothDialogsAbsent();

    // The onMounted bail-out must hold across a full page reload, not just the
    // first paint — navigate to Logs and re-assert absence to guard re-mounts.
    testLogger.info('Navigating to Logs and re-verifying absence');
    await pm.connectDataSourcePopupPage.navigateToLogs();
    await pm.connectDataSourcePopupPage.expectBothDialogsAbsent();

    testLogger.info('Test completed');
  });
});
