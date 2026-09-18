const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const { ingestTestData } = require('../utils/data-ingestion.js');

// Types a SQL query naming a stream the org does not have, then asserts the
// frontend stream-not-found message appears (no backend query is run).
async function triggerStreamNotFound(pm, streamName) {
  await pm.logsPage.clickQueryEditor();
  await pm.logsPage.typeInQueryEditor(`SELECT * FROM "${streamName}"`);
  await pm.logsPage.waitForQueryEditorValue(streamName);
  await pm.logsPage.expectStreamNotFoundMessage(streamName);
}

test.describe("Logs Stream Not Found testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);

    // Seed the shared e2e_automate stream (idempotent) so the positive
    // existing-stream scenario has a real stream to select.
    await ingestTestData(page);

    // Navigate to logs page WITHOUT a stream query param — triggers the
    // no-stream-selected state, which is the cleanest reproduction base.
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Readiness gate: the stream list must be loaded before typing, otherwise the
    // detection iterates an undefined streamResults.list and never self-corrects.
    await pm.logsPage.waitForStreamAvailable('e2e_automate');

    testLogger.info('Test setup completed');
  });

  test("should show stream-not-found message when SQL query names a missing stream", {
    tag: ['@logs-stream-not-found', '@all', '@logs', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing stream-not-found message for a missing stream');

    const runToken = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const missingStream = `e2e_does_not_exist_${runToken}`;

    await triggerStreamNotFound(pm, missingStream);

    // The generic "pick a stream" empty state must NOT shadow the message.
    await pm.logsPage.expectNoStreamSelectedTextNotVisible();

    testLogger.info('Stream-not-found message test completed');
  });

  test("should clear the message and select the stream when the query names an existing stream", {
    tag: ['@logs-stream-not-found', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing message clears when the query names an existing stream');

    const runToken = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const missingStream = `e2e_does_not_exist_${runToken}`;

    await triggerStreamNotFound(pm, missingStream);

    await pm.logsPage.setQueryEditorValue('SELECT * FROM "e2e_automate"');
    await pm.logsPage.waitForQueryEditorValue('e2e_automate');

    await pm.logsPage.expectStreamNotFoundMessageNotVisible();
    await pm.logsPage.expectStreamDropdownShowsStream('e2e_automate');

    testLogger.info('Existing-stream replace test completed');
  });

  test("should dismiss the message when the query is cleared", {
    tag: ['@logs-stream-not-found', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing message dismisses when the query is cleared');

    const runToken = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const missingStream = `e2e_does_not_exist_${runToken}`;

    await triggerStreamNotFound(pm, missingStream);

    await pm.logsPage.setQueryEditorValue('');
    await pm.logsPage.waitForQueryEditorValue('');

    await pm.logsPage.expectStreamNotFoundMessageNotVisible();
    await pm.logsPage.expectNoStreamHeroVisible();

    testLogger.info('Query-clear dismiss test completed');
  });

  test("should clear the message when a stream is selected in the sidebar", {
    tag: ['@logs-stream-not-found', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing message clears on sidebar stream selection');

    const runToken = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const missingStream = `e2e_does_not_exist_${runToken}`;

    await triggerStreamNotFound(pm, missingStream);

    // Sidebar selection must NOT re-navigate (skipNavigation=true) — a reload
    // would drop the typed query and defeat the sidebar-clear assertion.
    await pm.logsPage.selectStream('e2e_automate', 5, null, true);
    await pm.logsPage.waitForFieldListAfterStreamSelection();

    await pm.logsPage.expectStreamNotFoundMessageNotVisible();
    await pm.logsPage.expectStreamDropdownShowsStream('e2e_automate');

    testLogger.info('Sidebar-selection clear test completed');
  });
});
