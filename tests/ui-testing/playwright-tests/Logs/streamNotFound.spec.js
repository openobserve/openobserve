const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { waitForStreamListed } = require('../utils/data-ingestion.js');

test.describe("Logs Search Bar Stream Not Found Error testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    // Readiness gate: the streamFound loop reads streamResults.list (built from
    // /streams), so wait for the seeded stream to be listed — not searchable.
    await waitForStreamListed(page, 'e2e_automate', 'logs');
    // The error branch is gated on searchObj.loading == false; avoid a stale
    // auto-run leaving a search in flight when we type.
    await pm.logsPage.disableAutoRun();
    // Monaco lazy-loads; wait for its input area so setQueryEditorValue uses the
    // reliable Monaco API path instead of the keyboard fallback.
    await pm.logsPage.waitForQueryEditorTextbox();
    testLogger.info('Test setup completed');
  });

  test("should show stream not found error when the query names a missing stream", {
    tag: ['@logs-stream-not-found', '@logs', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing stream-not-found error for a missing stream');
    const missingStream = `stream_does_not_exist_${Math.random().toString(36).substring(2, 10)}`;
    const query = `SELECT * FROM "${missingStream}"`;

    await pm.logsPage.setQueryEditorValue(query);
    await pm.logsPage.waitForStreamNotFoundError();

    const errorText = await pm.logsPage.getStreamNotFoundErrorText();
    expect(errorText).toContain(`Stream "${missingStream}" does not exist`);

    await pm.logsPage.expectNoStreamHeroNotVisible();
    testLogger.info('Stream-not-found error test completed');
  });

  test("should not show stream not found error when the query names an existing stream", {
    tag: ['@logs-stream-not-found', '@logs', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing no stream-not-found error for an existing stream');
    const query = 'SELECT * FROM "e2e_automate"';

    await pm.logsPage.setQueryEditorValue(query);
    // Positive confirmation the detection ran: the streamFound loop selects the
    // named existing stream (filterErrMsg stays empty).
    await pm.logsPage.expectLogsSearchIndexListContainsText('e2e_automate');
    await pm.logsPage.expectStreamNotFoundErrorNotVisible();
    testLogger.info('Existing-stream no-error test completed');
  });

  test("should clear the stream not found error when the query is emptied", {
    tag: ['@logs-stream-not-found', '@logs', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing error clears when the query is emptied');
    const missingStream = `stream_does_not_exist_${Math.random().toString(36).substring(2, 10)}`;
    const query = `SELECT * FROM "${missingStream}"`;

    await pm.logsPage.setQueryEditorValue(query);
    await pm.logsPage.waitForStreamNotFoundError();

    await pm.logsPage.setQueryEditorValue('');
    await pm.logsPage.waitForStreamNotFoundErrorHidden();
    testLogger.info('Error-clears-on-empty test completed');
  });

  test("should clear the stream not found error when a stream is selected", {
    tag: ['@logs-stream-not-found', '@logs', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing error clears when a stream is selected');
    const missingStream = `stream_does_not_exist_${Math.random().toString(36).substring(2, 10)}`;
    const query = `SELECT * FROM "${missingStream}"`;

    await pm.logsPage.setQueryEditorValue(query);
    await pm.logsPage.waitForStreamNotFoundError();

    // skipNavigation + apiWaitMs=0: pick the stream in the UI without reloading,
    // so the assertion exercises IndexList.handleStreamSelection (filterErrMsg="")
    // rather than a full page reload clearing the error.
    await pm.logsPage.selectStream('e2e_automate', 5, 0, true);
    await pm.logsPage.waitForStreamNotFoundErrorHidden();
    testLogger.info('Error-clears-on-select test completed');
  });

  test("should not show stream not found error for a non-SQL filter query", {
    tag: ['@logs-stream-not-found', '@logs', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing no stream-not-found error for a filter-mode query');
    const query = 'code=200';

    await pm.logsPage.setQueryEditorValue(query);
    await pm.logsPage.waitForQueryEditorValue('code=200');
    await pm.logsPage.expectStreamNotFoundErrorNotVisible();
    testLogger.info('Filter-mode no-error test completed');
  });

  test("should not show stream not found error for a WITH (CTE) query", {
    tag: ['@logs-stream-not-found', '@logs', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing no stream-not-found error for a WITH (CTE) query');
    const query = 'WITH t AS (SELECT * FROM "e2e_automate") SELECT * FROM t';

    await pm.logsPage.setQueryEditorValue(query);
    await pm.logsPage.waitForQueryEditorValue('WITH t AS');
    await pm.logsPage.expectStreamNotFoundErrorNotVisible();
    testLogger.info('WITH (CTE) no-error test completed');
  });
});
