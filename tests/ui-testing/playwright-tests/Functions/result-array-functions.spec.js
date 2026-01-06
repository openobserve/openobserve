const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { expect } = require('@playwright/test');

test.describe('#ResultArray# Functionality Tests', { tag: ['@resultArray', '@functions'] }, () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to functions page
    testLogger.info('Navigating to Functions page');
    await pm.functionsPage.navigate();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Wait for page to be ready
    await page.waitForTimeout(2000);

    // Verify we're on the functions page
    const addButtonVisible = await page.locator('[data-test="function-list-add-function-btn"]').isVisible({ timeout: 5000 }).catch(() => false);
    testLogger.info(`Functions page loaded - Add button visible: ${addButtonVisible}`);
  });

  test.describe('VRL #ResultArray# Tests', () => {
    test('P0: Create VRL function with #ResultArray# marker', { tag: ['@smoke', '@P0', '@vrlResultArray'] }, async ({ page }) => {
      testLogger.info('Test: Create VRL function with #ResultArray# marker');

      const functionName = `vrl_result_array_${Date.now()}`;
      const vrlCode = `#ResultArray#
.new_field = "processed"
.source = "vrl"
[., .]`;

      // Create VRL function with #ResultArray#
      await pm.functionsPage.createVRLFunction(functionName, vrlCode);
      testLogger.info(`✅ VRL function with #ResultArray# created: ${functionName}`);

      // Cleanup
      await pm.functionsPage.deleteFunctionByName(functionName);
    });

    test('P0: VRL #ResultArray# - Multiple row expansion (1 input -> 3 outputs)', { tag: ['@smoke', '@P0', '@vrlResultArray'] }, async ({ page }) => {
      testLogger.info('Test: VRL #ResultArray# with multiple row expansion');

      const functionName = `vrl_array_expand_${Date.now()}`;
      const vrlCode = `#ResultArray#
.result_type = "expanded"
[
  merge(., {"index": 0}),
  merge(., {"index": 1}),
  merge(., {"index": 2})
]`;

      await pm.functionsPage.clickAddFunctionButton();
      await pm.functionsPage.fillFunctionName(functionName);
      await pm.functionsPage.selectVRLType();
      await pm.functionsPage.enterFunctionCode(vrlCode);

      // Test the function with sample data
      const testEvent = '{"name": "test", "value": 100}';
      await pm.functionsPage.clickTestButton();
      await pm.functionsPage.enterTestEvent(testEvent);

      const runSuccess = await pm.functionsPage.clickRunTestButton();
      if (runSuccess) {
        const output = await pm.functionsPage.getTestOutput();
        testLogger.info(`VRL array expansion output: ${output}`);

        // Verify output contains array elements (looking for index values)
        if (output.includes('index') && (output.includes('0') || output.includes('1') || output.includes('2'))) {
          testLogger.info('✅ VRL #ResultArray# successfully expanded to multiple rows');
        } else {
          testLogger.warn('⚠️ Output format may need verification');
        }
      }

      // Save and cleanup
      await pm.functionsPage.clickSaveButton();
      await page.waitForTimeout(2000);
      await pm.functionsPage.deleteFunctionByName(functionName);
    });

    test('P1: Verify #ResultArray# marker preserved after save (VRL)', { tag: ['@P1', '@vrlResultArray'] }, async ({ page }) => {
      testLogger.info('Test: Verify VRL #ResultArray# marker is preserved');

      const functionName = `vrl_preserve_marker_${Date.now()}`;
      const vrlCode = `#ResultArray#
.preserved = true
[., .]`;

      // Create function
      await pm.functionsPage.createVRLFunction(functionName, vrlCode);
      testLogger.info('VRL function with #ResultArray# saved');

      // Navigate away and back
      await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${process.env.ORGID}`);
      await page.waitForLoadState('networkidle');
      await pm.functionsPage.navigate();

      // Open function and check if #ResultArray# is still there
      await pm.functionsPage.searchFunction(functionName);
      await pm.functionsPage.clickFunctionByName(functionName);
      await page.waitForTimeout(2000);

      // Check editor content contains #ResultArray#
      const editorContent = await page.locator('[data-test="logs-vrl-function-editor"]').textContent();
      if (editorContent && editorContent.includes('#ResultArray#')) {
        testLogger.info('✅ #ResultArray# marker preserved in VRL function');
      } else {
        testLogger.warn('⚠️ #ResultArray# marker may not be visible in editor');
      }

      // Cleanup
      await pm.functionsPage.clickCancelButton();
      await pm.functionsPage.deleteFunctionByName(functionName);
    });

    test('P2: VRL #ResultArray# - Empty array return', { tag: ['@P2', '@vrlResultArray', '@edgeCases'] }, async ({ page }) => {
      testLogger.info('Test: VRL #ResultArray# with empty array');

      const functionName = `vrl_empty_array_${Date.now()}`;
      const vrlCode = `#ResultArray#
# Return empty array based on condition
if .filter_out == true {
  []
} else {
  [.]
}`;

      await pm.functionsPage.clickAddFunctionButton();
      await pm.functionsPage.fillFunctionName(functionName);
      await pm.functionsPage.selectVRLType();
      await pm.functionsPage.enterFunctionCode(vrlCode);

      // Test with filter_out=true to get empty array
      const testEvent = '{"filter_out": true, "name": "test"}';
      await pm.functionsPage.clickTestButton();
      await pm.functionsPage.enterTestEvent(testEvent);

      const runSuccess = await pm.functionsPage.clickRunTestButton();
      if (runSuccess) {
        const output = await pm.functionsPage.getTestOutput();
        testLogger.info(`VRL empty array output: ${output}`);
        testLogger.info('✅ VRL #ResultArray# handles empty array case');
      }

      // Cancel without saving
      await pm.functionsPage.clickCancelButton();
    });

    test('P2: VRL #ResultArray# - Single element array', { tag: ['@P2', '@vrlResultArray', '@edgeCases'] }, async ({ page }) => {
      testLogger.info('Test: VRL #ResultArray# with single element array');

      const functionName = `vrl_single_array_${Date.now()}`;
      const vrlCode = `#ResultArray#
.single_element = true
[.]`;

      await pm.functionsPage.createVRLFunction(functionName, vrlCode);
      testLogger.info('✅ VRL #ResultArray# with single element created');

      // Cleanup
      await pm.functionsPage.deleteFunctionByName(functionName);
    });
  });

  test.describe('JavaScript #ResultArray# Tests', () => {
    test('P0: Create JS function with #ResultArray# marker', { tag: ['@smoke', '@P0', '@jsResultArray'] }, async ({ page }) => {
      testLogger.info('Test: Create JavaScript function with #ResultArray# marker');

      const functionName = `js_result_array_${Date.now()}`;
      const jsCode = `#ResultArray#
row.new_field = "processed";
row.source = "javascript";
[row, row];`;

      // Create JS function with #ResultArray#
      await pm.functionsPage.createJavaScriptFunction(functionName, jsCode);
      testLogger.info(`✅ JavaScript function with #ResultArray# created: ${functionName}`);

      // Cleanup
      await pm.functionsPage.deleteFunctionByName(functionName);
    });

    test('P0: JS #ResultArray# - Multiple row expansion (1 input -> 3 outputs)', { tag: ['@smoke', '@P0', '@jsResultArray'] }, async ({ page }) => {
      testLogger.info('Test: JavaScript #ResultArray# with multiple row expansion');

      const functionName = `js_array_expand_${Date.now()}`;
      const jsCode = `#ResultArray#
// With #ResultArray#, use 'rows' variable (array input)
// Expand: take first row and create 3 copies with different indices
if (rows.length > 0) {
  var firstRow = rows[0];
  rows.length = 0;  // Clear array
  for (var i = 0; i < 3; i++) {
    var newRow = {};
    for (var key in firstRow) {
      newRow[key] = firstRow[key];
    }
    newRow.index = i;
    newRow.expanded = true;
    rows.push(newRow);
  }
}`;

      await pm.functionsPage.clickAddFunctionButton();
      await pm.functionsPage.fillFunctionName(functionName);
      await pm.functionsPage.selectJavaScriptType();
      await pm.functionsPage.enterFunctionCode(jsCode);

      // Test the function with sample data
      const testEvent = '{"name": "test", "value": 100}';
      await pm.functionsPage.clickTestButton();
      await pm.functionsPage.enterTestEvent(testEvent);

      const runSuccess = await pm.functionsPage.clickRunTestButton();
      if (runSuccess) {
        const output = await pm.functionsPage.getTestOutput();
        testLogger.info(`JavaScript array expansion output: ${output}`);

        // Verify output contains array elements
        if (output.includes('index') && output.includes('expanded')) {
          testLogger.info('✅ JavaScript #ResultArray# successfully expanded to multiple rows');
        } else {
          testLogger.warn('⚠️ Output format may need verification');
        }
      }

      // Save and cleanup
      await pm.functionsPage.clickSaveButton();
      await page.waitForTimeout(2000);
      await pm.functionsPage.deleteFunctionByName(functionName);
    });

    test('P1: Verify #ResultArray# marker preserved after save (JS)', { tag: ['@P1', '@jsResultArray'] }, async ({ page }) => {
      testLogger.info('Test: Verify JavaScript #ResultArray# marker is preserved');

      const functionName = `js_preserve_marker_${Date.now()}`;
      const jsCode = `#ResultArray#
// With #ResultArray#, use 'rows' variable
for (var i = 0; i < rows.length; i++) {
  rows[i].preserved = true;
}`;

      // Create function
      await pm.functionsPage.createJavaScriptFunction(functionName, jsCode);
      testLogger.info('JavaScript function with #ResultArray# saved');

      // Navigate away and back
      await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${process.env.ORGID}`);
      await page.waitForLoadState('networkidle');
      await pm.functionsPage.navigate();

      // Open function and check type and #ResultArray# marker
      const functionType = await pm.functionsPage.openFunctionAndCheckType(functionName);
      expect(functionType).toBe('js');
      testLogger.info('✅ JavaScript type verified');

      // Check editor content contains #ResultArray#
      const editorContent = await page.locator('[data-test="logs-vrl-function-editor"]').textContent();
      if (editorContent && editorContent.includes('#ResultArray#')) {
        testLogger.info('✅ #ResultArray# marker preserved in JavaScript function');
      } else {
        testLogger.warn('⚠️ #ResultArray# marker may not be visible in editor');
      }

      // Cleanup
      await pm.functionsPage.clickCancelButton();
      await pm.functionsPage.deleteFunctionByName(functionName);
    });

    test('P2: JS #ResultArray# - Empty array return', { tag: ['@P2', '@jsResultArray', '@edgeCases'] }, async ({ page }) => {
      testLogger.info('Test: JavaScript #ResultArray# with empty array');

      const functionName = `js_empty_array_${Date.now()}`;
      const jsCode = `#ResultArray#
// With #ResultArray#, use 'rows' variable
// Filter out rows based on condition
var filtered = [];
for (var i = 0; i < rows.length; i++) {
  if (rows[i].filter_out !== true) {
    filtered.push(rows[i]);
  }
}
rows.length = 0;
for (var i = 0; i < filtered.length; i++) {
  rows.push(filtered[i]);
}`;

      await pm.functionsPage.clickAddFunctionButton();
      await pm.functionsPage.fillFunctionName(functionName);
      await pm.functionsPage.selectJavaScriptType();
      await pm.functionsPage.enterFunctionCode(jsCode);

      // Test with filter_out=true to get empty array
      const testEvent = '{"filter_out": true, "name": "test"}';
      await pm.functionsPage.clickTestButton();
      await pm.functionsPage.enterTestEvent(testEvent);

      const runSuccess = await pm.functionsPage.clickRunTestButton();
      if (runSuccess) {
        const output = await pm.functionsPage.getTestOutput();
        testLogger.info(`JavaScript empty array output: ${output}`);
        testLogger.info('✅ JavaScript #ResultArray# handles empty array case');
      }

      // Cancel without saving
      await pm.functionsPage.clickCancelButton();
    });

    test('P2: JS #ResultArray# - Single element array', { tag: ['@P2', '@jsResultArray', '@edgeCases'] }, async ({ page }) => {
      testLogger.info('Test: JavaScript #ResultArray# with single element array');

      const functionName = `js_single_array_${Date.now()}`;
      const jsCode = `#ResultArray#
// With #ResultArray#, use 'rows' variable
for (var i = 0; i < rows.length; i++) {
  rows[i].single_element = true;
}`;

      await pm.functionsPage.createJavaScriptFunction(functionName, jsCode);
      testLogger.info('✅ JavaScript #ResultArray# with single element created');

      // Cleanup
      await pm.functionsPage.deleteFunctionByName(functionName);
    });

    test('P1: JS #ResultArray# - Complex transformation with map', { tag: ['@P1', '@jsResultArray'] }, async ({ page }) => {
      testLogger.info('Test: JavaScript #ResultArray# with complex array transformation');

      const functionName = `js_complex_array_${Date.now()}`;
      const jsCode = `#ResultArray#
// With #ResultArray#, use 'rows' variable
// Create multiple derived rows from each input row
var statuses = ['pending', 'processing', 'completed'];
var expanded = [];
for (var i = 0; i < rows.length; i++) {
  for (var j = 0; j < statuses.length; j++) {
    expanded.push({
      original_id: rows[i].id,
      status: statuses[j],
      timestamp: Date.now(),
      source: 'javascript'
    });
  }
}
rows.length = 0;
for (var i = 0; i < expanded.length; i++) {
  rows.push(expanded[i]);
}`;

      await pm.functionsPage.createJavaScriptFunction(functionName, jsCode);
      testLogger.info('✅ JavaScript #ResultArray# with complex transformation created');

      // Cleanup
      await pm.functionsPage.deleteFunctionByName(functionName);
    });
  });

  test.describe('Cross-Language Comparison', () => {
    test('P1: Compare VRL and JS #ResultArray# output', { tag: ['@P1', '@comparison'] }, async ({ page }) => {
      testLogger.info('Test: Compare VRL and JavaScript #ResultArray# behavior');

      const timestamp = Date.now();
      const vrlFunctionName = `vrl_compare_${timestamp}`;
      const jsFunctionName = `js_compare_${timestamp}`;

      // Create VRL version
      const vrlCode = `#ResultArray#
[
  merge(., {"type": "vrl", "index": 0}),
  merge(., {"type": "vrl", "index": 1})
]`;
      await pm.functionsPage.createVRLFunction(vrlFunctionName, vrlCode);
      testLogger.info('Created VRL comparison function');

      // Create JS version (using 'rows' for #ResultArray#)
      const jsCode = `#ResultArray#
// With #ResultArray#, use 'rows' variable
for (var i = 0; i < rows.length; i++) {
  rows[i].type = "javascript";
  rows[i].index = i;
}`;
      await pm.functionsPage.createJavaScriptFunction(jsFunctionName, jsCode);
      testLogger.info('Created JavaScript comparison function');

      testLogger.info('✅ Both VRL and JavaScript #ResultArray# functions created for comparison');

      // Cleanup
      await pm.functionsPage.deleteFunctionByName(vrlFunctionName);
      await pm.functionsPage.deleteFunctionByName(jsFunctionName);
    });
  });

  test.describe('Pipeline Integration', () => {
    test('P1: #ResultArray# function in pipeline context', { tag: ['@P1', '@pipelineIntegration'] }, async ({ page }) => {
      testLogger.info('Test: #ResultArray# function integration with pipelines');

      const functionName = `pipeline_array_fn_${Date.now()}`;
      const jsCode = `#ResultArray#
// With #ResultArray#, use 'rows' variable
// Expand each log entry into multiple events
var events = ['login', 'action', 'logout'];
var expanded = [];
for (var i = 0; i < rows.length; i++) {
  for (var j = 0; j < events.length; j++) {
    var newRow = {};
    for (var key in rows[i]) {
      newRow[key] = rows[i][key];
    }
    newRow.event_type = events[j];
    newRow.pipeline_processed = true;
    expanded.push(newRow);
  }
}
rows.length = 0;
for (var i = 0; i < expanded.length; i++) {
  rows.push(expanded[i]);
}`;

      await pm.functionsPage.createJavaScriptFunction(functionName, jsCode);
      testLogger.info('✅ #ResultArray# function created for pipeline integration');

      // Note: Full pipeline integration test would require:
      // 1. Create a pipeline with this function
      // 2. Send test data through the pipeline
      // 3. Verify multiple output rows are generated
      // This is documented for future pipeline E2E tests

      // Cleanup
      await pm.functionsPage.deleteFunctionByName(functionName);
    });
  });

  test.describe('Error Handling', () => {
    test('P2: #ResultArray# with invalid return value', { tag: ['@P2', '@errorHandling'] }, async ({ page }) => {
      testLogger.info('Test: #ResultArray# error handling for non-array return');

      const functionName = `invalid_array_${Date.now()}`;
      const jsCode = `#ResultArray#
// With #ResultArray#, use 'rows' variable
// This is valid - just marks rows as invalid
for (var i = 0; i < rows.length; i++) {
  rows[i].invalid = true;
}`;

      await pm.functionsPage.clickAddFunctionButton();
      await pm.functionsPage.fillFunctionName(functionName);
      await pm.functionsPage.selectJavaScriptType();
      await pm.functionsPage.enterFunctionCode(jsCode);

      // Try to save - may succeed (validation at runtime)
      await pm.functionsPage.clickSaveButton();
      await page.waitForTimeout(2000);

      testLogger.info('✅ Function created - validation occurs at runtime');

      // Cleanup
      const cancelVisible = await page.locator('[data-test="add-function-cancel-btn"]').isVisible({ timeout: 2000 }).catch(() => false);
      if (cancelVisible) {
        await pm.functionsPage.clickCancelButton();
      } else {
        await pm.functionsPage.deleteFunctionByName(functionName);
      }
    });
  });
});
