const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const logData = require('../../../fixtures/log.json');
const { ingestTestData } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

const STREAM = 'e2e_automate';
const VRL_FIELD = 'e2e9550';
const SCHEMA_FIELD = 'kubernetes_container_name';

test.describe("Logs VRL column cell actions", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestTestData(page).catch((e) => testLogger.warn(`Ingestion skipped: ${e.message}`));
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative1HourOrFallback();
    testLogger.info('VRL column cell-actions setup completed');
  });

  test("a VRL-derived column must not offer include/exclude term actions", {
    tag: ['@bug-9550', '@P2', '@regression', '@logsRegression', '@logsRegressionVrl']
  }, async () => {
    await pm.logsPage.setVrlFunction(`.${VRL_FIELD} = "derived"`);
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectResultsGridSettledWithRows();

    // Per #9550's own steps the VRL field is added "from the results" — it is absent
    // from the sidebar list, which only carries the stream's schema fields.
    await pm.logsPage.addFieldToTableFromLogDetail(VRL_FIELD);
    await pm.logsPage.expectFieldInTableHeader(VRL_FIELD);

    await pm.logsPage.clickAddFieldToTableButton(SCHEMA_FIELD);
    await pm.logsPage.expectFieldInTableHeader(SCHEMA_FIELD);

    // The control side: without it, a table that renders no actions at all would pass.
    const schemaActions = await pm.logsPage.countCellSearchTermActions(SCHEMA_FIELD);
    testLogger.info(`Schema column "${SCHEMA_FIELD}" exposes ${schemaActions} term actions`);
    expect(schemaActions,
      `Precondition: the schema field "${SCHEMA_FIELD}" must still offer include/exclude`
    ).toBeGreaterThan(0);

    const vrlActions = await pm.logsPage.countCellSearchTermActions(VRL_FIELD);
    testLogger.info(`VRL column "${VRL_FIELD}" exposes ${vrlActions} term actions`);
    expect(vrlActions,
      'Bug #9550: a VRL-derived column is not filterable, so it must not render the "=" / "!=" icons'
    ).toBe(0);

    testLogger.info('PASSED: VRL column carries no term actions (Bug #9550)');
  });
});
