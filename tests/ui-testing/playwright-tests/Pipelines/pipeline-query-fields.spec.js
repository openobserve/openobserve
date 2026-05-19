const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const logsdata = require("../../../test-data/logs_data.json");
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "serial" });

test.use({ slowMo: 500 });

test.describe("Pipeline Query Node - Field List", { tag: ['@all', '@pipelines', '@scheduledPipeline'] }, () => {
  let pageManager;
  const STREAM_NAMES = ["e2e_automate", "e2e_automate1"];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pageManager = new PageManager(page);

    // Ingest data to create test streams with fields
    await pageManager.pipelinesPage.bulkIngestToStreams(STREAM_NAMES, logsdata);

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  async function openQueryNodeWithStream(pipelinePage, streamName) {
    await pipelinePage.openPipelineMenu();
    await pipelinePage.addPipeline();
    await pipelinePage.dragStreamToTarget(pipelinePage.queryButton);
    await pipelinePage.waitForScheduledPipelineDialog();
    await pipelinePage.expandBuildQuerySection();
    await pipelinePage.selectStreamType('logs');
    await pipelinePage.selectStreamName(streamName);
    await pipelinePage.expectSqlEditorVisible();
    // Wait for field list to populate by checking field labels appear
    await pipelinePage.getPipelineFieldCount();
  }

  // =========================================================================
  // 1: Field search filters the field list
  // =========================================================================
  test("should filter fields when searching in the field list", {
    tag: ['@smoke', '@P0']
  }, async () => {
    testLogger.info('Testing: field search filters the field list');

    const pipelinePage = pageManager.pipelinesPage;
    await openQueryNodeWithStream(pipelinePage, 'e2e_automate');

    const initialCount = await pipelinePage.getPipelineFieldCount();
    expect(initialCount).toBeGreaterThan(0);
    testLogger.info(`Initial field count: ${initialCount}`);

    // Search for a specific field
    await pipelinePage.searchPipelineFieldList('_timestamp');

    const filteredCount = await pipelinePage.getPipelineFieldCount();
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
    testLogger.info(`Filtered count for "_timestamp": ${filteredCount}`);

    // Clear search, all fields should return
    await pipelinePage.clearPipelineFieldSearch();
    const restoredCount = await pipelinePage.getPipelineFieldCount();
    expect(restoredCount).toBe(initialCount);
    testLogger.info(`Restored count: ${restoredCount}`);

    await pipelinePage.clickCancelAndConfirm();
    testLogger.info('Test passed: field search filters correctly');
  });

  // =========================================================================
  // 2: Stream change updates the field list
  // =========================================================================
  test("should update field list when stream is changed", {
    tag: ['@smoke', '@P0']
  }, async () => {
    testLogger.info('Testing: field list updates on stream change');

    const pipelinePage = pageManager.pipelinesPage;
    await openQueryNodeWithStream(pipelinePage, 'e2e_automate');

    const firstCount = await pipelinePage.getPipelineFieldCount();
    expect(firstCount).toBeGreaterThan(0);
    testLogger.info(`Field count for "e2e_automate": ${firstCount}`);

    // Switch to a different stream
    await pipelinePage.selectStreamName('e2e_automate1');
    await pipelinePage.expectSqlEditorVisible();

    const secondCount = await pipelinePage.getPipelineFieldCount();
    expect(secondCount).toBeGreaterThan(0);
    testLogger.info(`Field count for "e2e_automate1": ${secondCount}`);

    await pipelinePage.expectQueryToContain('e2e_automate1');

    await pipelinePage.clickCancelAndConfirm();
    testLogger.info('Test passed: field list updates on stream change');
  });

  // =========================================================================
  // 3: Field list persists after collapsing/expanding Build Query
  // =========================================================================
  test("should keep field list visible after collapsing and re-expanding Build Query", {
    tag: ['@functional', '@P1']
  }, async () => {
    testLogger.info('Testing: field list persists through collapse/expand');

    const pipelinePage = pageManager.pipelinesPage;
    await openQueryNodeWithStream(pipelinePage, 'e2e_automate');

    const initialCount = await pipelinePage.getPipelineFieldCount();
    expect(initialCount).toBeGreaterThan(0);

    const scrollBefore = await pipelinePage.verifyPipelineFieldListScrollable();
    expect(scrollBefore.scrollable).toBe(true);

    // Collapse Build Query
    await pipelinePage.collapseBuildQuerySection();
    await pipelinePage.expectBuildQuerySectionCollapsed();
    // Re-expand Build Query
    await pipelinePage.expandBuildQuerySection();
    await pipelinePage.expectBuildQuerySectionVisible();

    const scrollAfter = await pipelinePage.verifyPipelineFieldListScrollable();
    expect(scrollAfter.scrollable).toBe(true);

    const restoredCount = await pipelinePage.getPipelineFieldCount();
    expect(restoredCount).toBe(initialCount);
    testLogger.info(`Field count after re-expand: ${restoredCount}`);

    await pipelinePage.clickCancelAndConfirm();
    testLogger.info('Test passed: field list persists through collapse/expand');
  });

});
