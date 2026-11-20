// tracesScope.spec.js
// Scope switch in the Spans view results bar, and the results Columns button.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');

const ROOT = "(reference_parent_span_id IS NULL OR reference_parent_span_id = '')";

test.describe("Traces scope select testcases", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      await ingestTraces(page, 6, { forceScenario: 'success' });
    } catch (e) {
      testLogger.warn('Scope trace seeding failed (continuing)', { error: e.message });
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.isStreamSelectVisible();
    await pm.tracesPage.selectTraceStream('default');
    await pm.tracesPage.switchToSpansMode();
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("P1: Root spans narrows the list request, and the link restores the select", {
    tag: ['@tracesScope', '@traces', '@query', '@P1', '@all']
  }, async ({ page }) => {
    await expect(pm.tracesPage.getScopeValue()).toHaveAttribute('aria-label', 'All spans');
    const capture = pm.tracesPage.captureSearchRequests();

    await pm.tracesPage.pickScope('root');

    await expect
      .poll(() => capture.requests.filter((r) => r.panel === 'results').map((r) => r.sql), {
        timeout: 20000,
      })
      .toContainEqual(expect.stringContaining(ROOT));
    capture.stop();
    await expect(page).toHaveURL(/[?&]scope=root(&|$)/, { timeout: 10000 });

    await page.reload();
    await pm.tracesPage.isStreamSelectVisible();
    await expect(pm.tracesPage.getScopeValue()).toHaveAttribute('aria-label', 'Root spans', { timeout: 20000 });
  });

  test("P2: Reset returns the scope to All spans and drops it from the link", {
    tag: ['@tracesScope', '@traces', '@P2', '@all']
  }, async ({ page }) => {
    await pm.tracesPage.pickScope('entrypoint');
    await expect(page).toHaveURL(/[?&]scope=entrypoint(&|$)/, { timeout: 10000 });

    await pm.tracesPage.resetAllFilters();

    await expect(pm.tracesPage.getScopeValue()).toHaveAttribute('aria-label', 'All spans');
    await expect(page).not.toHaveURL(/[?&]scope=/, { timeout: 10000 });
  });

  test("P2: Turning SQL mode on writes the scope into the WHERE and hides the select", {
    tag: ['@tracesScope', '@tracesSqlMode', '@traces', '@query', '@P2', '@all']
  }, async () => {
    await pm.tracesPage.setQueryEditorValue('');
    await pm.tracesPage.pickScope('root');
    await expect(pm.tracesPage.getScopeValue()).toHaveAttribute('aria-label', 'Root spans');

    await pm.tracesPage.toggleSqlModeFromToolbar();

    await pm.tracesPage.expectSqlMode(true);
    await pm.tracesPage.expectQueryEditorValue(
      `SELECT * FROM "default" WHERE ${ROOT} ORDER BY start_time DESC`,
    );
    await expect(pm.tracesPage.getScopeSelect()).toHaveCount(0);
  });
});
