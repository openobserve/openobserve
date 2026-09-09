const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const logData = require('../../../fixtures/log.json');

// https://github.com/openobserve/openobserve/issues/14283
//
// Search History became a standalone route in #13512, so re-applying a query from it
// remounts the logs page. The mount path used to restore the cached searchObj from Vuex
// on top of the query carried in the URL, and the re-applied query was silently dropped.
// The regression only shows up when the logs page has already been used in the session —
// that is what puts the stale query in the cache — hence the two searches in beforeEach.
test.describe('Regression: Search History re-apply retains the query (#14283)', () => {
  test.describe.configure({ mode: 'serial' });

  // The predicates are always true on purpose: the two searches only need to be
  // textually distinct and both return rows. A filter that matches nothing leaves the
  // results grid unrendered, and waitForResultsLoaded() never sees its pagination.
  const EARLIER_QUERY = `SELECT * FROM "e2e_automate" WHERE 200 = 200`;
  const LATEST_QUERY = `SELECT * FROM "e2e_automate" WHERE 404 = 404`;
  const EARLIER_MARKER = '200';
  const LATEST_MARKER = '404';

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env['ORGNAME']}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await pm.logsPage.selectIndexStream('e2e_automate');
    await page.waitForTimeout(1000);

    for (const query of [EARLIER_QUERY, LATEST_QUERY]) {
      await pm.logsPage.typeQuery(query);
      await page.waitForTimeout(500);
      await pm.logsPage.selectRunQuery();
      await pm.logsPage.waitForResultsLoaded();
    }

    testLogger.info('Two searches run; the logs cache now holds the later query');
  });

  test('Re-applying an earlier query from Search History loads it into the editor', {
    tag: ['@regression', '@logs', '@searchHistory', '@P0'],
  }, async ({ page }) => {
    await pm.searchHistoryPage.openFromLogs();

    // Match on the literal alone: the SQL recorded in usage may differ in spacing
    // from what was typed, but 200 vs 404 is what discriminates the two queries.
    // Both markers are compared against editor/URL text only, never against log rows.
    const reAppliedSql = await pm.searchHistoryPage.reApplyQuery(EARLIER_MARKER);
    expect(reAppliedSql).toContain(EARLIER_MARKER);

    // Fall back to a plain read so a miss reports the query the editor actually held
    // (the stale one) rather than an opaque poll timeout.
    const editorText = await pm.logsPage
      .getQueryEditorTextWhenReady(EARLIER_MARKER, 30000)
      .catch(() => pm.logsPage.getQueryEditorText());
    testLogger.info('Editor content after re-apply', { editorText });

    expect(editorText).toContain(EARLIER_MARKER);
    // The stale cached query must not win over the one carried in the URL.
    expect(editorText).not.toContain(LATEST_MARKER);
  });

  test('Re-applied query is carried in the logs URL', {
    tag: ['@regression', '@logs', '@searchHistory', '@P1'],
  }, async ({ page }) => {
    await pm.searchHistoryPage.openFromLogs();
    await pm.searchHistoryPage.reApplyQuery(EARLIER_MARKER);

    const url = new URL(page.url());
    const encodedQuery = url.searchParams.get('query');
    expect(encodedQuery).toBeTruthy();

    // b64EncodeUnicode emits URL-safe base64 (+ - / _ = .); undo that rather than
    // relying on Node's decoder being lenient about the alphabet.
    const standardBase64 = encodedQuery.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '=');
    const decoded = Buffer.from(standardBase64, 'base64').toString('utf-8');
    expect(decoded).toContain(EARLIER_MARKER);
    expect(url.searchParams.get('sql_mode')).toBe('true');
  });
});
