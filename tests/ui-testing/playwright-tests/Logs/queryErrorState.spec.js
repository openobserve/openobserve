const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');

test.describe("Query Error State testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('domcontentloaded');
    await ingestTestData(page);
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    testLogger.info('Query error state test setup completed');
  });

  test.fixme("should display hero error state with fix-query card on SQL syntax error — backend returns HTTP 400 code via MetaHttpResponse::error() at mod.rs:2001 instead of application error code 20001, so isQueryError is false and fix-query card never renders. Should use map_error_to_http_response().", {
    tag: ['@query-error-state', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing SQL syntax error → hero error state with fix-query card');

    await pm.logsPage.setQueryEditorValue('SELECT * FROM "e2e_automate" WHERE');
    await pm.logsPage.waitForQueryEditorValue('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();

    await pm.logsPage.expectErrorMessageVisible();
    await pm.logsPage.expectQueryErrorStateVisible();
    await pm.logsPage.expectFixQueryCardVisible();
    await pm.logsPage.expectErrorDetailPanelVisible();
    await pm.logsPage.expectErrorDetailSummaryVisible();

    testLogger.info('SQL syntax error hero state test completed');
  });

  test.fixme("should toggle error detail panel expand and collapse — error_detail field is not populated when Sql::new fails (mod.rs:2001), so hasDetail is false and the toggle button never renders. Backend should use map_error_to_http_response and include error_detail.", {
    tag: ['@query-error-state', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing error detail panel toggle expand/collapse');

    await pm.logsPage.setQueryEditorValue('SELECT * FROM "e2e_automate" WHERE');
    await pm.logsPage.waitForQueryEditorValue('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();

    await pm.logsPage.expectQueryErrorStateVisible();
    await pm.logsPage.expectErrorDetailToggleVisible();

    // Expand detail
    await pm.logsPage.clickErrorDetailToggle();
    await pm.logsPage.expectErrorDetailBodyVisible();

    // Collapse detail
    await pm.logsPage.clickErrorDetailToggle();
    await pm.logsPage.expectErrorDetailBodyHidden();

    testLogger.info('Error detail panel toggle test completed');
  });

  test("should copy error details and show Copied feedback", {
    tag: ['@query-error-state', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing copy error details button with Copied feedback');

    await pm.logsPage.setQueryEditorValue('SELECT * FROM "e2e_automate" WHERE');
    await pm.logsPage.waitForQueryEditorValue('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();

    await pm.logsPage.expectQueryErrorStateVisible();
    await pm.logsPage.expectCopyErrorButtonVisible();
    await pm.logsPage.clickCopyErrorButton();
    await pm.logsPage.expectCopyButtonShowsCopied();

    testLogger.info('Copy error details test completed');
  });

  test("should display no-events state with expand range and remove filter cards", {
    tag: ['@query-error-state', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing no-events state display with action cards');

    await pm.logsPage.setQueryEditorValue('SELECT * FROM "e2e_automate" WHERE code > 99999');
    await pm.logsPage.waitForQueryEditorValue('code > 99999');
    await pm.logsPage.runQueryAndWaitForResults();

    await pm.logsPage.expectNoEventsStateVisible();
    await pm.logsPage.expectNoEventsExpandCardVisible();
    await pm.logsPage.expectNoEventsRemoveFilterCardVisible();

    testLogger.info('No-events state display test completed');
  });

  test.fixme("should focus search bar editor on fix-query card click — fix-query card never renders because backend returns HTTP 400 (mod.rs:2001) instead of error code 20001, so isQueryError=false. Dependent on fix-query card visibility.", {
    tag: ['@query-error-state', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing fix-query card focuses search bar editor');

    await pm.logsPage.setQueryEditorValue('SELECT * FROM "e2e_automate" WHERE');
    await pm.logsPage.waitForQueryEditorValue('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();

    await pm.logsPage.expectQueryErrorStateVisible();
    await pm.logsPage.expectFixQueryCardVisible();
    await pm.logsPage.clickFixQueryCard();
    await pm.logsPage.expectSearchBarEditorFocused();

    testLogger.info('Fix-query card focus test completed');
  });

  test.skip("should display filter error state for multi-stream filter mismatch", {
    tag: ['@query-error-state', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing filter error state for multi-stream filter mismatch');
    // SKIPPED: This test requires multiple streams with differing field schemas.
    // The default test org only provides the "e2e_automate" stream.
    // To enable this test, set up additional streams with non-overlapping schemas,
    // then update the beforeEach to select multiple streams and use quick mode.

    // Steps would be:
    // 1. Select multiple streams via [data-test="log-search-index-list-select-stream"]
    // 2. Ensure quick mode (non-SQL) is active
    // 3. Add a filter using a field that exists in only some streams
    // 4. Click Run and assert [data-test="logs-search-filter-error-message"] appears
    // 5. Assert no action card ([data-test="query-error-fix-query-card"]) is shown

    testLogger.info('Filter error state test skipped — multi-stream schema dependency');
  });

  test.fixme("'Ask AI' button should NOT be visible in OSS edition — not wired: aiEnabled computed from config.isEnterprise at Index.vue:1497-1499", {
    tag: ['@query-error-state', '@all', '@logs', '@enterprise']
  }, async ({ page }) => {
    testLogger.info('Testing Ask AI button absence in OSS edition');

    await pm.logsPage.setQueryEditorValue('SELECT * FROM "e2e_automate" WHERE');
    await pm.logsPage.waitForQueryEditorValue('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();

    await pm.logsPage.expectQueryErrorStateVisible();
    await pm.logsPage.expectAskAiButtonNotVisible();

    testLogger.info('Ask AI button absence test completed — fixme (enterprise-only)');
  });

  test.skip("should display informational message when org has no streams", {
    tag: ['@query-error-state', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing no-streams-in-org informational message');
    // SKIPPED: This test requires an organization with zero log streams.
    // The default test org has at minimum the "e2e_automate" stream.
    // To enable this test, use a dedicated empty test org or add a setup
    // step to delete all streams before running this test.

    // Steps would be:
    // 1. Navigate to Logs page with an org that has zero streams
    // 2. Assert [data-test="logs-search-no-streams-in-org-text"] is visible

    testLogger.info('No-streams-in-org test skipped — requires empty org');
  });
});
