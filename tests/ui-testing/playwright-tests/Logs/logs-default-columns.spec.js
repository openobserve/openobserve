/**
 * Default log columns — the service column — E2E
 *
 * #15086 made the results table show `service` between the timestamp and the chosen
 * message column, so the first question about any log line — which service emitted it —
 * is answered without a click.
 *
 * Logs/ftsDefaultColumn.spec.js covers the FTS column from nine angles but cannot reach
 * this branch at all: its fixture (test-data/logs_data.json) carries no service field.
 * useLogs.spec.ts covers resolveDefaultColumns over a hand-built field list; these drive
 * real ingestion instead, so schema inference, FTS resolution and the rendered column set
 * are exercised together.
 *
 *     - a stream with service shows timestamp, service, message     (TC-DC-001)
 *     - a stream without service is unchanged                       (TC-DC-002)
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
// Carries `service` AND an FTS-eligible `body`, which the shared fixture does not.
const SVC_STREAM = `e2e_svc_cols_${SUFFIX}`;
// Same shape minus `service`, to show the column is not injected unconditionally.
const PLAIN_STREAM = `e2e_svc_none_${SUFFIX}`;

const SVC_ROWS = [
  { body: 'checkout started', service: 'checkout', level: 'info' },
  { body: 'payment captured', service: 'payments', level: 'info' },
  { body: 'cart updated', service: 'cart', level: 'debug' },
];
const PLAIN_ROWS = [
  { body: 'no service here', level: 'info' },
  { body: 'still none', level: 'debug' },
];

async function runSearch(pm, page, stream) {
  await page.goto(
    `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}` +
      `&stream_type=logs&stream=${stream}&period=15m&quick_mode=false&sql_mode=false`,
  );
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await pm.logsPage.runSearchAndWaitForResults();
}

test.describe('Logs default service column', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      for (const [stream, rows] of [
        [SVC_STREAM, SVC_ROWS],
        [PLAIN_STREAM, PLAIN_ROWS],
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
  });

  test('a stream with a service field defaults to timestamp, service, message', {
    tag: ['@logsDefaultColumns', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    await runSearch(pm, page, SVC_STREAM);

    // service goes between the timestamp and the chosen message column, so the first
    // question about any log line — which service emitted it — is answered without a click.
    await pm.logsPage.expectRenderedColumnIds().toEqual(['_timestamp', 'service', 'body']);
  });

  test('a stream without a service field is left unchanged', {
    tag: ['@logsDefaultColumns', '@logs', '@P2', '@all'],
  }, async ({ page }) => {
    await runSearch(pm, page, PLAIN_STREAM);

    await pm.logsPage.expectRenderedColumnIds().toEqual(['_timestamp', 'body']);
  });});
