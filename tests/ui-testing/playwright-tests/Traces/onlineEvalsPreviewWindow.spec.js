// onlineEvalsPreviewWindow.spec.js
// E2E tests for the Online Evals Job Preview Window change (24h → 1h).
// Verifies the matched-targets preview card on the job create form renders the
// new "last 1h" suffix (and never "last 24h") for each target scope, with the
// span/trace/session terminology following the selected scope.
//
// Data: reuses the read-only `default` traces stream seeded by global setup.
// Assertions target the suffix text (not a positive count), so they pass even
// when the seeded traces fall outside the 1h window and the count is 0.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('Online Evals Job Preview Window testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  test('should show "last 1h" (not "last 24h") matched-span preview after selecting a stream', {
    tag: ['@online-evals-preview-window', '@traces', '@enterprise', '@all'],
  }, async ({ page }) => {
    testLogger.info('Navigating to Online Evals jobs tab');
    await pm.onlineEvalsPage.navigateToOnlineEvalsJobs();

    testLogger.info('Opening the create job form');
    await pm.onlineEvalsPage.clickNewJob();

    testLogger.info('Verifying the preview card shows the hint before a stream is selected');
    await pm.onlineEvalsPage.expectMatchedTargetsCardVisible();
    await pm.onlineEvalsPage.expectMatchedTargetsHint();

    testLogger.info('Selecting the default traces stream');
    await pm.onlineEvalsPage.selectJobStream('default');

    testLogger.info('Asserting the span-scope count renders the "last 1h" suffix');
    await pm.onlineEvalsPage.expectMatchedTargetsScope('span');

    testLogger.info('Test completed');
  });

  test('should update matched-target terminology and "last 1h" suffix when switching target scope', {
    tag: ['@online-evals-preview-window', '@traces', '@enterprise', '@all'],
  }, async ({ page }) => {
    testLogger.info('Navigating to Online Evals jobs tab');
    await pm.onlineEvalsPage.navigateToOnlineEvalsJobs();

    testLogger.info('Opening the create job form');
    await pm.onlineEvalsPage.clickNewJob();

    await pm.onlineEvalsPage.expectMatchedTargetsCardVisible();

    testLogger.info('Selecting the default traces stream');
    await pm.onlineEvalsPage.selectJobStream('default');

    testLogger.info('Verifying default span scope');
    await pm.onlineEvalsPage.expectMatchedTargetsScope('span');

    testLogger.info('Switching target scope to trace');
    await pm.onlineEvalsPage.selectTargetScope('trace');
    await pm.onlineEvalsPage.expectMatchedTargetsScope('trace');

    testLogger.info('Switching target scope to session');
    await pm.onlineEvalsPage.selectTargetScope('session');
    await pm.onlineEvalsPage.expectMatchedTargetsScope('session');

    testLogger.info('Test completed');
  });
});
