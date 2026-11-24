const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  orgId, createLogsSavedView, getSavedView, deleteSavedViewQuietly, listSavedViewIds,
} = require('../../utils/regression-seed-api.js');

const STREAM = 'e2e_automate';
const ORIGINAL_QUERY = 'ovn_b_16076_original_marker';

test.describe('Logs saved views submenu: search, favorites, overwrite, delete (OSS#16076, ENT#3218)', () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  const created = [];
  let nameA;
  let nameB;
  let idA;
  let idB;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const run = Date.now().toString(36);
    nameA = `ovn-b-16076-alpha-${run}`;
    nameB = `ovn-b-16076-beta-${run}`;
    idA = await createLogsSavedView(page.request, nameA, ORIGINAL_QUERY);
    idB = await createLogsSavedView(page.request, nameB, ORIGINAL_QUERY);
    created.push(idA, idB);

    await navigateToBase(page);
    pm = new PageManager(page);
    await page.goto(`${process.env.ZO_BASE_URL}/web/logs?stream_type=logs&stream=${STREAM}&period=15m&org_identifier=${orgId()}`);
    await pm.logsPage.clickSavedViewsDropdownArrow();
  });

  test.afterEach(async ({ page }, testInfo) => {
    while (created.length) {
      await deleteSavedViewQuietly(page.request, created.pop());
    }
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('search filters the list, and a starred view moves into Favorites and stays there after reload', {
    tag: ['@bug-16076', '@P2', '@regression', '@logsRegression'],
  }, async ({ page }) => {
    const menu = pm.logsSavedViewsMenuPage;

    await pm.logsPage.fillSavedViewSearchInput(nameA);
    await menu.expectRowVisible(idA);
    await menu.expectRowAbsent(idB);

    await pm.logsPage.fillSavedViewSearchInput('ovn-b-16076-');
    await menu.expectRowVisible(idB);

    await menu.expectNotInFavorites(idA);
    await menu.toggleFavorite(idA);
    await menu.expectInFavorites(idA);
    await menu.expectNotInFavorites(idB);
    await menu.expectNotInAllGroup(idA);

    await page.reload();
    await pm.logsPage.clickSavedViewsDropdownArrow();
    await pm.logsPage.fillSavedViewSearchInput(nameA);
    await menu.expectInFavorites(idA);

    // Unstar so the favourite does not leak into later runs in this browser profile.
    await menu.toggleFavorite(idA);
    await menu.expectFavoritesGroupGone();
  });

  test('edit overwrites the stored view after confirmation and delete removes it', {
    tag: ['@bug-16076', '@P2', '@regression', '@logsRegression'],
  }, async ({ page }) => {
    const menu = pm.logsSavedViewsMenuPage;
    await pm.logsPage.fillSavedViewSearchInput(nameA);
    const put = await menu.confirmRowAction('update', idA, nameA, 'PUT');
    expect(put.status()).toBe(200);

    const afterUpdate = await getSavedView(page.request, idA);
    expect(afterUpdate.status()).toBe(200);
    const stored = JSON.stringify((await afterUpdate.json()).data ?? {});
    expect(stored, 'overwrite must replace the stored query').not.toContain(ORIGINAL_QUERY);
    expect(stored, 'overwrite must store the current page state').toContain(STREAM);

    await pm.logsPage.clickSavedViewsDropdownArrow();
    await pm.logsPage.fillSavedViewSearchInput(nameB);
    const del = await menu.confirmRowAction('delete', idB, nameB, 'DELETE');
    expect(del.status()).toBe(200);

    const gone = await getSavedView(page.request, idB);
    expect(gone.status(), 'deleted view must no longer be readable').not.toBe(200);
    const ids = await listSavedViewIds(page.request);
    expect(ids).not.toContain(idB);
    expect(ids).toContain(idA);
  });
});
