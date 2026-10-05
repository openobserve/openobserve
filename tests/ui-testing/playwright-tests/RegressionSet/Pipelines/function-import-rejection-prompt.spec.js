// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const path = require('path');

const authFile = path.join(__dirname, '../../utils/auth/user.json');
const org = process.env.ORGNAME || 'default';

const JS_BODY = 'function transform(row){ row.guarded = true; return row; }';

/**
 * Regression: the function import screen mishandled the language key and every
 * failure it could not fix.
 *
 * Three defects, all fixed in openobserve#15069:
 *
 *   1. Validation and the payload builder read only `item.transType`, so a file
 *      spelling it `trans_type` — the natural guess, since the rest of the
 *      product's payloads are snake_case — was ignored. A JavaScript body went
 *      out declared as VRL and failed to compile, with nothing on screen saying
 *      why.
 *   2. Any failure that was not `already exist` was offered a language dropdown
 *      and a body editor. For a 403, a 500 or a dropped connection those fix
 *      nothing: the user was told to retype a body that was never the problem.
 *   3. Worst of the three, and only reachable once (2) was fixed: the import loop
 *      decided success by counting failures that carried fix-up controls. A
 *      failure with no controls contributed no group, so a run where EVERY item
 *      was refused toasted success and navigated to the list — telling the user
 *      the import worked when nothing had been written.
 *
 * (2) and (3) are driven by intercepting the create call, which is the only way
 * to reach a 403 on an OSS build. The unit tests assert the pushed values; these
 * assert what the user is actually shown, which is where (3) hid.
 */
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
