const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { getHeaders, getIngestionUrl, waitForStreamData } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

const REPORTED_ID = '646586703926004764';
const LARGE_IDS = {
  reported: REPORTED_ID,
  max_safe_plus_2: '9007199254740993',
  int64_max: '9223372036854775807',
  negative: '-646586703926004764',
};
const SAFE_ID = '123456789';

// Built as text: JSON.stringify of a JS number would round the ids before they reach the server.
const PAYLOAD = '[' + [...Object.entries(LARGE_IDS), ['safe', SAFE_ID]]
  .map(([label, id]) => `{"label":"${label}","message":"bug-14376 ${label}","userid":${id}}`)
  .join(',') + ']';

// The exact text the bug rendered: what JSON.parse turns each id into.
const rounded = (id) => String(Number(id));

test.describe("Logs int64 precision (#14376)", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    const stream = 'e2e_14376_' + Math.random().toString(36).slice(2, 7);
    const ingest = await page.request.post(getIngestionUrl(getOrgIdentifier() || 'default', stream), {
      headers: getHeaders(),
      data: PAYLOAD,
    });
    expect(ingest.status(), 'Precondition: int64 records must ingest').toBe(200);
    await waitForStreamData(page, stream, 5);

    await pm.logsPage.openLogsWithSqlQuery(stream, `SELECT label, userid FROM "${stream}"`);
    await pm.logsPage.clickRefreshButton();
    await expect.poll(async () => (await pm.logsPage.getResultRowTexts()).length, { timeout: 30000 }).toBe(5);
  });

  test("results table shows every digit of integers beyond 2^53", {
    tag: ['@bug-14376', '@P1', '@regression', '@logsRegression']
  }, async () => {
    const rows = await pm.logsPage.getResultRowTexts();

    for (const [label, id] of Object.entries(LARGE_IDS)) {
      const row = rows.find((r) => r.includes(`"label":"${label}"`));
      expect(row, `a result row must exist for ${label}`).toBeTruthy();
      expect(row, `Bug #14376: ${label} must render as ${id}`).toContain(id);
      expect(row, `Bug #14376: ${label} must not render as the rounded ${rounded(id)}`).not.toContain(rounded(id));
    }

    const safeRow = rows.find((r) => r.includes('"label":"safe"'));
    expect(safeRow, 'a safe integer must still render as a bare number').toContain(`"userid":${SAFE_ID}`);
  });

  test("log detail sidebar shows the exact int64 value", {
    tag: ['@bug-14376', '@P1', '@regression', '@logsRegression']
  }, async () => {
    await pm.logsPage.openLogDetailForRowContaining('"label":"reported"');
    await pm.logsPage.clickLogDetailJsonTab();

    const detail = await pm.logsPage.getLogDetailDialogText();
    expect(detail, `Bug #14376: detail must show ${REPORTED_ID}`).toContain(REPORTED_ID);
    expect(detail, 'Bug #14376: detail must not show the rounded value').not.toContain(rounded(REPORTED_ID));
  });

  test("Include Search Term on an int64 field filters by the exact value", {
    tag: ['@bug-14376', '@P2', '@regression', '@logsRegression']
  }, async () => {
    await pm.logsPage.openLogDetailForRowContaining('"label":"reported"');
    await pm.logsPage.clickLogDetailTableTab();
    await pm.logsPage.includeLogDetailFieldValue('userid');
    await pm.logsPage.clickCloseDialog();

    // A rounded filter value would never appear, so this times out instead of passing on the bug.
    const query = await pm.logsPage.getQueryEditorTextWhenReady(REPORTED_ID);
    testLogger.info(`Query after include: ${query}`);

    await pm.logsPage.clickRefreshButton();
    await expect.poll(async () => (await pm.logsPage.getResultRowTexts()).length, {
      timeout: 30000,
      message: 'the exact-value filter must match exactly the one reported record',
    }).toBe(1);
    expect((await pm.logsPage.getResultRowTexts())[0]).toContain('"label":"reported"');
  });
});
