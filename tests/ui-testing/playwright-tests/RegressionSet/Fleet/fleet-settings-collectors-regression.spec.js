const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

test.describe('Fleet management settings and collectors regressions', { tag: ['@fleet', '@enterprise', '@all'] }, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    // Cleared first so a failed navigation never leaves afterEach the previous test's closed page.
    pm = undefined;
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.fleetManagerPage.assertEnabled();
  });

  test.afterEach(async () => {
    if (!pm) return;
    await pm.fleetSeed.cleanup();
    expect(await pm.fleetSeed.survivors()).toEqual([]);
  });

  test('R-16104c · the Settings tab has no "Alerts for fleets" section', {
    tag: ['@fleetAccess', '@regression', '@P2'],
  }, async () => {
    await pm.fleetManagerPage.gotoFleet({ tab: 'settings' });
    await pm.fleetManagerPage.expectTabActive('settings');
    await pm.fleetManagerPage.expectSettingsWithoutFleetAlerts(['Alerts for fleets', 'Open the alert library']);
  });

  test('R-16105c · collectors "Reset to default" keeps Architecture and Last connected from hidden', {
    tag: ['@fleetAccess', '@regression', '@P3'],
  }, async () => {
    const fleet = await pm.fleetSeed.createFleet('columns');
    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleet.id });
    await pm.fleetFleetsPage.expectPanelFor(fleet.name);
    await pm.fleetManagerPage.expectColumnChecked('arch', false);
    await pm.fleetManagerPage.expectColumnChecked('lastConnectedFrom', false);

    await pm.fleetManagerPage.toggleColumn('os');
    await pm.fleetManagerPage.expectColumnChecked('os', false);
    await pm.fleetManagerPage.expectColumnShown('os', false);

    await pm.fleetManagerPage.resetColumns();
    await pm.fleetManagerPage.expectColumnChecked('os', true);
    await pm.fleetManagerPage.expectColumnChecked('arch', false);
    await pm.fleetManagerPage.expectColumnChecked('lastConnectedFrom', false);
    await pm.fleetManagerPage.expectColumnShown('os', true);
    await pm.fleetManagerPage.expectColumnShown('arch', false);
    await pm.fleetManagerPage.expectColumnShown('lastConnectedFrom', false);
  });
});
