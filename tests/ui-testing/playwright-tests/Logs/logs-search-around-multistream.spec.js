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
const PageManager = require('../../pages/page-manager.js');

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

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await navigateToBase(page);
    // Both streams selected, which is the condition that used to hide the action.
    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}` +
        `&stream_type=logs&stream=${STREAM_A},${STREAM_B}&period=15m&quick_mode=false&sql_mode=false`,
    );
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await pm.logsPage.runSearchAndWaitForResults();
    // A multi-stream result set carries the stream-name column; wait for it so the
    // row we open is definitely one of the merged rows.
    await expect(pm.logsPage.streamNameCells().first()).toBeVisible({ timeout: 30000 });
  });

  test('offers search around on a hit when several streams are selected', {
    tag: ['@logsSearchAround', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    await pm.logsPage.openFirstHitDetail();
    // Previously hidden outright for multi-stream selections.
    await expect(pm.logsPage.searchAroundButton()).toBeVisible({ timeout: 20000 });
  });

  test("runs search around against the hit's own stream, not the multi endpoint", {
    tag: ['@logsSearchAround', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    const hitStream = await pm.logsPage.openFirstHitDetail();
    const request = await pm.logsPage.clickSearchAroundAwaitingRequest();

    // The _around endpoint is single-stream; the hit's _stream_name picks which one.
    expect(request.url()).toContain(`/${hitStream}/_around`);
    expect(request.url()).not.toContain('_around_multi');
  });

  test('tags the search-around results with the stream they came from', {
    tag: ['@logsSearchAround', '@logs', '@P2', '@all'],
  }, async ({ page }) => {
    const hitStream = await pm.logsPage.openFirstHitDetail();

    // Wait for the round trip before reading the table. The pre-click table is the
    // multi-stream result set, so an assertion about the new rows could otherwise be
    // satisfied by the old ones — passing without the search-around having run.
    const response = await pm.logsPage.clickSearchAroundAwaitingResponse();
    expect(response.status(), 'search around request failed').toBe(200);

    // _around returns SELECT * rows, so the stream-name column has to be repopulated
    // by the client or the results lose track of which stream they belong to.
    await expect
      .poll(() => pm.logsPage.distinctStreamNames(), { timeout: 30000 })
      .toEqual([hitStream]);
  });
});
