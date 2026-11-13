const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { getHeaders, getIngestionUrl, waitForStreamData } = require('../../utils/data-ingestion.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');

const ROWS = [
  { svc: 'alpha', ns: 'ns-a', host: 'host-a', pod: 'pod-a', level: 'info', message: 'ovn-b-include alpha 1' },
  { svc: 'alpha', ns: 'ns-a', host: 'host-a', pod: 'pod-a', level: 'info', message: 'ovn-b-include alpha 2' },
  { svc: 'beta', ns: 'ns-b', host: 'host-b', pod: 'pod-b', level: 'info', message: 'ovn-b-include beta 1' },
  { svc: 'beta', ns: 'ns-b', host: 'host-b', pod: 'pod-b', level: 'warn', message: 'ovn-b-include beta 2' },
];

function orgId() {
  return getOrgIdentifier() || 'default';
}

async function openLogsWithFilter(page, stream, filter) {
  const query = encodeURIComponent(Buffer.from(filter).toString('base64'));
  await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${orgId()}&stream_type=logs&stream=${stream}&period=15m&sql_mode=false&quick_mode=false&query=${query}`);
}

async function includeFromFirstRow(pm, rowText, field) {
  await pm.logsPage.openLogDetailForRowContaining(rowText);
  await pm.logsPage.clickLogDetailTableTab();
  await pm.logsPage.includeLogDetailFieldValue(field);
  await pm.logsPage.clickCloseDialog();
}

test.describe('Logs Include Search Term query shape (ENT#3086, OSS#11220)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    stream = 'ovn_b_include_' + Math.random().toString(36).slice(2, 8);
    const ingest = await page.request.post(getIngestionUrl(orgId(), stream), { headers: getHeaders(), data: ROWS });
    expect(ingest.status(), 'Precondition: rows must ingest').toBe(200);
    await waitForStreamData(page, stream, ROWS.length);
  });

  test.afterEach(async ({ page }, testInfo) => {
    const base = process.env.ZO_BASE_URL_SC || process.env.ZO_BASE_URL;
    await page.request.delete(`${base}/api/${orgId()}/streams/${stream}?type=logs`, { headers: getAuthHeaders() }).catch(() => {});
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('three includes in a row keep one bracket around the original filter (ENT#3086)', {
    tag: ['@bug-ent3086', '@P2', '@regression', '@logsRegression'],
  }, async ({ page }) => {
    await openLogsWithFilter(page, stream, "svc = 'alpha'");
    await pm.logsPage.getQueryEditorTextWhenReady("svc = 'alpha'");
    await pm.logsPage.clickRefreshButton();
    await expect.poll(async () => (await pm.logsPage.getResultRowTexts()).length, { timeout: 30000 }).toBe(2);

    for (const field of ['ns', 'host', 'pod']) {
      await includeFromFirstRow(pm, 'ovn-b-include alpha', field);
      await pm.logsPage.getQueryEditorTextWhenReady(`${field} = '${field}-a'`);
    }

    const query = (await pm.logsPage.getQueryEditorText()).replace(/\s+/g, ' ').trim();
    testLogger.info(`Query after three includes: ${query}`);
    // Pre-fix every include re-wrapped the whole query: "( ( ( svc = 'alpha' ) AND ns ... ) AND host ... ) AND pod ...".
    expect((query.match(/\(/g) || []).length, `one bracket level only: ${query}`).toBe(1);
    expect(query).toMatch(/^\(\s*svc = 'alpha'\s*\) AND ns = 'ns-a' AND host = 'host-a' AND pod = 'pod-a'$/);

    await pm.logsPage.clickRefreshButton();
    await expect.poll(async () => (await pm.logsPage.getResultRowTexts()).length, { timeout: 30000 }).toBe(2);
  });

  test('include on a GROUP BY query lands inside WHERE, before GROUP BY, and the query runs (OSS#11220)', {
    tag: ['@bug-11220', '@P2', '@regression', '@logsRegression'],
  }, async ({ page }) => {
    const sql = `SELECT svc, count(*) as cnt FROM "${stream}" WHERE level = 'info' GROUP BY svc ORDER BY cnt DESC`;
    await pm.logsPage.openLogsWithSqlQuery(stream, sql);
    await pm.logsPage.clickRefreshButton();
    await expect.poll(async () => (await pm.logsPage.getResultRowTexts()).length, { timeout: 30000 }).toBe(2);

    await includeFromFirstRow(pm, '"svc":"alpha"', 'svc');
    const query = (await pm.logsPage.getQueryEditorTextWhenReady("svc = 'alpha'")).replace(/\s+/g, ' ');
    testLogger.info(`Query after include: ${query}`);

    const lower = query.toLowerCase();
    const where = lower.indexOf(' where ');
    const added = lower.indexOf("svc = 'alpha'");
    const groupBy = lower.indexOf('group by');
    expect(where, `query keeps its WHERE: ${query}`).toBeGreaterThan(-1);
    // Pre-fix the condition was appended after GROUP BY.
    expect(added, `condition must be inside WHERE: ${query}`).toBeGreaterThan(where);
    expect(added, `condition must come before GROUP BY: ${query}`).toBeLessThan(groupBy);
    expect(lower).toMatch(/level = 'info'\s+and\s+svc = 'alpha'/);

    const searchResp = page.waitForResponse((r) => r.url().includes('/_search') && r.request().method() === 'POST', { timeout: 30000 });
    await pm.logsPage.clickRefreshButton();
    expect((await searchResp).status(), 'the rewritten query must run').toBe(200);
    await expect.poll(async () => (await pm.logsPage.getResultRowTexts()).length, { timeout: 30000 }).toBe(1);
    expect((await pm.logsPage.getResultRowTexts())[0]).toContain('"svc":"alpha"');
  });
});
