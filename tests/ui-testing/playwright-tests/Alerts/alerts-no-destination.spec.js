// Copyright 2026 OpenObserve Inc.

/**
 * Alerts — saving an alert with no destination  [#15267]
 *
 * A destination is optional: the form notes that the alert notifies nobody
 * instead of refusing the save, notify-on-recovery cannot be switched on while
 * nothing is notified, and import accepts an absent or empty `destinations`
 * while still refusing one that is not a list.
 */

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { STREAM, DEST, uniq, seedAlertFixturesOnce } = require('../utils/alerts-api-helpers.js');

test.describe('Alerts — no destination', {
  tag: ['@alerts', '@alertsNoDestination'],
}, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await seedAlertFixturesOnce(page);
    await navigateToBase(page);
  });

  test.afterEach(async () => {
    await pm.alertNoDestinationPage.deleteCreatedAlerts();
  });

  test('a new alert saves with no destination and notes that nobody is notified', {
    tag: ['@P0', '@smoke'],
  }, async () => {
    const name = uniq('auto_nodest_new');

    await pm.alertSaveQueryModePage.openNewAlert();
    await pm.alertSaveQueryModePage.selectStream(STREAM);
    await pm.alertSaveQueryModePage.addBuilderCondition('city', 'paris');
    await pm.alertNoDestinationPage.expectNoDestinationNote();

    await pm.alertSaveQueryModePage.setName(name, { submit: true });
    await pm.alertSaveQueryModePage.expectSavedWithoutDialog();

    const id = await pm.alertNoDestinationPage.trackCreatedAlert(name);
    await pm.alertNoDestinationPage.expectStoredDestinations(id, []);
  });

  test('removing the only destination from an alert saves it with none', {
    tag: ['@P1'],
  }, async () => {
    const id = await pm.alertNoDestinationPage.seedAlert(uniq('auto_nodest_edit'));

    await pm.alertSaveQueryModePage.openEditor(id);
    await pm.alertNoDestinationPage.expectDestinationStatus();

    await pm.alertNoDestinationPage.clearDestinations();
    await pm.alertNoDestinationPage.expectNoDestinationNote();

    await pm.alertSaveQueryModePage.clickSave();
    await pm.alertSaveQueryModePage.expectSavedWithoutDialog();
    await pm.alertNoDestinationPage.expectStoredDestinations(id, []);
  });

  test('notify on recovery stays off until the alert notifies someone', {
    tag: ['@P2'],
  }, async () => {
    await pm.alertSaveQueryModePage.openNewAlert();
    await pm.alertSaveQueryModePage.selectStream(STREAM);
    await pm.alertNoDestinationPage.expectRecoveryToggleDisabled();

    await pm.alertSaveQueryModePage.selectDestination(DEST);
    await pm.alertNoDestinationPage.expectDestinationStatus();
    await pm.alertNoDestinationPage.expectRecoveryToggleEnabled();
  });

  for (const [shape, destinations] of [['absent', undefined], ['empty', []]]) {
    test(`import accepts an alert whose destinations are ${shape}`, {
      tag: ['@P1', '@import'],
    }, async () => {
      const name = uniq(`auto_nodest_imp_${shape}`);

      await pm.alertNoDestinationPage.openImport();
      await pm.alertNoDestinationPage.importAlerts([
        pm.alertNoDestinationPage.importPayload(name, destinations),
      ]);
      await pm.alertNoDestinationPage.expectImportCreated(name);

      const id = await pm.alertNoDestinationPage.trackCreatedAlert(name);
      await pm.alertNoDestinationPage.expectStoredDestinations(id, []);
    });
  }

  test('import still refuses destinations that are not a list', {
    tag: ['@P2', '@import', '@negative'],
  }, async () => {
    const name = uniq('auto_nodest_imp_null');

    await pm.alertNoDestinationPage.openImport();
    await pm.alertNoDestinationPage.importAlerts([
      pm.alertNoDestinationPage.importPayload(name, null),
    ]);
    await pm.alertNoDestinationPage.expectImportRejected('Destinations must be an array.');
    await pm.alertNoDestinationPage.expectAlertNotCreated(name);
  });
});
