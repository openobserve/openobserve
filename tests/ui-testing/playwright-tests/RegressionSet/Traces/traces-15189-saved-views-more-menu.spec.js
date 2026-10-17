const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { generateHexId } = require('../../utils/trace-ingestion.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');

const STREAM = 'default';
const PIN_TITLE = 'Pin to toolbar';
const UNPIN_TITLE = 'Unpin from toolbar';

const org = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const baseUrl = () => (process.env.ZO_BASE_URL || '').replace(/\/+$/, '');

async function createTracesView(page, name, editorValue) {
  const response = await page.request.post(`${baseUrl()}/api/${org()}/savedviews`, {
    headers: getAuthHeaders(),
    data: {
      view_name: name,
      view_type: 'traces',
      data: {
        version: 1,
        stream: { label: STREAM, value: STREAM },
        editorValue,
        datetime: { type: 'relative', relativeTimePeriod: '15m', startTime: 0, endTime: 0 },
        searchMode: 'spans',
        sortBy: 'start_time',
        sortOrder: 'desc',
        selectedFields: [],
      },
    },
  });
  expect(response.status(), 'Precondition: saved view must be created').toBe(200);
  return (await response.json()).view_id;
}

async function deleteView(page, viewId) {
  if (!viewId) return;
  await page.request
    .delete(`${baseUrl()}/api/${org()}/savedviews/${viewId}`, { headers: getAuthHeaders() })
    .catch(() => {});
}

test.describe('Traces saved views in the More menu with a pin (#15189)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let viewId;
  let viewName;
  let viewFilter;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    const runId = generateHexId(4);
    viewName = `e2e-15189-${runId}`;
    viewFilter = `service_name = 'e2e-15189-${runId}'`;
    viewId = await createTracesView(page, viewName, viewFilter);
    await pm.tracesPage.navigateToTracesUrlWithStream(STREAM);
    await pm.tracesPage.switchToSpansMode();
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteView(page, viewId);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('the More menu on Traces search offers "List saved views" and "Create saved view" with a pin', {
    tag: ['@bug-15189', '@P1', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.openMoreMenu();
    await pm.tracesPage.expectMoreMenuSavedViewsEntriesVisible();
    await pm.tracesPage.closeMoreMenu();

    await pm.tracesPage.openCreateSavedViewFromMoreMenu();
    testLogger.info('Create saved view opened from the More menu');
  });

  test('unpinning moves saved views out of the toolbar, pinning brings them back, and both stick after reload', {
    tag: ['@bug-15189', '@P1', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.expectPinnedSavedViewsInToolbar();

    await pm.tracesPage.toggleSavedViewsPinFromMoreMenu();
    await pm.tracesPage.expectSavedViewsPinTitle(PIN_TITLE);
    await pm.tracesPage.closeMoreMenu();
    await pm.tracesPage.expectPinnedSavedViewsNotInToolbar();

    await pm.tracesPage.openMoreMenu();
    await pm.tracesPage.expectMoreMenuSavedViewsEntriesVisible();
    await pm.tracesPage.closeMoreMenu();

    await pm.tracesPage.reloadPage();
    await pm.tracesPage.openMoreMenu();
    await pm.tracesPage.expectSavedViewsPinTitle(PIN_TITLE);
    await pm.tracesPage.closeMoreMenu();
    await pm.tracesPage.expectPinnedSavedViewsNotInToolbar();

    await pm.tracesPage.toggleSavedViewsPinFromMoreMenu();
    await pm.tracesPage.expectSavedViewsPinTitle(UNPIN_TITLE);
    await pm.tracesPage.closeMoreMenu();
    await pm.tracesPage.expectPinnedSavedViewsInToolbar();

    await pm.tracesPage.reloadPage();
    await pm.tracesPage.expectPinnedSavedViewsInToolbar();
  });

  test('a saved view applies from the pinned toolbar dropdown', {
    tag: ['@bug-15189', '@P1', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.expectPinnedSavedViewsInToolbar();
    await pm.tracesPage.applySavedViewFromPinnedGroup(viewName);
    await pm.tracesPage.expectQueryEditorEventuallyContains(viewFilter);
  });

  test('a saved view applies from the List saved views dialog opened from the More menu', {
    tag: ['@bug-15189', '@P1', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.openSavedViewsListFromMoreMenu();
    await pm.tracesPage.applySavedViewFromListDialog(viewName);
    await pm.tracesPage.expectQueryEditorEventuallyContains(viewFilter);
  });

  test('the saved views group is hidden on Services Catalog', {
    tag: ['@bug-15189', '@P2', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.expectPinnedSavedViewsInToolbar();

    await pm.tracesPage.navigateToServicesViaTab();
    await pm.tracesPage.expectPinnedSavedViewsNotInToolbar();
    await pm.tracesPage.openMoreMenu();
    await pm.tracesPage.expectMoreMenuSavedViewsEntriesHidden();
  });
});
