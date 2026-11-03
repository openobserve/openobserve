const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { sendRequest, getHeaders, getIngestionUrl, waitForStreamData } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

// operation_name is the tail of db_operation_name, so an unbounded field match edits the wrong condition.
const ROWS = [
  { db_operation_name: 'SELECT', operation_name: 'GET /', name: 'row_a' },
  { db_operation_name: 'SELECT', operation_name: 'GET /', name: 'row_b' },
  { db_operation_name: 'SELECT', operation_name: 'POST /', name: 'row_c' },
  { db_operation_name: 'INSERT', operation_name: 'GET /', name: 'row_d' },
];

test.describe("Field-value filter on a field whose name ends another field's name (o2-enterprise#3322)", () => {
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    stream = 'e2e_3322_' + Math.random().toString(36).slice(2, 7);
    const orgId = getOrgIdentifier() || 'default';
    await sendRequest(page, getIngestionUrl(orgId, stream), ROWS, getHeaders());
    await waitForStreamData(page, stream, ROWS.length);
  });

  test.afterEach(async ({ page }) => {
    await new PageManager(page).logsPage.deleteStream(stream).catch((e) =>
      testLogger.warn(`Failed to delete stream ${stream}: ${e.message}`)
    );
  });

  test("Logs SQL mode: ticking operation_name values keeps the db_operation_name condition", {
    tag: ['@bug-3322', '@P2', '@regression', '@logsRegression']
  }, async () => {
    const base = `SELECT * FROM "${stream}" WHERE db_operation_name = 'SELECT'`;
    await pm.logsPage.openLogsWithSqlQuery(stream, base);
    await pm.logsPage.clickRefreshButton();
    await expect.poll(async () => (await pm.logsPage.getResultRowTexts()).length, { timeout: 30000 }).toBe(3);

    await pm.logsPage.clickFieldExpandButton('operation_name');
    await pm.logsPage.fieldValueCheckbox('operation_name', 'GET /').click();
    await expect.poll(() => pm.logsPage.getQueryEditorText(), {
      timeout: 15000,
      message: 'the db_operation_name condition must stay and operation_name must be added',
    }).toBe(`${base} AND operation_name = 'GET /'`);

    await pm.logsPage.clickRefreshButton();
    await expect.poll(async () => (await pm.logsPage.getResultRowTexts()).length, { timeout: 30000 }).toBe(2);
    const rows = (await pm.logsPage.getResultRowTexts()).join('\n');
    expect(rows).toContain('row_a');
    expect(rows).toContain('row_b');

    await pm.logsPage.fieldValueCheckbox('operation_name', 'POST /').click();
    await expect.poll(() => pm.logsPage.getQueryEditorText(), {
      timeout: 15000,
      message: 'a second value must replace only the operation_name condition',
    }).toBe(`${base} AND (operation_name = 'GET /' OR operation_name = 'POST /')`);

    await pm.logsPage.clickRefreshButton();
    await expect.poll(async () => (await pm.logsPage.getResultRowTexts()).length, { timeout: 30000 }).toBe(3);
    expect((await pm.logsPage.getResultRowTexts()).join('\n')).not.toContain('row_d');
  });

  test("Pipelines Query source SQL: ticking an operation_name value keeps the db_operation_name condition", {
    tag: ['@bug-3322', '@P2', '@regression', '@logsRegression', '@pipelinesRegressionQuery']
  }, async () => {
    await pm.pipelinesPage.openPipelineMenu();
    await pm.pipelinesPage.addPipeline();
    await pm.pipelinesPage.dragStreamToTarget(pm.pipelinesPage.queryButton);
    await pm.pipelinesPage.waitForScheduledPipelineDialog();
    await pm.pipelinesPage.expandBuildQuerySection();
    await pm.pipelinesPage.selectStreamType('logs');
    await pm.pipelinesPage.selectStreamName(stream);
    await pm.pipelinesPage.expectSqlEditorVisible();

    const base = `SELECT * FROM "${stream}" WHERE db_operation_name='SELECT'`;
    await pm.pipelinesPage.setQuerySourceSql(base);

    const value = await pm.pipelinesPage.addQueryFieldValueFilter('operation_name');
    testLogger.info(`Ticked operation_name='${value}'`);
    expect(['GET /', 'POST /']).toContain(value);
    await expect.poll(() => pm.pipelinesPage.getQuerySourceSql(), {
      timeout: 15000,
      message: 'the db_operation_name condition must stay and operation_name must be added',
    }).toBe(`${base} AND operation_name='${value}'`);

    await pm.pipelinesPage.clickBodyCorner();
    await pm.pipelinesPage.clickCancelPipelineBtnForce();
  });
});
