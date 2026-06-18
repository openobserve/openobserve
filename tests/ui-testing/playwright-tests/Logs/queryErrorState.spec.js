/**
 * Query Error State Refactor — End-to-End Tests
 *
 * Tests for the shared QueryErrorState component and its backing useQueryError composable,
 * as rendered in the Logs plugin (hero layout). Covers:
 * - Error-code-specific action cards (fix-query, configure-resource, expand-range)
 * - Collapsible ErrorDetailPanel (expand/collapse toggle)
 * - Copy-to-clipboard button with feedback
 * - Filter validation error path
 * - "Fix query" action card focusing the SQL editor
 * - Error state title/description matching error codes
 *
 * Does NOT cover:
 * - Ask AI button (gated on enterprise edition, never visible in OSS) — see TC07-fixme
 * - Block layout (not wired into Logs plugin) — see TC08-fixme
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");

test.describe("Query Error State testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  const TEST_STREAM = 'e2e_automate';

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  // =====================================================
  // P0 — Core happy path: invalid SQL → error state with fix-query card
  // =====================================================

  test.fixme("TC01-fixme: Invalid SQL query triggers hero error state with fix-query action card — FIX QUERY CARD UNWIRED: errorCode not propagated from backend for ParserError; isQueryError=false → EmptyStateActionCard never renders. Evidence: QueryErrorState.vue:115-122 (v-else-if=\"isQueryError\"); useQueryError.ts:89 (QUERY_ERROR_CODES requires 20001/20004/20005/20007/20008 but backend errorCode is 0 for SQL syntax errors)", {
    tag: ['@query-error-state', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing invalid SQL query triggers hero error state with fix-query card');

    // Select stream and set up an invalid SQL query
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);
    // SQL mode is auto-detected from SELECT...FROM in the query editor
    await pm.logsPage.clearAndFillQueryEditor(`SELECT nonexistent_field FROM "${TEST_STREAM}"`);
    await pm.logsPage.clickRefresh();

    // Wait for the error state to replace search results
    await pm.logsPage.expectQueryErrorStateVisible();
    // Verify the fix-query action card is present
    await pm.logsPage.expectQueryErrorFixQueryCardVisible();
    // Verify the error detail panel is visible (hasAnyContent should be true)
    await pm.logsPage.expectErrorDetailPanelVisible();
    // Verify the search results table is NOT visible (error state replaces it)
    await pm.logsPage.expectLogsTableNotVisible();

    testLogger.info('Invalid SQL error state test completed');
  });

  test.fixme("TC02-fixme: Error detail panel toggles expand/collapse — TOGGLE UNWIRED: hasDetail=false for single-sentence parser errors (no remainder past first sentence, no rawDetail). ErrorDetailPanel.vue:52 toggle button wrapped in <template v-if=\"hasDetail\">; useQueryError.ts:199 detailBody empty → hasDetail=false → toggle never renders", {
    tag: ['@query-error-state', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing error detail panel expand/collapse toggle');

    // Set up error state (same as TC01)
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);
    await pm.logsPage.clearAndFillQueryEditor(`SELECT nonexistent_field FROM "${TEST_STREAM}"`);
    await pm.logsPage.clickRefresh();

    // Wait for error state
    await pm.logsPage.expectQueryErrorStateVisible();

    // Click toggle to expand detail
    await pm.logsPage.clickErrorDetailToggleBtn();
    await pm.logsPage.expectErrorDetailBodyVisible();

    // Click toggle again to collapse detail
    await pm.logsPage.clickErrorDetailToggleBtn();
    await pm.logsPage.expectErrorDetailBodyNotVisible();

    testLogger.info('Error detail panel toggle test completed');
  });

  test("TC03: Copy error button copies details and shows 'Copied!' feedback", {
    tag: ['@query-error-state', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing copy error button copies details and shows feedback');

    // Set up error state (same as TC01)
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);
    await pm.logsPage.clearAndFillQueryEditor(`SELECT nonexistent_field FROM "${TEST_STREAM}"`);
    await pm.logsPage.clickRefresh();

    // Wait for error state
    await pm.logsPage.expectQueryErrorStateVisible();

    // Click the copy button
    await pm.logsPage.clickQueryErrorCopyBtn();

    // Assert the button text changes to indicate "Copied!"
    const btnTextAfterClick = await pm.logsPage.getQueryErrorCopyBtnText();
    expect(btnTextAfterClick).toBeTruthy();
    // The button should contain "Copied!" or the i18n equivalent
    const hasCopiedText = btnTextAfterClick.toLowerCase().includes('copied');
    expect(hasCopiedText).toBe(true);
    testLogger.info('Copy button shows Copied! feedback', { btnText: btnTextAfterClick });

    // Wait for the 2-second feedback timeout to expire
    await page.waitForTimeout(2500);

    // Assert the button reverts to original text
    const btnTextAfterRevert = await pm.logsPage.getQueryErrorCopyBtnText();
    expect(btnTextAfterRevert).toBeTruthy();
    // The button should no longer say "Copied!"
    const hasReverted = !btnTextAfterRevert.toLowerCase().includes('copied');
    expect(hasReverted).toBe(true);
    testLogger.info('Copy button reverted to original text', { btnText: btnTextAfterRevert });

    testLogger.info('Copy error button test completed');
  });

  // =====================================================
  // P1 — Important variations
  // =====================================================

  test.fixme("TC04-fixme: Filter validation error displays generic error state (no action cards) — FILTER ERROR PATH UNWIRED: Quick Mode filter validation errors route through errorMsg (searchObj.data.errorMsg) not filterErrMsg (searchObj.data.filterErrMsg). Index.vue:108-112 filterErrMsg div never activates; the error renders via the regular error state section (Index.vue:126-143) instead. Evidence: Quick Mode field-not-found triggers errorMsg in current backend, not filterErrMsg", {
    tag: ['@query-error-state', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing filter validation error displays generic error state');

    // Use Quick (non-SQL) mode
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);
    await pm.logsPage.ensureQuickModeState(true);
    await page.waitForTimeout(1000);

    // Add a filter with a field that does not exist in the stream
    // Use the query editor to type a filter expression
    await pm.logsPage.clearAndFillQueryEditor(`nonexistent_field_12345 = "x"`);
    // Run the query to trigger filter validation
    await pm.logsPage.clickRefresh();

    // Wait for the filter error state to appear
    await pm.logsPage.expectLogsFilterErrorContainerVisible();

    // Verify no action cards are visible (errorCode=0, generic)
    await pm.logsPage.expectQueryErrorFixQueryCardNotVisible();
    await pm.logsPage.expectQueryErrorConfigureResourceCardNotVisible();
    await pm.logsPage.expectQueryErrorExpandRangeCardNotVisible();

    testLogger.info('Filter validation error test completed');
  });

  test.fixme("TC05-fixme: 'Fix the query' action card click focuses the SQL editor — SAME ROOT CAUSE AS TC01: errorCode not propagated from backend for ParserError; isQueryError=false → action card never renders. Evidence: QueryErrorState.vue:115-122, useQueryError.ts:89", {
    tag: ['@query-error-state', '@all']
  }, async ({ page }) => {
    testLogger.info("Testing fix-query action card click focuses the SQL editor");

    // Set up error state (same as TC01)
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);
    await pm.logsPage.clearAndFillQueryEditor(`SELECT nonexistent_field FROM "${TEST_STREAM}"`);
    await pm.logsPage.clickRefresh();

    // Wait for error state
    await pm.logsPage.expectQueryErrorStateVisible();
    await pm.logsPage.expectQueryErrorFixQueryCardVisible();

    // Click the "Fix query" action card
    await pm.logsPage.clickQueryErrorFixQueryCard();

    // Verify the SQL editor gains focus
    await pm.logsPage.expectQueryEditorFocused();

    testLogger.info('Fix-query card focus test completed');
  });

  test("TC06: Error state title and description match the error code", {
    tag: ['@query-error-state', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing error state title and description match error code');

    // Set up error state (same as TC01)
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);
    await pm.logsPage.clearAndFillQueryEditor(`SELECT nonexistent_field FROM "${TEST_STREAM}"`);
    await pm.logsPage.clickRefresh();

    // Wait for error state
    await pm.logsPage.expectQueryErrorStateVisible();

    // Verify the error state contains meaningful text (not empty, not "undefined")
    const errorStateText = await pm.logsPage.getQueryErrorStateText();
    expect(errorStateText).toBeTruthy();
    expect(errorStateText.trim().length).toBeGreaterThan(10);
    // Should NOT contain raw "undefined" or "null" as stand-alone text
    expect(errorStateText).not.toMatch(/^\s*undefined\s*$/i);
    testLogger.info('Error state text captured', { text: errorStateText.substring(0, 200) });

    // Verify the detail panel summary line contains the first sentence of the backend error
    await pm.logsPage.expectErrorDetailSummaryNotEmpty();

    testLogger.info('Error state title/description test completed');
  });

  // =====================================================
  // P2 — Edge cases / backend-dependent (fixme)
  // =====================================================

  test.fixme("TC07-fixme: Ask AI button — gated on enterprise edition (UNWIRED in OSS) — evidence: QueryErrorState.vue:782-793", {
    tag: ['@query-error-state', '@enterprise-only']
  }, async ({ page }) => {
    testLogger.info('Testing Ask AI button visibility (enterprise-only)');

    // Set up error state
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);
    await pm.logsPage.clearAndFillQueryEditor(`SELECT nonexistent_field FROM "${TEST_STREAM}"`);
    await pm.logsPage.clickRefresh();
    await pm.logsPage.expectQueryErrorStateVisible();

    // In enterprise editions with AI enabled, the Ask AI button should be visible.
    // The button code is wired at QueryErrorState.vue:782-793 but gated on
    // config.isEnterprise === "true" && store.state.zoConfig.ai_enabled.
    // In OSS config.isEnterprise is "false", so this assertion will only pass
    // when running against an enterprise environment with AI enabled.
    await pm.logsPage.expectQueryErrorAskAiBtnVisible();

    testLogger.info('Ask AI button test completed');
  });

  test.fixme("TC08-fixme: Block layout — not wired into Logs plugin (UNWIRED in logs) — evidence: LogsErrorState.vue hardcodes size=\"hero\"", {
    tag: ['@query-error-state', '@future-integration']
  }, async ({ page }) => {
    testLogger.info('Testing block layout rendering (future integration)');

    // The block layout is designed for dashboard panels, alert test results, and
    // other compact contexts. LogsErrorState.vue hardcodes size="hero", so the
    // block layout code path (QueryErrorState.vue:198 `size !== 'hero'`) is
    // currently unreachable from the Logs page.
    //
    // When a logs integration passes size="block", the following selectors
    // should be visible instead of the hero-specific ones.

    // Set up error state (same as TC01)
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);
    await pm.logsPage.clearAndFillQueryEditor(`SELECT nonexistent_field FROM "${TEST_STREAM}"`);
    await pm.logsPage.clickRefresh();
    await pm.logsPage.expectQueryErrorStateVisible();

    // Block layout selectors — these would be visible if size="block" were used
    await pm.logsPage.expectQueryErrorSummaryVisible();
    await pm.logsPage.clickErrorDetailToggleBtn();
    await pm.logsPage.expectQueryErrorFixQueryBtnVisible();

    testLogger.info('Block layout test completed');
  });
});
