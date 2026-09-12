// Copyright 2026 OpenObserve Inc.

/**
 * Composite alerts — alert list and references drawer (plan area A).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The list row is assembled by a hand-maintained, field-by-field mapping, and a
 * field the mapping forgets is invisible no matter what the API returns. Two
 * live bugs are exactly that failure (o2-enterprise#2619 and #2620), so these
 * assertions are pinned to what the API demonstrably sends rather than to what
 * the table happens to render today.
 *
 * The delete-conflict path gets first-class coverage because it is the only
 * thing preventing a user from dissolving a composite by deleting its children
 * out from under it.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const {
  uniq, urls, api, createChildAlerts, createCompositeAlert, listAlerts,
  deleteAlertsCascade, seedAlertFixturesOnce,
} = require('../utils/alerts-api-helpers.js');

test.describe('Composite alerts — list', {
  tag: ['@alerts', '@alerts-composite', '@P0'],
}, () => {
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
    await deleteAlertsCascade(page, created);
  });

  /** Two children plus a composite over them. */
  async function seedComposite(page, prefix) {
    const [a, b] = await createChildAlerts(page, prefix, 2);
    created.push(a.id, b.id);
    const parent = await createCompositeAlert(page, uniq(`${prefix}_parent`), [a.id, b.id]);
    expect(parent.response.status(), await parent.response.text()).toBe(200);
    created.push(parent.id);
    return { a, b, parent };
  }

  test('A1/A2 · the Composite tab lists composites with a badge and child count', async ({ page }) => {
    const { a, parent } = await seedComposite(page, 'a1');

    await pm.compositeAlertsPage.openList();
    await pm.compositeAlertsPage.openListTab('composite');

    await expect(pm.compositeAlertsPage.listBadge(parent.id)).toBeVisible();
    await expect(pm.compositeAlertsPage.listChildCount(parent.id)).toContainText('2');

    // The tab is a filter: plain children must not appear under it.
    await expect(pm.compositeAlertsPage.listBadge(a.id)).toHaveCount(0);
  });

  test('A3 · a composite row has no stream to show', async ({ page }) => {
    const { parent } = await seedComposite(page, 'a3');

    await pm.compositeAlertsPage.openList();
    await pm.compositeAlertsPage.openListTab('composite');

    await expect(pm.compositeAlertsPage.listRow(parent.id)).toContainText('--');
  });

  test.fixme('A4 · a composite row shows its trigger expression (o2-enterprise#2620)', async ({ page }) => {
    const { parent } = await seedComposite(page, 'a4');

    await pm.compositeAlertsPage.openList();
    await pm.compositeAlertsPage.openListTab('composite');

    // The list response carries no expression under any key, so the cell's
    // `v-if` suppresses it entirely. Un-fixme once the backend sends one.
    await expect(pm.compositeAlertsPage.listExpression(parent.id)).toBeVisible();
  });

  test.fixme('A5 · a referenced child shows a "referenced by" chip (o2-enterprise#2619)', async ({ page }) => {
    const { a } = await seedComposite(page, 'a5');

    await pm.compositeAlertsPage.openList();
    await pm.alertsPage.searchAlert(a.name);

    // The API sends referenced_by_composite_count; the scheduled-row mapping
    // drops it, so the chip never renders. Un-fixme once the mapping copies it.
    await expect(pm.compositeAlertsPage.listReferenceCount(a.id)).toBeVisible();
    await expect(pm.compositeAlertsPage.referenceChip()).toBeVisible();
  });

  test('A5b · the API supplies the reference count the chip needs', async ({ page }) => {
    const { a, parent } = await seedComposite(page, 'a5b');

    // Guards the contract behind #2619 so a backend regression cannot hide
    // behind the front-end bug while that one is still open.
    const rows = await listAlerts(page);
    expect(rows.find((r) => r.alert_id === a.id).referenced_by_composite_count).toBe(1);
    expect(rows.find((r) => r.alert_id === parent.id).child_count).toBe(2);
  });

  test('A9 · deleting a referenced child is blocked and names the parent', async ({ page }) => {
    const { a, parent } = await seedComposite(page, 'a9');
    let status = null;
    page.on('response', (response) => {
      if (response.url().includes(`/alerts/${a.id}`) && response.request().method() === 'DELETE') {
        status = response.status();
      }
    });

    await pm.compositeAlertsPage.openList();
    await pm.alertsPage.searchAlert(a.name);
    await pm.compositeAlertsPage.attemptRowDelete(a.name);

    await expect(pm.compositeAlertsPage.referenceDrawer()).toBeVisible();
    await expect(pm.compositeAlertsPage.referenceConflict()).toBeVisible();
    await expect(pm.compositeAlertsPage.referenceParent(parent.id)).toBeVisible();
    await expect.poll(() => status).toBe(409);

    // The child must survive a refused delete.
    expect(await listAlerts(page)).toEqual(
      expect.arrayContaining([expect.objectContaining({ alert_id: a.id })]),
    );
  });

  test('A7 · the conflict drawer navigates to the blocking parent', async ({ page }) => {
    const { a, parent } = await seedComposite(page, 'a7');

    await pm.compositeAlertsPage.openList();
    await pm.alertsPage.searchAlert(a.name);
    await pm.compositeAlertsPage.attemptRowDelete(a.name);
    await expect(pm.compositeAlertsPage.referenceParent(parent.id)).toBeVisible();

    await pm.compositeAlertsPage.referenceParent(parent.id).click();

    await expect(page).toHaveURL(new RegExp(parent.id));
  });

  test('A6 · the conflict drawer moves focus to its close control', async ({ page }) => {
    const { a } = await seedComposite(page, 'a6');

    await pm.compositeAlertsPage.openList();
    await pm.alertsPage.searchAlert(a.name);
    await pm.compositeAlertsPage.attemptRowDelete(a.name);
    await expect(pm.compositeAlertsPage.referenceDrawer()).toBeVisible();

    await expect(pm.compositeAlertsPage.referenceClose()).toBeFocused();

    await pm.compositeAlertsPage.referenceClose().click();
    await expect(pm.compositeAlertsPage.referenceDrawer()).toBeHidden();
  });

  test('A10 · removing the parent first frees its children for deletion', async ({ page }) => {
    const { a, parent } = await seedComposite(page, 'a10');

    const blocked = await api(page, 'delete', `${urls().v2}/alerts/${a.id}?folder=default`);
    expect(blocked.status()).toBe(409);

    const removeParent = await api(page, 'delete', `${urls().v2}/alerts/${parent.id}?folder=default`);
    expect(removeParent.status(), await removeParent.text()).toBe(200);

    const freed = await api(page, 'delete', `${urls().v2}/alerts/${a.id}?folder=default`);
    expect(freed.status(), await freed.text()).toBe(200);

    created = created.filter((id) => id !== parent.id && id !== a.id);

    await pm.compositeAlertsPage.openList();
    await pm.compositeAlertsPage.openListTab('composite');
    await expect(pm.compositeAlertsPage.listBadge(parent.id)).toHaveCount(0);
  });

  test('A12 · a composite can be enabled and disabled again from its row', async ({ page }) => {
    const { parent } = await seedComposite(page, 'a12');
    const enabled = async () =>
      (await listAlerts(page)).find((row) => row.alert_id === parent.id)?.enabled;

    await pm.compositeAlertsPage.openList();
    await pm.compositeAlertsPage.openListTab('composite');
    await expect(pm.compositeAlertsPage.listBadge(parent.id)).toBeVisible();

    const toggle = pm.compositeAlertsPage.listEnableToggle(parent.name);
    await expect(toggle).toBeVisible();
    expect(await enabled(), 'fixtures are created paused').toBe(false);

    await toggle.click();
    await expect.poll(enabled).toBe(true);

    // The return trip is the half that actually matters: enabling a composite
    // creates a scheduler job, and disabling has to tear it down again rather
    // than leaving an orphan behind.
    await toggle.click();
    await expect.poll(enabled).toBe(false);
  });
});
