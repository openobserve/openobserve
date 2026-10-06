/**
 * Search around with several streams selected — E2E
 *
 * Coverage for the multi-stream search-around work in #15086. Before it, the action
 * was hidden whenever more than one stream was selected (`selectedStream.length <= 1`),
 * so the main debugging tool disappeared exactly in the multi-stream searches people
 * use when they do not yet know which service broke.
 *
 * The existing coverage is single-stream only: RegressionSet/Logs/logs-search-around-size.spec.js
 * (size vs a SQL LIMIT) and Logs/region.spec.js (timezone).
 *
 *   - the action is offered on a hit when several streams are selected  (TC-SA-001)
 *   - the request goes to the hit's OWN stream, not the multi endpoint  (TC-SA-002)
 *   - the returned rows are tagged with that stream                     (TC-SA-003)
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

const SUFFIX = Math.random().toString(36).slice(2, 7);
const STREAM_A = `e2e_sa_one_${SUFFIX}`;
const STREAM_B = `e2e_sa_two_${SUFFIX}`;

const ROWS_A = [
  { body: 'alpha one', origin: 'a' },
  { body: 'alpha two', origin: 'a' },
];
const ROWS_B = [
  { body: 'beta one', origin: 'b' },
  { body: 'beta two', origin: 'b' },
];

const RESULTS_TABLE = '[data-test="logs-search-result-logs-table"]';
const SEARCH_AROUND_BTN = '[data-test="logs-detail-table-search-around-btn"]';

test.describe('Logs search around with several streams selected', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      for (const [stream, rows] of [
        [STREAM_A, ROWS_A],
        [STREAM_B, ROWS_B],
      ]) {
        await ingestCustomData(page, stream, rows);
        expect(
          await waitForStreamData(page, stream, rows.length, 60000),
          `stream ${stream} never became queryable within 60s`,
        ).toBe(true);
        expect(
          await waitForStreamListed(page, stream, 'logs'),
          `stream ${stream} never appeared in the streams list`,
        ).toBe(true);
      }
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    // Both streams selected, which is the condition that used to hide the action.
    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}` +
        `&stream_type=logs&stream=${STREAM_A},${STREAM_B}&period=15m&quick_mode=false&sql_mode=false`,
    );
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await expect(page.locator(RESULTS_TABLE)).toBeVisible({ timeout: 30000 });
    // A multi-stream result set carries the stream-name column; wait for it so the
    // row we open is definitely one of the merged rows.
    await expect(
      page.locator(`${RESULTS_TABLE} td[data-test="o2-table-cell-_stream_name"]`).first(),
    ).toBeVisible({ timeout: 30000 });
  });

  /** Opens the first row's detail and returns the stream name that row came from. */
  async function openFirstHit(page) {
    const streamCell = page
      .locator(`${RESULTS_TABLE} td[data-test="o2-table-cell-_stream_name"]`)
      .first();
    const hitStream = (await streamCell.innerText()).trim();
    await streamCell.click();
    await expect(page.locator('[data-test="logs-search-result-detail-dialog"]')).toBeVisible({
      timeout: 20000,
    });
    return hitStream;
  }

  test('offers search around on a hit when several streams are selected', {
    tag: ['@logsSearchAround', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    await openFirstHit(page);
    // Previously hidden outright for multi-stream selections.
    await expect(page.locator(SEARCH_AROUND_BTN)).toBeVisible({ timeout: 20000 });
  });

  test("runs search around against the hit's own stream, not the multi endpoint", {
    tag: ['@logsSearchAround', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    const hitStream = await openFirstHit(page);

    const [request] = await Promise.all([
      page.waitForRequest((r) => /_around/.test(r.url()), { timeout: 30000 }),
      page.locator(SEARCH_AROUND_BTN).click(),
    ]);

    // The _around endpoint is single-stream; the hit's _stream_name picks which one.
    expect(request.url()).toContain(`/${hitStream}/_around`);
    expect(request.url()).not.toContain('_around_multi');
  });

  test('tags the search-around results with the stream they came from', {
    tag: ['@logsSearchAround', '@logs', '@P2', '@all'],
  }, async ({ page }) => {
    const hitStream = await openFirstHit(page);
    await page.locator(SEARCH_AROUND_BTN).click();

    // _around returns SELECT * rows, so the stream-name column has to be repopulated
    // by the client or the results lose track of which stream they belong to.
    await expect
      .poll(
        async () => {
          const cells = await page
            .locator(`${RESULTS_TABLE} td[data-test="o2-table-cell-_stream_name"]`)
            .allInnerTexts();
          return [...new Set(cells.map((c) => c.trim()))].filter(Boolean);
        },
        { timeout: 30000 },
      )
      .toEqual([hitStream]);
  });
});
