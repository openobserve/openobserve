// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

const authFile = path.join(__dirname, '../utils/auth/user.json');
const org = process.env.ORGNAME || 'default';

test.describe('Functions Import & Export testcases', { tag: ['@functions-import-export', '@functions', '@all'] }, () => {
  // Sequential on purpose. Every test here shares one org's function list, and
  // the afterAll cleanup deletes by name prefix across the whole org — under
  // `mode: 'parallel'` a worker that finishes first wipes functions the other
  // workers are still asserting on. Playwright still runs this file in parallel
  // with the rest of the shard.
  test.describe.configure({ mode: 'default' });
  let pm;
  // Pipelines created by tests here; functions are cleaned by name prefix but
  // a pipeline holding a function open would block its delete.
  const createdPipelineIds = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test.afterAll(async ({ browser }) => {
    // Clean up every function this spec created (shared prefixes, unique per run).
    try {
      const cleanupContext = await browser.newContext({ storageState: authFile });
      const cleanupPage = await cleanupContext.newPage();
      try {
        const cleanupPm = new PageManager(cleanupPage);
        // Pipelines first: a function still referenced by one cannot be deleted.
        for (const id of createdPipelineIds) {
          await cleanupPm.apiCleanup.deletePipeline(id).catch(() => {});
        }
        await cleanupPm.apiCleanup.cleanupFunctionsInOrg(org, [/^fn_e2e_/, /^fn_export/, /^fn_clash/]);
      } finally {
        await cleanupContext.close();
      }
    } catch (error) {
      testLogger.warn(`Function cleanup failed: ${error.message}`);
    }
  });

  test('should export a single function as a correctly-named JSON object', { tag: ['@P0'] }, async ({ page }) => {
    testLogger.info('Test: single function export downloads a single-object JSON');
    const name = `fn_export_single_${Date.now()}`;

    await pm.apiCleanup.createFunction(name, '. = .', org);
    await pm.functionsPage.navigate(org);
    await pm.functionsPage.searchFunction(name);
    await pm.functionsPage.expectFunctionInList(name);

    const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
    await pm.functionsImportExport.clickSingleExport(name);
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(`${name}.json`);
    const payload = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(payload.name).toBe(name);
    expect(payload.function).toBe('. = .');
    expect(payload.params).toBe('row');
    expect(payload.transType).toBe(0);
    testLogger.info('Test completed');
  });

  test('should import a single valid VRL function and show it in the list', { tag: ['@P0', '@smoke'] }, async () => {
    testLogger.info('Test: import a single valid VRL function (happy path)');
    const name = `fn_e2e_import_${Date.now()}`;

    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.setImportJsonViaMonaco(
      JSON.stringify({ name, function: '. = .', params: 'row', transType: 0 }),
    );
    await pm.functionsImportExport.runImport();

    // Import success redirects back to the list after ~400ms — assert the created row.
    await pm.functionsPage.expectFunctionInList(name);
    testLogger.info('Test completed');
  });

  test('should bulk export selected functions as a dated JSON array', { tag: ['@P0'] }, async ({ page }) => {
    testLogger.info('Test: bulk export of selected functions');
    const prefix = `fn_export_bulk_${Date.now()}`;
    const a = `${prefix}_a`;
    const b = `${prefix}_b`;

    await pm.apiCleanup.createFunction(a, '. = .', org);
    await pm.apiCleanup.createFunction(b, '. = .', org);
    await pm.functionsPage.navigate(org);
    await pm.functionsPage.searchFunction(prefix);
    await pm.functionsPage.expectFunctionInList(a);
    await pm.functionsPage.expectFunctionInList(b);

    await pm.functionsImportExport.selectFunctionRow(a);
    await pm.functionsImportExport.selectFunctionRow(b);
    await pm.functionsImportExport.expectBulkExportVisible();

    const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
    await pm.functionsImportExport.clickBulkExport();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^functions-\d{4}-\d{2}-\d{2}\.json$/);
    const payload = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(Array.isArray(payload)).toBe(true);
    expect(payload.map((p) => p.name).sort()).toEqual([a, b].sort());
    testLogger.info('Test completed');
  });

  test('should render inline fix-up controls for validation errors and re-import after fixing', { tag: ['@P1'] }, async () => {
    testLogger.info('Test: validation errors render inline fix-up and re-import');
    const fixedName = `fn_e2e_fixed_${Date.now()}`;
    const secondName = `fn_e2e_fix_${Date.now()}`;

    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.setImportJsonViaMonaco(
      JSON.stringify([
        { name: '1bad', function: '. = .', params: 'row', transType: 0 },
        { name: secondName, function: '', params: 'row', transType: 0 },
      ]),
    );
    await pm.functionsImportExport.runImport();

    // Invalid name (item 0) and missing body (item 1) both render an error line.
    await pm.functionsImportExport.expectImportError(0, 0);
    await pm.functionsImportExport.expectImportError(1, 0);

    await pm.functionsImportExport.renameImportItem(0, fixedName);
    await pm.functionsImportExport.setImportBody(1, '. = .');
    await pm.functionsImportExport.runImport();

    // Redirects back to the list; both corrected items import.
    await pm.functionsPage.expectFunctionInList(fixedName);
    await pm.functionsPage.expectFunctionInList(secondName);
    testLogger.info('Test completed');
  });

  test('should resolve an existing-name clash by overriding the function', { tag: ['@P1'] }, async ({ page }) => {
    testLogger.info('Test: existing-name clash resolves via override');
    const name = `fn_clash_${Date.now()}`;

    // existingNames is loaded once per org — create the clash function before navigating.
    await pm.apiCleanup.createFunction(name, '. = .', org);
    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.setImportJsonViaMonaco(
      JSON.stringify({ name, function: '.overridden = true', params: 'row', transType: 0 }),
    );
    await pm.functionsImportExport.runImport();

    await pm.functionsImportExport.expectImportError(0, 0);
    await pm.functionsImportExport.expectOverrideCheckboxVisible(0);

    await pm.functionsImportExport.overrideImportItem(0);
    await pm.functionsImportExport.runImport();

    // Redirects back to the list; verify the override wrote the new body via export.
    await pm.functionsPage.expectFunctionInList(name);
    const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
    await pm.functionsImportExport.clickSingleExport(name);
    const download = await downloadPromise;
    const payload = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    // The server normalises a VRL body that does not already end in `.` by
    // appending " \n ." — assert the override landed, not the exact stored text.
    expect(payload.function).toContain('.overridden = true');
    testLogger.info('Test completed');
  });

  test('should surface a toast and not write when the JSON is malformed', { tag: ['@P1'] }, async () => {
    testLogger.info('Test: malformed JSON surfaces a toast without writing');
    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.setImportJsonViaMonaco('{not valid json');
    await pm.functionsImportExport.runImport();

    // The parse error message is browser-dependent, so assert a toast surfaced
    // and that no import result was written (no write, no redirect).
    await pm.functionsImportExport.expectToastVisible();
    await pm.functionsImportExport.expectNoImportResult();
    testLogger.info('Test completed');
  });

  test('should surface a "no functions found" toast for an empty array', { tag: ['@P2'] }, async () => {
    testLogger.info('Test: empty array surfaces "no functions found" toast');
    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.setImportJsonViaMonaco('[]');
    await pm.functionsImportExport.runImport();

    await pm.functionsImportExport.expectToast('No functions found to import');
    testLogger.info('Test completed');
  });

  // ---------------------------------------------------------------------------
  // Round trip, alternate import sources, and the regression guards the vitest
  // unit tests cannot reach (real downloads, real FileReader, real axios, SPA
  // routing, narrow viewports).
  // ---------------------------------------------------------------------------

  /** Write JSON to a uniquely-named temp .json file and return its path. */
  function writeTempJson(label, value) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `o2-fn-import-${label}-`));
    const file = path.join(dir, `${label}.json`);
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
    return file;
  }

  test('should round trip a function through export, delete and re-import', { tag: ['@P0', '@smoke'] }, async ({ page }) => {
    testLogger.info('Test: export -> delete -> import the exported file restores the function');
    const name = `fn_e2e_roundtrip_${Date.now()}`;
    const body = '.roundtrip = true';

    await pm.apiCleanup.createFunction(name, body, org);
    await pm.functionsPage.navigate(org);
    await pm.functionsPage.searchFunction(name);
    await pm.functionsPage.expectFunctionInList(name);

    // Export the real file the user would get.
    const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
    await pm.functionsImportExport.clickSingleExport(name);
    const download = await downloadPromise;
    const exportedPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'o2-fn-roundtrip-')),
      download.suggestedFilename(),
    );
    await download.saveAs(exportedPath);

    // Delete it, so the import has to genuinely recreate it.
    await pm.functionsPage.deleteFunctionByName(name, org);
    await pm.functionsPage.expectFunctionAbsent(name);

    // Import the very file that was exported.
    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.uploadImportFile(exportedPath);
    await pm.functionsImportExport.runImportAndWaitForList();

    await pm.functionsPage.searchFunction(name);
    await pm.functionsPage.expectFunctionInList(name);

    // And the restored body is the one that was exported.
    const verifyDownload = page.waitForEvent('download', { timeout: 20000 });
    await pm.functionsImportExport.clickSingleExport(name);
    const restored = JSON.parse(fs.readFileSync(await (await verifyDownload).path(), 'utf8'));
    expect(restored.name).toBe(name);
    expect(restored.function).toContain('.roundtrip = true');
    testLogger.info('Test completed');
  });

  test('should import several functions from an uploaded file', { tag: ['@P0'] }, async () => {
    testLogger.info('Test: file upload imports every function in the array');
    const stamp = Date.now();
    const names = [`fn_e2e_file_a_${stamp}`, `fn_e2e_file_b_${stamp}`, `fn_e2e_file_c_${stamp}`];
    const file = writeTempJson(
      'multi',
      names.map((name) => ({ name, function: '. = .', params: 'row', transType: 0 })),
    );

    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.uploadImportFile(file);
    await pm.functionsImportExport.runImportAndWaitForList();

    for (const name of names) {
      await pm.functionsPage.searchFunction(name);
      await pm.functionsPage.expectFunctionInList(name);
    }
    testLogger.info('Test completed');
  });

  test('should import a function fetched from a URL', { tag: ['@P1'] }, async ({ page }) => {
    testLogger.info('Test: URL import fetches the document and imports it');
    const name = `fn_e2e_url_${Date.now()}`;
    const fixtureUrl = 'https://o2-e2e.invalid/functions-fixture.json';

    // The screen axios-GETs the URL from the page, so fulfil it in the browser —
    // no public host, no CORS flakiness, same code path.
    await page.route(fixtureUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify([{ name, function: '. = .', params: 'row', transType: 0 }]),
      }),
    );

    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.switchToUrlTab();
    await pm.functionsImportExport.fillImportUrl(fixtureUrl);
    await pm.functionsImportExport.runImportAndWaitForList();

    await pm.functionsPage.searchFunction(name);
    await pm.functionsPage.expectFunctionInList(name);
    testLogger.info('Test completed');
  });

  test('should render the server VRL compile error and hold the import screen', { tag: ['@P1'] }, async () => {
    testLogger.info('Test: a VRL body the server cannot compile is reported in place');
    const name = `fn_e2e_badvrl_${Date.now()}`;

    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.setImportJsonViaMonaco(
      JSON.stringify({ name, function: 'this is >>> not vrl', params: 'row', transType: 0 }),
    );
    await pm.functionsImportExport.runImport();

    // The body passes this screen's own checks, so the item is actually sent and
    // the server's compile error is what comes back.
    await pm.functionsImportExport.expectImportResult(0, name);
    await pm.functionsImportExport.expectImportError(0, 0);
    await pm.functionsImportExport.expectStillOnImportScreen();

    // Nothing was written.
    const functions = await pm.apiCleanup.fetchFunctionsInOrg(org);
    expect(functions.some((f) => f.name === name)).toBe(false);
    testLogger.info('Test completed');
  });

  test('should answer a name clash by renaming, leaving the original untouched', { tag: ['@P1'] }, async ({ page }) => {
    testLogger.info('Test: renaming is the default way out of a clash; the original is not rewritten');
    const existing = `fn_clash_keep_${Date.now()}`;
    const renamed = `fn_e2e_renamed_${Date.now()}`;

    await pm.apiCleanup.createFunction(existing, '.original = true', org);

    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.setImportJsonViaMonaco(
      JSON.stringify({ name: existing, function: '.incoming = true', params: 'row', transType: 0 }),
    );
    await pm.functionsImportExport.runImport();

    // First press: the screen knows the name is taken and says so before it
    // sends anything, so nothing is written and the rename box is offered.
    await pm.functionsImportExport.expectImportError(0, 0);
    await pm.functionsImportExport.expectOverrideCheckboxVisible(0);

    // Take the rename route rather than ticking override.
    await pm.functionsImportExport.renameImportItem(0, renamed);
    await pm.functionsImportExport.runImportAndWaitForList();

    await pm.functionsPage.searchFunction(renamed);
    await pm.functionsPage.expectFunctionInList(renamed);

    // The function that was already there still has its own body.
    await pm.functionsPage.searchFunction(existing);
    const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
    await pm.functionsImportExport.clickSingleExport(existing);
    const payload = JSON.parse(fs.readFileSync(await (await downloadPromise).path(), 'utf8'));
    expect(payload.function).toContain('.original = true');
    expect(payload.function).not.toContain('.incoming');
    testLogger.info('Test completed');
  });

  test('should show the imported function without a page reload', { tag: ['@P1'] }, async ({ page }) => {
    testLogger.info('Test: the list updates in place after an import (no refresh needed)');
    const name = `fn_e2e_noreload_${Date.now()}`;

    await pm.functionsImportExport.navigateToImport(org);
    // Survives a client-side route change; a full document load would clear it.
    await page.evaluate(() => {
      window.__o2NoReloadMarker = true;
    });

    await pm.functionsImportExport.setImportJsonViaMonaco(
      JSON.stringify({ name, function: '. = .', params: 'row', transType: 0 }),
    );
    await pm.functionsImportExport.runImport();

    // Import redirects back to the list on its own; the row is there already.
    await pm.functionsPage.expectFunctionInList(name);
    expect(await page.evaluate(() => window.__o2NoReloadMarker === true)).toBe(true);
    testLogger.info('Test completed');
  });

  test('should keep import and export reachable at 375px', { tag: ['@P2'] }, async ({ page }) => {
    testLogger.info('Test: narrow viewport keeps Import in the header and Export in the row menu');
    const name = `fn_export_mobile_${Date.now()}`;

    await pm.apiCleanup.createFunction(name, '. = .', org);
    await page.setViewportSize({ width: 375, height: 812 });
    await pm.functionsPage.navigate(org);
    await pm.functionsPage.searchFunction(name);
    await pm.functionsPage.expectFunctionInList(name);

    await pm.functionsImportExport.expectListImportButtonVisible();

    // At this width the row actions collapse into the overflow menu.
    const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
    await pm.functionsImportExport.clickExportFromRowMenu(name);
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${name}.json`);
    testLogger.info('Test completed');
  });

  test('should round trip a JavaScript function without rewriting it as VRL', { tag: ['@P1'] }, async ({ page }) => {
    testLogger.info('Test: a JS function keeps transType 1 and an unsuffixed body across export/import');
    const name = `fn_e2e_js_${Date.now()}`;
    const jsBody = 'function transform(row){ row.js = 1; return row; }';

    // Created through the API because the Add form offers JS only where the
    // build allows it; the import path itself is what is under test here.
    await pm.apiCleanup.createJsFunction(name, jsBody, org);
    await pm.functionsPage.navigate(org);
    await pm.functionsPage.searchFunction(name);
    await pm.functionsPage.expectFunctionInList(name);

    const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
    await pm.functionsImportExport.clickSingleExport(name);
    const download = await downloadPromise;
    const payload = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));

    // A JS body is not VRL, so it must not pick up the trailing " \n ." the
    // server appends to VRL, and its language must survive the export.
    expect(payload.transType).toBe(1);
    expect(payload.function).toBe(jsBody);

    // Re-import it under a new name and the language still holds.
    const reimported = `fn_e2e_js_back_${Date.now()}`;
    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.setImportJsonViaMonaco(
      JSON.stringify({ ...payload, name: reimported }),
    );
    await pm.functionsImportExport.runImportAndWaitForList();

    await pm.functionsPage.searchFunction(reimported);
    await pm.functionsPage.expectFunctionInList(reimported);

    const stored = (await pm.apiCleanup.fetchFunctionsInOrg(org)).find((f) => f.name === reimported);
    expect(stored.transType).toBe(1);
    expect(stored.function).toBe(jsBody);
    testLogger.info('Test completed');
  });

  test('should reject a file that names the same function twice', { tag: ['@P1'] }, async () => {
    testLogger.info('Test: a name repeated inside one file is caught before anything is sent');
    const name = `fn_e2e_dup_${Date.now()}`;

    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.setImportJsonViaMonaco(
      JSON.stringify([
        { name, function: '.first = true', params: 'row', transType: 0 },
        { name, function: '.second = true', params: 'row', transType: 0 },
      ]),
    );
    await pm.functionsImportExport.runImport();

    // The second item is the duplicate, so that is the one that carries the error.
    await pm.functionsImportExport.expectImportError(0, 0);
    await pm.functionsImportExport.expectStillOnImportScreen();

    // This is a shape problem, so it is caught before anything is written.
    const functions = await pm.apiCleanup.fetchFunctionsInOrg(org);
    expect(functions.some((f) => f.name === name)).toBe(false);
    testLogger.info('Test completed');
  });

  test('should name the pipelines an override would affect', { tag: ['@P1'] }, async () => {
    testLogger.info('Test: choosing Override warns which pipelines depend on the function');
    const name = `fn_clash_dep_${Date.now()}`;
    const pipelineName = `fn_e2e_pl_${Date.now()}`;

    await pm.apiCleanup.createFunction(name, '.original = true', org);
    createdPipelineIds.push(await pm.apiCleanup.createPipelineUsingFunction(pipelineName, name, 'e2e_automate', org));

    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.setImportJsonViaMonaco(
      JSON.stringify({ name, function: '.replaced = true', params: 'row', transType: 0 }),
    );
    await pm.functionsImportExport.runImport();

    await pm.functionsImportExport.expectOverrideCheckboxVisible(0);
    // The warning is a consequence of choosing to replace, so it is not shown
    // until the box is ticked.
    await pm.functionsImportExport.expectOverrideDependentsHidden(0);

    await pm.functionsImportExport.overrideImportItem(0);
    await pm.functionsImportExport.expectOverrideDependents(0, pipelineName);
    testLogger.info('Test completed');
  });

  test('should let the fix-up controls repair an entry that is not an object', { tag: ['@P1'] }, async ({ page }) => {
    testLogger.info('Test: a bare string / null entry can still be fixed in place');
    const stamp = Date.now();

    // Regression guard. These entries get the same fix-up controls as any other
    // rejected item, but the controls used to have nowhere to write: a bare
    // string threw "Cannot create property 'name' on string", a null was
    // silently ignored. Either way the typed name never reached the document
    // and the item could never be fixed.
    for (const [label, entry] of [
      ['string', 'just a string'],
      ['null', null],
    ]) {
      const name = `fn_e2e_nonobj_${label}_${stamp}`;
      const pageErrors = [];
      const onPageError = (error) => pageErrors.push(error.message);
      page.on('pageerror', onPageError);

      await pm.functionsImportExport.navigateToImport(org);
      await pm.functionsImportExport.setImportJsonViaMonaco(JSON.stringify([entry]));
      await pm.functionsImportExport.runImport();

      // The item is rejected and offered the inline fixers.
      await pm.functionsImportExport.expectImportError(0, 0);

      // Both fixers must land in the document.
      await pm.functionsImportExport.renameImportItem(0, name);
      await pm.functionsImportExport.setImportBody(0, '.fixed = true');
      // Scoped to the defect: the editor emits unrelated "invalid dom" noise.
      expect(
        pageErrors.filter((message) => /Cannot (create|assign to read only) property/i.test(message)),
        `a ${label} entry must not throw when the fixers write to it`,
      ).toEqual([]);

      await pm.functionsImportExport.runImportAndWaitForList();
      await pm.functionsPage.searchFunction(name);
      await pm.functionsPage.expectFunctionInList(name);

      page.off('pageerror', onPageError);
    }
    testLogger.info('Test completed');
  });

  test('should make an imported function usable from the Logs function dropdown', { tag: ['@P0', '@smoke'] }, async ({ page }) => {
    testLogger.info('Test: a function that was imported can be applied to a logs search');
    const name = `fn_e2e_logsuse_${Date.now()}`;
    const marker = 'imported_marker';

    // Import it the way a user would, rather than seeding it over the API —
    // the point of the test is that what the import wrote is a real, usable
    // function and not just a row in a list.
    await pm.functionsImportExport.navigateToImport(org);
    await pm.functionsImportExport.setImportJsonViaMonaco(
      JSON.stringify({ name, function: `.${marker} = "yes"`, params: 'row', transType: 0 }),
    );
    await pm.functionsImportExport.runImportAndWaitForList();

    // The search bar collapses its controls at narrow widths and the function
    // dropdown is one of the first to go, so give it room.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await pm.logsPage.navigateToLogs(org);
    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.toggleVrlEditor();

    // Offered by name in the dropdown, and choosing it loads its body.
    await pm.logsPage.selectSavedFunction(name);
    // getVrlEditorContent() scrapes the rendered editor: the gutter's line
    // numbers are glued to the start of each line and the gaps come back as
    // non-breaking spaces, so normalise before matching the body.
    const applied = (await pm.logsPage.getVrlEditorContent()).replace(/\s+/g, ' ');
    expect(applied).toContain(`${marker} = "yes"`);

    // And it actually runs: the field it adds comes back on the results.
    await pm.logsPage.clickRefreshButton();
    await expect
      .poll(async () => await page.locator('body').innerText(), {
        timeout: 60000,
        intervals: [1000, 2000, 3000],
      })
      .toContain(marker);
    testLogger.info('Test completed');
  });
});
