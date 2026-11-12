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
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
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
        await pageManager.apiCleanup.cleanupPipelines([], [], [new RegExp(`^${currentPipelineName}$`)]).catch(() => {});
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

    // Test 1: Verify the first line reads "Where"
    await pageManager.pipelinesPage.verifyFirstConditionLabel("Where");

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
    await pageManager.pipelinesPage.verifyOperatorLabel("OR", 0);

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
  test("should validate fields and show proper error messages", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesValidation', '@pipelinesErrorMessages']
  }, async ({ page }) => {
    await pageManager.pipelinesPage.createPipelineWithCondition(`e2e_conditions_validation${streamSuffix}`);

    // Test 1: Verify guidelines are displayed (the null/empty value hints are
    // gone — dedicated is_null/is_empty operators replaced them)
    await pageManager.pipelinesPage.verifyNoteContainer();
    const noteInfo = pageManager.pipelinesPage.noteInfo;
    await expect(noteInfo).toContainText("custom column");
    await expect(noteInfo).toContainText("If conditions are not met");

    // Test 2: Try to save without any valid conditions
    await pageManager.pipelinesPage.tryToSaveWithoutValidConditions();

    // Should show error notification
    await pageManager.pipelinesPage.verifyNotificationVisible();

    // Test 3: Fill partial condition (missing value)
    await pageManager.pipelinesPage.fillPartialCondition("kubernetes_container_name");
    await pageManager.pipelinesPage.selectOperatorFromMenu("=");

    // Test 4: Test cancel with unsaved changes
    await pageManager.pipelinesPage.fillFirstConditionValue("test-value");
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

    // Condition B, then switch its join to OR
    await pageManager.pipelinesPage.addNewCondition();
    await pageManager.pipelinesPage.fillCondition("kubernetes_host", "=", "value-B", 1);
    await pageManager.pipelinesPage.toggleConditionOperator(0);
    await page.waitForTimeout(300);

    // Guard: the OR toggle took effect on condition B's join before we rely on
    // the A OR B combination below.
    await pageManager.pipelinesPage.verifyOperatorLabel("OR", 0);

    // Condition C with AND (default)
    await pageManager.pipelinesPage.addNewCondition();
    await pageManager.pipelinesPage.fillCondition("kubernetes_pod_name", "=", "value-C", 2);

    // Verify 3 conditions exist
    await pageManager.pipelinesPage.verifyConditionCount(3);

    // Verify BOTH join operators unconditionally: A OR B AND C. The first join
    // (B) is OR, the second (C) is AND — no `count() >= 2` guard, both must hold.
    await pageManager.pipelinesPage.verifyOperatorLabel("OR", 0);
    await pageManager.pipelinesPage.verifyOperatorLabel("AND", 1);

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

    // Add Contains operator condition
    await pageManager.pipelinesPage.addNewCondition();
    await pageManager.pipelinesPage.fillCondition("kubernetes_pod_name", "Contains", "include", 2);

    // Add NotContains operator condition
    await pageManager.pipelinesPage.addNewCondition();
    await pageManager.pipelinesPage.fillCondition("kubernetes_namespace_name", "NotContains", "ignore", 3);

    // Verify all 4 conditions exist
    await pageManager.pipelinesPage.verifyConditionCount(4);

    // Assert each row's operator actually took effect — the count alone would
    // let a wrong/failed operator selection pass.
    await pageManager.pipelinesPage.verifyOperatorSelected(">=", 0);
    await pageManager.pipelinesPage.verifyOperatorSelected("!=", 1);
    await pageManager.pipelinesPage.verifyOperatorSelected("Contains", 2);
    await pageManager.pipelinesPage.verifyOperatorSelected("NotContains", 3);

    await pageManager.pipelinesPage.saveConditionAndCompletePipeline(pipelineName);

    // Note: Data already ingested in beforeEach - no need for redundant ingestion here

    await pageManager.pipelinesPage.openPipelineMenu();
    await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
  });

  test("should hide the value input for a unary is_null operator and save without error", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@condition-null-empty-operators']
  }, async ({ page }) => {
    await pageManager.pipelinesPage.createPipelineWithCondition(`e2e_conditions_operators${streamSuffix}`);
    await pageManager.pipelinesPage.verifyConditionDialogOpen();

    // Select column + unary operator (no value input for unary operators).
    await pageManager.pipelinesPage.fillUnaryCondition("kubernetes_container_name", "is_null", 0);

    // A unary chip carries no value part.
    await pageManager.pipelinesPage.verifyValueInputCount(0);

    // Saving a unary condition is complete without a value: no inline error and
    // the drawer closes (the condition node appears on the canvas).
    await pageManager.pipelinesPage.saveCondition();
    await pageManager.pipelinesPage.verifyNoConditionError();
    await pageManager.pipelinesPage.verifyConditionDialogClosed();
  });

  test("should round-trip a saved unary operator on edit and restore the value input for a binary operator", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@condition-null-empty-operators']
  }, async ({ page }) => {
    const pipelineName = `pipeline-null-empty-roundtrip-${Math.random().toString(36).substring(7)}`;
    currentPipelineName = pipelineName;

    await pageManager.pipelinesPage.createPipelineWithCondition(`e2e_conditions_operators${streamSuffix}`);
    await pageManager.pipelinesPage.fillUnaryCondition("kubernetes_container_name", "is_null", 0);
    await pageManager.pipelinesPage.verifyValueInputCount(0);
    await pageManager.pipelinesPage.saveConditionAndCompletePipeline(pipelineName);

    // Reopen the saved pipeline and edit its condition node.
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.openPipelineForEdit(pipelineName);
    await pageManager.pipelinesPage.clickConditionNode();
    await pageManager.pipelinesPage.verifyConditionDialogOpen();

    // The unary operator round-trips and the value input stays hidden on load.
    await pageManager.pipelinesPage.verifyOperatorSelected("is_null", 0);
    await pageManager.pipelinesPage.verifyValueInputCount(0);

    // Switching to a binary operator asks for a value, and the chip shows it once given.
    await pageManager.pipelinesPage.selectOperatorFromMenu("=");
    await pageManager.pipelinesPage.fillFirstConditionValue("restored");
    await pageManager.pipelinesPage.verifyValueInputCount(1);
    await pageManager.pipelinesPage.verifyConditionValueInputValue("restored", 0);

    // Cleanup
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.deletePipelineByName(pipelineName);
  });

  test("should offer all four unary operators in the condition operator dropdown", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@condition-null-empty-operators']
  }, async ({ page }) => {
    await pageManager.pipelinesPage.createPipelineWithCondition(`e2e_conditions_operators${streamSuffix}`);
    await pageManager.pipelinesPage.verifyConditionDialogOpen();

    // Select a column so the operator menu is in its interactive state.
    await pageManager.pipelinesPage.fillPartialCondition("kubernetes_container_name");

    // All four unary operators are offered.
    await pageManager.pipelinesPage.verifyUnaryOperatorsOffered();
  });

  test("should still require a value for a binary operator after unary operators are added", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@pipelinesValidation', '@condition-null-empty-operators']
  }, async ({ page }) => {
    await pageManager.pipelinesPage.createPipelineWithCondition(`e2e_conditions_operators${streamSuffix}`);
    await pageManager.pipelinesPage.fillPartialCondition("kubernetes_container_name");
    await pageManager.pipelinesPage.selectOperatorFromMenu("=");

    // Guard: the half-built condition carries the binary operator before asserting its error.
    await pageManager.pipelinesPage.verifyDraftOperator("=");

    // A binary operator still requires a value: saving with an empty value
    // surfaces the inline schema error (unary exemption did not weaken this).
    await pageManager.pipelinesPage.tryToSaveWithoutValidConditions();
    await pageManager.pipelinesPage.verifyNotificationVisible();
  });

  test("should clear a previously entered value when switching to a unary operator", {
    tag: ['@all', '@pipelines', '@pipelinesConditions', '@condition-null-empty-operators']
  }, async ({ page }) => {
    await pageManager.pipelinesPage.createPipelineWithCondition(`e2e_conditions_operators${streamSuffix}`);

    // Enter a binary condition with a stale value.
    await pageManager.pipelinesPage.fillCondition("kubernetes_container_name", "=", "stale-value", 0);

    // Switching to a unary operator drops the stale value and its chip part.
    await pageManager.pipelinesPage.selectOperatorFromMenu("is_null");
    await pageManager.pipelinesPage.verifyValueInputCount(0);

    // Switching back to a binary operator asks for a value with an empty box —
    // proving the stale value did not leak back in.
    await pageManager.pipelinesPage.selectOperatorFromMenu("=");
    await pageManager.pipelinesPage.verifyValuePromptEmpty();
  });
});
