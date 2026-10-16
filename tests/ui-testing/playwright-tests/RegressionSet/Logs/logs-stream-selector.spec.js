const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

const STREAM = 'e2e_automate';
// A prefix of the stream name, so the filter and the selection are different strings.
const TYPED_PREFIX = 'e2e_a';

test.describe("Logs stream picker", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test("the typed filter does not survive into the selected label @bug-9540 @bug-8456 @P0 @regression @logsRegression", {
    tag: ['@bug-9540', '@bug-8456', '@P0', '@regression', '@logsRegression'],
  }, async () => {
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.pickStreamByTypedFilter(TYPED_PREFIX, STREAM);

    await pm.logsPage.expectStreamPickerClosed();
    await pm.logsPage.expectSelectedStreamLabel(STREAM);
  });

  test("every offered stream renders its name after a query has run @bug-10598 @P2 @regression @logsRegression", {
    tag: ['@bug-10598', '@P2', '@regression', '@logsRegression'],
  }, async () => {
    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.selectRunQuery();

    await pm.logsPage.openStreamPicker();
    const options = await pm.logsPage.getStreamOptionLabels();

    expect(options.length).toBeGreaterThan(0);
    const blank = options.filter((o) => o.text.length === 0);
    expect(blank, `streams rendered with no label: ${JSON.stringify(blank)}`).toEqual([]);
    expect(options[0].text).toBe(options[0].value);
  });
});
