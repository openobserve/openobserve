const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { sendRequest, getHeaders, getIngestionUrl } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

const MULTILINE_FIELD = 'stacktrace';
const MULTILINE_VALUE = 'Traceback (most recent call last):\n  File "a.py", line 1\n    raise ValueError';

test.describe("Logs Field Value Rendering Regression", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // A field whose value genuinely contains newlines; the shared fixture has none.
    stream = 'e2e_13354_' + Math.random().toString(36).slice(2, 7);
    const orgId = getOrgIdentifier() || 'default';
    await sendRequest(page, getIngestionUrl(orgId, stream), [{
      level: 'error', job: 'test_13354', [MULTILINE_FIELD]: MULTILINE_VALUE,
    }], getHeaders());

    await pm.logsPage.selectStream(stream);
    await pm.logsPage.clickRefreshButton();
  });

  test("multiline field values keep their newlines in the values panel @bug-13354 @P2 @regression @logsRegression", async () => {
    await pm.logsPage.clickFieldExpandButton(MULTILINE_FIELD);

    const rendering = await pm.logsPage.getFirstFieldValueRendering(MULTILINE_FIELD);
    testLogger.info(`white-space=${rendering.whiteSpace} newlines=${rendering.newlineCount}`);

    // The label collapsed newlines because it did not carry pre-wrap, so the
    // wrapping mode is the contract -- the text alone can look right while the
    // browser still renders it on one line.
    expect(rendering.whiteSpace, 'the value label must preserve newlines')
      .toMatch(/pre-wrap|pre-line|pre/);
    expect(rendering.newlineCount, 'the rendered value must still contain its newlines')
      .toBeGreaterThan(0);
  });
});
