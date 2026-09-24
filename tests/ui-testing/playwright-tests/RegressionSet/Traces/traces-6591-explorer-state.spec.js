// traces-6591-explorer-state.spec.js
// Traces Regression — Traces Explorer state and query controls (#6591)
//
// #6591 collected eleven Traces UI defects. This file covers the six that live on
// the Explorer itself; the trace-details ones are in
// traces-6591-details-interactions.spec.js.
//
//   1  the loader was not visible on the Explorer
//   2  the query was reset when coming back from Trace Details
//   3  the results were reset the same way
//   4  the Explorer had no pagination
//   5  "No results found" was shown on the way back, over results that existed
//
// Items 2, 3 and 5 are one round trip, so they are asserted together rather than
// as three separate navigations — splitting them would triple the setup cost and
// still exercise the same transition.
//
// Item 9 ("Cancel query" after Run query) is NOT here: that button is behind
// `config.isEnterprise` in SearchBar.vue, so it cannot exist on the OSS build
// this suite runs against. It lives in traces-ent6591-cancel-query.spec.js.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { generateMultiHopTrace, ingestTraces } = require('../../utils/service-graph-ingestion.js');

// Enough traces that the Explorer must paginate at the default page size.
const FIXTURE_TRACE_COUNT = 12;

function tracesUrl(extra = '') {
  const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
  const org = process.env['ORGNAME'] || 'default';
  return `${baseUrl}/web/traces?stream=default&period=1h&org_identifier=${org}&tab=spans${extra}`;
}

test.describe('Traces Explorer state (#6591)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      const traces = Array.from({ length: FIXTURE_TRACE_COUNT }, () =>
        generateMultiHopTrace({ latencyMs: 40 }),
      );
      const result = await ingestTraces(page, traces, { delayMs: 40 });
      expect(result.successful, 'fixture traces must ingest').toBe(traces.length);
      testLogger.info('Ingested Explorer fixture traces', { count: result.successful });
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await page.evaluate(() => localStorage.removeItem('o2_trace_active_tab'));
    await page.goto(tracesUrl());
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('P1: the Explorer shows a loader while it is still loading', {
    tag: ['@traces', '@regression', '@P1', '@all'],
  }, async ({ page }) => {
    // Hold the stream list open so `loadingStream` stays true long enough to
    // observe. Without this the page settles faster than any assertion can run,
    // and the test would pass against a build that renders no loader at all.
    await page.route('**/api/*/streams**', async (route) => {
      await page.waitForTimeout(5000);
      await route.continue();
    });

    await page.goto(tracesUrl());

    await expect(page.locator('[data-test="traces-search-loading"]')).toBeVisible({
      timeout: 15000,
    });

    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('P1: the query and its results survive a round trip through Trace Details', {
    tag: ['@traces', '@regression', '@P1', '@all'],
  }, async ({ page }) => {
    // A filter that is visibly the user's own, so "preserved" cannot be confused
    // with "reset to the default empty query".
    await page.locator('[data-test="log-search-expand-service_name-field-btn"]').click();
    await page.locator('[data-test^="logs-search-subfield-add-service_name-"]').first().waitFor({
      state: 'visible',
      timeout: 20000,
    });
    await page.locator('[data-test^="logs-search-subfield-add-service_name-"]').first().click();
    await page.getByRole('button', { name: 'Run query' }).first().click();
    await page.waitForTimeout(4000);

    const editorBefore = (await page.locator('.monaco-editor').first().innerText()).trim();
    const headerBefore = (await page.locator('[data-test="traces-section-header"]').innerText()).trim();
    expect(editorBefore, 'precondition: a filter is applied').toContain('service_name');

    await page.locator('table tbody tr').first().locator('td').nth(1).click();
    await expect(page).toHaveURL(/trace-details/, { timeout: 30000 });

    await page.goBack();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Item 2: the query is still the user's.
    const editorAfter = (await page.locator('.monaco-editor').first().innerText()).trim();
    expect(editorAfter).toBe(editorBefore);

    // Item 3: the results came back with it.
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30000 });
    const headerAfter = (await page.locator('[data-test="traces-section-header"]').innerText()).trim();
    expect(headerAfter.split('|')[0]).toBe(headerBefore.split('|')[0]);

    // Item 5: and no empty-state was painted over them.
    const saysNoResults = await page.evaluate(() => /no results found/i.test(document.body.innerText));
    expect(saysNoResults, '"No results found" must not appear over results that exist').toBe(false);
  });

  test('P2: the Explorer paginates its results', {
    tag: ['@traces', '@regression', '@P2', '@all'],
  }, async ({ page }) => {
    await page.getByRole('button', { name: 'Run query' }).first().click();
    await page.waitForTimeout(4000);

    // Item 4: pagination exists and can move off page 1.
    const pagination = page.locator('[data-test="traces-search-result-pagination"]');
    await expect(pagination).toBeVisible({ timeout: 30000 });

    const secondPage = page.locator('[data-test="traces-search-result-pagination-page-2"]');
    await expect(secondPage, 'the fixture must produce more than one page').toBeVisible({
      timeout: 15000,
    });
    await secondPage.click();
    await page.waitForTimeout(3000);
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20000 });
  });
});
