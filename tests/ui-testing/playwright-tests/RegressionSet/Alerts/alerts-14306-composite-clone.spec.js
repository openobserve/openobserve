// Copyright 2026 OpenObserve Inc.

/**
 * Alerts Regression — composite alert clone (#14306)
 *
 * Before #14351, cloning a composite alert flattened it to a simple alert
 * instead of routing through the dedicated /clone endpoint, so the clone lost
 * its composite_condition and child references. Covers the same-folder clone,
 * identity preservation, cross-folder routing, cancel, the copy landing paused,
 * the duplicate name the prefilled dialog produces, and the delete guard the
 * clone extends over the children it now shares with its source.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const logData = require('../../../fixtures/log.json');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');
const {
  uniq, simpleAlert, compositeAlert,
  createAlert, listAlerts, findAlertId, findAlertIdInFolder, getAlert,
  deleteAlertInFolder, deleteAlertFolder, seedAlertFixtures, createAlertFolder,
} = require('../../utils/alerts-api-helpers.js');

test.describe('Clone Composite Alerts testcases', {
  tag: ['@alerts', '@alerts-composite'],
}, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;
  // Track alerts as { id, folderId } so cleanup deletes the composite before
  // its child regardless of which folder a cross-folder clone landed in.
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

  async function createChild(page, name) {
    const response = await createAlert(page, simpleAlert(name));
    expect(response.status(), await response.text()).toBe(200);
    const id = await findAlertId(page, name);
    expect(id).toBeTruthy();
    created.push({ id, folderId: 'default' });
    return { id, name };
  }

  async function createCompositeFixture(page, children, overrides = {}) {
    const name = uniq('composite_clone');
    const response = await createAlert(
      page,
      compositeAlert(name, children.map((child) => child.id), overrides),
    );
    expect(response.status(), await response.text()).toBe(200);
    const id = await findAlertId(page, name);
    expect(id).toBeTruthy();
    created.push({ id, folderId: 'default' });
    return { id, name };
  }

  async function openCompositeList(page) {
    await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}&folder=default`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await pm.compositeAlertsPage.openCompositeTab();
  }

  test('should hide stream selects and clone a composite alert into the same folder', {
    tag: ['@composite-alert-clone', '@all', '@alerts', '@alerts-composite', '@P0'],
  }, async ({ page }) => {
    const childA = await createChild(page, uniq('composite_clone_child_a'));
    const childB = await createChild(page, uniq('composite_clone_child_b'));
    const source = await createCompositeFixture(page, [childA, childB]);

    await openCompositeList(page);
    await expect(pm.compositeAlertsPage.listBadge(source.id)).toBeVisible();
    await expect(pm.compositeAlertsPage.listChildCount(source.id)).toContainText('2');

    await pm.compositeAlertsPage.clickCloneButton(source.name);
    await pm.compositeAlertsPage.expectCloneDialogVisible();
    await pm.compositeAlertsPage.expectCloneNamePrefilled(source.name);
    await pm.compositeAlertsPage.expectStreamSelectsHidden();

    const newName = `${source.name} - Copy`;
    await pm.compositeAlertsPage.fillCloneName(newName);
    await pm.compositeAlertsPage.submitClone();
    await pm.compositeAlertsPage.expectCloneSuccessToast();

    const newId = await findAlertId(page, newName);
    expect(newId, 'cloned composite must exist in the same folder').toBeTruthy();
    created.push({ id: newId, folderId: 'default' });
    await expect(pm.compositeAlertsPage.listBadge(newId)).toBeVisible();
    await expect(pm.compositeAlertsPage.listChildCount(newId)).toContainText('2');
    testLogger.info('Composite cloned into the same folder with a preserved child count');
  });

  test('should preserve composite identity when cloned (not flattened to simple)', {
    tag: ['@composite-alert-clone', '@all', '@alerts', '@alerts-composite', '@P1'],
  }, async ({ page }) => {
    const childA = await createChild(page, uniq('composite_clone_child_a'));
    const childB = await createChild(page, uniq('composite_clone_child_b'));
    const source = await createCompositeFixture(page, [childA, childB]);
    const sourceAlert = await getAlert(page, source.id);
    expect(sourceAlert, 'GET must return the source composite').toBeTruthy();
    expect(sourceAlert.alert_type).toBe('composite');
    expect(sourceAlert.composite_condition, 'source composite must store its condition').toBeTruthy();

    await openCompositeList(page);
    await pm.compositeAlertsPage.clickCloneButton(source.name);
    await pm.compositeAlertsPage.expectCloneDialogVisible();
    await pm.compositeAlertsPage.expectStreamSelectsHidden();

    const newName = `${source.name} - Copy`;
    await pm.compositeAlertsPage.fillCloneName(newName);
    await pm.compositeAlertsPage.submitClone();
    await pm.compositeAlertsPage.expectCloneSuccessToast();

    const newId = await findAlertId(page, newName);
    expect(newId, 'cloned composite must be findable by name').toBeTruthy();
    created.push({ id: newId, folderId: 'default' });

    const clone = await getAlert(page, newId);
    expect(clone, 'GET must return the cloned composite').toBeTruthy();
    expect(clone.alert_type).toBe('composite');
    expect(clone.composite_condition, 'clone must keep its composite_condition').toBeTruthy();
    expect(clone.composite_condition.expression).toBe(sourceAlert.composite_condition.expression);
    expect(clone.composite_condition.expression).toContain(`{${childA.id}}`);
    expect(clone.composite_condition.expression).toContain(`{${childB.id}}`);
    await expect(pm.compositeAlertsPage.listBadge(newId)).toBeVisible();
    testLogger.info('Cloned composite preserved its type and child-referencing expression');
  });

  test('should route a composite clone into a different folder', {
    tag: ['@composite-alert-clone', '@all', '@alerts', '@alerts-composite', '@P1'],
  }, async ({ page }) => {
    const targetFolderId = await createAlertFolder(page, uniq('clone_target'));
    createdFolders.push(targetFolderId);
    const childA = await createChild(page, uniq('composite_clone_child_a'));
    const childB = await createChild(page, uniq('composite_clone_child_b'));
    const source = await createCompositeFixture(page, [childA, childB]);

    await openCompositeList(page);
    await pm.compositeAlertsPage.clickCloneButton(source.name);
    await pm.compositeAlertsPage.expectCloneDialogVisible();
    await pm.compositeAlertsPage.expectStreamSelectsHidden();
    await pm.compositeAlertsPage.selectCloneFolder(targetFolderId);

    const newName = `${source.name} - Copy`;
    await pm.compositeAlertsPage.fillCloneName(newName);
    await pm.compositeAlertsPage.submitClone();
    await pm.compositeAlertsPage.expectCloneSuccessToast();

    const newId = await findAlertIdInFolder(page, newName, targetFolderId);
    expect(newId, 'cloned composite must land in the chosen target folder').toBeTruthy();
    created.push({ id: newId, folderId: targetFolderId });
    expect(await findAlertId(page, newName), 'clone must NOT remain in the default folder').toBeUndefined();

    // The list follows the clone rather than leaving the user in the folder
    // they cloned from, where the new alert is nowhere to be seen.
    await expect(pm.compositeAlertsPage.listBadge(newId)).toBeVisible();
    testLogger.info('Composite clone routed to the target folder, not default');
  });

  test('should cancel the clone dialog without creating an alert', {
    tag: ['@composite-alert-clone', '@all', '@alerts', '@alerts-composite', '@P1'],
  }, async ({ page }) => {
    const childA = await createChild(page, uniq('composite_clone_child_a'));
    const childB = await createChild(page, uniq('composite_clone_child_b'));
    const source = await createCompositeFixture(page, [childA, childB]);

    await openCompositeList(page);
    await pm.compositeAlertsPage.clickCloneButton(source.name);
    await pm.compositeAlertsPage.expectCloneDialogVisible();
    await pm.compositeAlertsPage.expectStreamSelectsHidden();

    await pm.compositeAlertsPage.cancelClone();
    await pm.compositeAlertsPage.expectCloneDialogHidden();

    expect(await findAlertId(page, `${source.name} - Copy`), 'cancel must not create a clone').toBeUndefined();
    testLogger.info('Cancel dismissed the dialog and created no clone');
  });

  test('should create the clone paused even when the source composite is running', {
    tag: ['@composite-alert-clone', '@all', '@alerts', '@alerts-composite', '@P1'],
  }, async ({ page }) => {
    const childA = await createChild(page, uniq('composite_clone_child_a'));
    const childB = await createChild(page, uniq('composite_clone_child_b'));
    const source = await createCompositeFixture(page, [childA, childB], { enabled: true });
    const sourceAlert = await getAlert(page, source.id);
    expect(sourceAlert.enabled, 'the source must start out running').toBe(true);
    expect(sourceAlert.scheduler_job_present, 'an enabled composite owns a scheduler job').toBe(true);

    await openCompositeList(page);
    await pm.compositeAlertsPage.clickCloneButton(source.name);
    await pm.compositeAlertsPage.expectCloneDialogVisible();

    const newName = `${source.name} - Copy`;
    await pm.compositeAlertsPage.fillCloneName(newName);
    await pm.compositeAlertsPage.submitClone();
    await pm.compositeAlertsPage.expectCloneSuccessToast();

    const newId = await findAlertId(page, newName);
    expect(newId, 'cloned composite must be findable by name').toBeTruthy();
    created.push({ id: newId, folderId: 'default' });

    // A clone is never armed: duplicating an alert to edit it must not start a
    // second stream of notifications behind the user's back.
    const clone = await getAlert(page, newId);
    expect(clone.enabled, 'clone must land paused even though the source was running').toBe(false);
    expect(clone.scheduler_job_present, 'a paused clone owns no scheduler job').toBe(false);

    // The row toggle is the only affordance that tells the two apart on the
    // list, so it has to disagree between source and copy.
    await expect(pm.compositeAlertsPage.listEnableToggle(newName)).toHaveAttribute('data-row-action', 'resume');
    await expect(pm.compositeAlertsPage.listEnableToggle(source.name)).toHaveAttribute('data-row-action', 'pause');
    testLogger.info('Clone of a running composite landed paused and unscheduled');
  });

  test('should keep the prefilled name and leave two composites answering to it', {
    tag: ['@composite-alert-clone', '@all', '@alerts', '@alerts-composite', '@P2'],
  }, async ({ page }) => {
    const childA = await createChild(page, uniq('composite_clone_child_a'));
    const childB = await createChild(page, uniq('composite_clone_child_b'));
    const source = await createCompositeFixture(page, [childA, childB]);

    await openCompositeList(page);
    await pm.compositeAlertsPage.clickCloneButton(source.name);
    await pm.compositeAlertsPage.expectCloneDialogVisible();
    await pm.compositeAlertsPage.expectCloneNamePrefilled(source.name);

    // Saving the dialog untouched is the default path, and alert names are not
    // unique (a plain alert create accepts a duplicate too), so the folder ends
    // up holding two composites under one name.
    await pm.compositeAlertsPage.submitClone();
    await pm.compositeAlertsPage.expectCloneSuccessToast();

    const rows = (await listAlerts(page)).filter((row) => row.name === source.name);
    expect(rows, 'the copy must be a second row, not an overwrite').toHaveLength(2);
    const copy = rows.find((row) => row.alert_id !== source.id);
    expect(copy, 'the second row must be a new alert, not the source again').toBeTruthy();
    created.push({ id: copy.alert_id, folderId: 'default' });

    // Assertions stay on the API from here: every row-level selector is keyed
    // by name, and two rows now answer to this one.
    const sourceAlert = await getAlert(page, source.id);
    const clone = await getAlert(page, copy.alert_id);
    expect(clone.alert_type).toBe('composite');
    expect(clone.composite_condition.expression).toBe(sourceAlert.composite_condition.expression);
    testLogger.info('Clone kept the prefilled name and created a second row under it');
  });

  test('should extend the blocked-delete guard from the source to the clone', {
    tag: ['@composite-alert-clone', '@all', '@alerts', '@alerts-composite', '@P2'],
  }, async ({ page }) => {
    const childA = await createChild(page, uniq('composite_clone_child_a'));
    const childB = await createChild(page, uniq('composite_clone_child_b'));
    const source = await createCompositeFixture(page, [childA, childB]);

    await openCompositeList(page);
    await pm.compositeAlertsPage.clickCloneButton(source.name);
    await pm.compositeAlertsPage.expectCloneDialogVisible();

    const newName = `${source.name} - Copy`;
    await pm.compositeAlertsPage.fillCloneName(newName);
    await pm.compositeAlertsPage.submitClone();
    await pm.compositeAlertsPage.expectCloneSuccessToast();

    const newId = await findAlertId(page, newName);
    expect(newId, 'cloned composite must be findable by name').toBeTruthy();
    created.push({ id: newId, folderId: 'default' });

    // The clone copies the stored id expression, so the children it shares with
    // its source are now held twice over: the delete has to name both parents,
    // not just the one the user remembers building.
    await pm.compositeAlertsPage.openList();
    await pm.alertsPage.searchAlert(childA.name);
    await pm.compositeAlertsPage.attemptRowDelete(childA.name);

    await expect(pm.compositeAlertsPage.referenceDrawer()).toBeVisible();
    await expect(pm.compositeAlertsPage.referenceParent(source.id)).toBeVisible();
    await expect(pm.compositeAlertsPage.referenceParent(newId)).toBeVisible();
    expect(await findAlertId(page, childA.name), 'the child must survive the refused delete').toBeTruthy();
    testLogger.info('Cloning a composite extended the child delete guard to the copy');
  });

  test.fixme('should refuse a blank clone name', {
    tag: ['@composite-alert-clone', '@all', '@alerts', '@alerts-composite', '@P2'],
  }, async ({ page }) => {
    const childA = await createChild(page, uniq('composite_clone_child_a'));
    const childB = await createChild(page, uniq('composite_clone_child_b'));
    const source = await createCompositeFixture(page, [childA, childB]);

    await openCompositeList(page);
    await pm.compositeAlertsPage.clickCloneButton(source.name);
    await pm.compositeAlertsPage.expectCloneDialogVisible();

    // Neither side validates the name: the dialog's OInput carries no required
    // rule and the composite create path has no server-side check either, so
    // this saves an unnamed composite — a row that cannot be searched, toggled
    // or deleted by name. The same empty name on a plain alert is rejected
    // 400 "Alert name is required".
    await pm.compositeAlertsPage.fillCloneName('');
    await pm.compositeAlertsPage.submitClone();

    await pm.compositeAlertsPage.expectCloneDialogVisible();
    expect(
      (await listAlerts(page)).filter((row) => !row.name),
      'a blank name must not create an alert',
    ).toHaveLength(0);
  });
});
