// Copyright 2026 OpenObserve Inc.

// Each test parks the GET under test with page.route, so the load window stays open for as long as the assertions need it.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const logData = require('../../../fixtures/log.json');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');
const {
  uniq,
  simpleAlert,
  createAlert,
  findAlertId,
  getAlert,
  createChildAlerts,
  deleteAlertInFolder,
  deleteAlertsCascade,
  seedAlertFixturesOnce,
} = require('../../utils/alerts-api-helpers.js');

const detailUrl = (id) => new RegExp(`/api/v2/[^/]+/alerts/${id}(\\?|$)`);
const CANDIDATES_URL = /\/api\/v2\/[^/]+\/alerts\?.*alert_type=all/;

const isCreate = (r) => r.method() === 'POST' && /\/api\/v2\/[^/]+\/alerts(\?|$)/.test(r.url());

function sourceAlert(name, threshold) {
  const alert = simpleAlert(name);
  alert.trigger_condition.threshold = threshold;
  alert.query_condition.conditions.conditions.conditions = [
    { filterType: 'condition', column: 'city', operator: '=', value: 'paris', logicalOperator: 'AND' },
  ];
  return alert;
}

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

    async function holdGet(page, url) {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      let markRequested;
      const requested = new Promise((resolve) => {
        markRequested = resolve;
      });
      await page.route(url, async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        markRequested();
        await gate;
        return route.fallback();
      });
      const hold = { requested, release };
      holds.push(hold);
      return hold;
    }

    // Every fixture name carries the `auto_` prefix cleanup.spec.js sweeps.
    async function seedSource(page, name, threshold = 3) {
      const response = await createAlert(page, sourceAlert(name, threshold));
      expect(response.status(), await response.text()).toBe(200);
      const id = await findAlertId(page, name);
      expect(id, `seeded alert ${name} must be listable`).toBeTruthy();
      created.push(id);
      return id;
    }

    async function openAlertList(page, search) {
      await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}&folder=default`);
      await pm.alertsPage.searchAlert(search);
    }

    async function saveClone(page) {
      const saved = page.waitForResponse((r) => isCreate(r.request()));
      await pm.alertsPage.submitCloneDialog();
      const response = await saved;
      expect(response.status(), await response.text()).toBe(200);
      return response.request().postDataJSON();
    }

    async function trackCopy(page, name) {
      const id = await findAlertId(page, name);
      expect(id, 'the copy must exist under its new name').toBeTruthy();
      created.push(id);
      return getAlert(page, id);
    }

    test('ENT#2995 clone Save waits for the source alert, then the copy has its destinations and conditions', async ({
      page,
    }) => {
      const name = uniq('auto_ent2995_src');
      const id = await seedSource(page, name);
      const source = await getAlert(page, id);
      expect(source.destinations.length, 'the fixture must have a destination to lose').toBeGreaterThan(0);
      expect(
        source.query_condition.conditions.conditions.conditions.length,
        'the fixture must have a condition to lose',
      ).toBeGreaterThan(0);

      await openAlertList(page, name);
      const held = await holdGet(page, detailUrl(id));
      await pm.alertsPage.openCloneDialog(name);
      const copyName = uniq('auto_ent2995_copy');
      await pm.alertsPage.fillCloneName(copyName);
      await held.requested;
      await expect(pm.alertsPage.cloneSaveButton()).toBeDisabled();

      held.release();
      await expect(pm.alertsPage.cloneSaveButton()).toBeEnabled({ timeout: 15000 });
      const body = await saveClone(page);
      expect(body.name).toBe(copyName);
      expect(body.destinations).toEqual(source.destinations);
      expect(body.query_condition.conditions).toEqual(source.query_condition.conditions);

      const copy = await trackCopy(page, copyName);
      expect(copy.destinations).toEqual(source.destinations);
      expect(copy.query_condition.conditions).toEqual(source.query_condition.conditions);
      expect(copy.trigger_condition.threshold).toBe(source.trigger_condition.threshold);
    });

    test('ENT#2995 a slow load from an earlier clone does not replace the alert being cloned now', async ({ page }) => {
      const stem = uniq('auto_ent2995_stale');
      const [nameA, nameB] = [`${stem}_a`, `${stem}_b`];
      const idA = await seedSource(page, nameA, 7);
      const idB = await seedSource(page, nameB, 9);

      await openAlertList(page, stem);
      const heldA = await holdGet(page, detailUrl(idA));
      await pm.alertsPage.openCloneDialog(nameA);
      await heldA.requested;
      await pm.alertsPage.cancelCloneDialog();
      await expect(pm.alertsPage.cloneDialog()).toBeHidden();

      const loadedB = page.waitForResponse(detailUrl(idB));
      await pm.alertsPage.openCloneDialog(nameB);
      const copyName = uniq('auto_ent2995_stale_copy');
      await pm.alertsPage.fillCloneName(copyName);
      await loadedB;
      await expect(pm.alertsPage.cloneSaveButton()).toBeEnabled({ timeout: 15000 });

      const loadedA = page.waitForResponse(detailUrl(idA));
      heldA.release();
      await (await loadedA).finished();
      // The stale load's continuation runs after its response event, and has to land before Save reads the source.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));

      const body = await saveClone(page);
      expect(body.name).toBe(copyName);
      expect(body.trigger_condition.threshold, 'the copy must come from the alert in the dialog').toBe(9);

      const copy = await trackCopy(page, copyName);
      expect(copy.trigger_condition.threshold).toBe(9);
      const [a, b] = [await getAlert(page, idA), await getAlert(page, idB)];
      expect([a.name, a.trigger_condition.threshold]).toEqual([nameA, 7]);
      expect([b.name, b.trigger_condition.threshold]).toEqual([nameB, 9]);
    });

    test('ENT#3037 Edit on the original right after a clone opens the original, and Save updates it', async ({
      page,
    }) => {
      const name = uniq('auto_ent3037_src');
      const id = await seedSource(page, name, 3);

      await openAlertList(page, name);
      const loaded = page.waitForResponse(detailUrl(id));
      await pm.alertsPage.openCloneDialog(name);
      const copyName = uniq('auto_ent3037_copy');
      await pm.alertsPage.fillCloneName(copyName);
      await loaded;
      await expect(pm.alertsPage.cloneSaveButton()).toBeEnabled({ timeout: 15000 });
      await saveClone(page);
      await trackCopy(page, copyName);
      await expect(pm.alertsPage.cloneDialog()).toBeHidden();

      await pm.alertsPage.clickRowEdit(name);
      await expect(page).toHaveURL(new RegExp(`alert_id=${id}`));
      await pm.alertSaveQueryModePage.expectThreshold('3');
      await expect(pm.alertSaveQueryModePage.alertNameValue()).toHaveText(name);

      await pm.alertSaveQueryModePage.setThreshold('6');
      const saved = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && /\/api\/v2\/[^/]+\/alerts\//.test(r.url()),
      );
      await pm.alertSaveQueryModePage.clickSave();
      const response = await saved;
      expect(response.url(), 'Save must address the original by its own id').toMatch(detailUrl(id));
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
      const held = await holdGet(page, CANDIDATES_URL);
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
        await page.route(CANDIDATES_URL, async (route) => {
          const response = await route.fetch();
          const json = await response.json();
          json.list = json.list.filter((alert) => childIds.includes(alert.alert_id));
          await route.fulfill({ response, json });
        });

        const composite = pm.compositeAlertsPage;
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
