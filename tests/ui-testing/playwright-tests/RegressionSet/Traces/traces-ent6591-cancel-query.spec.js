// traces-ent6591-cancel-query.spec.js
// Traces Regression — "Cancel query" during a search (#6591 item 9)
//
// Item 9 of openobserve#6591: the Cancel query control did not appear after
// clicking Run query, so a long search could not be stopped.
//
// Enterprise-gated, which is why it is not in traces-6591-explorer-state.spec.js:
// SearchBar.vue renders the button behind
//
//     v-if="config.isEnterprise == 'true' && isLoading"
//
// so on an OSS build it cannot exist whatever the loading state, and an OSS run
// of this assertion fails for the edition rather than for the bug.
//
// The traces search streams over `_search_stream`, and against a local instance
// it returns faster than any assertion can run. The spec therefore holds the
// response open so the in-flight state is genuinely observable — without that it
// would pass against a build that never renders the control at all.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { generateMultiHopTrace, ingestTraces } = require('../../utils/service-graph-ingestion.js');

const SEARCH_HOLD_MS = 8000;

function tracesUrl() {
  const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
  const org = process.env['ORGNAME'] || 'default';
  return `${baseUrl}/web/traces?stream=default&period=1h&org_identifier=${org}&tab=spans`;
}

test.describe('Traces search cancellation (#6591 item 9)', { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      const traces = Array.from({ length: 6 }, () => generateMultiHopTrace({ latencyMs: 40 }));
      const result = await ingestTraces(page, traces, { delayMs: 40 });
      expect(result.successful, 'fixture traces must ingest').toBe(traces.length);
      testLogger.info('Ingested cancel-query fixture traces', { count: result.successful });
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await page.goto(tracesUrl());
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('P1: a running search offers a Cancel query control', {
    tag: ['@traces', '@regression', '@P1', '@all'],
  }, async ({ page }) => {
    await page.route('**/_search_stream**', async (route) => {
      await page.waitForTimeout(SEARCH_HOLD_MS);
      await route.continue();
    });

    await page.getByRole('button', { name: 'Run query' }).first().click();

    const cancelBtn = page.locator('[data-test="traces-search-bar-cancel-btn"]');
    await expect(cancelBtn).toBeVisible({ timeout: 15000 });

    // It must also do something: clicking it ends the in-flight search rather
    // than leaving the page spinning.
    await cancelBtn.click();
    await expect(cancelBtn).toBeHidden({ timeout: 20000 });

    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
