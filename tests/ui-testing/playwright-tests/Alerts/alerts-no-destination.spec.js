// Copyright 2026 OpenObserve Inc.

/**
 * Alerts — saving an alert with no destination  [#15267]
 *
 * A destination is optional: the form notes that the alert notifies nobody
 * instead of refusing the save, notify-on-recovery cannot be switched on while
 * nothing is notified, and import accepts an absent or empty `destinations`
 * while still refusing one that is not a list.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const {
  STREAM, DEST, uniq,
  simpleAlert, createAlert, findAlertId, getAlert,
  deleteAlertInFolder, seedAlertFixturesOnce,
} = require('../utils/alerts-api-helpers.js');

test.describe('Alerts — no destination', {
  tag: ['@alerts', '@alertsNoDestination'],
}, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;
  let created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    created = [];
    await seedAlertFixturesOnce(page);
    await navigateToBase(page);
  });

  test.afterEach(async ({ page }) => {
    for (const id of [...created].reverse()) {
      await deleteAlertInFolder(page, id, 'default');
    }
  });

  async function trackCreated(page, name) {
    const id = await findAlertId(page, name);
    expect(id, `alert ${name} must exist after save`).toBeTruthy();
    created.push(id);
    return id;
  }

  test('a new alert saves with no destination and notes that nobody is notified', {
    tag: ['@P0', '@smoke'],
  }, async ({ page }) => {
    const name = uniq('auto_nodest_new');

    await pm.alertSaveQueryModePage.openNewAlert();
    await pm.alertSaveQueryModePage.selectStream(STREAM);
    await pm.alertSaveQueryModePage.addBuilderCondition('city', 'paris');
    await pm.alertNoDestinationPage.expectNoDestinationNote();

    await pm.alertSaveQueryModePage.setName(name, { submit: true });
    await pm.alertSaveQueryModePage.expectSavedWithoutDialog();

    const id = await trackCreated(page, name);
    expect((await getAlert(page, id)).destinations).toEqual([]);
  });

  test('removing the only destination from an alert saves it with none', {
    tag: ['@P1'],
  }, async ({ page }) => {
    const name = uniq('auto_nodest_edit');
    const response = await createAlert(page, simpleAlert(name));
    expect(response.status(), await response.text()).toBe(200);
    const id = await trackCreated(page, name);

    await pm.alertSaveQueryModePage.openEditor(id);
    await pm.alertNoDestinationPage.expectDestinationStatus();

    await pm.alertNoDestinationPage.clearDestinations();
    await pm.alertNoDestinationPage.expectNoDestinationNote();

    await pm.alertSaveQueryModePage.clickSave();
    await pm.alertSaveQueryModePage.expectSavedWithoutDialog();
    expect((await getAlert(page, id)).destinations).toEqual([]);
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

  for (const shape of ['absent', 'empty']) {
    test(`import accepts an alert whose destinations are ${shape}`, {
      tag: ['@P1', '@import'],
    }, async ({ page }) => {
      const name = uniq(`auto_nodest_imp_${shape}`);
      const alert = { ...simpleAlert(name), org_id: getOrgIdentifier() };
      if (shape === 'absent') delete alert.destinations;
      else alert.destinations = [];

      await pm.alertNoDestinationPage.openImport();
      await pm.alertNoDestinationPage.importAlerts([alert]);
      await pm.alertNoDestinationPage.expectImportCreated(name);

      const id = await trackCreated(page, name);
      expect((await getAlert(page, id)).destinations).toEqual([]);
    });
  }

  test('import still refuses destinations that are not a list', {
    tag: ['@P2', '@import', '@negative'],
  }, async ({ page }) => {
    const name = uniq('auto_nodest_imp_null');
    const alert = { ...simpleAlert(name), org_id: getOrgIdentifier(), destinations: null };

    await pm.alertNoDestinationPage.openImport();
    await pm.alertNoDestinationPage.importAlerts([alert]);
    await pm.alertNoDestinationPage.expectImportRejected('Destinations must be an array.');
    expect(await findAlertId(page, name)).toBeFalsy();
  });
});
