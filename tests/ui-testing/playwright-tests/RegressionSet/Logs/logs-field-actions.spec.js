const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData, ingestCustomData, waitForStreamData } = require('../../utils/data-ingestion.js');

const STREAM = 'e2e_automate';

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
    // Which fields the sidebar offers varies by dataset, so take them as rendered.
    const [firstField, secondField] = await pm.logsPage.getFilterableSidebarFields(2);
    testLogger.info(`Using sidebar fields: ${firstField}, ${secondField}`);

    await pm.logsPage.addEqualsFilterForField(firstField);
    const afterFirst = await pm.logsPage.getQueryEditorText();
    testLogger.info(`After first filter: ${afterFirst}`);
    expect(afterFirst, 'first field filter must reach the editor').toContain(firstField);

    await pm.logsPage.addEqualsFilterForField(secondField);
    const afterSecond = await pm.logsPage.getQueryEditorText();
    testLogger.info(`After second filter: ${afterSecond}`);

    // The defect replaced the first field, so the first surviving is the contract.
    expect(afterSecond, 'the first field must survive the second').toContain(firstField);
    expect(afterSecond, 'the second field must be added').toContain(secondField);
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

test.describe("Include on an empty or \"null\" text value", () => {
  test.describe.configure({ mode: 'serial' });
  const stream = `e2e_empty_vals_${Date.now()}`;
  const ROWS = [
    { tag: 'row_empty', k: '' },
    { tag: 'row_missing' },
    { tag: 'row_nulltext', k: 'null' },
    { tag: 'row_value', k: 'v' },
  ];
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    expect(await waitForStreamData(page, stream, ROWS.length, 60000), 'Precondition: rows searchable').toBe(true);
    await pm.logsPage.openLogsWithSqlQuery(stream, `SELECT * FROM "${stream}"`);
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectResultsGridSettledWithRows();
  });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      expect((await ingestCustomData(page, stream, ROWS)).status, 'Precondition: rows must ingest').toBe(200);
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await new PageManager(page).streamsPage.deleteStreamViaAPI(stream);
    } catch (e) {
      testLogger.warn(`Cleanup of ${stream} failed: ${e.message}`);
    } finally {
      await page.close();
    }
  });

  for (const { title, tag, literal } of [
    { title: 'Include on an empty value returns only the clicked row', tag: 'row_empty', literal: "k = ''" },
    { title: 'Include on the text "null" returns only the clicked row', tag: 'row_nulltext', literal: "k = 'null'" },
  ]) {
    test(title, { tag: ['@bug-16941', '@P1', '@regression', '@logsRegression'] }, async () => {
      await pm.logsPage.openLogDetailForRowContaining(tag);
      await pm.logsPage.includeLogDetailJsonFieldValue('k');
      await pm.logsPage.closeLogDetailIfOpen();

      const query = await pm.logsPage.getQueryEditorText();
      testLogger.info(`Query after Include: ${query}`);
      expect(query).toContain(literal);
      expect(query.toLowerCase()).not.toContain('is null');

      await pm.logsPage.runQueryAndWaitForResults();
      expect(await pm.logsPage.getResultHitsCount()).toBe(1);
      const rows = await pm.logsPage.getResultRowTexts();
      expect(rows.join('\n')).toContain(tag);
    });
  }
});
