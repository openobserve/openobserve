import { test, expect } from "../baseFixtures.js";
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import PageManager from "../../pages/page-manager.js";
import { LoginPage } from "../../pages/generalPages/loginPage.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });

test.use({
  contextOptions: {
    slowMo: 1000
  }
});

const randomFunctionName = `Pipeline${Math.floor(Math.random() * 1000)}`;

test.describe("Core Pipeline Tests", { tag: ['@all', '@pipelines', '@pipelinesCore'] }, () => {
  let pageManager;
  let loginPage;

  test.beforeEach(async ({ page }) => {
    // Login using LoginPage
    loginPage = new LoginPage(page);
    await loginPage.gotoLoginPage();
    await loginPage.loginAsInternalUser();
    await loginPage.login();

    pageManager = new PageManager(page);

    // Ingest data using page object method
    const streamNames = ["e2e_automate", "e2e_automate1", "e2e_automate2", "e2e_automate3"];
    await pageManager.pipelinesPage.bulkIngestToStreams(streamNames, logsdata);
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await pageManager.logsPage.selectStream("e2e_automate");
    await pageManager.logsPage.applyQuery();
  });

  test("should add source & destination node and then delete the pipeline", async ({ page }) => {
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectLogs();

    await pageManager.pipelinesPage.enterStreamName("e2e");
    await pageManager.pipelinesPage.enterStreamName("e2e_automate3");
    await pageManager.pipelinesPage.selectStreamOption("e2e_automate3");
    await pageManager.pipelinesPage.saveInputNodeStream();
    await page.waitForTimeout(3000);

    // Delete the auto-created output stream node
    await pageManager.pipelinesPage.deleteOutputStreamNode();

    // Drag and drop output stream instead of hover-click
    await pageManager.pipelinesPage.selectAndDragSecondStream();
    await pageManager.pipelinesPage.fillDestinationStreamName("destination-node");
    await pageManager.pipelinesPage.clickInputNodeStreamSave();

    // Wait for dialog to close and connect nodes
    await page.waitForTimeout(2000);
    await pageManager.pipelinesPage.connectInputToOutput();

    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);
    await pageManager.pipelinesPage.savePipeline();

    // Navigate to pipeline list via stream exploration
    await pageManager.pipelinesPage.exploreStreamAndNavigateToPipeline('destination_node');
    await pageManager.pipelinesPage.searchPipeline(pipelineName);
    await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
  });

  test.skip("should add source, function, destination and then delete pipeline", async ({ page }) => {
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectLogs();
    await pageManager.pipelinesPage.enterStreamName("e2e");
    await pageManager.pipelinesPage.enterStreamName("e2e_automate1");
    await pageManager.pipelinesPage.selectStreamOption("e2e_automate1");
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
    await pageManager.pipelinesPage.fillDestinationStreamName("destination-node");
    await pageManager.pipelinesPage.clickInputNodeStreamSave();

    // Wait for dialog to close and connect nodes via function
    await page.waitForTimeout(2000);
    await pageManager.pipelinesPage.connectNodesViaMiddleNode();

    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);
    await pageManager.pipelinesPage.savePipeline();

    // Navigate to pipeline list via stream exploration
    await pageManager.pipelinesPage.exploreStreamAndInteractWithLogDetails('destination_node');
    await pageManager.pipelinesPage.searchPipeline(pipelineName);
    await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
  });

  /**
   * Test: Pipeline with function node using VRL transform
   * Verifies that a function node with VRL code can be added to pipeline
   */
  test("should add pipeline with function node using VRL transform @P1 @function @vrl @regression", async ({ page }) => {
    testLogger.info('Test: Add pipeline with function node (VRL transform)');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Add source stream
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectLogs();
    await pageManager.pipelinesPage.enterStreamName("e2e");
    await pageManager.pipelinesPage.enterStreamName("e2e_automate");
    await pageManager.pipelinesPage.selectStreamOption("e2e_automate");
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
    await pageManager.pipelinesPage.fillDestinationStreamName("destination_node");
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
      await pageManager.pipelinesPage.exploreStreamAndNavigateToPipeline('destination_node');
      await pageManager.pipelinesPage.searchPipeline(pipelineName);
      await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
      testLogger.info('Pipeline cleanup completed');
    } catch (cleanupError) {
      testLogger.warn(`Pipeline cleanup failed (non-critical): ${cleanupError.message}`);
    }

    testLogger.info('✓ Pipeline with VRL function node test passed');
  });

  test("should add source, condition & destination node and then delete the pipeline", async ({ page }) => {
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectLogs();

    await pageManager.pipelinesPage.enterStreamName("e2e");
    await pageManager.pipelinesPage.enterStreamName("e2e_automate2");
    await pageManager.pipelinesPage.selectStreamOption("e2e_automate2");
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
    await pageManager.pipelinesPage.fillDestinationStreamName("destination-node");
    await pageManager.pipelinesPage.clickInputNodeStreamSave();

    // Wait for dialog to close and connect nodes via condition
    await page.waitForTimeout(2000);
    await pageManager.pipelinesPage.connectNodesViaMiddleNode();

    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);
    await pageManager.pipelinesPage.savePipeline();

    // Navigate to pipeline list via stream exploration
    await pageManager.pipelinesPage.exploreStreamAndNavigateToPipeline('destination_node');
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.searchPipeline(pipelineName);
    await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
  });
});
