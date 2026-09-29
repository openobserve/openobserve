const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const logsdata = require("../../../../test-data/logs_data.json");

test.describe("Pipeline default destination node guard", () => {
  let pm;
  let sourceStream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    sourceStream = `e2e_automate_w${testInfo.parallelIndex}`;
    await pm.pipelinesPage.bulkIngestToStreams([sourceStream], logsdata);

    await pm.pipelinesPage.openPipelineMenu();
    await pm.pipelinesPage.addPipeline();
    await pm.pipelinesPage.selectStream();
    await pm.pipelinesPage.dragStreamToTarget(pm.pipelinesPage.streamButton);
    await pm.pipelinesPage.selectLogs();
    await pm.pipelinesPage.enterStreamName(sourceStream);
    await pm.pipelinesPage.selectStreamOption(sourceStream);
    await pm.pipelinesPage.saveInputNodeStream();
  });

  test("deleting the implicit destination node should warn that ingestion stops", {
    tag: ['@bug-8597', '@P2', '@regression', '@pipelinesRegression']
  }, async () => {
    // Saving the source node implicitly adds a destination mirroring it; that is the guarded node.
    expect(await pm.pipelinesPage.countOutputStreamNodes()).toBeGreaterThan(0);

    await pm.pipelinesPage.openOutputStreamNodeDeleteDialog();
    await pm.pipelinesPage.expectDefaultDestinationWarningVisible();
    await pm.pipelinesPage.cancelConfirmDialog();

    // Cancelling must leave the node in place, or the warning is decoration.
    expect(await pm.pipelinesPage.countOutputStreamNodes()).toBeGreaterThan(0);

    testLogger.info('✓ PASSED: implicit destination node delete is guarded (Bug #8597)');
  });

  test("deleting a user-added destination node should not warn", {
    tag: ['@bug-8597', '@P3', '@regression', '@pipelinesRegression']
  }, async () => {
    await pm.pipelinesPage.deleteOutputStreamNode();

    await pm.pipelinesPage.selectAndDragSecondStream();
    await pm.pipelinesPage.fillDestinationStreamName(`${sourceStream}_dest`);
    await pm.pipelinesPage.clickInputNodeStreamSave();

    await pm.pipelinesPage.openOutputStreamNodeDeleteDialog();
    await pm.pipelinesPage.expectDefaultDestinationWarningAbsent();
    await pm.pipelinesPage.cancelConfirmDialog();

    testLogger.info('✓ PASSED: a distinct destination node deletes without the warning (Bug #8597)');
  });
});
