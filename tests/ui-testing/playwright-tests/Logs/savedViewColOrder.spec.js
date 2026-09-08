const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

const STREAM = logData.Stream; // "e2e_automate"
const TIMESTAMP_COLUMN = '_timestamp';

/**
 * Encode a field array as the legacy object-format colOrder shape
 * (e.g. ['code','level'] -> { 0: 'code', 1: 'level' }).
 */
function toObjectColOrder(fields) {
  const obj = {};
  fields.forEach((field, index) => {
    obj[index] = field;
  });
  return obj;
}

/**
 * Seed a saved view for the selected stream by driving the UI to create a real,
 * valid searchObj (add fields + save), then mutating its colOrder payload via the
 * saved-views REST API and writing it back.
 *
 * This follows the setup contract's "robust path": it copies a real searchObj
 * instead of hand-building one, so the payload always matches the running frontend.
 *
 * @param {PageManager} pm
 * @param {string} viewName - Unique view name (must be unique per org).
 * @param {string[]} fields - Fields to add as table columns (in order).
 * @param {(searchObj: object) => void} mutateColOrder - Mutates the fetched searchObj's
 *        `data.resultGrid.colOrder` / `data.stream.selectedFields` before PUT.
 * @returns {Promise<string>} The created view_id.
 */
async function seedViewWithColOrder(pm, viewName, fields, mutateColOrder) {
  // Add fields to the table so the saved searchObj has a real, non-empty selection.
  for (const field of fields) {
    await pm.logsPage.fillIndexFieldSearchInput(field);
    await pm.logsPage.hoverOnFieldExpandButton(field);
    await pm.logsPage.clickAddFieldToTableButton(field);
    await pm.logsPage.fillIndexFieldSearchInput('');
  }

  // Save a view through the UI (produces a real, valid array-format searchObj).
  await pm.logsPage.clickSaveViewButton();
  await pm.logsPage.fillSavedViewName(viewName);
  await pm.logsPage.clickSavedViewDialogSave();

  // The UI create is async; poll until the view id is discoverable by name.
  const viewId = await pm.apiCleanup.getSavedViewIdByName(viewName);
  if (!viewId) {
    throw new Error(`Seeded saved view not found by name: ${viewName}`);
  }

  // Fetch the real payload, mutate colOrder, then write it back.
  const view = await pm.apiCleanup.getSavedView(viewId);
  const searchObj = view.data;
  mutateColOrder(searchObj);
  await pm.apiCleanup.updateSavedView(viewId, searchObj, viewName);

  return viewId;
}

/**
 * Apply a saved view via the saved-views dropdown.
 */
async function applySavedView(pm, viewName) {
  await pm.logsPage.clickSavedViewsExpand();
  await pm.logsPage.fillSavedViewSearchInput(viewName);
  await pm.logsPage.clickSavedViewByTitle(viewName);
}

test.describe("Logs Saved View Column Order Normalization testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('domcontentloaded');

    await ingestTestData(page, STREAM);
    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.ensureQuickModeState(false);
    await pm.logsPage.clickSearchBarRefreshButton();

    testLogger.info('Saved view column order test setup completed');
  });

  test("should normalize legacy object-format colOrder to an array on apply", {
    tag: ['@saved-view-column-order', '@logs', '@savedview', '@all']
  }, async ({ page }) => {
    testLogger.info('Seeding a legacy object-format colOrder saved view');

    const viewName = `e2e_colorder_obj_${Date.now()}`;
    let viewId = null;

    try {
      viewId = await seedViewWithColOrder(
        pm,
        viewName,
        ['code', 'level', 'message'],
        (searchObj) => {
          searchObj.data.resultGrid.colOrder[STREAM] = toObjectColOrder(['code', 'level', 'message']);
          searchObj.data.stream.selectedFields = ['code', 'level', 'message'];
        },
      );

      await applySavedView(pm, viewName);

      // The object-format colOrder must be normalized back to an array and render
      // in the encoded order, with the timestamp pinned first.
      await pm.logsPage.expectColumnOrder([TIMESTAMP_COLUMN, 'code', 'level', 'message']);

      testLogger.info('Legacy object-format colOrder normalization test completed');
    } finally {
      if (viewId) {
        await pm.apiCleanup.deleteSavedView(viewId);
      }
    }
  });

  test("should preserve array-format colOrder order when applying a saved view", {
    tag: ['@saved-view-column-order', '@logs', '@savedview', '@all']
  }, async ({ page }) => {
    testLogger.info('Seeding a reordered array-format colOrder saved view');

    const viewName = `e2e_colorder_arr_${Date.now()}`;
    let viewId = null;

    try {
      viewId = await seedViewWithColOrder(
        pm,
        viewName,
        ['code', 'level', 'message'],
        (searchObj) => {
          // Reorder to a different sequence than the UI-saved order to prove the
          // array survives the mergeDeep apply (and is not objectified).
          searchObj.data.resultGrid.colOrder[STREAM] = ['message', 'code', 'level'];
          searchObj.data.stream.selectedFields = ['message', 'code', 'level'];
        },
      );

      await applySavedView(pm, viewName);

      // The array order must be preserved exactly (timestamp pinned first).
      await pm.logsPage.expectColumnOrder([TIMESTAMP_COLUMN, 'message', 'code', 'level']);

      testLogger.info('Array-format colOrder preservation test completed');
    } finally {
      if (viewId) {
        await pm.apiCleanup.deleteSavedView(viewId);
      }
    }
  });

  test("should fall back to stored selectedFields order when colOrder is absent", {
    tag: ['@saved-view-column-order', '@logs', '@savedview', '@all']
  }, async ({ page }) => {
    testLogger.info('Seeding a saved view with no colOrder key');

    const viewName = `e2e_colorder_none_${Date.now()}`;
    let viewId = null;

    try {
      viewId = await seedViewWithColOrder(
        pm,
        viewName,
        ['log', 'took', 'level'],
        (searchObj) => {
          // Remove the colOrder entry entirely; applySavedView must fall back to
          // the stored selectedFields order.
          delete searchObj.data.resultGrid.colOrder[STREAM];
        },
      );

      await applySavedView(pm, viewName);

      // Columns must render from selectedFields with the timestamp pinned first.
      await pm.logsPage.expectColumnOrder([TIMESTAMP_COLUMN, 'log', 'took', 'level']);

      testLogger.info('No-colOrder fallback test completed');
    } finally {
      if (viewId) {
        await pm.apiCleanup.deleteSavedView(viewId);
      }
    }
  });
});
