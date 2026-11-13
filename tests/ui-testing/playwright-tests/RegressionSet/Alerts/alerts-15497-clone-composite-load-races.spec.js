// Copyright 2026 OpenObserve Inc.

// Each test parks the GET under test with page.route, so the load window stays open for as long as the assertions need it.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const {
  uniq,
  cityConditionAlert,
  createAlertForId,
  requireAlertId,
  getAlert,
  createChildAlerts,
  deleteAlertInFolder,
  deleteAlertsCascade,
  seedAlertFixturesOnce,
} = require('../../utils/alerts-api-helpers.js');

test.describe(
  'Alerts — clone and composite load races (ENT#2995, ENT#3037, ENT#2996)',
  {
    tag: ['@alerts', '@alertsLoadRaces', '@regression'],
  },
  () => {
    test.describe.configure({ mode: 'parallel' });

    let pm;
    let created = [];
    let holds = [];

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      pm = new PageManager(page);
      created = [];
      holds = [];
      await seedAlertFixturesOnce(page);
      await navigateToBase(page);
    });

    test.afterEach(async ({ page }) => {
      for (const hold of holds) hold.release();
      for (const id of [...created].reverse()) {
        await deleteAlertInFolder(page, id, 'default');
      }
    });

    test('ENT#2995 clone Save waits for the source alert, then the copy has its destinations and conditions', async ({
      page,
    }) => {
      // Every fixture name carries the `auto_` prefix cleanup.spec.js sweeps.
      const name = uniq('auto_ent2995_src');
      const id = await createAlertForId(page, cityConditionAlert(name));
      created.push(id);
      const source = await getAlert(page, id);
      expect(source.destinations.length, 'the fixture must have a destination to lose').toBeGreaterThan(0);
      expect(
        source.query_condition.conditions.conditions.conditions.length,
        'the fixture must have a condition to lose',
      ).toBeGreaterThan(0);

      await pm.alertsPage.openAlertListAndSearch(name);
      const held = await pm.alertsPage.holdAlertDetailLoad(id);
      holds.push(held);
      await pm.alertsPage.openCloneDialog(name);
      const copyName = uniq('auto_ent2995_copy');
      await pm.alertsPage.fillCloneName(copyName);
      await held.requested;
      await expect(pm.alertsPage.cloneSaveButton()).toBeDisabled();

      held.release();
      await expect(pm.alertsPage.cloneSaveButton()).toBeEnabled({ timeout: 15000 });
      const body = await pm.alertsPage.saveCloneDialog();
      expect(body.name).toBe(copyName);
      expect(body.destinations).toEqual(source.destinations);
      expect(body.query_condition.conditions).toEqual(source.query_condition.conditions);

      const copyId = await requireAlertId(page, copyName);
      created.push(copyId);
      const copy = await getAlert(page, copyId);
      expect(copy.destinations).toEqual(source.destinations);
      expect(copy.query_condition.conditions).toEqual(source.query_condition.conditions);
      expect(copy.trigger_condition.threshold).toBe(source.trigger_condition.threshold);
    });

    test('ENT#2995 a slow load from an earlier clone does not replace the alert being cloned now', async ({ page }) => {
      const stem = uniq('auto_ent2995_stale');
      const [nameA, nameB] = [`${stem}_a`, `${stem}_b`];
      const idA = await createAlertForId(page, cityConditionAlert(nameA, 7));
      created.push(idA);
      const idB = await createAlertForId(page, cityConditionAlert(nameB, 9));
      created.push(idB);

      await pm.alertsPage.openAlertListAndSearch(stem);
      const heldA = await pm.alertsPage.holdAlertDetailLoad(idA);
      holds.push(heldA);
      await pm.alertsPage.openCloneDialog(nameA);
      await heldA.requested;
      await pm.alertsPage.cancelCloneDialog();
      await expect(pm.alertsPage.cloneDialog()).toBeHidden();

      const loadedB = pm.alertsPage.waitForAlertDetailLoad(idB);
      await pm.alertsPage.openCloneDialog(nameB);
      const copyName = uniq('auto_ent2995_stale_copy');
      await pm.alertsPage.fillCloneName(copyName);
      await loadedB;
      await expect(pm.alertsPage.cloneSaveButton()).toBeEnabled({ timeout: 15000 });

      const loadedA = pm.alertsPage.waitForAlertDetailLoad(idA);
      heldA.release();
      await (await loadedA).finished();
      // The stale load has to land before Save reads the source, or the test cannot see it overwrite B.
      await pm.alertsPage.settlePendingUiTasks();

      const body = await pm.alertsPage.saveCloneDialog();
      expect(body.name).toBe(copyName);
      expect(body.trigger_condition.threshold, 'the copy must come from the alert in the dialog').toBe(9);

      const copyId = await requireAlertId(page, copyName);
      created.push(copyId);
      const copy = await getAlert(page, copyId);
      expect(copy.trigger_condition.threshold).toBe(9);
      const [a, b] = [await getAlert(page, idA), await getAlert(page, idB)];
      expect([a.name, a.trigger_condition.threshold]).toEqual([nameA, 7]);
      expect([b.name, b.trigger_condition.threshold]).toEqual([nameB, 9]);
    });

    test('ENT#3037 Edit on the original right after a clone opens the original, and Save updates it', async ({
      page,
    }) => {
      const name = uniq('auto_ent3037_src');
      const id = await createAlertForId(page, cityConditionAlert(name, 3));
      created.push(id);

      await pm.alertsPage.openAlertListAndSearch(name);
      const loaded = pm.alertsPage.waitForAlertDetailLoad(id);
      await pm.alertsPage.openCloneDialog(name);
      const copyName = uniq('auto_ent3037_copy');
      await pm.alertsPage.fillCloneName(copyName);
      await loaded;
      await expect(pm.alertsPage.cloneSaveButton()).toBeEnabled({ timeout: 15000 });
      await pm.alertsPage.saveCloneDialog();
      created.push(await requireAlertId(page, copyName));
      await expect(pm.alertsPage.cloneDialog()).toBeHidden();

      await pm.alertsPage.clickAlertEditButtonInList(name);
      await expect(page).toHaveURL(new RegExp(`alert_id=${id}`));
      await pm.alertSaveQueryModePage.expectThreshold('3');
      await expect(pm.alertsPage.getAlertNameValueLocator()).toHaveText(name);

      await pm.alertSaveQueryModePage.setThreshold('6');
      const response = await pm.alertSaveQueryModePage.saveAndWaitForUpdate();
      expect(response.url(), 'Save must address the original by its own id').toMatch(pm.alertsPage.alertDetailUrl(id));
      expect(response.status(), await response.text()).toBe(200);

      const after = await getAlert(page, id);
      expect(after.name).toBe(name);
      expect(after.trigger_condition.threshold).toBe(6);
    });

    test('ENT#2996 Add alert stays disabled while the child alerts load, then adds one', async ({ page }) => {
      const [child] = await createChildAlerts(page, 'auto_ent2996_load', 1);
      created.push(child.id);
      const composite = pm.compositeAlertsPage;
      await composite.openCreate();
      const held = await composite.holdCandidateLoad();
      holds.push(held);
      await composite.typeTab().click();
      await expect(composite.form()).toBeVisible();
      await held.requested;

      await expect(composite.childAdd()).toHaveAttribute('aria-disabled', 'true');
      await expect(composite.childEmpty()).toBeVisible();

      held.release();
      await expect(composite.childAdd()).not.toHaveAttribute('aria-disabled', 'true', { timeout: 15000 });
      await composite.childAdd().click();
      await expect(composite.selectedChildRows()).toHaveCount(1);
    });

    test('ENT#2996 Add alert is disabled once every child alert is picked, and comes back when one is removed', async ({
      page,
    }) => {
      const children = await createChildAlerts(page, 'auto_ent2996', 2);
      const childIds = children.map((child) => child.id);
      try {
        // The default org holds other runs' alerts, so the candidate list is narrowed to make "all picked" reachable.
        const composite = pm.compositeAlertsPage;
        await composite.limitCandidatesTo(childIds);
        await composite.openCreate();
        await composite.chooseCompositeType();
        await expect(composite.childAdd()).not.toHaveAttribute('aria-disabled', 'true', { timeout: 15000 });
        await composite.childAdd().click();
        await expect(composite.selectedChildRows()).toHaveCount(1);
        await composite.childAdd().click();
        await expect(composite.selectedChildRows()).toHaveCount(2);

        await expect(composite.childAdd()).toHaveAttribute('aria-disabled', 'true');
        await composite.childAdd().click({ force: true });
        await expect(composite.selectedChildRows()).toHaveCount(2);

        await composite.childRemove(childIds[0]).click();
        await expect(composite.selectedChildRows()).toHaveCount(1);
        await expect(composite.childAdd()).not.toHaveAttribute('aria-disabled', 'true');
      } finally {
        await deleteAlertsCascade(page, childIds);
      }
    });
  },
);
