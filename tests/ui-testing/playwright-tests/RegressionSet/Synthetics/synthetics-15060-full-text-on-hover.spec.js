const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { SyntheticsRegressionPage } = require('../../../pages/syntheticsPages/syntheticsRegressionPage.js');

test.describe('Synthetics cut-off text shows in full on hover (#15060)', () => {
  test.describe.configure({ mode: 'parallel' });
  let synthetics;
  let tag;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    synthetics = new SyntheticsRegressionPage(page);
    tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  });

  test.afterEach(async ({}, testInfo) => {
    await synthetics.deleteCreated();
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('a location name cut off in the runs table shows its full text on hover', {
    tag: ['@bug-15060', '@P2', '@regression', '@syntheticsRegression'],
  }, async () => {
    const label = `SynReg ${tag} probe location with a name far too long for its column`;
    const locationId = `synreg-${tag}`;
    await synthetics.createPublicLocations([{ id: locationId, label }]);
    const check = await synthetics.createCheck(`synreg${tag}_hover`, 'http', locationId);
    await synthetics.seedRuns(check, locationId, [{ status: 'passed', durationMs: 240, ageSec: 60 }]);

    await synthetics.gotoResults(check);
    await synthetics.expectRunLocationCut(0);
    await synthetics.hoverRunLocation(0);
    await synthetics.expectTooltipText(label);
  });
});
