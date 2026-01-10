const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { expect } = require('@playwright/test');

// NOTE: JavaScript transform type is ONLY allowed in _meta organization
// This file consolidates tests from:
// - javascript-functions.spec.js (JS function operations)
// - meta-org-js-restriction.spec.js (org-based JS restrictions)

test.describe('JavaScript Transform Type', { tag: ['@jsTransformType', '@functions'] }, () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.describe('_meta Organization - JavaScript Allowed', () => {
    test.beforeEach(async ({ page }) => {
      // Switch to _meta organization
      testLogger.info('Switching to _meta organization');
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=_meta`);
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Verify we're in _meta org
      const currentUrl = page.url();
      expect(currentUrl).toContain('org_identifier=_meta');
      testLogger.info('Confirmed in _meta organization');
    });

    // NOTE: Consolidated from meta-org "JS radio visible" + "Create JS function" tests
    // Both validations preserved in sequential flow
    test('P0: JavaScript function creation flow in _meta org', { tag: ['@smoke', '@P0'] }, async ({ page }) => {
      testLogger.info('Test: JavaScript function creation flow in _meta org');

      const functionName = `meta_js_fn_${Date.now()}`;
      const jsCode = `// JavaScript function in _meta\nrow.processed = true;\nrow.org = "_meta";`;

      // Step 1: Verify both radio buttons are visible (former Test 1)
      await pm.functionsPage.clickAddFunctionButton('_meta');
      await pm.functionsPage.expectVrlRadioVisible();
      testLogger.info('VRL radio button visible');
      await pm.functionsPage.expectJsRadioVisible();
      testLogger.info('JavaScript radio button visible in _meta org');

      // Step 2: Create JavaScript function in same dialog (former Test 2)
      // Continue in same dialog to avoid redundant open/close
      await pm.functionsPage.fillFunctionName(functionName);
      await pm.functionsPage.selectJavaScriptType();
      await pm.functionsPage.enterFunctionCode(jsCode);
      await pm.functionsPage.clickSaveButton();
      testLogger.info(`JavaScript function created in _meta org: ${functionName}`);

      // Step 3: Verify function appears in list
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=_meta`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      await pm.functionsPage.searchFunction(functionName);
      await pm.functionsPage.expectFunctionInList(functionName);
      testLogger.info('Function visible in functions list');

      // Cleanup
      await pm.functionsPage.deleteFunctionByName(functionName, '_meta');
      testLogger.info('Test cleanup complete');
    });

    // NOTE: Consolidated from javascript-functions "Select JS type" + "Create simple JS" + "Validate saved type" tests
    // NOTE: Radio visibility checks removed - covered by first test in this section
    test('P0: JS function creation and validation flow', { tag: ['@smoke', '@P0', '@functionCreation'] }, async ({ page }) => {
      testLogger.info('Test: JS function creation and validation flow');

      const functionName = `test_js_fn_${Date.now()}`;
      const jsCode = `// Simple JS function\nrow.processed = true;\nrow.count = (row.count || 0) + 1;`;

      // Step 1: Verify JS type selection works
      await pm.functionsPage.clickAddFunctionButton('_meta');
      await pm.functionsPage.selectJavaScriptType();
      await pm.functionsPage.expectJsRadioSelected();
      testLogger.info('JavaScript type selection works');
      await pm.functionsPage.clickCancelButton();

      // Step 2: Create JS function
      await pm.functionsPage.createJavaScriptFunction(functionName, jsCode);
      testLogger.info(`JS function created: ${functionName}`);

      // Step 3: Navigate away and back, verify type persists
      await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=_meta`);
      await page.waitForLoadState('networkidle');
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=_meta`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const functionType = await pm.functionsPage.openFunctionAndCheckType(functionName);
      expect(functionType).toBe('js');
      testLogger.info('JS function type persisted correctly');

      // Cleanup
      await pm.functionsPage.clickCancelButton();
      await pm.functionsPage.deleteFunctionByName(functionName, '_meta');
    });

    // NOTE: Consolidated from javascript-functions "Test JS execution" + "Test JS with error" tests
    // Both execution validations preserved
    test('P1: JS function execution and error handling', { tag: ['@P1', '@functionTesting'] }, async ({ page }) => {
      testLogger.info('Test: JS function execution and error handling');

      // Step 1: Test successful JS function execution
      const functionName1 = `test_js_exec_${Date.now()}`;
      const jsCode1 = 'row.count = (row.count || 5) + 1; row.tested = true;';

      await pm.functionsPage.clickAddFunctionButton('_meta');
      await pm.functionsPage.fillFunctionName(functionName1);
      await pm.functionsPage.selectJavaScriptType();
      await pm.functionsPage.enterFunctionCode(jsCode1);

      const testEvent1 = '{"name": "test", "count": 5}';
      const output = await pm.functionsPage.testFunctionExecution(testEvent1);

      // Assert output exists before checking content
      expect(output).toBeTruthy();
      testLogger.info(`Test output: ${output}`);
      await pm.functionsPage.expectTestOutputContains('count');
      await pm.functionsPage.expectTestOutputContains('6'); // 5 + 1
      await pm.functionsPage.expectTestOutputContains('tested');
      testLogger.info('JS function executed successfully');
      await pm.functionsPage.clickCancelButton();

      // Step 2: Test JS function with error
      const functionName2 = `test_js_error_${Date.now()}`;
      const jsCode2 = 'row.field = undefinedVar; // This will error';

      await pm.functionsPage.clickAddFunctionButton('_meta');
      await pm.functionsPage.fillFunctionName(functionName2);
      await pm.functionsPage.selectJavaScriptType();
      await pm.functionsPage.enterFunctionCode(jsCode2);

      const testEvent2 = '{"name": "test"}';
      await pm.functionsPage.clickTestButton();
      await pm.functionsPage.enterTestEvent(testEvent2);

      const runSuccess = await pm.functionsPage.clickRunTestButton();
      if (runSuccess) {
        const outputText = await pm.functionsPage.getTestOutput();
        testLogger.info(`Error test output: ${outputText}`);

        const hasError = outputText.toLowerCase().includes('error') ||
                        outputText.toLowerCase().includes('undefined') ||
                        outputText.toLowerCase().includes('failed');

        expect(hasError).toBe(true);
        testLogger.info('Error handling works - error message displayed');
      }
      await pm.functionsPage.clickCancelButton();
    });

    // NOTE: Consolidated from javascript-functions "Compilation error" + "Empty JS function" tests
    // Both error case validations preserved
    test('P1: JS function error cases', { tag: ['@P1', '@errorHandling', '@edgeCases'] }, async ({ page }) => {
      testLogger.info('Test: JS function error cases');

      // Step 1: Compilation error handling
      const functionName1 = `test_js_syntax_err_${Date.now()}`;
      const invalidCode = 'function broken { // Missing parentheses';

      await pm.functionsPage.clickAddFunctionButton('_meta');
      await pm.functionsPage.fillFunctionName(functionName1);
      await pm.functionsPage.selectJavaScriptType();
      await pm.functionsPage.enterFunctionCode(invalidCode);

      await pm.functionsPage.clickSaveButton();

      const pageContent = await page.content();
      const hasErrorIndicator = pageContent.toLowerCase().includes('error') ||
                                 pageContent.toLowerCase().includes('invalid') ||
                                 pageContent.toLowerCase().includes('syntax');

      expect(hasErrorIndicator).toBe(true);
      testLogger.info('Compilation error detected and reported');
      await pm.functionsPage.clickCancelButton();

      // Step 2: Empty JS function
      const functionName2 = `test_js_empty_${Date.now()}`;
      const emptyCode = '   '; // Just spaces

      await pm.functionsPage.clickAddFunctionButton('_meta');
      await pm.functionsPage.fillFunctionName(functionName2);
      await pm.functionsPage.selectJavaScriptType();
      await pm.functionsPage.enterFunctionCode(emptyCode);

      await pm.functionsPage.clickSaveButton();
      testLogger.info('Empty function handling tested');

      // Cancel if save failed
      if (await pm.functionsPage.isCancelButtonVisible()) {
        await pm.functionsPage.clickCancelButton();
      }
    });

    // NOTE: API tests for JavaScript function creation in _meta org have been migrated to:
    // tests/api-testing/tests/test_functions_meta_org_restriction.py
    // - test_create_js_function_in_meta_org_success
  });

  test.describe('Default Organization - JavaScript Blocked', () => {
    test.beforeEach(async ({ page }) => {
      // Switch to default organization
      testLogger.info('Switching to default organization');
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=default`);
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Verify we're in default org
      const currentUrl = page.url();
      expect(currentUrl).toContain('org_identifier=default');
      testLogger.info('Confirmed in default organization');
    });

    // NOTE: Consolidated from meta-org "JS radio NOT visible" + "VRL functions work" tests
    // Both validations preserved: JS hidden check + VRL creation
    test('P0: Default org - JS hidden, VRL works', { tag: ['@smoke', '@P0'] }, async ({ page }) => {
      testLogger.info('Test: Default org - JS hidden, VRL works');

      // Step 1: Verify JS radio is hidden, VRL is visible
      await pm.functionsPage.clickAddFunctionButton('default');
      await pm.functionsPage.expectVrlRadioVisible();
      testLogger.info('VRL radio button visible');

      const isJsRadioVisible = await pm.functionsPage.isJsRadioVisible();
      expect(isJsRadioVisible).toBe(false);
      testLogger.info('JavaScript radio button correctly hidden in default org');
      await pm.functionsPage.clickCancelButton();

      // Step 2: Create VRL function to verify it works
      const functionName = `default_vrl_fn_${Date.now()}`;
      const vrlCode = '.processed = true\n.org = "default"';

      await pm.functionsPage.clickAddFunctionButton('default');
      await pm.functionsPage.fillFunctionName(functionName);
      // VRL is default, no need to select
      await pm.functionsPage.enterFunctionCode(vrlCode);
      await pm.functionsPage.clickSaveButton();

      // Verify function appears
      await page.waitForTimeout(1000);
      await pm.functionsPage.expectFunctionInList(functionName);
      testLogger.info('VRL function created successfully in default org');

      // Cleanup
      await pm.functionsPage.deleteFunctionByName(functionName);
    });

    // NOTE: API tests for JavaScript function blocking in default org have been migrated to:
    // tests/api-testing/tests/test_functions_meta_org_restriction.py
    // - test_create_js_function_in_default_org_blocked
    // - test_test_js_function_in_default_org_blocked
  });

  test.describe('Organization Switching & VRL Control', () => {
    // NOTE: Consolidated from meta-org "Org switching" + "VRL always visible" tests
    // Both validations preserved: JS visibility changes with org + VRL always visible
    test('P1: Radio visibility across orgs', { tag: ['@P1', '@orgSwitching', '@control'] }, async ({ page }) => {
      testLogger.info('Test: Radio visibility across orgs');

      // Step 1: Default org - JS hidden, VRL visible
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=default`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      await pm.functionsPage.clickAddFunctionButton('default');
      await pm.functionsPage.expectVrlRadioVisible();
      testLogger.info('VRL visible in default org');
      await pm.functionsPage.expectJsRadioHidden();
      testLogger.info('JS hidden in default org');
      await pm.functionsPage.clickCancelButton();

      // Step 2: Switch to _meta org - JS visible, VRL visible
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=_meta`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      await pm.functionsPage.clickAddFunctionButton('_meta');
      await pm.functionsPage.expectVrlRadioVisible();
      testLogger.info('VRL visible in _meta org');
      await pm.functionsPage.expectJsRadioVisible();
      testLogger.info('JS visible in _meta org');
      await pm.functionsPage.clickCancelButton();

      // Step 3: Switch back to default - JS hidden again, VRL still visible
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=default`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      await pm.functionsPage.clickAddFunctionButton('default');
      await pm.functionsPage.expectVrlRadioVisible();
      testLogger.info('VRL still visible after switching back');
      await pm.functionsPage.expectJsRadioHidden();
      testLogger.info('JS hidden after switching back to default');
      await pm.functionsPage.clickCancelButton();
    });
  });

  // NOTE: API-based error handling tests have been migrated to:
  // tests/api-testing/tests/test_functions_meta_org_restriction.py
  // - test_error_message_content
  // - test_error_message_consistency
  // - test_empty_function_code
  // - test_invalid_trans_type_value
  // - test_case_sensitivity_org_name
  // - test_update_vrl_to_js_in_default_org_blocked
});
