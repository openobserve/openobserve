// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const path = require('path');

const authFile = path.join(__dirname, '../../utils/auth/user.json');
const org = process.env.ORGNAME || 'default';

const JS_BODY = 'function transform(row){ row.guarded = true; return row; }';

// Regression guards for openobserve#15069. A 403 is unreachable on OSS, so the create call is intercepted.
test.describe(
  'Function import — rejections that cannot be fixed inline',
  { tag: ['@functions', '@regression', '@all'] },
  () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
    });

    test.afterAll(async ({ browser }) => {
      try {
        const context = await browser.newContext({ storageState: authFile });
        const page = await context.newPage();
        try {
          await new PageManager(page).apiCleanup.cleanupFunctionsInOrg(org, [
            /^fn_regr_reject_/,
          ]);
        } finally {
          await context.close();
        }
      } catch (error) {
        testLogger.warn(`Function cleanup failed: ${error.message}`);
      }
    });

    test(
      'should import a snake_case trans_type as the language it declares',
      { tag: ['@P1'] },
      async ({ page }) => {
        const name = `fn_regr_reject_snake_${Date.now()}`;

        await pm.functionsImportExport.navigateToImport(org);
        await pm.functionsImportExport.setImportJsonViaMonaco(
          JSON.stringify([{ name, function: JS_BODY, params: 'row', trans_type: 1 }]),
        );
        await pm.functionsImportExport.runImportAndWaitForList();

        // A JavaScript body sent as VRL would have been refused with a syntax
        // error, so landing in the list at all is half the assertion.
        await pm.functionsPage.searchFunction(name);
        await pm.functionsPage.expectFunctionInList(name);

        // The other half: it is stored as JavaScript, not VRL.
        await pm.functionsPage.expectFunctionTypeIsJavaScript();
        testLogger.info('Test completed');
      },
    );

    test(
      'should offer nothing to retype when the server refuses the user',
      { tag: ['@P1'] },
      async ({ page }) => {
        const name = `fn_regr_reject_403_${Date.now()}`;

        // The only route to a 403 on an OSS build.
        await page.route('**/api/*/functions', async (route) => {
          if (route.request().method() === 'POST') {
            await route.fulfill({
              status: 403,
              contentType: 'application/json',
              body: JSON.stringify({ code: 403, message: 'Unauthorized Access' }),
            });
            return;
          }
          await route.fallback();
        });

        await pm.functionsImportExport.navigateToImport(org);
        await pm.functionsImportExport.setImportJsonViaMonaco(
          JSON.stringify([{ name, function: '.a = 1', params: 'row', transType: 0 }]),
        );
        await pm.functionsImportExport.runImport();

        // The refusal is reported in the results list, in the server's own words.
        await pm.functionsImportExport.expectImportResult(0, 'Unauthorized Access');
        await pm.functionsImportExport.waitForImportSettled();

        // It is NOT an interactive error, and retyping a body cannot grant a
        // permission — offering either control is the defect.
        await pm.functionsImportExport.expectNoImportError(0, 0);
        await pm.functionsImportExport.expectNoInlineFixControls(0);
        testLogger.info('Test completed');
      },
    );

    test(
      'should not report an import as successful when every item was refused',
      { tag: ['@P0'] },
      async ({ page }) => {
        const name = `fn_regr_reject_nosuccess_${Date.now()}`;

        await page.route('**/api/*/functions', async (route) => {
          if (route.request().method() === 'POST') {
            await route.fulfill({
              status: 403,
              contentType: 'application/json',
              body: JSON.stringify({ code: 403, message: 'Unauthorized Access' }),
            });
            return;
          }
          await route.fallback();
        });

        await pm.functionsImportExport.navigateToImport(org);
        await pm.functionsImportExport.setImportJsonViaMonaco(
          JSON.stringify([{ name, function: '.a = 1', params: 'row', transType: 0 }]),
        );
        await pm.functionsImportExport.runImport();
        await pm.functionsImportExport.expectImportResult(0, 'Unauthorized Access');
        await pm.functionsImportExport.waitForImportSettled();
        await pm.functionsImportExport.expectNoImportError(0, 0);

        // The screen redirects itself on success, so still being here is the
        // assertion: nothing was written, and the user is not told otherwise.
        await pm.functionsImportExport.expectStillOnImportScreen();

        // And no function reached the org.
        await page.unroute('**/api/*/functions');
        await pm.functionsPage.navigate(org);
        await pm.functionsPage.searchFunction(name);
        await pm.functionsPage.expectFunctionAbsent(name);
        testLogger.info('Test completed');
      },
    );
  },
);
