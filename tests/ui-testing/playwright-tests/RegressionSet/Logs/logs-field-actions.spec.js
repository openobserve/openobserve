const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');

const STREAM = 'e2e_automate';
const FIRST_FIELD = 'level';
const SECOND_FIELD = 'message';

test.describe("Logs Field Actions Regression", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    try {
      await ingestTestData(page);
    } catch (error) {
      testLogger.warn(`Data ingestion skipped: ${error.message}`);
    }
    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.expectResultsGridSettledWithRows();
  });

  test("a second field filter is ANDed onto the query, not substituted @bug-11988 @P1 @regression @logsRegression", async () => {
    await pm.logsPage.addEqualsFilterForField(FIRST_FIELD);
    const afterFirst = await pm.logsPage.getQueryEditorText();
    testLogger.info(`After first filter: ${afterFirst}`);
    expect(afterFirst, 'first field filter must reach the editor').toContain(FIRST_FIELD);

    await pm.logsPage.addEqualsFilterForField(SECOND_FIELD);
    const afterSecond = await pm.logsPage.getQueryEditorText();
    testLogger.info(`After second filter: ${afterSecond}`);

    // The defect replaced the first field, so the first surviving is the contract.
    expect(afterSecond, 'the first field must survive the second').toContain(FIRST_FIELD);
    expect(afterSecond, 'the second field must be added').toContain(SECOND_FIELD);
    expect(afterSecond.toLowerCase(), 'the two filters must be combined').toContain(' and ');
  });

  test("the field menu label reflects whether the field is already in the table @bug-3347 @P3 @regression @logsRegression", async () => {
    await pm.logsPage.expandFirstResultRow();
    // Which fields a record carries varies, so pick one the row actually renders.
    const field = await pm.logsPage.getFirstActionableDetailField();
    testLogger.info(`Using expanded-row field: ${field}`);

    const beforeAdd = await pm.logsPage.getAddOrRemoveFieldLabel(field);
    testLogger.info(`Label before adding: ${beforeAdd}`);
    expect(beforeAdd.toLowerCase(), 'menu should offer to add the field').toContain('add');

    await pm.logsPage.clickAddOrRemoveFieldItem();

    const afterAdd = await pm.logsPage.getAddOrRemoveFieldLabel(field);
    testLogger.info(`Label after adding: ${afterAdd}`);
    // The defect was a static label, so the flip to remove is what must be asserted.
    expect(afterAdd.toLowerCase(), 'menu should offer to remove an already-added field')
      .toContain('remove');
  });
});
