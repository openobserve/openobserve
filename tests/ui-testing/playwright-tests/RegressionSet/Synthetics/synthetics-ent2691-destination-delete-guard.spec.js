// Copyright 2026 OpenObserve Inc.
// o2-enterprise#2691: an alert destination used only by a synthetic check showed Unused and deleted cleanly.
const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { SyntheticsRegressionPage } = require('../../../pages/syntheticsPages/syntheticsRegressionPage.js');

test.describe('A destination used by a synthetic check cannot be deleted (#2691)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let synthetics;
  let tag;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    synthetics = new SyntheticsRegressionPage(page);
    tag = synthetics.newRunTag();
  });

  test.afterEach(async ({}, testInfo) => {
    await synthetics.deleteCreated();
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  async function openDestinationsScopedTo(name) {
    await pm.alertDestinationsPage.navigateToDestinations();
    await pm.alertDestinationsPage.waitForDestinationListReady();
    await pm.alertDestinationsPage.searchDestinations(name);
  }

  test('the destination lists the check as a user, refuses deletion, and deletes once the check is gone', {
    tag: ['@bug-ent2691', '@P1', '@regression', '@syntheticsRegression'],
  }, async () => {
    await synthetics.getMetaOrg();
    const destinationName = await synthetics.createAlertDestination(tag);
    const locationId = await synthetics.createProbeLocation(tag);
    const check = await synthetics.createCheck(`synreg${tag}_dest_guard`, 'http', locationId, {
      destinations: [destinationName],
    });

    await openDestinationsScopedTo(destinationName);
    await pm.alertDestinationsPage.expectUsedByBadgeCount(destinationName, 'synthetic_check', 1);
    await pm.alertDestinationsPage.expectUnusedChipAbsent(destinationName);

    await pm.alertDestinationsPage.openImpactDialog(destinationName);
    await pm.alertDestinationsPage.expectAlertRowVisible(check.name);
    await pm.alertDestinationsPage.closeImpactDialog();

    await pm.alertDestinationsPage.attemptDeleteDestination(destinationName);
    await pm.alertDestinationsPage.expectInUseErrorToastContaining(['synthetic check', check.name]);
    await pm.alertDestinationsPage.expectDestinationRowStillVisible(destinationName);

    await synthetics.deleteCheckNow(check.id);
    await openDestinationsScopedTo(destinationName);
    await pm.alertDestinationsPage.expectUnusedChipVisible(destinationName);
    await pm.alertDestinationsPage.attemptDeleteDestination(destinationName);
    await pm.alertDestinationsPage.expectDestinationNotInList(destinationName);
    synthetics.forgetDestination(destinationName);
  });
});
