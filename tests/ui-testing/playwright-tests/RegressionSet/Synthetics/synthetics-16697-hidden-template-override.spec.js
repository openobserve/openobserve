// Copyright 2026 OpenObserve Inc.
// openobserve#16697: removing a check's last destination hid the template picker but kept sending its override.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { SyntheticsRegressionPage } = require('../../../pages/syntheticsPages/syntheticsRegressionPage.js');

test.describe('A check with no destination drops its hidden template override (#16697)', () => {
  let synthetics;
  let tag;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    synthetics = new SyntheticsRegressionPage(page);
    tag = synthetics.newRunTag();
  });

  test.afterEach(async ({}, testInfo) => {
    await synthetics.deleteCreated();
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('removing the last destination saves the check with template null', {
    tag: ['@bug-16697', '@P2', '@regression', '@syntheticsRegression'],
  }, async () => {
    await synthetics.getMetaOrg();
    const destinationName = await synthetics.createAlertDestination(tag);
    const templateName = await synthetics.createOverrideTemplate(tag);
    const locationId = await synthetics.createProbeLocation(tag);
    const check = await synthetics.createCheck(`synreg${tag}_override`, 'http', locationId, {
      destinations: [destinationName],
      template: templateName,
    });
    expect((await synthetics.fetchCheck(check.id)).template).toBe(templateName);

    await synthetics.gotoEditCheck(check);
    await synthetics.expectTemplateOverride(templateName);
    await synthetics.untickAlertDestination(destinationName);
    await synthetics.expectTemplateOverrideHidden();

    const sent = await synthetics.saveEditedCheck(check.id);
    expect(sent.destinations).toEqual([]);
    expect(sent.template).toBeNull();
    const stored = await synthetics.fetchCheck(check.id);
    expect(stored.destinations ?? []).toEqual([]);
    expect(stored.template ?? null).toBeNull();
  });
});
