const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { sendRequest, getHeaders, getIngestionUrl } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

const FIELD = 'http_body';
const QUOTED = "it's $& ok";
const JSONISH = `{"sql":"where a = 'y'"} $' end`;

test.describe("Logs field-value multi-select with quotes (issue 11966)", () => {
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    stream = 'e2e_11966_' + Math.random().toString(36).slice(2, 7);
    const orgId = getOrgIdentifier() || 'default';
    await sendRequest(page, getIngestionUrl(orgId, stream), [
      { level: 'info', [FIELD]: QUOTED },
      { level: 'info', [FIELD]: JSONISH },
      { level: 'info', [FIELD]: 'plain' },
    ], getHeaders());

    await pm.logsPage.selectStream(stream);
    await pm.logsPage.clickRefreshButton();
  });

  test.afterEach(async ({ page }) => {
    await new PageManager(page).logsPage.deleteStream(stream).catch((e) =>
      testLogger.warn(`Failed to delete stream ${stream}: ${e.message}`)
    );
  });

  test("ticking a second value keeps the filter intact when values hold quotes and $ tokens @bug-11966 @P1 @regression @logsRegression", async () => {
    await pm.logsPage.clickFieldExpandButton(FIELD);
    const box = (text) => pm.logsPage.fieldValueCheckbox(FIELD, text);

    await box('it\'s').click();
    await expect.poll(() => pm.logsPage.getQueryEditorText()).toBe(`${FIELD} = 'it''s $& ok'`);

    await box('where a').click();
    const expected = `(${FIELD} = 'it''s $& ok' OR ${FIELD} = '{"sql":"where a = ''y''"} $'' end')`;
    await expect.poll(() => pm.logsPage.getQueryEditorText(), { timeout: 15000 }).toBe(expected);
    await expect(box('it\'s')).toBeChecked();
    await expect(box('where a')).toBeChecked();
  });
});
