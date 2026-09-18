// Copyright 2026 OpenObserve Inc.

/**
 * Alerts Regression — the clone dialog for ordinary (non-composite) alerts
 *
 * The composite family routes through the dedicated /clone endpoint and is
 * covered by alerts-14306-composite-clone.spec.js. Ordinary alerts take the
 * other branch of the same dialog: AlertList.vue re-fetches the source, swaps
 * the name, stream and folder, and POSTs it back as a new alert — which is why
 * a copy here inherits `enabled` instead of landing paused like a composite
 * clone does. Covers the finished copy, stream retargeting, folder routing and
 * the two validations the stream selects impose.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const logData = require('../../../fixtures/log.json');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');
const {
  STREAM, uniq, simpleAlert,
  createAlert, listAlerts, findAlertId, findAlertIdInFolder, getAlert,
  deleteAlertInFolder, deleteAlertFolder, seedAlertFixtures, createAlertFolder,
} = require('../../utils/alerts-api-helpers.js');

// Ingested by global setup on every run, so it exists on any server the suite
// is pointed at — unlike the alert fixtures' own notification sink.
const RETARGET_STREAM = 'e2e_automate';

test.describe('Clone Alert dialog testcases', {
  tag: ['@alerts', '@alerts-clone'],
}, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;
  let created = [];
  let createdFolders = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    created = [];
    createdFolders = [];
    await seedAlertFixtures(page);
    await navigateToBase(page);
  });

  test.afterEach(async ({ page }) => {
    for (const { id, folderId } of [...created].reverse()) {
      await deleteAlertInFolder(page, id, folderId);
    }
    for (const folderId of [...createdFolders].reverse()) {
      await deleteAlertFolder(page, folderId);
    }
  });

  // Every fixture name carries the `auto_` prefix cleanup.spec.js sweeps, so an
  // interrupted run leaves nothing behind for the next one to trip over.
  async function createSource(page, prefix) {
    const name = uniq(prefix);
    const response = await createAlert(page, simpleAlert(name));
    expect(response.status(), await response.text()).toBe(200);
    const id = await findAlertId(page, name);
    expect(id).toBeTruthy();
    created.push({ id, folderId: 'default' });
    return { id, name };
  }

  // The default folder accumulates alerts across parallel runs, so a row is
  // only addressable after searching for it.
  async function openAlertList(page, name) {
    await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}&folder=default`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await pm.alertsPage.searchAlert(name);
  }

  test('should clone a running alert into an independent copy that keeps running', {
    tag: ['@alert-clone-dialog', '@all', '@alerts', '@alerts-clone', '@P1'],
  }, async ({ page }) => {
    const source = await createSource(page, 'auto_alert_clone_src');
    const sourceAlert = await getAlert(page, source.id);
    expect(sourceAlert.enabled, 'the fixture must start out running').toBe(true);

    await openAlertList(page, source.name);
    const newName = uniq('auto_alert_clone_copy');
    await pm.alertsPage.cloneAlert(source.name, 'logs', STREAM, { newName });

    const newId = await findAlertId(page, newName);
    expect(newId, 'the copy must exist under its new name').toBeTruthy();
    created.push({ id: newId, folderId: 'default' });
    expect(newId, 'the copy must be a new alert, not the source renamed').not.toBe(source.id);

    // The copy carries the whole definition, which is the only reason to clone
    // rather than start a new alert from the wizard.
    const clone = await getAlert(page, newId);
    expect(clone.stream_name).toBe(sourceAlert.stream_name);
    expect(clone.stream_type).toBe(sourceAlert.stream_type);
    expect(clone.destinations).toEqual(sourceAlert.destinations);
    expect(clone.trigger_condition).toEqual(sourceAlert.trigger_condition);
    expect(clone.query_condition).toEqual(sourceAlert.query_condition);

    // Unlike a composite clone, which is forced paused, an ordinary copy keeps
    // the source's enabled state and is therefore scheduled the moment it is
    // saved. Pinned here so the divergence is a decision, not a surprise.
    expect(clone.enabled, 'an ordinary clone inherits the source enabled state').toBe(true);
    await pm.alertsPage.searchAlert(newName);
    await expect(pm.alertsPage.rowEnableToggle(newName)).toHaveAttribute('data-row-action', 'pause');

    // Cloning is a copy, not a move.
    const after = await getAlert(page, source.id);
    expect(after.name).toBe(source.name);
    expect(after.enabled).toBe(true);
    testLogger.info('Clone of a running alert is an independent, still-running copy');
  });

  test('should retarget the copy at the stream chosen in the dialog', {
    tag: ['@alert-clone-dialog', '@all', '@alerts', '@alerts-clone', '@P1'],
  }, async ({ page }) => {
    const source = await createSource(page, 'auto_alert_clone_stream_src');

    await openAlertList(page, source.name);
    const newName = uniq('auto_alert_clone_stream_copy');
    // Choosing a different stream is the whole point of the stream selects the
    // composite branch hides: the copy must follow the dialog, not the source.
    // RETARGET_STREAM, not the notification sink: the sink only exists once
    // some other spec has fired an alert into it, which makes the stream this
    // test picks depend on run order.
    await pm.alertsPage.cloneAlert(source.name, 'logs', RETARGET_STREAM, { newName });

    const newId = await findAlertId(page, newName);
    expect(newId, 'the retargeted copy must exist').toBeTruthy();
    created.push({ id: newId, folderId: 'default' });

    const clone = await getAlert(page, newId);
    expect(clone.stream_name).toBe(RETARGET_STREAM);
    expect(clone.query_condition, 'retargeting must not rewrite the condition').toEqual(
      (await getAlert(page, source.id)).query_condition,
    );
    expect((await getAlert(page, source.id)).stream_name, 'the source keeps its own stream').toBe(STREAM);
    testLogger.info('Clone followed the stream chosen in the dialog');
  });

  test('should route the copy into the folder chosen in the dialog', {
    tag: ['@alert-clone-dialog', '@all', '@alerts', '@alerts-clone', '@P1'],
  }, async ({ page }) => {
    const targetFolderId = await createAlertFolder(page, uniq('auto_alert_clone_target'));
    createdFolders.push(targetFolderId);
    const source = await createSource(page, 'auto_alert_clone_folder_src');

    await openAlertList(page, source.name);
    const newName = uniq('auto_alert_clone_folder_copy');
    await pm.alertsPage.cloneAlert(source.name, 'logs', STREAM, { newName, folderId: targetFolderId });

    const newId = await findAlertIdInFolder(page, newName, targetFolderId);
    expect(newId, 'the copy must land in the chosen folder').toBeTruthy();
    created.push({ id: newId, folderId: targetFolderId });
    expect(await findAlertId(page, newName), 'the copy must NOT remain in the default folder').toBeUndefined();
    testLogger.info('Clone routed to the chosen folder, not default');
  });

  test('should demand a name, a stream type and a stream name before cloning', {
    tag: ['@alert-clone-dialog', '@all', '@alerts', '@alerts-clone', '@P2'],
  }, async ({ page }) => {
    const source = await createSource(page, 'auto_alert_clone_validation');

    await openAlertList(page, source.name);
    await pm.alertsPage.openCloneDialog(source.name);

    // The name is prefilled but erasable, and nothing below the dialog rejects
    // a blank one, so Save has to stay out of reach until a name is typed.
    await pm.alertsPage.fillCloneName('');
    await expect(pm.alertsPage.cloneSaveButton()).toBeDisabled();
    await pm.alertsPage.fillCloneName(source.name);
    await expect(pm.alertsPage.cloneSaveButton()).toBeEnabled();

    // An ordinary alert has a stream, and the copy cannot inherit it silently:
    // both selects start empty and each is refused in turn.
    await pm.alertsPage.submitCloneDialog();
    await expect(pm.alertsPage.toastWithText('Please select stream type')).toBeVisible({ timeout: 10000 });

    await pm.alertsPage.selectCloneStreamType('logs');
    await pm.alertsPage.submitCloneDialog();
    await expect(pm.alertsPage.toastWithText('Please select stream name')).toBeVisible({ timeout: 10000 });

    await pm.alertsPage.cancelCloneDialog();
    await expect(pm.alertsPage.cloneDialog()).toBeHidden({ timeout: 10000 });
    expect(
      (await listAlerts(page)).filter((row) => row.name === source.name),
      'a refused clone must leave the folder with only the source',
    ).toHaveLength(1);
    testLogger.info('Clone refused until both stream selects are answered');
  });
});
