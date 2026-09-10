/**
 * Logs Index Stream Change Resets Pagination — E2E suite.
 *
 * Verifies that changing the selected stream resets the left-hand field-list
 * (IndexList) pagination back to page 1, so the user never lands mid-list on the
 * previous stream's page offset. Both streams are ingested with 70_fields.json
 * (111 distinct fields → 5 pages at pageSize 25) so the field-list pagination
 * stays visible across the stream change and the "page 1 is primary again"
 * assertion is explicit.
 */
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe("Logs Index Stream Change Resets Pagination testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  // Per-worker stream fixtures: ingested once per worker and reused across that
  // worker's tests. Module state is per process, so parallel workers stay isolated.
  let streamA;
  let streamB;
  let streamsReady = false;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    // Ingest the two 111-field streams once per worker BEFORE navigating to the
    // logs page, so the fresh stream list (and quick-pick) includes them.
    if (!streamsReady) {
      const token = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
      streamA = `e2e_pag_reset_a_${token}`;
      streamB = `e2e_pag_reset_b_${token}`;
      await pm.logsPage.ingest70FieldsData(streamA);
      await pm.logsPage.ingest70FieldsData(streamB);
      await pm.logsPage.waitForStreamsListed([streamA, streamB], 120000);
      streamsReady = true;
    }
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  // ── P0: changing the stream via the dropdown resets field-list pagination ──
  test("should reset field list pagination to page 1 when switching to another stream via the dropdown", {
    tag: ['@logs-index-stream-change-pagination-reset', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing field-list pagination reset on dropdown stream change');

    await pm.logsPage.selectStream(streamA);
    await pm.logsPage.waitForFieldListAfterStreamSelection();
    await pm.logsPage.waitForFieldListPaginationVisible();
    await pm.logsPage.expectFieldListPaginationPageActive(1);

    await pm.logsPage.clickFieldListPaginationPage(2);
    await pm.logsPage.expectFieldListPaginationPageActive(2);
    await pm.logsPage.expectFieldListPaginationPageInactive(1);

    // Switch to the second stream in-page (skipNavigation) — page must snap to 1.
    await pm.logsPage.selectStream(streamB, 5, null, true);
    await pm.logsPage.waitForFieldListAfterStreamSelection();
    await pm.logsPage.waitForFieldListPaginationVisible();
    await pm.logsPage.expectFieldListPaginationPageActive(1);
    await pm.logsPage.expectFieldListPaginationPageInactive(2);

    testLogger.info('Test completed');
  });

  // ── P1: quick-pick stream selection resets pagination ──
  test("should reset field list pagination to page 1 when selecting a stream via quick pick", {
    tag: ['@logs-index-stream-change-pagination-reset', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing field-list pagination reset on quick-pick stream change');

    await pm.logsPage.expectQuickPickContainerVisible();
    await pm.logsPage.clickQuickPickButton(streamA);
    await pm.logsPage.expectQuickPickContainerNotVisible();
    await pm.logsPage.waitForFieldListAfterStreamSelection();
    await pm.logsPage.waitForFieldListPaginationVisible();
    await pm.logsPage.expectFieldListPaginationPageActive(1);

    await pm.logsPage.clickFieldListPaginationPage(2);
    await pm.logsPage.expectFieldListPaginationPageActive(2);
    await pm.logsPage.expectFieldListPaginationPageInactive(1);

    // Deselect so the quick pick reappears, then re-select via quick pick.
    await pm.logsPage.deselectStreamViaCheckbox(streamA);
    await pm.logsPage.expectQuickPickContainerVisible();
    await pm.logsPage.clickQuickPickButton(streamB);
    await pm.logsPage.waitForFieldListAfterStreamSelection();
    await pm.logsPage.waitForFieldListPaginationVisible();
    await pm.logsPage.expectFieldListPaginationPageActive(1);
    await pm.logsPage.expectFieldListPaginationPageInactive(2);

    testLogger.info('Test completed');
  });

  // ── P1: field-list search-term change resets pagination ──
  test("should reset field list pagination to page 1 when the field list search term changes", {
    tag: ['@logs-index-stream-change-pagination-reset', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing field-list pagination reset on search term change');

    await pm.logsPage.selectStream(streamA);
    await pm.logsPage.waitForFieldListAfterStreamSelection();
    await pm.logsPage.waitForFieldListPaginationVisible();
    await pm.logsPage.expectFieldListPaginationPageActive(1);

    await pm.logsPage.clickFieldListPaginationPage(2);
    await pm.logsPage.expectFieldListPaginationPageActive(2);

    // "kubernetes" matches 30 of the 111 fixture fields (> 25), so pagination
    // stays visible (2 pages) and page 1 must become the active page again.
    await pm.logsPage.typeFieldListSearch('kubernetes');
    await pm.logsPage.expectFieldListPaginationPageActive(1);
    await pm.logsPage.expectFieldListPaginationPageInactive(2);

    testLogger.info('Test completed');
  });
});
