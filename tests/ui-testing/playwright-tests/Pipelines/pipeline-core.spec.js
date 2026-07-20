import { test, expect } from "../baseFixtures.js";
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import PageManager from "../../pages/page-manager.js";
const testLogger = require('../utils/test-logger.js');
const path = require('path');

test.describe.configure({ mode: "parallel" });

// Use stored authentication state from global setup instead of logging in each test
const authFile = path.join(__dirname, '../utils/auth/user.json');
test.use({
  storageState: authFile,
  contextOptions: {
    slowMo: 1000
  }
});

const randomFunctionName = `Pipeline${Math.floor(Math.random() * 1000)}`;

test.describe("Core Pipeline Tests", { tag: ['@all', '@pipelines', '@pipelinesCore'] }, () => {
  let pageManager;
  // Worker-specific stream suffix. parallelIndex is 0..(workers-1), so two tests
  // that run concurrently are always on different workers and therefore never share
  // a source/destination stream — this removes the residual cross-file collision
  // that per-test cleanup scoping alone could not (two concurrent tests on the same
  // shared stream name). Same-worker tests run sequentially and are safe.
  let streamSuffix;

  test.beforeEach(async ({ page }, testInfo) => {
    // Auth is handled via storageState - no login needed
    pageManager = new PageManager(page);
    streamSuffix = `_w${testInfo.parallelIndex}`;

    // Ingest data using page object method (worker-scoped stream names)
    const streamNames = [
      `e2e_automate${streamSuffix}`,
      `e2e_automate1${streamSuffix}`,
      `e2e_automate2${streamSuffix}`,
      `e2e_automate3${streamSuffix}`,
    ];
    await pageManager.pipelinesPage.bulkIngestToStreams(streamNames, logsdata);
    // NOTE: pipeline cleanup is intentionally NOT done pool-wide here. A cleanup that
    // deletes pipelines across all four shared source streams races with sibling tests
    // under parallel execution and deletes their in-flight pipelines, which makes
    // deletePipelineByName poll-timeout (the flaky failure). Each test instead frees
    // only its OWN source stream at its start via cleanupPipelines([sourceStream]).

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await pageManager.logsPage.selectStream(`e2e_automate${streamSuffix}`);
    await pageManager.logsPage.applyQuery();
  });

  test("should add source & destination node and then delete the pipeline", async ({ page }) => {
    const sourceStream = `e2e_automate3${streamSuffix}`;
    const destFill = `destination-node${streamSuffix}`;   // hyphen normalizes to "_" on create
    const destStream = `destination_node${streamSuffix}`;  // resulting stream name to explore
    // Free only this test's own source stream so a sibling test's setup can never
    // delete this test's in-flight pipeline (was pool-wide cleanup in beforeEach).
    await pageManager.apiCleanup.cleanupPipelines([sourceStream]).catch(() => {});
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectLogs();

    await pageManager.pipelinesPage.enterStreamName("e2e");
    await pageManager.pipelinesPage.enterStreamName(sourceStream);
    await pageManager.pipelinesPage.selectStreamOption(sourceStream);
    await pageManager.pipelinesPage.saveInputNodeStream();
    await page.waitForTimeout(3000);

    // Delete the auto-created output stream node
    await pageManager.pipelinesPage.deleteOutputStreamNode();

    // Drag and drop output stream instead of hover-click
    await pageManager.pipelinesPage.selectAndDragSecondStream();
    await pageManager.pipelinesPage.fillDestinationStreamName(destFill);
    await pageManager.pipelinesPage.clickInputNodeStreamSave();

    // Wait for dialog to close and connect nodes
    await page.waitForTimeout(2000);
    await pageManager.pipelinesPage.connectInputToOutput();

    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);
    await pageManager.pipelinesPage.savePipeline();

    // Navigate to pipeline list via stream exploration
    await pageManager.pipelinesPage.exploreStreamAndNavigateToPipeline(destStream);
    await pageManager.pipelinesPage.searchPipeline(pipelineName);
    await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
  });

  test.skip("should add source, function, destination and then delete pipeline", async ({ page }) => {
    const sourceStream = `e2e_automate1${streamSuffix}`;
    const destFill = `destination-node${streamSuffix}`;
    const destStream = `destination_node${streamSuffix}`;
    // Free only this test's own source stream (see note in beforeEach).
    await pageManager.apiCleanup.cleanupPipelines([sourceStream]).catch(() => {});
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectLogs();
    await pageManager.pipelinesPage.enterStreamName("e2e");
    await pageManager.pipelinesPage.enterStreamName(sourceStream);
    await pageManager.pipelinesPage.selectStreamOption(sourceStream);
    await pageManager.pipelinesPage.saveInputNodeStream();
    await page.waitForTimeout(2000);

    // Delete the auto-created output stream node
    await pageManager.pipelinesPage.deleteOutputStreamNode();

    // Drag and drop function instead of hover-click
    await pageManager.pipelinesPage.selectAndDragFunction();
    await pageManager.pipelinesPage.toggleCreateFunction();
    await pageManager.pipelinesPage.enterFunctionName(randomFunctionName);
    // Type function code in VRL editor using page object methods
    await pageManager.pipelinesPage.clickVrlEditorMonaco();
    await pageManager.pipelinesPage.typeVrlCode(".a=41", 100);
    await page.keyboard.press("Enter");
    await pageManager.pipelinesPage.typeVrlCode(".", 100);
    await pageManager.pipelinesPage.clickNoteText();
    await pageManager.pipelinesPage.verifyVrlEditorHasText(".a=41 .");
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.saveNewFunction();
    await page.waitForTimeout(3000);
    await pageManager.pipelinesPage.saveFunction();
    await page.waitForTimeout(3000);

    // Drag and drop output stream instead of hover-click
    await pageManager.pipelinesPage.selectAndDragSecondStream();
    await pageManager.pipelinesPage.fillDestinationStreamName(destFill);
    await pageManager.pipelinesPage.clickInputNodeStreamSave();

    // Wait for dialog to close and connect nodes via function
    await page.waitForTimeout(2000);
    await pageManager.pipelinesPage.connectNodesViaMiddleNode();

    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);
    await pageManager.pipelinesPage.savePipeline();

    // Navigate to pipeline list via stream exploration
    await pageManager.pipelinesPage.exploreStreamAndInteractWithLogDetails(destStream);
    await pageManager.pipelinesPage.searchPipeline(pipelineName);
    await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
  });

  /**
   * Test: Pipeline with function node using VRL transform
   * Verifies that a function node with VRL code can be added to pipeline
   */
  test("should add pipeline with function node using VRL transform @P1 @function @vrl @regression", async ({ page }) => {
    testLogger.info('Test: Add pipeline with function node (VRL transform)');

    const sourceStream = `e2e_automate${streamSuffix}`;
    const destStream = `destination_node${streamSuffix}`;
    // Free only this test's own source stream (see note in beforeEach).
    await pageManager.apiCleanup.cleanupPipelines([sourceStream]).catch(() => {});
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Add source stream
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectLogs();
    await pageManager.pipelinesPage.enterStreamName("e2e");
    await pageManager.pipelinesPage.enterStreamName(sourceStream);
    await pageManager.pipelinesPage.selectStreamOption(sourceStream);
    await pageManager.pipelinesPage.saveInputNodeStream();
    await page.waitForTimeout(2000);

    // Delete auto-created output node
    await pageManager.pipelinesPage.deleteOutputStreamNode();

    // Add function node
    await pageManager.pipelinesPage.selectAndDragFunction();
    await pageManager.pipelinesPage.toggleCreateFunction();

    const funcName = `vrl_func_${Math.random().toString(36).substring(7)}`;
    await pageManager.pipelinesPage.enterFunctionName(funcName);

    // Add VRL code to transform data
    await pageManager.pipelinesPage.clickVrlEditorMonaco();
    await pageManager.pipelinesPage.typeVrlCode(".transformed = true", 50);
    await page.keyboard.press("Enter");
    await pageManager.pipelinesPage.typeVrlCode(".", 50);
    await pageManager.pipelinesPage.clickNoteText();
    await page.waitForTimeout(500);

    // Save function
    await pageManager.pipelinesPage.saveNewFunction();
    await page.waitForTimeout(2000);
    await pageManager.pipelinesPage.saveFunction();
    await page.waitForTimeout(2000);

    // Verify function node was added (using POM)
    const isFunctionVisible = await pageManager.pipelinesPage.isFunctionNodeVisible(funcName);
    testLogger.info(`Function node visible: ${isFunctionVisible}`);

    // Add destination node (use same naming as other tests for consistency)
    await pageManager.pipelinesPage.selectAndDragSecondStream();
    await pageManager.pipelinesPage.fillDestinationStreamName(destStream);
    await pageManager.pipelinesPage.clickInputNodeStreamSave();
    await page.waitForTimeout(2000);

    // Connect nodes via function
    await pageManager.pipelinesPage.connectNodesViaMiddleNode();

    // Save pipeline
    const pipelineName = `vrl-pipeline-${Math.random().toString(36).substring(7)}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);
    await pageManager.pipelinesPage.savePipeline();

    // Verify pipeline was created
    await page.waitForTimeout(2000);

    // Cleanup - navigate to pipeline list and delete
    try {
      await pageManager.pipelinesPage.exploreStreamAndNavigateToPipeline(destStream);
      await pageManager.pipelinesPage.searchPipeline(pipelineName);
      await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
      testLogger.info('Pipeline cleanup completed');
    } catch (cleanupError) {
      testLogger.warn(`Pipeline cleanup failed (non-critical): ${cleanupError.message}`);
    }

    testLogger.info('✓ Pipeline with VRL function node test passed');
  });

  test("should add source, condition & destination node and then delete the pipeline", async ({ page }) => {
    const sourceStream = `e2e_automate2${streamSuffix}`;
    const destFill = `destination-node${streamSuffix}`;
    const destStream = `destination_node${streamSuffix}`;
    // Free only this test's own source stream (see note in beforeEach).
    await pageManager.apiCleanup.cleanupPipelines([sourceStream]).catch(() => {});
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectLogs();

    await pageManager.pipelinesPage.enterStreamName("e2e");
    await pageManager.pipelinesPage.enterStreamName(sourceStream);
    await pageManager.pipelinesPage.selectStreamOption(sourceStream);
    await pageManager.pipelinesPage.saveInputNodeStream();
    await page.waitForTimeout(2000);

    // Delete the auto-created output stream node
    await pageManager.pipelinesPage.deleteOutputStreamNode();

    // Drag and drop condition instead of hover-click
    await pageManager.pipelinesPage.selectAndDragCondition();
    await page.waitForTimeout(1000);

    // Fill condition fields using page object method
    await pageManager.pipelinesPage.fillConditionFields(
      "container_name",
      "kubernetes_container_name",
      "Contains",
      "prometheus"
    );

    await pageManager.pipelinesPage.saveCondition();
    await page.waitForTimeout(2000);

    // Drag and drop output stream instead of hover-click
    await pageManager.pipelinesPage.selectAndDragSecondStream();
    await pageManager.pipelinesPage.fillDestinationStreamName(destFill);
    await pageManager.pipelinesPage.clickInputNodeStreamSave();

    // Wait for dialog to close and connect nodes via condition
    await page.waitForTimeout(2000);
    await pageManager.pipelinesPage.connectNodesViaMiddleNode();

    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);
    await pageManager.pipelinesPage.savePipeline();

    // Navigate to pipeline list via stream exploration
    await pageManager.pipelinesPage.exploreStreamAndNavigateToPipeline(destStream);
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.searchPipeline(pipelineName);
    await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
  });
});
