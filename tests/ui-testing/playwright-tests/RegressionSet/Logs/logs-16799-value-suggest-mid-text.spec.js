const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestRows, waitForSearchable } = require('../../utils/auto-run-helpers.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

const ORG = getOrgIdentifier() || 'default';
const STREAM = `e2e_16799_${Math.random().toString(36).slice(2, 7)}`;
const jobId = (digits, tail) => `deploy-ft-k8s-meg-rd-${digits}-leader-open-close-emails-${tail}`;
// One row only, so it sits outside the top-10 values and appears only when the typed text is sent to the server.
const HIT = jobId('5041', '119768');
const TOP = Array.from({ length: 12 }, (_, i) => jobId(String(1040 + i), '100200'));

const logsUrl = () =>
  `/web/logs?org_identifier=${ORG}&stream=${STREAM}&stream_type=logs&period=15m` +
  '&refresh=0&sql_mode=true&quick_mode=false&show_histogram=false';

// openobserve#16799 (issue #13984): only values starting with the typed text were kept, and unquoted text never reached the server lookup.
test.describe('Logs value suggestions match mid-text (#16799)', () => {
  let pm;

  test.beforeAll(async ({ request }) => {
    const now = Date.now() * 1000;
    const data = [];
    TOP.forEach((value, i) => {
      for (let n = 0; n < 5; n++) data.push({ _timestamp: now - (i * 5 + n + 1) * 1_000_000, job_id: value, message: 'top' });
    });
    data.push({ _timestamp: now - 90 * 1_000_000, job_id: HIT, message: 'rare' });
    await ingestRows(request, ORG, STREAM, data);
    await waitForSearchable(request, ORG, STREAM, data.length);
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.goto(logsUrl());
    await pm.logsPage.waitForStreamFieldsLoaded('job_id');
    // The landing search re-renders the editor when it lands, which drops focus from a seeded editor.
    await pm.logsPage.waitForSearchResultRows(60000);
  });

  for (const [name, typed] of [['unquoted', '5041'], ['quoted', "'5041"]]) {
    test(`${name} text from the middle of a value suggests that value`, {
      tag: ['@bug-16799', '@bug-13984', '@P2', '@regression', '@logsRegression', '@autosuggestions'],
    }, async ({ page }) => {
      await pm.logsPage.seedQueryEditorForTyping(`SELECT * FROM "${STREAM}" WHERE job_id = `);
      await page.keyboard.type(typed, { delay: 30 });
      const rows = await pm.logsPage.expectSuggestValueOffered(HIT);
      testLogger.info('value rows', { rows: rows.slice(0, 12) });
      for (const other of TOP) expect(rows.some((r) => r.includes(other)), `${other} does not contain 5041`).toBe(false);
    });
  }
});
