const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const logsdata = require("../../../test-data/logs_data.json");

test.describe.configure({ mode: "parallel" });

test.use({
  contextOptions: {
    slowMo: 1000
  }
});

// Generate a unique run ID at the start of test execution (shared across all workers)
// This ensures stream names are unique across test runs, not just within a run
const testRunId = Date.now().toString(36).slice(-4);

test.describe("Pipeline Conditions - Comprehensive Tests", () => {
  let pageManager;

  // Variables for lightweight cleanup
  let currentPipelineName;
  // Worker-specific stream suffix to avoid conflicts in parallel execution
  let streamSuffix;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Generate worker-specific stream suffix using parallelIndex AND testRunId
    // This avoids conflicts both within a test run (parallelIndex) and across test runs (testRunId)
    streamSuffix = `_${testRunId}_w${testInfo.parallelIndex}`;

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pageManager = new PageManager(page);

    // Post-authentication stabilization wait
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Ingest data to worker-specific unique streams to avoid conflicts in parallel execution
    // Use only first 10 records to avoid timeout (full dataset has 3800+ records)
    const streamNames = [
      `e2e_conditions_basic${streamSuffix}`,
      `e2e_conditions_groups${streamSuffix}`,
      `e2e_conditions_validation${streamSuffix}`,
      `e2e_conditions_precedence${streamSuffix}`,
      `e2e_conditions_multiple${streamSuffix}`,
      `e2e_conditions_delete${streamSuffix}`,
      `e2e_conditions_operators${streamSuffix}`
    ];

    for (const streamName of streamNames) {
      await pageManager.logsPage.ingestData(streamName, logsdata.slice(0, 10));
    }

    // Brief wait for stream schemas to be established
    await page.waitForTimeout(3000);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await page.waitForTimeout(2000);
  });

  test.afterEach(async ({ page }) => {
    // Lightweight pipeline cleanup
    try {
      if (currentPipelineName) {
        await pageManager.apiCleanup.deletePipeline(currentPipelineName).catch(() => {});
        testLogger.info('Cleaned up pipeline', { currentPipelineName });
      }
    } catch (error) {
      testLogger.warn('Cleanup failed', { error: error.message });
    }

    // Reset variables
    currentPipelineName = null;
  });

  test("should create, edit, and test basic condition operations with multiple operators", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesBasicOperations', '@pipelinesMultipleOperators']
  }, async ({ page }) => {
    const pipelineName = `pipeline-basic-ops-${Math.random().toString(36).substring(7)}`;
    currentPipelineName = pipelineName;

    // Create pipeline with condition (using worker-specific stream name)
    await pageManager.pipelinesPage.createPipelineWithCondition(`e2e_conditions_basic${streamSuffix}`);

    // Verify condition dialog is open
    await pageManager.pipelinesPage.verifyConditionDialogOpen();

    // Test 1: Verify first condition shows "if" label
    await pageManager.pipelinesPage.verifyFirstConditionLabel("if");

    // Test 2: Fill first condition with "Contains" operator
    await pageManager.pipelinesPage.fillCondition("kubernetes_container_name", "Contains", "prometheus", 0);
    await pageManager.pipelinesPage.verifyConditionValueInputValue("prometheus", 0);

    // Test 3: Add second condition with "=" operator
    await pageManager.pipelinesPage.addNewCondition();
    await pageManager.pipelinesPage.fillCondition("kubernetes_host", "=", "test-host", 1);

    // Test 4: Verify both conditions exist
    await pageManager.pipelinesPage.verifyConditionCount(2);

    // Test 5: Toggle second condition to OR operator
    await pageManager.pipelinesPage.toggleConditionOperator(0);
    await page.waitForTimeout(500);

    // Test 6: Add third condition and test other operators
    await pageManager.pipelinesPage.addNewCondition();
    await pageManager.pipelinesPage.fillCondition("kubernetes_pod_name", "!=", "excluded-pod", 2);
    await pageManager.pipelinesPage.verifyConditionCount(3);

    // Test 7: Delete second condition (not first, not last)
    await pageManager.pipelinesPage.deleteConditionByIndex(1);
    await page.waitForTimeout(500);
    await pageManager.pipelinesPage.verifyConditionCount(2);

    // Test 8: Verify all conditions including first can be deleted (after fix for issue #9518)
    await pageManager.pipelinesPage.verifyDeleteButtonCount(2);

    // Save and complete pipeline
    await pageManager.pipelinesPage.saveConditionAndCompletePipeline(pipelineName);

    // Note: Data already ingested in beforeEach - no need for redundant ingestion here

    // Test 9: Edit existing condition
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.openPipelineForEdit(pipelineName);
    await pageManager.pipelinesPage.clickConditionNode();
    await pageManager.pipelinesPage.verifyConditionDialogOpen();

    // Verify existing value and modify
    await pageManager.pipelinesPage.verifyConditionValueInputValue("prometheus", 0);
    await pageManager.pipelinesPage.clearAndFillConditionValue("modified-value", 0);

    await pageManager.pipelinesPage.saveCondition();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.savePipeline();

    // Wait for save to complete and UI to stabilize
    await page.waitForTimeout(2000);

    // Cleanup
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
  });

  test("should handle condition groups, nesting, and reordering", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesNesting', '@pipelinesReordering']
  }, async ({ page }) => {
    await pageManager.pipelinesPage.createPipelineWithCondition(`e2e_conditions_groups${streamSuffix}`);

    // Test 1: Add first condition
    await pageManager.pipelinesPage.fillCondition("kubernetes_container_name", "=", "test-A", 0);

    // Test 2: Add nested condition group
    await pageManager.pipelinesPage.addConditionGroup();
    await page.waitForTimeout(500);

    // Verify nested group exists
    await pageManager.pipelinesPage.verifyNestedGroupsExist();

    // Test 3: Add conditions in nested group
    const addConditionButtons = pageManager.pipelinesPage.addConditionButton;
    const buttonCount = await addConditionButtons.count();
    expect(buttonCount).toBeGreaterThan(1);

    // Fill the first condition in nested group
    await pageManager.pipelinesPage.fillCondition("kubernetes_namespace_name", "=", "test-B", 1);

    // Add another condition in nested group
    await addConditionButtons.nth(1).click();
    await page.waitForTimeout(500);

    // Fill the second condition in nested group
    await pageManager.pipelinesPage.fillCondition("kubernetes_pod_name", "=", "test-C", 2);

    // Test 4: Verify group-level tabs exist for nested group
    await pageManager.pipelinesPage.verifyScheduledAlertTabsVisible();

    // Test 5: Test reorder button with actual reordering validation
    const reorderButtons = pageManager.pipelinesPage.reorderBtn;
    const reorderButtonCount = await reorderButtons.count();
    expect(reorderButtonCount).toBeGreaterThan(1);

    // Capture order of condition values before reorder
    const beforeValues = await pageManager.pipelinesPage.captureConditionValues();
    testLogger.info('Condition values before reorder:', { beforeValues });

    // Take screenshot before reorder
    const beforeScreenshot = await pageManager.pipelinesPage.captureConditionScreenshot();

    // Click reorder button at nested level
    await pageManager.pipelinesPage.clickReorderButton(1);

    // Capture order of condition values after reorder
    const afterValues = await pageManager.pipelinesPage.captureConditionValues();
    testLogger.info('Condition values after reorder:', { afterValues });

    // Take screenshot after reorder
    const afterScreenshot = await pageManager.pipelinesPage.captureConditionScreenshot();

    // Verify screenshots were captured
    expect(beforeScreenshot.length).toBeGreaterThan(0);
    expect(afterScreenshot.length).toBeGreaterThan(0);

    // Verify that the order has changed (arrays should not be equal)
    expect(beforeValues.length).toBe(afterValues.length);
    expect(beforeValues).not.toEqual(afterValues);

    // Verify reorder button is still visible after click
    await expect(reorderButtons.nth(1)).toBeVisible();

    // Cancel without saving
    await pageManager.pipelinesPage.cancelConditionDialog();
    await pageManager.pipelinesPage.verifyConfirmationDialog();
  });

  test("should validate fields and show proper error messages", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesValidation', '@pipelinesErrorMessages']
  }, async ({ page }) => {
    await pageManager.pipelinesPage.createPipelineWithCondition(`e2e_conditions_validation${streamSuffix}`);

    // Test 1: Verify guidelines are displayed
    await pageManager.pipelinesPage.verifyNoteContainer();
    const noteInfo = pageManager.pipelinesPage.noteInfo;
    await expect(noteInfo).toContainText('""');
    await expect(noteInfo).toContainText('null');

    // Test 2: Try to save without any valid conditions
    await pageManager.pipelinesPage.tryToSaveWithoutValidConditions();

    // Should show error notification
    await pageManager.pipelinesPage.verifyNotificationVisible();

    // Test 3: Fill partial condition (missing value)
    await pageManager.pipelinesPage.fillPartialCondition("kubernetes");
    await pageManager.pipelinesPage.selectOperatorFromMenu("=");

    // Try to save without value
    await pageManager.pipelinesPage.tryToSaveWithoutValidConditions();

    // Test 4: Test cancel with unsaved changes
    await pageManager.pipelinesPage.valueInput.first().locator('input').fill("test-value");
    await pageManager.pipelinesPage.addNewCondition();
    await page.waitForTimeout(500);

    await pageManager.pipelinesPage.cancelConditionDialog();
    await page.waitForTimeout(500);

    // Should show confirmation dialog
    await pageManager.pipelinesPage.verifyConfirmationDialog();
  });

  test("should test complex conditions and operator precedence (A OR B AND C)", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesOperatorPrecedence', '@pipelinesComplexConditions']
  }, async ({ page }) => {
    const pipelineName = `pipeline-complex-${Math.random().toString(36).substring(7)}`;
    currentPipelineName = pipelineName;

    await pageManager.pipelinesPage.createPipelineWithCondition(`e2e_conditions_precedence${streamSuffix}`);

    // Create: A OR B AND C (tests operator precedence)
    // Condition A
    await pageManager.pipelinesPage.fillCondition("kubernetes_container_name", "=", "value-A", 0);

    // Condition B with OR
    await pageManager.pipelinesPage.addNewCondition();
    await pageManager.pipelinesPage.toggleConditionOperator(0);
    await page.waitForTimeout(300);
    await pageManager.pipelinesPage.fillCondition("kubernetes_host", "=", "value-B", 1);

    // Condition C with AND (default)
    await pageManager.pipelinesPage.addNewCondition();
    await pageManager.pipelinesPage.fillCondition("kubernetes_pod_name", "=", "value-C", 2);

    // Verify 3 conditions exist
    await pageManager.pipelinesPage.verifyConditionCount(3);

    // Verify operators are set correctly
    const operatorLabels = pageManager.pipelinesPage.operatorLabels;
    if (await operatorLabels.count() >= 2) {
      await pageManager.pipelinesPage.verifyOperatorLabel("OR", 0);
    }

    await pageManager.pipelinesPage.saveConditionAndCompletePipeline(pipelineName);

    // Note: Data already ingested in beforeEach - no need for redundant ingestion here

    await pageManager.pipelinesPage.openPipelineMenu();
    await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
  });

  test("should test multiple conditions: A, B, C, and D", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesMultipleConditions']
  }, async ({ page }) => {
    const pipelineName = `pipeline-multiple-${Math.random().toString(36).substring(7)}`;
    currentPipelineName = pipelineName;

    await pageManager.pipelinesPage.createPipelineWithCondition(`e2e_conditions_multiple${streamSuffix}`);

    // Wait for condition dialog to be fully loaded
    await pageManager.pipelinesPage.verifyConditionDialogOpen();
    await page.waitForTimeout(1000);

    // Condition A at root level
    await pageManager.pipelinesPage.fillCondition("kubernetes_container_name", "=", "value-A", 0);

    // Add condition B
    await pageManager.pipelinesPage.addNewCondition();
    await page.waitForTimeout(500);
    await pageManager.pipelinesPage.fillCondition("kubernetes_host", "=", "value-B", 1);

    // Add condition C
    await pageManager.pipelinesPage.addNewCondition();
    await page.waitForTimeout(500);
    await pageManager.pipelinesPage.fillCondition("kubernetes_pod_name", "=", "value-C", 2);

    // Add condition D
    await pageManager.pipelinesPage.addNewCondition();
    await page.waitForTimeout(500);
    await pageManager.pipelinesPage.fillCondition("kubernetes_namespace_name", "=", "value-D", 3);

    // Verify all 4 conditions exist
    await pageManager.pipelinesPage.verifyConditionCount(4);

    await pageManager.pipelinesPage.saveConditionAndCompletePipeline(pipelineName);

    // Note: Data already ingested in beforeEach - no need for redundant ingestion here

    await pageManager.pipelinesPage.openPipelineMenu();
    await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
  });

  test("should delete condition node from pipeline", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesDeleteNode']
  }, async ({ page }) => {
    const pipelineName = `pipeline-delete-${Math.random().toString(36).substring(7)}`;
    currentPipelineName = pipelineName;

    // Create pipeline with condition (using worker-specific stream name)
    await pageManager.pipelinesPage.createPipelineWithCondition(`e2e_conditions_delete${streamSuffix}`);
    await pageManager.pipelinesPage.fillCondition("kubernetes_container_name", "=", "test", 0);
    await pageManager.pipelinesPage.saveConditionAndCompletePipeline(pipelineName);

    // Open pipeline in edit mode
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.openPipelineForEdit(pipelineName);

    // Click on condition node to open
    await pageManager.pipelinesPage.clickConditionNode();

    // Verify delete button exists and click it
    await pageManager.pipelinesPage.clickDeleteConditionNode();

    // Verify dialog closed
    await pageManager.pipelinesPage.verifyConditionDialogClosed();

    // After deleting condition node, reconnect source to destination
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.reconnectSourceToDestination();

    // Save the updated pipeline
    await pageManager.pipelinesPage.savePipeline();
    await page.waitForTimeout(3000);

    // Cleanup
    await pageManager.pipelinesPage.openPipelineMenu();
    await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
  });

  test("should test different comparison operators (>=, !=, Contains, NotContains)", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesComparisonOperators']
  }, async ({ page }) => {
    const pipelineName = `pipeline-operators-${Math.random().toString(36).substring(7)}`;
    currentPipelineName = pipelineName;

    await pageManager.pipelinesPage.createPipelineWithCondition(`e2e_conditions_operators${streamSuffix}`);

    // Test >= operator
    await pageManager.pipelinesPage.fillCondition("kubernetes_container_name", ">=", "100", 0);

    // Add != operator condition
    await pageManager.pipelinesPage.addNewCondition();
    await pageManager.pipelinesPage.fillCondition("kubernetes_host", "!=", "excluded", 1);

    // Add NotContains operator condition
    await pageManager.pipelinesPage.addNewCondition();
    await pageManager.pipelinesPage.fillCondition("kubernetes_pod_name", "NotContains", "ignore", 2);

    // Verify all 3 conditions exist
    await pageManager.pipelinesPage.verifyConditionCount(3);

    await pageManager.pipelinesPage.saveConditionAndCompletePipeline(pipelineName);

    // Note: Data already ingested in beforeEach - no need for redundant ingestion here

    await pageManager.pipelinesPage.openPipelineMenu();
    await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
  });
});
