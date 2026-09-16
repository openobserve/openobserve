// Copyright 2026 OpenObserve Inc.

/**
 * Alerts Regression — composite alert clone (#14306)
 *
 * Before #14351, cloning a composite alert flattened it to a simple alert
 * instead of routing through the dedicated /clone endpoint, so the clone lost
 * its composite_condition and child references. Covers the same-folder clone,
 * identity preservation, cross-folder routing, cancel, and a clone whose
 * child alert was subsequently deleted.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const logData = require('../../../fixtures/log.json');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');
const {
  uniq, simpleAlert, compositeAlert,
  createAlert, findAlertId, findAlertIdInFolder, getAlert,
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
    const source = await createCompositeFixture(page, [childA, childB], { enabled: true });
    const sourceAlert = await getAlert(page, source.id);
    expect(sourceAlert, 'GET must return the source composite').toBeTruthy();
    expect(sourceAlert.alert_type).toBe('composite');
    expect(sourceAlert.composite_condition, 'source composite must store its condition').toBeTruthy();
    expect(sourceAlert.enabled, 'source composite must be seeded enabled').toBe(true);

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
    expect(clone.enabled, 'clone must be created disabled even though the source was enabled').toBe(false);
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

  test.fixme(
    'should clone a composite whose child alert was deleted — not wired: '
      + 'delete of a referenced child is refused 409 child_referenced (mod.rs:2157-2168) '
      + 'and alerts-api-helpers.js:233 swallows the error; a genuinely missing child is '
      + 'rejected at resolve_children (service.rs:462-466, ChildNotAccessible)',
    { tag: ['@composite-alert-clone', '@all', '@alerts', '@alerts-composite', '@P2'] },
    async () => {},
  );
});
