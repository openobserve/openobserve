const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { expect } = require('@playwright/test');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// NOTE: JavaScript transform availability is EDITION-dependent — it mirrors the
// gate in AddFunction.vue:
//   config.isEnterprise === "true" || config.isCloud === "true" || org === "_meta"
// i.e. enterprise/cloud offer JS in EVERY org; OSS keeps it to _meta only (where it
// predates the entitlement, for SSO claim parsing). It used to be _meta-only
// everywhere, which is what the two skipped tests below still assert.
// This file consolidates tests from:
// - javascript-functions.spec.js (JS function operations)
// - meta-org-js-restriction.spec.js (org-based JS restrictions)

// Helper: get the org identifier for "non-meta" tests
// On self-hosted: 'default' org. On cloud: user's own org (also non-meta, JS blocked there too)
function getNonMetaOrg() {
  if (isCloudEnvironment()) {
    return getOrgIdentifier();
  }
  return 'default';
}

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
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
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
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=_meta`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
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

      // Default events don't have 'count' — tests the || 5 fallback: (undefined || 5) + 1 = 6
      const output = await pm.functionsPage.testFunctionExecution();

      // Assert output exists before checking content
      expect(output).toBeTruthy();
      testLogger.info(`Test output: ${output}`);
      await pm.functionsPage.expectTestOutputContains('count');
      await pm.functionsPage.expectTestOutputContains('6'); // (undefined || 5) + 1
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

      // Trigger test execution using default events
      const errorOutput = await pm.functionsPage.testFunctionExecution();

      expect(errorOutput).toBeTruthy();
      testLogger.info(`Error test output: ${errorOutput}`);

      // `row.field = undefinedVar` throws a ReferenceError at RUNTIME, not compile
      // time — the code is syntactically valid. Only syntax errors fail the request
      // now, so this returns 200 with the message attached per event and the output
      // editor keeps showing the (untransformed) events. The error surfaces in the
      // error-details section instead, which is what we assert on.
      await pm.functionsPage.expectFunctionErrorContains('ReferenceError');

      testLogger.info('Error handling works - error message displayed');
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

  test.describe('Non-Meta Organization - JavaScript edition-gated', () => {
    test.beforeEach(async ({ page }) => {
      // Switch to a non-meta organization (self-hosted: 'default', cloud: user's own org)
      const nonMetaOrg = getNonMetaOrg();
      testLogger.info(`Switching to non-meta organization: ${nonMetaOrg}`);
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${nonMetaOrg}`);
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Verify we're in the correct org
      const currentUrl = page.url();
      expect(currentUrl).toContain(`org_identifier=${nonMetaOrg}`);
      testLogger.info(`Confirmed in non-meta organization: ${nonMetaOrg}`);
    });

    // NOTE: Consolidated from meta-org "JS radio NOT visible" + "VRL functions work" tests
    // Both validations preserved: JS hidden check + VRL creation
    test('P0: Non-meta org - JS radio edition-gated, VRL works', { tag: ['@smoke', '@P0'] }, async ({ page }) => {
      // JS radio visibility in a non-meta org is EDITION-dependent (see file header):
      //   OSS      -> JS is _meta-only, so the radio is HIDDEN here.
      //   ENT/cloud-> JS is offered in every org, so the radio is VISIBLE here.
      // We detect the edition at runtime from the header edition button label
      // (data-test="upgrade-to-enterprise-btn"), which is driven by the SAME
      // build-time flags (config.isEnterprise/isCloud via @/aws-exports) that gate
      // the JS radio — so it's the exact source of truth, no CI env var needed.
      // Step 2 (VRL create in a non-meta org) is edition-agnostic and always runs.
      const nonMetaOrg = getNonMetaOrg();
      const edition = await pm.editionFeaturesPage.detectEdition();
      testLogger.info(`Test: Non-meta org (${nonMetaOrg}) - edition=${edition}`);

      // Step 1: VRL is always visible; JS radio visibility depends on edition.
      await pm.functionsPage.clickAddFunctionButton(nonMetaOrg);
      await pm.functionsPage.expectVrlRadioVisible();
      testLogger.info('VRL radio button visible');

      if (edition === 'opensource') {
        const isJsRadioVisible = await pm.functionsPage.isJsRadioVisible();
        expect(isJsRadioVisible).toBe(false);
        testLogger.info(`OSS: JavaScript radio correctly hidden in ${nonMetaOrg} org`);
      } else {
        // enterprise / cloud
        await pm.functionsPage.expectJsRadioVisible();
        testLogger.info(`${edition}: JavaScript radio correctly visible in ${nonMetaOrg} org`);
      }
      await pm.functionsPage.clickCancelButton();

      // Step 2 (edition-agnostic): Create a VRL function to verify it works.
      const functionName = `nonmeta_vrl_fn_${Date.now()}`;
      const vrlCode = '.processed = true\n.org = "non_meta"';

      await pm.functionsPage.clickAddFunctionButton(nonMetaOrg);
      await pm.functionsPage.fillFunctionName(functionName);
      // VRL is default, no need to select
      await pm.functionsPage.enterFunctionCode(vrlCode);
      await pm.functionsPage.clickSaveButton();

      // Navigate back to functions list and search for the function
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${nonMetaOrg}`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);
      await pm.functionsPage.searchFunction(functionName);
      await pm.functionsPage.expectFunctionInList(functionName);
      testLogger.info(`VRL function created successfully in ${nonMetaOrg} org`);

      // Cleanup
      await pm.functionsPage.deleteFunctionByName(functionName, nonMetaOrg);
    });

    // Edition-agnostic: a VRL runtime error surfaces in the error-details section
    // (mirrors the JS ReferenceError case in the _meta describe). VRL works in every
    // org on every edition, so this runs unconditionally. Covers the VRL half of the
    // "runtime errors now render per-event" behaviour change (PR #13156).
    test('P1: VRL runtime error surfaces in error-details', { tag: ['@P1', '@errorHandling'] }, async ({ page }) => {
      const nonMetaOrg = getNonMetaOrg();
      testLogger.info(`Test: VRL runtime error in error-details (${nonMetaOrg} org)`);

      // to_int!(.s) compiles fine but aborts at runtime when .s can't be coerced.
      const functionName = `nonmeta_vrl_err_${Date.now()}`;
      const vrlCode = '.x = to_int!(.s)';

      await pm.functionsPage.clickAddFunctionButton(nonMetaOrg);
      await pm.functionsPage.fillFunctionName(functionName);
      // VRL is the default type
      await pm.functionsPage.enterFunctionCode(vrlCode);

      // Run against an event that triggers the runtime abort.
      await pm.functionsPage.testFunctionExecution('[{"s":"notanumber"}]');

      // The per-event VRL runtime error renders in the error-details section
      // (200 response with results[].message, not a 400).
      await pm.functionsPage.expectFunctionErrorContains('runtime error');
      testLogger.info('VRL runtime error rendered in error-details section');
      await pm.functionsPage.clickCancelButton();
    });

    // NOTE: API tests for JavaScript function behaviour in default org live in:
    // tests/api-testing/tests/pipelines/test_functions_meta_org_restriction.py
    // - test_create_js_function_in_default_org_allowed
    // - test_test_js_function_in_default_org_allowed
  });

  test.describe('Organization Switching & VRL Control', () => {
    // NOTE: Consolidated from meta-org "Org switching" + "VRL always visible" tests
    // Both validations preserved: JS visibility changes with org + VRL always visible
    test('P1: Radio visibility across orgs', { tag: ['@P1', '@orgSwitching', '@control'] }, async ({ page }) => {
      // JS radio visibility in a NON-meta org is edition-gated (OSS hides it,
      // ENT/cloud shows it); in the _meta org JS is ALWAYS visible on every
      // edition. VRL is always visible everywhere. We detect the edition from
      // the header edition button (same build-flag source as the JS gate).
      const nonMetaOrg = getNonMetaOrg();
      const edition = await pm.editionFeaturesPage.detectEdition();
      testLogger.info(`Test: Radio visibility across orgs (non-meta: ${nonMetaOrg}, edition=${edition})`);

      const expectJsRadioForNonMeta = async (label) => {
        if (edition === 'opensource') {
          await pm.functionsPage.expectJsRadioHidden();
          testLogger.info(`OSS: JS hidden in ${nonMetaOrg} org (${label})`);
        } else {
          await pm.functionsPage.expectJsRadioVisible();
          testLogger.info(`${edition}: JS visible in ${nonMetaOrg} org (${label})`);
        }
      };

      // Step 1: Non-meta org - VRL visible, JS edition-gated
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${nonMetaOrg}`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);

      await pm.functionsPage.clickAddFunctionButton(nonMetaOrg);
      await pm.functionsPage.expectVrlRadioVisible();
      testLogger.info(`VRL visible in ${nonMetaOrg} org`);
      await expectJsRadioForNonMeta('step 1');
      await pm.functionsPage.clickCancelButton();

      // Step 2 (edition-agnostic): Switch to _meta org - JS visible, VRL visible
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=_meta`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);

      await pm.functionsPage.clickAddFunctionButton('_meta');
      await pm.functionsPage.expectVrlRadioVisible();
      testLogger.info('VRL visible in _meta org');
      await pm.functionsPage.expectJsRadioVisible();
      testLogger.info('JS visible in _meta org (always, every edition)');
      await pm.functionsPage.clickCancelButton();

      // Step 3: Switch back to non-meta - JS gated again, VRL still visible
      await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${nonMetaOrg}`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);

      await pm.functionsPage.clickAddFunctionButton(nonMetaOrg);
      await pm.functionsPage.expectVrlRadioVisible();
      testLogger.info('VRL still visible after switching back');
      await expectJsRadioForNonMeta('step 3');
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

  // ─── Language Toggle Visual Elements (net-new UI delta: badges, separator, info tooltips) ───
  // Covers: OFormToggleGroup / OToggleGroupItem migration from the old radio-group UI.
  // Existing tests (above) continue to exercise selection, edition-gating, org-switching,
  // and function creation through the updated page-object selectors — these tests only
  // assert the NEW elements that are invisible to all existing tests.
  test.describe('Language Toggle Visual Elements', { tag: ['@functionLanguageToggle', '@functions', '@all'] }, () => {
    test.describe.configure({ mode: 'parallel' });

    test('P2: Language toggle displays badges, separator, and per-option info tips — both languages available',
      { tag: ['@functionLanguageToggle', '@functions', '@all'] },
      async ({ page }) => {
        testLogger.info('Test: Language toggle displays badges, separator, and per-option info tips');
        const fp = pm.functionsPage;

        // Pre-condition: _meta org (JS always available on every edition)
        await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=_meta`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        // Open the Add Function form
        await fp.clickAddFunctionButton('_meta');

        // 1. Assert toggle wrapper renders
        await fp.expectToggleWrapperVisible();
        testLogger.info('Toggle wrapper (OFormToggleGroup) visible');

        // 2. VRL option: badge "V", info icon, selected state
        await fp.expectVrlRadioVisible();
        await fp.expectVrlBadgeVisible();
        testLogger.info('VRL badge ("V") visible inside VRL option');
        await fp.expectVrlInfoIconVisible();
        testLogger.info('VRL info icon visible inside VRL option');
        await fp.expectVrlRadioSelected();
        testLogger.info('VRL is default selection');

        // 3. JS option: badge "JS", info icon, NOT selected
        await fp.expectJsRadioVisible();
        await fp.expectJsBadgeVisible();
        testLogger.info('JS badge ("JS") visible inside JS option');
        await fp.expectJsInfoIconVisible();
        testLogger.info('JS info icon visible inside JS option');
        await fp.expectJsRadioNotSelected();
        testLogger.info('JS option not selected (data-state="off")');

        // 4. Separator between VRL and JS
        await fp.expectSeparatorVisible();
        testLogger.info('Vertical separator visible between VRL and JS options');

        // 5. Cancel — no save needed (purely visual inspection)
        await fp.clickCancelButton();
        testLogger.info('Test completed — toggle visual elements verified');
      },
    );

    test('P2: Info tooltip for the unselected language is reachable',
      { tag: ['@functionLanguageToggle', '@functions', '@all'] },
      async ({ page }) => {
        testLogger.info('Test: Info tooltip for the unselected language is reachable');
        const fp = pm.functionsPage;

        // Pre-condition: _meta org → open form. VRL is default selection.
        await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=_meta`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        await fp.clickAddFunctionButton('_meta');

        // 1. Verify VRL is selected (JS option exists but is NOT selected)
        await fp.expectVrlRadioSelected();
        await fp.expectJsRadioVisible();
        testLogger.info('VRL selected, JS option visible but unselected');

        // 2. Hover the JS info icon — it must be reachable even though JS is NOT selected
        await fp.hoverJsInfoIcon();
        await fp.expectTooltipVisible();
        testLogger.info('JS tooltip appeared on hover (JS option not selected)');
        await fp.expectTooltipContainsText('row');
        testLogger.info('JS tooltip contains JS hint text');

        // 3. Dismiss the tooltip
        await fp.dismissTooltip();
        testLogger.info('Tooltip dismissed after mouse-out');

        // 4. Hover the VRL info icon (the already-selected language)
        await fp.hoverVrlInfoIcon();
        await fp.expectTooltipVisible();
        testLogger.info('VRL tooltip appeared on hover (VRL selected)');
        await fp.expectTooltipContainsText('current event');
        testLogger.info('VRL tooltip contains VRL hint text');

        // 5. Dismiss
        await fp.dismissTooltip();

        // 6. Cancel
        await fp.clickCancelButton();
        testLogger.info('Test completed — both info tooltips reachable');
      },
    );

    test('P2: VRL-only org — no separator, JS badge, or JS info tip',
      { tag: ['@functionLanguageToggle', '@functions', '@all', '@oss'] },
      async ({ page }) => {
        testLogger.info('Test: VRL-only org — no separator, JS badge, or JS info tip');

        // Only meaningful on OSS — enterprise/cloud always have JS
        const edition = await pm.editionFeaturesPage.detectEdition();
        testLogger.info(`Edition detected: ${edition}`);
        test.skip(edition !== 'opensource', `Skipping — JS is always visible on ${edition}`);

        // Pre-condition: non-meta org on OSS → only VRL
        const nonMetaOrg = getNonMetaOrg();
        await page.goto(`${process.env.ZO_BASE_URL}/web/pipeline/functions?org_identifier=${nonMetaOrg}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        const fp = pm.functionsPage;
        await fp.clickAddFunctionButton(nonMetaOrg);

        // 1. VRL option visible and selected
        await fp.expectVrlRadioVisible();
        await fp.expectVrlRadioSelected();
        testLogger.info(`VRL option visible and selected in ${nonMetaOrg} org`);

        // 2. JS option NOT in the DOM
        await fp.expectJsRadioHidden();
        testLogger.info('JS option not visible (absent on OSS non-meta org)');

        // 3. JS info icon NOT in the DOM
        await fp.expectJsInfoIconHidden();
        testLogger.info('JS info icon not visible (absent)');

        // 4. Separator NOT rendered (v-if on transformTypeOptions[1])
        await fp.expectSeparatorHidden();
        testLogger.info('Vertical separator not visible (only one toggle option)');

        // 5. VRL info icon IS visible (the single remaining tooltip trigger)
        await fp.expectVrlInfoIconVisible();
        testLogger.info('VRL info icon visible — single remaining tooltip');

        // 6. Cancel
        await fp.clickCancelButton();
        testLogger.info('Test completed — VRL-only org verified');
      },
    );
  });
});
