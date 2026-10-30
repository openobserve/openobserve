const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { generateHexId } = require('../../utils/trace-ingestion.js');
const { createSavedView, deleteSavedView } = require('../../utils/traces-api.js');

const STREAM = 'default';
const PIN_TITLE = 'Pin to toolbar';
const UNPIN_TITLE = 'Unpin from toolbar';

function tracesView(name, editorValue) {
  return {
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
  };
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
    viewId = await createSavedView(page.request, tracesView(viewName, viewFilter), {
      message: 'Precondition: saved view must be created',
    });
    await pm.tracesPage.navigateToTracesUrlWithStream(STREAM);
    await pm.tracesPage.switchToSpansMode();
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteSavedView(page.request, viewId);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('the More menu on Traces search offers a Saved views submenu with "Create saved view" and a pin', {
    tag: ['@bug-15189', '@P1', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.openMoreMenu();
    await pm.tracesPage.expectMoreMenuSavedViewsEntriesVisible();
    await pm.tracesPage.closeMoreMenu();

    await pm.tracesPage.openCreateSavedViewFromMoreMenu();
    testLogger.info('Create saved view opened from the More menu');
  });

  test('saved views are not pinned by default, pinning shows them in the toolbar, unpinning removes them, and both stick after reload', {
    tag: ['@bug-15189', '@P1', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.expectPinnedSavedViewsNotInToolbar();
    await pm.tracesPage.openMoreMenu();
    await pm.tracesPage.expectSavedViewsPinTitle(PIN_TITLE);
    await pm.tracesPage.expectMoreMenuSavedViewsEntriesVisible();
    await pm.tracesPage.closeMoreMenu();

    await pm.tracesPage.toggleSavedViewsPinFromMoreMenu();
    await pm.tracesPage.expectSavedViewsPinTitle(UNPIN_TITLE);
    await pm.tracesPage.closeMoreMenu();
    await pm.tracesPage.expectPinnedSavedViewsInToolbar();

    await pm.tracesPage.reloadPage();
    await pm.tracesPage.expectPinnedSavedViewsInToolbar();

    await pm.tracesPage.toggleSavedViewsPinFromMoreMenu();
    await pm.tracesPage.expectSavedViewsPinTitle(PIN_TITLE);
    await pm.tracesPage.closeMoreMenu();
    await pm.tracesPage.expectPinnedSavedViewsNotInToolbar();

    await pm.tracesPage.reloadPage();
    await pm.tracesPage.expectPinnedSavedViewsNotInToolbar();
  });

  test('a saved view applies from the pinned toolbar dropdown', {
    tag: ['@bug-15189', '@P1', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.toggleSavedViewsPinFromMoreMenu();
    await pm.tracesPage.closeMoreMenu();
    await pm.tracesPage.expectPinnedSavedViewsInToolbar();
    await pm.tracesPage.applySavedViewFromPinnedGroup(viewName);
    await pm.tracesPage.expectQueryEditorEventuallyContains(viewFilter);
  });

  test('a saved view applies from the Saved views submenu in the More menu', {
    tag: ['@bug-15189', '@P1', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.applySavedViewFromMoreMenu(viewName);
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
