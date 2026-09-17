const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');

const STREAM = 'e2e_automate';
const FIELD = 'kubernetes_container_name';

test.describe("Associate Query filter removal", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestTestData(page).catch((e) => testLogger.warn(`Ingestion skipped: ${e.message}`));
    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Associate Query filter-removal setup completed');
  });

  test("removing a field filter must strip it from the query, not re-add the field", {
    tag: ['@bug-12090', '@P1', '@regression', '@pipelinesRegression', '@pipelinesRegressionQuery']
  }, async ({ page }) => {
    await pm.pipelinesPage.openPipelineMenu();
    await pm.pipelinesPage.addPipeline();
    await pm.pipelinesPage.dragStreamToTarget(pm.pipelinesPage.queryButton);
    await pm.pipelinesPage.waitForScheduledPipelineDialog();
    await pm.pipelinesPage.expandBuildQuerySection();
    await pm.pipelinesPage.selectStreamType('logs');
    await pm.pipelinesPage.selectStreamName(STREAM);
    await pm.pipelinesPage.expectSqlEditorVisible();
    await pm.pipelinesPage.expectQueryToContain(STREAM);

    const value = await pm.pipelinesPage.addQueryFieldValueFilter(FIELD);
    testLogger.info(`Applied filter ${FIELD}='${value}'`);
    await pm.pipelinesPage.expectQueryToContain(FIELD);

    await pm.pipelinesPage.clearQueryFieldValueFilter();

    // The field name must be gone entirely: the pre-fix path fell through to the
    // "insert at cursor" branch and wrote the bare field name back into the query.
    await pm.pipelinesPage.expectQueryNotToContain(FIELD);
    await pm.pipelinesPage.expectQueryToContain(STREAM);

    await pm.pipelinesPage.clickBodyCorner();
    await pm.pipelinesPage.clickCancelPipelineBtnForce();

    testLogger.info('PASSED: removing a filter strips it from the query (Bug #12090)');
  });
});
