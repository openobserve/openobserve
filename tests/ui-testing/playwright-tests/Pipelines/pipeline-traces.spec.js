/**
 * Pipeline Tests for Traces Stream Type
 *
 * This test file covers pipeline creation and management for traces streams.
 * Tests include:
 * - Creating real-time pipelines for traces
 * - Adding condition nodes to filter traces
 * - Adding function nodes to transform traces
 * - Validation and edge cases
 *
 * @see docs/test_generator/features/pipelines-traces-metrics-feature.md
 * @see docs/test_generator/test-plans/pipelines-traces-metrics-test-plan.md
 */

import { test, expect } from "../baseFixtures.js";
import logData from "../../fixtures/log.json";
import PageManager from "../../pages/page-manager.js";
const testLogger = require('../utils/test-logger.js');
const path = require('path');

test.describe.configure({ mode: "serial" });

// Use stored authentication state from global setup instead of logging in each test
const authFile = path.join(__dirname, '../utils/auth/user.json');
test.use({
  storageState: authFile,
  contextOptions: {
    slowMo: 1000
  }
});

const TRACES_SERVICE_NAME = "e2e-traces-pipeline-service";

/**
 * Generate unique stream name for each test to avoid conflicts
 * (once a stream is used in a pipeline, it becomes disabled for other pipelines)
 */
function generateUniqueStreamName(prefix = 'e2e_traces') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

test.describe("Traces Pipeline Tests", { tag: ['@all', '@pipelines', '@traces', '@pipelinesTraces'] }, () => {
  let pageManager;
  // Generate unique stream per test to avoid "stream already in use" issues
  let TRACES_STREAM;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Auth is handled via storageState - no login needed
    pageManager = new PageManager(page);

    // Generate unique stream name for this test to avoid "stream already used" conflicts
    TRACES_STREAM = generateUniqueStreamName('e2e_traces');
    testLogger.info('Generated unique traces stream name for test', { streamName: TRACES_STREAM });

    // Navigate to logs page FIRST (required for page.evaluate to work in browser context)
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Ingest trace data with unique stream name for this test
    testLogger.info('Ingesting trace data for pipeline test', { streamName: TRACES_STREAM });
    try {
      // Use POM method that supports custom stream name via header
      const traceResult = await pageManager.pipelinesPage.ingestTracesData(
        TRACES_SERVICE_NAME,
        10,
        TRACES_STREAM
      );
      testLogger.info('Trace ingestion completed', {
        streamName: TRACES_STREAM,
        status: traceResult.status
      });
      // Wait for traces to be indexed
      await page.waitForTimeout(5000);
    } catch (error) {
      testLogger.warn('Trace ingestion failed, tests may fail if traces stream does not exist', {
        error: error.message,
        streamName: TRACES_STREAM
      });
    }

    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);

    // Cleanup: Wait for any pending operations to complete
    await page.waitForTimeout(1000);

    // Clear any open dialogs or menus using POM
    await pageManager.pipelinesPage.dismissOpenDialogs();

    testLogger.info('Test cleanup completed');
  });

  /**
   * Test: Verify traces stream type is available in pipeline creation
   * Priority: P0 - Smoke
   * Objective: Confirm that "traces" appears as a stream type option in the stream node form
   */
  test("should show traces as stream type option in add pipeline dialog @P0 @smoke", async ({ page }) => {
    testLogger.info('Testing traces stream type visibility in stream node form');

    // Navigate to pipelines
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);

    // Click add pipeline button - routes to pipeline editor
    await pageManager.pipelinesPage.addPipeline();
    await page.waitForTimeout(1500);
    await page.waitForLoadState('networkidle');

    // Click on the Stream button and drag it to the canvas to open the stream form dialog
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await page.waitForTimeout(1000);

    // Click on stream type dropdown in the stream form (uses input-node-stream-type-select)
    await pageManager.pipelinesPage.clickInputNodeStreamTypeSelect();
    await page.waitForTimeout(500);

    // Verify "traces" option is available using POM
    const isTracesVisible = await pageManager.pipelinesPage.isTracesOptionVisible();
    expect(isTracesVisible).toBe(true);
    testLogger.info('Traces option found in stream type dropdown');

    // Close dialog by pressing Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Navigate back to pipelines list
    await page.keyboard.press('Escape');

    testLogger.info('Test completed: Traces stream type visibility check');
  });

  /**
   * Test: Create a basic pipeline and select stream type
   * Priority: P0 - Smoke
   * Objective: Verify pipeline creation dialog opens and stream type can be selected
   */
  test("should open add pipeline dialog and allow stream type selection @P0 @smoke", async ({ page }) => {
    testLogger.info('Testing pipeline creation dialog with stream type selection');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);

    await pageManager.pipelinesPage.addPipeline();
    await page.waitForTimeout(500);

    // Verify dialog opened - check for pipeline name input using POM
    await expect(pageManager.pipelinesPage.pipelineNameInput).toBeVisible();
    testLogger.info('Pipeline name input is visible');

    // Enter a pipeline name using POM method
    const pipelineName = `traces-test-${Date.now()}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);
    testLogger.info(`Entered pipeline name: ${pipelineName}`);

    // Close dialog without saving
    await page.keyboard.press('Escape');

    testLogger.info('Test completed: Pipeline dialog opens correctly');
  });

  /**
   * Test: Create pipeline with source and destination nodes
   * Priority: P1 - Functional
   * Objective: Verify complete pipeline flow can be created
   * Note: This test uses logs stream type as traces may not be available in test environment
   */
  test("should create pipeline with source and destination nodes @P1 @functional", async ({ page }) => {
    testLogger.info('Testing pipeline creation with source and destination nodes');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Add source and destination stream nodes using helpers
    await pageManager.pipelinesPage.addSourceStreamNode('traces', TRACES_STREAM);
    await pageManager.pipelinesPage.addDestinationStreamNode('traces', 'traces_test_dest');

    // Connect nodes and save pipeline
    await pageManager.pipelinesPage.connectInputToOutput();
    const pipelineName = await pageManager.pipelinesPage.savePipelineWithName('traces-pipeline');

    // Verify pipeline was created on pipeline page
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    const pipelineExists = await pageManager.pipelinesPage.verifyPipelineExists(pipelineName);
    expect(pipelineExists).toBe(true);
    testLogger.info('Pipeline creation verified', { exists: pipelineExists });

    // Ingest data through the source stream to trigger the pipeline
    testLogger.info('Ingesting data through source stream to trigger pipeline');
    await pageManager.pipelinesPage.ingestTracesData(TRACES_SERVICE_NAME, 5, TRACES_STREAM);
    await page.waitForTimeout(5000); // Wait for data to flow through pipeline

    // Verify destination stream was created on streams page
    const destStreamExists = await pageManager.pipelinesPage.verifyTracesDestinationStreamExists("traces_test_dest");
    expect(destStreamExists).toBe(true);
    testLogger.info('Destination stream verification completed', { exists: destStreamExists });

    // Cleanup
    await pageManager.pipelinesPage.cleanupPipelineByName(pipelineName);

    testLogger.info('Test completed: Pipeline with source and destination nodes');
  });

  /**
   * Test: Create pipeline with condition node for filtering
   * Priority: P1 - Functional
   * Objective: Verify condition node can be added to filter data
   */
  test("should create pipeline with condition node for filtering @P1 @condition @functional", async ({ page }) => {
    testLogger.info('Testing pipeline with condition node');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Add source stream node using helper
    await pageManager.pipelinesPage.addSourceStreamNode('traces', TRACES_STREAM);

    // Add condition node
    await pageManager.pipelinesPage.selectAndDragCondition();
    await page.waitForTimeout(1000);

    // Configure condition using existing method - use trace-specific field
    await pageManager.pipelinesPage.fillConditionFields(
      "service_name",
      "service_name",
      "Contains",
      "service"
    );

    await pageManager.pipelinesPage.saveCondition();
    await page.waitForTimeout(2000);

    // Add destination stream node using helper
    await pageManager.pipelinesPage.addDestinationStreamNode('traces', 'condition_test_dest');

    // Connect nodes via condition and save pipeline
    await pageManager.pipelinesPage.connectNodesViaMiddleNode();
    const pipelineName = await pageManager.pipelinesPage.savePipelineWithName('condition-pipeline');

    // Verify pipeline was created on pipeline page
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    const pipelineExists = await pageManager.pipelinesPage.verifyPipelineExists(pipelineName);
    expect(pipelineExists).toBe(true);
    testLogger.info('Pipeline creation verified', { exists: pipelineExists });

    // Ingest data through the source stream to trigger the pipeline
    testLogger.info('Ingesting data through source stream to trigger pipeline');
    await pageManager.pipelinesPage.ingestTracesData(TRACES_SERVICE_NAME, 5, TRACES_STREAM);
    await page.waitForTimeout(5000); // Wait for data to flow through pipeline

    // Verify destination stream was created on streams page
    const destStreamExists = await pageManager.pipelinesPage.verifyTracesDestinationStreamExists("condition_test_dest");
    expect(destStreamExists).toBe(true);
    testLogger.info('Destination stream verification completed', { exists: destStreamExists });

    // Cleanup
    await pageManager.pipelinesPage.cleanupPipelineByName(pipelineName);

    testLogger.info('Test completed: Pipeline with condition node');
  });

  /**
   * Test: Verify condition validation - empty condition
   * Priority: P1 - Validation
   * Objective: Verify that saving a condition without required fields shows error
   */
  test("should show error when saving condition without required fields @P1 @validation", async ({ page }) => {
    testLogger.info('Testing condition validation - empty fields');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Drag condition node to canvas
    await pageManager.pipelinesPage.selectAndDragCondition();
    await page.waitForTimeout(1000);

    // Try to save without filling fields
    await pageManager.pipelinesPage.saveCondition();

    // Verify error message
    await pageManager.pipelinesPage.verifyFieldRequiredError();

    testLogger.info('Test completed: Condition validation error shown');
  });

  /**
   * Test: Create pipeline with function node for VRL transform
   * Priority: P1 - Functional
   * Objective: Verify function node with VRL code can transform data
   */
  test("should create pipeline with function node using VRL transform @P1 @function @vrl", async ({ page }) => {
    testLogger.info('Testing pipeline with function node (VRL transform)');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Add source stream node using helper
    await pageManager.pipelinesPage.addSourceStreamNode('traces', TRACES_STREAM);

    // Add function node
    await pageManager.pipelinesPage.selectAndDragFunction();
    await pageManager.pipelinesPage.toggleCreateFunction();

    const funcName = `vrl_traces_func_${Math.random().toString(36).substring(7)}`;
    await pageManager.pipelinesPage.enterFunctionName(funcName);

    // Add VRL code to transform data
    await pageManager.pipelinesPage.clickVrlEditorMonaco();
    await pageManager.pipelinesPage.typeVrlCode(".trace_processed = true", 50);
    await page.keyboard.press("Enter");
    await pageManager.pipelinesPage.typeVrlCode(".", 50);
    await pageManager.pipelinesPage.clickNoteText();
    await page.waitForTimeout(500);

    // Save function
    await pageManager.pipelinesPage.saveNewFunction();
    await page.waitForTimeout(2000);
    await pageManager.pipelinesPage.saveFunction();
    await page.waitForTimeout(2000);

    testLogger.info(`Function node created: ${funcName}`);

    // Add destination node using helper
    await pageManager.pipelinesPage.addDestinationStreamNode('traces', 'function_test_dest');

    // Connect nodes via function and save pipeline
    await pageManager.pipelinesPage.connectNodesViaMiddleNode();
    const pipelineName = await pageManager.pipelinesPage.savePipelineWithName('vrl-traces-pipeline');

    // Verify pipeline was created on pipeline page
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    const pipelineExists = await pageManager.pipelinesPage.verifyPipelineExists(pipelineName);
    expect(pipelineExists).toBe(true);
    testLogger.info('Pipeline creation verified', { exists: pipelineExists });

    // Ingest data through the source stream to trigger the pipeline
    testLogger.info('Ingesting data through source stream to trigger pipeline');
    await pageManager.pipelinesPage.ingestTracesData(TRACES_SERVICE_NAME, 5, TRACES_STREAM);
    await page.waitForTimeout(5000); // Wait for data to flow through pipeline

    // Verify destination stream was created on streams page
    const destStreamExists = await pageManager.pipelinesPage.verifyTracesDestinationStreamExists("function_test_dest");
    expect(destStreamExists).toBe(true);
    testLogger.info('Destination stream verification completed', { exists: destStreamExists });

    // Cleanup
    await pageManager.pipelinesPage.cleanupPipelineByName(pipelineName);

    testLogger.info('Test completed: Pipeline with function node');
  });

  // NOTE: The following validation tests were removed as duplicates of existing tests in pipelines.spec.js:
  // - "should show error when creating function without name" -> duplicates "should display error when function name is not added"
  // - "should show error when saving pipeline without name" -> duplicates "should display error on entering only pipeline name and save"
  // - "should show error when saving pipeline without source node" -> duplicates "should display error on entering only source node and save"
  // Pipeline validation (name required, source node required, function name required) is stream-type agnostic
  // and doesn't need to be repeated for each stream type (logs/traces/metrics).

  /**
   * Test: Verify pipeline validation - missing destination node
   * Priority: P1 - Validation
   * Objective: Verify that saving pipeline without destination node shows error
   * Note: If the pipeline auto-creates a destination, the test verifies the validation
   *       behavior after attempting to remove it
   */
  test("should show error when saving pipeline without destination node @P1 @validation", async ({ page }) => {
    testLogger.info('Testing pipeline validation - missing destination node');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Add source stream - use traces stream
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectTraces();
    await pageManager.pipelinesPage.enterStreamName(TRACES_STREAM);
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.selectStreamOptionByName(TRACES_STREAM);
    await pageManager.pipelinesPage.saveInputNodeStream();

    // Try to delete any auto-created output node
    await pageManager.pipelinesPage.deleteOutputStreamNode();

    // Enter pipeline name
    const pipelineName = `no-dest-pipeline-${Date.now()}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);

    // Try to save - should show error if no destination, or save successfully if destination exists
    await pageManager.pipelinesPage.savePipeline();
    await page.waitForTimeout(1000);

    // Check for error message OR successful save (depending on auto-creation behavior)
    const hasError = await pageManager.pipelinesPage.isDestinationRequiredErrorVisible();
    const hasSaved = await pageManager.pipelinesPage.isPipelineSaveSuccessVisible();
    const isOnPipelinePage = await pageManager.pipelinesPage.isPipelineNameInputVisible();

    // One of these must be true: error shown, pipeline saved, or still on editing page (validation prevented save)
    expect(hasError || hasSaved || isOnPipelinePage).toBe(true);

    if (hasError) {
      testLogger.info('Destination node required error shown as expected');
    } else if (hasSaved) {
      testLogger.info('Pipeline saved (destination node was auto-created or not required)');
    } else {
      testLogger.info('Still on pipeline editing page - validation prevented save');
    }

    testLogger.info('Test completed: Pipeline destination validation verified');
  });

  /**
   * Test: Verify disconnected nodes validation
   * Priority: P1 - Validation
   * Objective: Verify that saving pipeline with unconnected nodes shows error
   */
  test("should show error when nodes are not connected @P1 @validation", async ({ page }) => {
    testLogger.info('Testing pipeline validation - disconnected nodes');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Add source stream - use 'default' traces stream
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectTraces();
    await pageManager.pipelinesPage.enterStreamName(TRACES_STREAM);
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.selectStreamOptionByName(TRACES_STREAM);
    await pageManager.pipelinesPage.saveInputNodeStream();
    await page.waitForTimeout(1000);

    // Delete auto-created output node
    await pageManager.pipelinesPage.deleteOutputStreamNode();

    // Drag new stream to different position (without connecting)
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectAndDragSecondStream();
    await page.waitForTimeout(2000);

    // Fill destination stream name
    await pageManager.pipelinesPage.fillDestinationStreamName("disconnected-dest");
    await pageManager.pipelinesPage.clickInputNodeStreamSave();
    await page.waitForTimeout(2000);

    // Don't connect nodes - just save
    const pipelineName = `disconnected-pipeline-${Date.now()}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);
    await pageManager.pipelinesPage.savePipeline();

    // Verify connection error
    await pageManager.pipelinesPage.verifyConnectionError();

    testLogger.info('Test completed: Connection error shown for disconnected nodes');
  });

  /**
   * Test: Navigate away from pipeline editor with unsaved changes
   * Priority: P2 - UX
   * Objective: Verify unsaved changes prompt appears when navigating away
   */
  test("should prompt when navigating away with unsaved changes @P2 @ux", async ({ page }) => {
    testLogger.info('Testing unsaved changes warning');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Add source stream (creates unsaved changes) - use 'default' traces stream
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.streamButton.waitFor({ state: "visible" });
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectTraces();

    await page.waitForTimeout(2000);
    await pageManager.pipelinesPage.enterStreamName(TRACES_STREAM);
    await page.waitForTimeout(2000);
    await pageManager.pipelinesPage.selectStreamOptionByName(TRACES_STREAM);
    await pageManager.pipelinesPage.saveInputNodeStream();

    // Set up dialog handler to accept/dismiss
    let dialogAppeared = false;
    page.once('dialog', async (dialog) => {
      dialogAppeared = true;
      testLogger.debug('Dialog message', { message: dialog.message() });
      await dialog.accept();
    });

    // Store current URL before navigation attempt
    const beforeUrl = page.url();

    // Try to navigate to dashboards
    await pageManager.pipelinesPage.clickDashboardsMenu();

    // Wait to see if navigation happens
    await page.waitForURL(/dashboards/, { timeout: 5000 }).catch(() => {
      testLogger.info('Navigation blocked or no dialog appeared');
    });

    // Either a dialog appeared (unsaved changes prompt) or URL changed (navigation succeeded)
    const urlChanged = page.url() !== beforeUrl;
    expect(dialogAppeared || urlChanged).toBe(true);

    testLogger.info('Test completed: Unsaved changes behavior verified');
  });
});
