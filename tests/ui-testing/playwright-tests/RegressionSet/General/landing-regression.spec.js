/**
 * Landing Page Regression Bug Tests
 *
 * Bug fixes for landing page / header functionality:
 * - #11604: Clicking on Slack URL at top left gives blank page
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

test.describe("Landing Page Regression Bug Fixes", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Landing page regression test setup completed');
  });

  // ==========================================================================
  // Bug #11604: Clicking on slack url at the top left gives blank page
  // https://github.com/openobserve/openobserve/issues/11604
  // ==========================================================================
  test("Slack button should open a functional page, not blank", {
    tag: ['@bug-11604', '@P1', '@regression', '@landingRegression']
  }, async ({ page }) => {
    // page is available but unused — slack opens in a new tab via pm.homePage.clickSlackButton()
    testLogger.info('Test: Verify Slack button opens valid page (Bug #11604)');

    // Verify slack button is visible in header via POM
    await expect(pm.homePage.slackButton, 'Slack button should be visible in header')
      .toBeVisible({ timeout: 10000 });
    testLogger.info('Slack button is visible');

    // Click opens in a new tab — POM method returns the new page handle
    const newPage = await pm.homePage.clickSlackButton();

    await newPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await newPage.waitForTimeout(2000);

    const bodyText = await newPage.evaluate(() => document.body.innerText).catch(() => '');
    const title = await newPage.title().catch(() => '');
    testLogger.info(`Slack page title: "${title}", body length: ${bodyText.length}`);

    expect(bodyText.length,
      'Bug #11604: Slack link should not open a blank page'
    ).toBeGreaterThan(0);

    await newPage.close();
    testLogger.info('PASSED: Slack button opens a functional page, not blank');
  });

  test.afterEach(async () => {
    testLogger.info('Landing page regression test completed');
  });
});
