// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const logData = require('../../fixtures/log.json');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const {
  uniq, simpleAlert, compositeAlert,
  createAlert, findAlertId, findAlertIdInFolder, getAlert,
  deleteAlertInFolder, deleteAlertFolder, seedAlertFixtures, createAlertFolder,
} = require('../utils/alerts-api-helpers.js');

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

  async function createCompositeFixture(page, children) {
    const name = uniq('composite_clone');
    const response = await createAlert(
      page,
      compositeAlert(name, children.map((child) => child.id)),
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
    const child = await createChild(page, uniq('composite_clone_child'));
    const source = await createCompositeFixture(page, [child]);

    await openCompositeList(page);
    await expect(pm.compositeAlertsPage.listBadge(source.id)).toBeVisible();
    await expect(pm.compositeAlertsPage.listChildCount(source.id)).toContainText('1');

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
    await expect(pm.compositeAlertsPage.listChildCount(newId)).toContainText('1');
    testLogger.info('Composite cloned into the same folder with a preserved child count');
  });

  test('should preserve composite identity when cloned (not flattened to simple)', {
    tag: ['@composite-alert-clone', '@all', '@alerts', '@alerts-composite', '@P1'],
  }, async ({ page }) => {
    const child = await createChild(page, uniq('composite_clone_child'));
    const source = await createCompositeFixture(page, [child]);
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
    expect(clone.composite_condition.expression).toContain(`{${child.id}}`);
    await expect(pm.compositeAlertsPage.listBadge(newId)).toBeVisible();
    testLogger.info('Cloned composite preserved its type and child-referencing expression');
  });

  test('should route a composite clone into a different folder', {
    tag: ['@composite-alert-clone', '@all', '@alerts', '@alerts-composite', '@P1'],
  }, async ({ page }) => {
    const targetFolderId = await createAlertFolder(page, uniq('clone_target'));
    createdFolders.push(targetFolderId);
    const child = await createChild(page, uniq('composite_clone_child'));
    const source = await createCompositeFixture(page, [child]);

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
    testLogger.info('Composite clone routed to the target folder, not default');
  });

  test('should cancel the clone dialog without creating an alert', {
    tag: ['@composite-alert-clone', '@all', '@alerts', '@alerts-composite', '@P1'],
  }, async ({ page }) => {
    const child = await createChild(page, uniq('composite_clone_child'));
    const source = await createCompositeFixture(page, [child]);

    await openCompositeList(page);
    await pm.compositeAlertsPage.clickCloneButton(source.name);
    await pm.compositeAlertsPage.expectCloneDialogVisible();
    await pm.compositeAlertsPage.expectStreamSelectsHidden();

    await pm.compositeAlertsPage.cancelClone();
    await pm.compositeAlertsPage.expectCloneDialogHidden();

    expect(await findAlertId(page, `${source.name} - Copy`), 'cancel must not create a clone').toBeUndefined();
    testLogger.info('Cancel dismissed the dialog and created no clone');
  });

  test('should clone a composite whose child alert was deleted', {
    tag: ['@composite-alert-clone', '@all', '@alerts', '@alerts-composite', '@P2'],
  }, async ({ page }) => {
    const child = await createChild(page, uniq('composite_clone_child'));
    const source = await createCompositeFixture(page, [child]);

    // Clone is id-based and copies the stored expression; a deleted child must
    // not block it. Remove the child from the tracked cleanup set first.
    await deleteAlertInFolder(page, child.id, 'default');
    created = created.filter((entry) => entry.id !== child.id);

    await openCompositeList(page);
    await pm.compositeAlertsPage.clickCloneButton(source.name);
    await pm.compositeAlertsPage.expectCloneDialogVisible();
    await pm.compositeAlertsPage.expectStreamSelectsHidden();

    const newName = `${source.name} - Copy`;
    await pm.compositeAlertsPage.fillCloneName(newName);
    await pm.compositeAlertsPage.submitClone();
    await pm.compositeAlertsPage.expectCloneSuccessToast();

    const newId = await findAlertId(page, newName);
    expect(newId, 'clone with a stale child reference must still be created').toBeTruthy();
    created.push({ id: newId, folderId: 'default' });
    await expect(pm.compositeAlertsPage.listBadge(newId)).toBeVisible();
    await expect(pm.compositeAlertsPage.listChildCount(newId)).toBeVisible();
    testLogger.info('Composite cloned despite its child having been deleted');
  });
});
