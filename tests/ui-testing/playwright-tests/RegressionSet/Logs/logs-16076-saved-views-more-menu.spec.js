const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');

const STREAM = 'e2e_automate';
const ORIGINAL_QUERY = 'ovn_b_16076_original_marker';

function orgId() {
  return getOrgIdentifier() || process.env.ORGNAME || 'default';
}

function apiBase() {
  return process.env.ZO_BASE_URL_SC || process.env.ZO_BASE_URL;
}

async function createLogsView(request, name) {
  const resp = await request.post(`${apiBase()}/api/${orgId()}/savedviews`, {
    headers: getAuthHeaders(),
    data: { view_name: name, view_type: 'logs', data: { query: ORIGINAL_QUERY } },
  });
  expect(resp.status(), `Precondition: saved view ${name} must be created`).toBe(200);
  return (await resp.json()).view_id;
}

async function getView(request, id) {
  return request.get(`${apiBase()}/api/${orgId()}/savedviews/${id}`, { headers: getAuthHeaders() });
}

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
    idA = await createLogsView(page.request, nameA);
    idB = await createLogsView(page.request, nameB);
    created.push(idA, idB);

    await navigateToBase(page);
    pm = new PageManager(page);
    await page.goto(`${process.env.ZO_BASE_URL}/web/logs?stream_type=logs&stream=${STREAM}&period=15m&org_identifier=${orgId()}`);
    await pm.logsPage.clickSavedViewsDropdownArrow();
  });

  test.afterEach(async ({ page }, testInfo) => {
    while (created.length) {
      const id = created.pop();
      await page.request.delete(`${apiBase()}/api/${orgId()}/savedviews/${id}`, { headers: getAuthHeaders() }).catch(() => {});
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

    const afterUpdate = await getView(page.request, idA);
    expect(afterUpdate.status()).toBe(200);
    const stored = JSON.stringify((await afterUpdate.json()).data ?? {});
    expect(stored, 'overwrite must replace the stored query').not.toContain(ORIGINAL_QUERY);
    expect(stored, 'overwrite must store the current page state').toContain(STREAM);

    await pm.logsPage.clickSavedViewsDropdownArrow();
    await pm.logsPage.fillSavedViewSearchInput(nameB);
    const del = await menu.confirmRowAction('delete', idB, nameB, 'DELETE');
    expect(del.status()).toBe(200);

    const gone = await getView(page.request, idB);
    expect(gone.status(), 'deleted view must no longer be readable').not.toBe(200);
    const listResp = await page.request.get(`${apiBase()}/api/${orgId()}/savedviews`, { headers: getAuthHeaders() });
    const ids = ((await listResp.json()).views || []).map((v) => v.view_id);
    expect(ids).not.toContain(idB);
    expect(ids).toContain(idA);
  });
});
