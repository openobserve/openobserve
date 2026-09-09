/**
 * SLO alert SLI — source load error handling
 *
 * The source picker for the `alert` SLI type loads its options from
 * `GET /api/{org}/alerts/slo-eligible`. When that load fails, the failure now
 * surfaces on the picker itself (`:error` / `:error-message` on OSelect) rather
 * than on a sibling OBanner, and the "no eligible alerts" info banner is
 * suppressed while an error is showing. A 500 that carries a `message` shows
 * the server's own reason; one without a body falls back to the generic copy.
 *
 * No data is seeded: the tests fail the load on purpose by intercepting the
 * eligible-alerts request, so they exercise only the error path and share no
 * state with the SLO measurement specs.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const ORG = process.env['ORGNAME'];
const ELIGIBLE_ALERTS_GLOB = '**/api/*/alerts/slo-eligible**';

test.describe('SLO Alert SLI Source Error Handling testcases', {
  tag: ['@slo', '@slo-alert-source-error', '@all'],
}, () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test('should surface the server\'s own message on the source picker when the source load fails', {
    tag: ['@P1'],
  }, async ({ page }) => {
    testLogger.info('Failing the eligible-alerts load with a server message');
    await page.route(ELIGIBLE_ALERTS_GLOB, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'org has no alerts configured' }),
      }),
    );

    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('alert');

    await pm.sloFormPage.expectAlertSourceErrorVisible('org has no alerts configured');
    testLogger.info('Test completed');
  });

  test('should fall back to the generic message when the source load fails without a reason', {
    tag: ['@P1'],
  }, async ({ page }) => {
    testLogger.info('Failing the eligible-alerts load with an empty body');
    await page.route(ELIGIBLE_ALERTS_GLOB, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );

    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('alert');

    await pm.sloFormPage.expectAlertSourceErrorVisible('Could not load the eligible alerts');
    testLogger.info('Test completed');
  });

  test('should hide the empty-state banner while a source load error is showing', {
    tag: ['@P1'],
  }, async ({ page }) => {
    testLogger.info('Failing the eligible-alerts load to hold the empty banner back');
    await page.route(ELIGIBLE_ALERTS_GLOB, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'boom' }),
      }),
    );

    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('alert');

    await pm.sloFormPage.expectAlertSourceErrorVisible();
    await pm.sloFormPage.expectAlertSourceEmptyAbsent();
    testLogger.info('Test completed');
  });
});
