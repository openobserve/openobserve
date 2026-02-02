const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { expect } = require('@playwright/test');

test.describe('JavaScript Functions _meta Org Restriction', { tag: ['@metaOrgRestriction', '@functions', '@P0'] }, () => {
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
      testLogger.info('✅ Confirmed in _meta organization');
    });

    test('P0: JavaScript radio button visible in _meta org', { tag: ['@smoke', '@P0'] }, async ({ page }) => {
      testLogger.info('Test: Verify JavaScript option is visible in _meta org');

      // Click Add Function
      await pm.functionsPage.clickAddFunctionButton();

      // Verify both VRL and JavaScript radio buttons are visible
      await pm.functionsPage.expectVrlRadioVisible();
      testLogger.info('✅ VRL radio button visible');

      await pm.functionsPage.expectJsRadioVisible();
      testLogger.info('✅ JavaScript radio button visible in _meta org');

      // Cancel
      await pm.functionsPage.clickCancelButton();
    });

    test('P0: Create JavaScript function in _meta org', { tag: ['@smoke', '@P0'] }, async ({ page }) => {
      testLogger.info('Test: Create JavaScript function in _meta org');

      const functionName = `meta_js_fn_${Date.now()}`;
      const jsCode = `// JavaScript function in _meta\nrow.processed = true;\nrow.org = "_meta";`;

      // Create JavaScript function
      await pm.functionsPage.createJavaScriptFunction(functionName, jsCode);
      testLogger.info(`✅ JavaScript function created in _meta org: ${functionName}`);

      // Verify function appears in list
      await page.waitForTimeout(1000);
      const functionRow = page.locator(`text=${functionName}`);
      await expect(functionRow).toBeVisible({ timeout: 5000 });
      testLogger.info('✅ Function visible in functions list');

      // Cleanup
      await pm.functionsPage.deleteFunctionByName(functionName);
      testLogger.info('✅ Test cleanup complete');
    });

    test('P1: Test JavaScript function execution in _meta org', { tag: ['@P1'] }, async ({ page }) => {
      testLogger.info('Test: Test JavaScript function execution in _meta org');

      const functionName = `meta_js_test_${Date.now()}`;
      const jsCode = 'row.count = (row.count || 0) + 1; row.tested = true;';

      await pm.functionsPage.clickAddFunctionButton();
      await pm.functionsPage.fillFunctionName(functionName);
      await pm.functionsPage.selectJavaScriptType();
      await pm.functionsPage.enterFunctionCode(jsCode);

      // Test function
      const testEvent = '{"name": "test", "count": 5}';
      const output = await pm.functionsPage.testFunctionExecution(testEvent);

      if (output) {
        testLogger.info(`Test output: ${output}`);
        await pm.functionsPage.expectTestOutputContains('count');
        await pm.functionsPage.expectTestOutputContains('6'); // 5 + 1
        testLogger.info('✅ JavaScript function executed successfully in _meta org');
      }

      // Cancel without saving
      await pm.functionsPage.clickCancelButton();
    });

    test('P1: Edit existing JavaScript function in _meta org', { tag: ['@P1'] }, async ({ page }) => {
      testLogger.info('Test: Edit existing JavaScript function in _meta org');

      // Create JS function
      const functionName = `meta_js_edit_${Date.now()}`;
      const jsCode = 'row.version = 1;';

      await pm.functionsPage.createJavaScriptFunction(functionName, jsCode);
      testLogger.info(`Created function: ${functionName}`);

      // Navigate away and back
      await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=_meta`);
      await page.waitForLoadState('networkidle');
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=_meta`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Open function and verify type
      const functionType = await pm.functionsPage.openFunctionAndCheckType(functionName);
      expect(functionType).toBe('js');
      testLogger.info('✅ JavaScript function type persisted correctly in _meta org');

      // Cancel and cleanup
      await pm.functionsPage.clickCancelButton();
      await pm.functionsPage.deleteFunctionByName(functionName);
    });

    test('P1: Save JavaScript function in _meta org via API', { tag: ['@P1', '@api'] }, async ({ page, request }) => {
      testLogger.info('Test: Save JavaScript function via API in _meta org');

      const functionName = `meta_js_api_${Date.now()}`;
      const payload = {
        name: functionName,
        function: 'row.api_created = true;',
        params: 'row',
        trans_type: 1, // JavaScript
      };

      // Make API call to create function
      const response = await request.post(`${process.env.ZO_BASE_URL}/api/_meta/functions`, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      expect(response.status()).toBe(200);
      testLogger.info('✅ JavaScript function created via API in _meta org (200)');

      // Cleanup
      await request.delete(`${process.env.ZO_BASE_URL}/api/_meta/functions/${functionName}`);
    });
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
      testLogger.info('✅ Confirmed in default organization');
    });

    test('P0: JavaScript radio button NOT visible in default org', { tag: ['@smoke', '@P0'] }, async ({ page }) => {
      testLogger.info('Test: Verify JavaScript option is NOT visible in default org');

      // Click Add Function
      await pm.functionsPage.clickAddFunctionButton();

      // Verify VRL radio button IS visible
      await pm.functionsPage.expectVrlRadioVisible();
      testLogger.info('✅ VRL radio button visible');

      // Verify JavaScript radio button is NOT visible
      const jsRadio = page.locator('[data-test="function-transform-type-js-radio"]');
      const isJsRadioVisible = await jsRadio.isVisible().catch(() => false);

      expect(isJsRadioVisible).toBe(false);
      testLogger.info('✅ JavaScript radio button correctly hidden in default org');

      // Cancel
      await pm.functionsPage.clickCancelButton();
    });

    test('P0: Cannot create JavaScript function in default org via UI', { tag: ['@smoke', '@P0'] }, async ({ page }) => {
      testLogger.info('Test: Verify cannot create JavaScript function in default org');

      // Click Add Function
      await pm.functionsPage.clickAddFunctionButton();

      // Verify only VRL option is present
      const jsRadio = page.locator('[data-test="function-transform-type-js-radio"]');
      await expect(jsRadio).not.toBeVisible();

      testLogger.info('✅ UI correctly prevents JavaScript function creation in default org');

      // Cancel
      await pm.functionsPage.clickCancelButton();
    });

    test('P0: VRL functions work normally in default org', { tag: ['@smoke', '@P0'] }, async ({ page }) => {
      testLogger.info('Test: Verify VRL functions work in default org');

      const functionName = `default_vrl_fn_${Date.now()}`;
      const vrlCode = '.processed = true\n.org = "default"';

      await pm.functionsPage.clickAddFunctionButton();
      await pm.functionsPage.fillFunctionName(functionName);
      // VRL is default, no need to select
      await pm.functionsPage.enterFunctionCode(vrlCode);
      await pm.functionsPage.clickSaveButton();

      // Verify function appears
      await page.waitForTimeout(1000);
      const functionRow = page.locator(`text=${functionName}`);
      await expect(functionRow).toBeVisible({ timeout: 5000 });
      testLogger.info('✅ VRL function created successfully in default org');

      // Cleanup
      await pm.functionsPage.deleteFunctionByName(functionName);
    });

    test('P0: API blocks JavaScript function creation in default org', { tag: ['@smoke', '@P0', '@api'] }, async ({ page, request }) => {
      testLogger.info('Test: API blocks JavaScript function in default org');

      const functionName = `default_js_blocked_${Date.now()}`;
      const payload = {
        name: functionName,
        function: 'row.blocked = true;',
        params: 'row',
        trans_type: 1, // JavaScript - should be blocked
      };

      // Make API call to create function
      const response = await request.post(`${process.env.ZO_BASE_URL}/api/default/functions`, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Should return 400 Bad Request
      expect(response.status()).toBe(400);
      testLogger.info('✅ API correctly returned 400 for JavaScript function in default org');

      // Verify error message
      const responseBody = await response.text();
      expect(responseBody).toContain('JavaScript functions are only allowed in the \'_meta\' organization');
      testLogger.info('✅ Correct error message returned');
    });

    test('P1: API test endpoint blocks JavaScript in default org', { tag: ['@P1', '@api'] }, async ({ page, request }) => {
      testLogger.info('Test: Test API endpoint blocks JavaScript in default org');

      const payload = {
        function: 'row.test = true;',
        events: [{ name: 'test', count: 5 }],
        trans_type: 1, // JavaScript
      };

      // Make API call to test function
      const response = await request.post(`${process.env.ZO_BASE_URL}/api/default/functions/test`, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Should return 400 Bad Request
      expect(response.status()).toBe(400);
      testLogger.info('✅ Test API correctly returned 400 for JavaScript in default org');

      // Verify error message
      const responseBody = await response.text();
      expect(responseBody).toContain('JavaScript functions are only allowed in the \'_meta\' organization');
      testLogger.info('✅ Correct error message in test endpoint');
    });
  });

  test.describe('Organization Switching', () => {
    test('P1: JavaScript option appears when switching to _meta', { tag: ['@P1', '@orgSwitching'] }, async ({ page }) => {
      testLogger.info('Test: JavaScript option appears when switching to _meta');

      // Start in default org
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=default`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      await pm.functionsPage.clickAddFunctionButton();

      // Verify JavaScript NOT visible
      const jsRadioInDefault = page.locator('[data-test="function-transform-type-js-radio"]');
      await expect(jsRadioInDefault).not.toBeVisible();
      testLogger.info('✅ JavaScript option hidden in default org');

      // Cancel and switch to _meta
      await pm.functionsPage.clickCancelButton();

      // Switch to _meta org
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=_meta`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      await pm.functionsPage.clickAddFunctionButton();

      // Verify JavaScript IS visible
      await pm.functionsPage.expectJsRadioVisible();
      testLogger.info('✅ JavaScript option appears in _meta org');

      // Cancel
      await pm.functionsPage.clickCancelButton();
    });

    test('P1: JavaScript option disappears when switching from _meta', { tag: ['@P1', '@orgSwitching'] }, async ({ page }) => {
      testLogger.info('Test: JavaScript option disappears when leaving _meta');

      // Start in _meta org
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=_meta`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      await pm.functionsPage.clickAddFunctionButton();

      // Verify JavaScript IS visible
      await pm.functionsPage.expectJsRadioVisible();
      testLogger.info('✅ JavaScript option visible in _meta org');

      // Cancel and switch to default
      await pm.functionsPage.clickCancelButton();

      // Switch to default org
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=default`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      await pm.functionsPage.clickAddFunctionButton();

      // Verify JavaScript NOT visible
      const jsRadioInDefault = page.locator('[data-test="function-transform-type-js-radio"]');
      await expect(jsRadioInDefault).not.toBeVisible();
      testLogger.info('✅ JavaScript option hidden when switching to default org');

      // Cancel
      await pm.functionsPage.clickCancelButton();
    });
  });

  test.describe('VRL Functions - Control Tests', () => {
    test('P1: VRL functions work in all organizations', { tag: ['@P1', '@control'] }, async ({ page, request }) => {
      testLogger.info('Test: VRL functions work in all organizations');

      const orgs = ['default', '_meta', 'another_org'];
      const results = [];

      for (const org of orgs) {
        const functionName = `vrl_${org}_${Date.now()}`;
        const payload = {
          name: functionName,
          function: '.processed = true',
          params: 'row',
          trans_type: 0, // VRL
        };

        // Try to create VRL function
        const response = await request.post(`${process.env.ZO_BASE_URL}/api/${org}/functions`, {
          data: payload,
          headers: {
            'Content-Type': 'application/json',
          },
        }).catch(() => ({ status: () => 500 }));

        const status = response.status();
        results.push({ org, status, allowed: status === 200 });

        // Cleanup if created
        if (status === 200) {
          await request.delete(`${process.env.ZO_BASE_URL}/api/${org}/functions/${functionName}`).catch(() => {});
        }

        testLogger.info(`VRL in ${org}: ${status === 200 ? '✅ Allowed' : '❌ Blocked'}`);
      }

      // VRL should work in all orgs (at least default and _meta)
      const allowedInDefault = results.find(r => r.org === 'default')?.allowed;
      const allowedInMeta = results.find(r => r.org === '_meta')?.allowed;

      expect(allowedInDefault).toBe(true);
      expect(allowedInMeta).toBe(true);

      testLogger.info('✅ VRL functions work across organizations');
    });

    test('P2: VRL option always visible regardless of org', { tag: ['@P2', '@control'] }, async ({ page }) => {
      testLogger.info('Test: VRL option always visible');

      const orgs = ['default', '_meta'];

      for (const org of orgs) {
        await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${org}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        await pm.functionsPage.clickAddFunctionButton();

        // Verify VRL is visible
        await pm.functionsPage.expectVrlRadioVisible();
        testLogger.info(`✅ VRL visible in ${org} org`);

        await pm.functionsPage.clickCancelButton();
      }
    });
  });

  test.describe('Error Handling and Edge Cases', () => {
    test('P2: Attempt to update function to JavaScript in default org', { tag: ['@P2', '@errorHandling'] }, async ({ page, request }) => {
      testLogger.info('Test: Cannot update VRL to JavaScript in default org');

      // Create VRL function in default org
      const functionName = `vrl_to_js_${Date.now()}`;
      const vrlPayload = {
        name: functionName,
        function: '.test = true',
        params: 'row',
        trans_type: 0, // VRL
      };

      await request.post(`${process.env.ZO_BASE_URL}/api/default/functions`, {
        data: vrlPayload,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Try to update to JavaScript
      const jsPayload = {
        name: functionName,
        function: 'row.test = true;',
        params: 'row',
        trans_type: 1, // JavaScript - should be blocked
      };

      const response = await request.put(`${process.env.ZO_BASE_URL}/api/default/functions/${functionName}`, {
        data: jsPayload,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Should return 400
      expect(response.status()).toBe(400);
      testLogger.info('✅ Cannot change VRL to JavaScript in default org');

      // Cleanup
      await request.delete(`${process.env.ZO_BASE_URL}/api/default/functions/${functionName}`).catch(() => {});
    });

    test('P2: Error message is user-friendly', { tag: ['@P2', '@errorHandling'] }, async ({ page, request }) => {
      testLogger.info('Test: Error message is clear and actionable');

      const payload = {
        name: `error_test_${Date.now()}`,
        function: 'row.test = true;',
        params: 'row',
        trans_type: 1, // JavaScript
      };

      const response = await request.post(`${process.env.ZO_BASE_URL}/api/default/functions`, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const responseBody = await response.text();

      // Check error message quality
      expect(responseBody).toContain('JavaScript');
      expect(responseBody).toContain('_meta');
      expect(responseBody).toContain('organization');
      expect(responseBody).toContain('VRL');

      testLogger.info('✅ Error message contains all key information');
      testLogger.info(`Error message: ${responseBody.substring(0, 200)}`);
    });
  });
});
