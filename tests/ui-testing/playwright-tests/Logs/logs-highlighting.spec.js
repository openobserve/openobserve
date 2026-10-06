/**
 * Search-term highlighting across every full-text filter — E2E suite
 *
 * Coverage for the highlighting work in #15086. Before this, only `match_all`
 * highlighting was exercised (RegressionSet/Logs/logs-result-display.spec.js asserts
 * markup exists; logs-9754.spec.js asserts characters survive). The field-scoped
 * filters had no browser coverage at all, which is how the lowercasing defect
 * survived: the logs page lowercased the highlight query, so a case-sensitive
 * filter (`str_match`) matched rows but could never highlight anything, and no
 * test noticed.
 *
 *   - str_match highlights an uppercase term verbatim          (TC-HL-001)
 *   - str_match is case-sensitive                              (TC-HL-002)
 *   - *_ignore_case folds case                                 (TC-HL-003)
 *   - re_match highlights, re_not_match does not               (TC-HL-004/005)
 *   - a field filter highlights only its own field             (TC-HL-006)
 *   - match_all stays global across fields                     (TC-HL-007)
 *   - markup in a value is escaped, not rendered               (TC-HL-008)
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const logData = require('../../fixtures/log.json');
const {
  ingestCustomData,
  waitForStreamData,
  waitForStreamListed,
} = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// Per-run suffix: a fixed name collides with concurrent runs in the shared org and
// ingestion then fails with "stream [...] is being deleted". The e2e_ prefix keeps
// prefix-based cleanup working.
const STREAM = 'e2e_hl_filters_' + Math.random().toString(36).slice(2, 7);

// `tag_value` repeats the term that `body` carries, which is what lets a field-scoped
// filter be told apart from a global one. No field NAME contains a search term —
// otherwise a highlight on a key would be indistinguishable from one on a value.
const HL_LOGS = [
  { body: 'ERROR connection refused to db', tag_value: 'kelvin_sign', case_id: 'upper' },
  { body: 'kelvin reading stable', tag_value: 'kelvin_sign', case_id: 'scope' },
  { body: 'error lowercase variant', tag_value: 'plain', case_id: 'lower' },
  { body: '<script>alert(1)</script> payload', tag_value: 'plain', case_id: 'markup' },
];

const RESULTS_TABLE = '[data-test="logs-search-result-logs-table"]';

/**
 * Highlighted strings inside one column's cells.
 *
 * In SQL mode the table renders every projected field into a single `source` cell, so
 * counting highlights there is what distinguishes a field-scoped filter (one hit, in
 * body's value) from a global one (two hits, body + tag_value) on the SAME row. Adding
 * each field as its own column instead is not reliable — the column set is re-resolved
 * on every search.
 */
const highlightsIn = (page, column) =>
  page.locator(`${RESULTS_TABLE} td[data-test="o2-table-cell-${column}"] .log-highlighted`);

/**
 * Highlight texts, polled until they settle.
 *
 * Highlighting is applied asynchronously after the rows render (processHitsInChunks), so
 * the table is visible — and even partly highlighted — before the final markup exists.
 * Reading allInnerTexts() once races that and returns [] or a partial list.
 */
const expectHighlights = (page, column) =>
  expect.poll(async () => highlightsIn(page, column).allInnerTexts(), { timeout: 20000 });

/**
 * Drives a search through the URL rather than the editor: the query lands base64-encoded
 * in `query`, exactly as a shared/bookmarked logs link does, which keeps the filter text
 * verbatim. Typing into the Monaco editor re-tokenises and is far flakier for a test
 * whose whole subject is the exact characters of the query.
 */
async function runQuery(page, query, { sqlMode = false } = {}) {
  const url =
    `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}` +
    `&stream_type=logs&stream=${STREAM}&period=15m&quick_mode=false` +
    `&sql_mode=${sqlMode}&query=${Buffer.from(query).toString('base64')}`;
  await page.goto(url);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
  await expect(page.locator(RESULTS_TABLE)).toBeVisible({ timeout: 30000 });
}

test.describe('Logs search-term highlighting', () => {
  // Serial: every test queries the single stream the setup ingests.
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await ingestCustomData(page, STREAM, HL_LOGS);
      expect(
        await waitForStreamData(page, STREAM, HL_LOGS.length, 60000),
        `stream ${STREAM} never became queryable within 60s of ingestion`,
      ).toBe(true);
      // Queryable is not the same as LISTED: /streams enumerates a new stream later
      // than _search can query it, and the stream popover is built from /streams.
      expect(
        await waitForStreamListed(page, STREAM, 'logs'),
        `stream ${STREAM} never appeared in the streams list`,
      ).toBe(true);
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  // ---------------------------------------------------------------------------
  // P0 — the lowercasing defect, on the default (quick mode) path
  // ---------------------------------------------------------------------------

  test('str_match highlights an uppercase term verbatim', {
    tag: ['@logsHighlighting', '@logs', '@P0', '@all'],
  }, async ({ page }) => {
    await runQuery(page, "str_match(body, 'ERROR')");

    // The defect lowercased the highlight query, so a case-sensitive filter matched
    // the row but highlighted nothing. Case must survive verbatim.
    await expectHighlights(page, 'body').toEqual(['ERROR']);
  });

  test('str_match is case-sensitive', {
    tag: ['@logsHighlighting', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    await runQuery(page, "str_match(body, 'error')");

    const table = page.locator(RESULTS_TABLE);
    await expect(table).toContainText('error lowercase variant', { timeout: 20000 });
    // The uppercase row must not match a case-sensitive filter at all.
    await expect(table).not.toContainText('ERROR connection refused');
  });

  // ---------------------------------------------------------------------------
  // P1 — the rest of the filter family
  // ---------------------------------------------------------------------------

  test('str_match_ignore_case folds case and highlights both spellings', {
    tag: ['@logsHighlighting', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    await runQuery(
      page,
      `SELECT body, tag_value FROM "${STREAM}" WHERE str_match_ignore_case(body, 'error')`,
      { sqlMode: true },
    );

    await expectHighlights(page, 'source').toEqual(
      expect.arrayContaining(['error', 'ERROR']),
    );
  });

  test('re_match highlights its regex match', {
    tag: ['@logsHighlighting', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    await runQuery(page, "re_match(body, '^ERROR')");

    await expectHighlights(page, 'body').toEqual(expect.arrayContaining(['ERROR']));
  });

  test('re_not_match highlights nothing', {
    tag: ['@logsHighlighting', '@logs', '@P2', '@all'],
  }, async ({ page }) => {
    // A negative filter has no matching text to mark; highlighting it would be wrong.
    await runQuery(page, "re_not_match(body, 'ERROR')");

    await expect(page.locator(RESULTS_TABLE)).toContainText('kelvin reading stable', {
      timeout: 20000,
    });
    expect(await page.locator(`${RESULTS_TABLE} .log-highlighted`).count()).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // P1 — field scoping. The pair below is the whole point: the SAME row carries
  // "kelvin" in both body and tag_value, so the highlight count separates a
  // field-scoped filter (1) from a global one (2).
  // ---------------------------------------------------------------------------

  test('a field filter highlights only its own field', {
    tag: ['@logsHighlighting', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    await runQuery(
      page,
      `SELECT body, tag_value FROM "${STREAM}" WHERE str_match(body, 'kelvin')`,
      { sqlMode: true },
    );

    await expectHighlights(page, 'source').toEqual(['kelvin']);
  });

  test('match_all stays global across fields', {
    tag: ['@logsHighlighting', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    await runQuery(
      page,
      `SELECT body, tag_value FROM "${STREAM}" WHERE match_all('kelvin')`,
      { sqlMode: true },
    );

    // Same row as the previous test; global highlighting marks tag_value too.
    await expectHighlights(page, 'source').toEqual(['kelvin', 'kelvin']);
  });

  // ---------------------------------------------------------------------------
  // P0 — escaping
  // ---------------------------------------------------------------------------

  test('markup in a log value is escaped, not rendered', {
    tag: ['@logsHighlighting', '@logs', '@P0', '@security', '@all'],
  }, async ({ page }) => {
    // Highlighting assembles HTML strings, so an unescaped value would inject.
    await runQuery(page, "str_match(body, 'payload')");

    await expect(page.locator(RESULTS_TABLE)).toContainText('<script>alert(1)</script>', {
      timeout: 20000,
    });
    expect(await page.locator(`${RESULTS_TABLE} script`).count()).toBe(0);
  });
});
