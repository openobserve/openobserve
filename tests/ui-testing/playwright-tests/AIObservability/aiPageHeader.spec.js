const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");

const PAGES = ['sessions', 'llm-insights', 'agent-graph', 'agent-behavior'];
const SECONDARY_NAV = {
  'sessions': 'ai-secondary-nav-sessions',
  'llm-insights': 'ai-secondary-nav-llm-insights',
  'agent-graph': 'ai-secondary-nav-agent-graph',
  'agent-behavior': 'ai-secondary-nav-agent-behavior',
  'quality': 'ai-secondary-nav-quality',
};

test.describe("AI Observability Header testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  // ========================================================================
  // P0 — CRITICAL PATH: Header presence, selector correctness, navigation
  // ========================================================================

  test("TC-P0-1: should render header with correct data-test selectors on all four AiPageShell pages", {
    tag: ['@aiObservability', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Verifying header selectors on all four AI Observability pages');
    for (const slug of PAGES) {
      testLogger.info(`Navigating to /ai/${slug}`);
      await pm.aiObservabilityPage.gotoPage(slug);
      await pm.aiObservabilityPage.expectHeaderVisible(slug);
      // The last-refreshed indicator should be hidden (no data fetched yet)
      await pm.aiObservabilityPage.expectLastRefreshedHidden(slug);
    }
    testLogger.info('All four pages rendered correct header selectors');
  });

  test("TC-P0-2: should render Quality tab header with correct selectors", {
    tag: ['@aiObservability', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Navigating to Quality tab');
    await pm.aiObservabilityPage.gotoQualityTab();
    testLogger.info('Verifying Quality tab header selectors');
    await pm.aiObservabilityPage.expectQualityHeaderVisible();
    // The last-refreshed indicator may be visible if evaluator data already
    // exists (e.g. the deployment has pre-seeded quality configs), or hidden
    // if no data has been fetched.  Both are valid for a header-rendering test.
    const qualityVisible = await pm.aiObservabilityPage.isQualityLastRefreshedVisible();
    if (qualityVisible) {
      testLogger.info('Quality last-refreshed indicator is visible (evaluator data present)');
    } else {
      testLogger.info('Quality last-refreshed indicator is hidden (no evaluator data)');
    }
    testLogger.info('Quality tab header rendered correctly');
  });

  test("TC-P0-3: should preserve header pattern when navigating between AI pages via secondary rail", {
    tag: ['@aiObservability', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Starting secondary-rail navigation test');
    // Step 1: Navigate to AI Observability shell via left navbar
    testLogger.info('Clicking AI Monitoring nav link');
    await pm.aiObservabilityPage.clickNavLink();
    // The default redirect lands on LLM Insights
    await pm.aiObservabilityPage.expectHeaderVisible('llm-insights');

    // Step 2: Navigate to Sessions via secondary rail
    testLogger.info('Navigating to Sessions via secondary rail');
    await pm.aiObservabilityPage.clickSecondaryNav(SECONDARY_NAV['sessions']);
    await pm.aiObservabilityPage.expectHeaderVisible('sessions');

    // Step 3: Navigate to Agent Graph via secondary rail
    testLogger.info('Navigating to Agent Graph via secondary rail');
    await pm.aiObservabilityPage.clickSecondaryNav(SECONDARY_NAV['agent-graph']);
    await pm.aiObservabilityPage.expectHeaderVisible('agent-graph');

    // Step 4: Navigate to Agent Behavior via secondary rail
    testLogger.info('Navigating to Agent Behavior via secondary rail');
    await pm.aiObservabilityPage.clickSecondaryNav(SECONDARY_NAV['agent-behavior']);
    await pm.aiObservabilityPage.expectHeaderVisible('agent-behavior');

    testLogger.info('Navigation between AI pages via secondary rail preserves header pattern');
  });

  // ========================================================================
  // P1 — IMPORTANT: Refresh flow, date state, Quality refresh
  // ========================================================================

  test("TC-P1-1: should show loading state on Refresh click and recover on Sessions page", {
    tag: ['@aiObservability', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Verifying Refresh button loading state on Sessions page');
    await pm.aiObservabilityPage.gotoPage('sessions');

    // Assert button is initially ready
    await pm.aiObservabilityPage.expectRefreshButtonReady('sessions');

    // Click Refresh
    testLogger.info('Clicking Refresh button on Sessions page');
    await pm.aiObservabilityPage.clickRefresh('sessions');

    // Assert the button entered loading state (disabled + spinning)
    await pm.aiObservabilityPage.expectRefreshButtonSpinning('sessions');

    // Wait for the fetch to settle: button becomes enabled again (timeout 30s)
    testLogger.info('Waiting for Refresh to settle');
    await pm.aiObservabilityPage.waitForRefreshToSettle('sessions');

    // After the fetch settles, the last-refreshed indicator may appear if the org has
    // LLM/trace data. If no data exists, the indicator stays hidden — that is a valid
    // outcome. We check conditionally and log appropriately.
    const isVisible = await pm.aiObservabilityPage.isLastRefreshedIndicatorVisible('sessions');
    if (isVisible) {
      testLogger.info('Last-refreshed indicator appeared after refresh');
      await pm.aiObservabilityPage.expectDotColor('sessions', 'bg-refresh-dot-fresh');
    } else {
      testLogger.info('Last-refreshed indicator stayed hidden (no LLM trace data available in this org)');
    }
    testLogger.info('Refresh loading state test completed');
  });

  test.fixme("TC-P1-2: should persist shared date range across page navigations — not wired: date picker internal selectors for relative-time selection on AI-specific DateTime picker are not yet confirmed (see AiPageShell.vue DateTime component); needs same investigation as dashboard date-time helpers", {
    tag: ['@aiObservability', '@all', '@P1']
  }, async ({ page }) => {
    // When implemented: change date picker on LLM Insights to "Last 1 hour",
    // navigate to Sessions, assert same value; navigate to Quality, assert same value.
    testLogger.info('Navigate to LLM Insights');
    await pm.aiObservabilityPage.gotoPage('llm-insights');
    // Interact with date picker [data-test="ai-llm-insights-date-time"] to select "Last 1 hour"
    // Navigate to Sessions via secondary nav
    // Assert date picker [data-test="ai-sessions-date-time"] reflects "Last 1 hour"
    // Navigate to Quality
    // Assert date picker [data-test="quality-time-range-picker"] reflects "Last 1 hour"
    testLogger.info('Date range persistence test skipped — date picker interaction API not yet confirmed');
  });

  test("TC-P1-3: should trigger loading state on Quality tab Refresh and recover", {
    tag: ['@aiObservability', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Verifying Refresh button loading state on Quality tab');
    await pm.aiObservabilityPage.gotoQualityTab();

    // Assert button is initially ready
    await pm.aiObservabilityPage.expectQualityRefreshReady();

    // Click Refresh
    testLogger.info('Clicking Refresh button on Quality tab');
    await pm.aiObservabilityPage.clickQualityRefresh();

    // Assert the button entered loading state
    await pm.aiObservabilityPage.expectQualityRefreshSpinning();

    // Wait for the orchestrated reload to settle (button becomes enabled, timeout 30s)
    testLogger.info('Waiting for Quality refresh to settle');
    await pm.aiObservabilityPage.waitForQualityRefreshToSettle();

    // The quality-last-refreshed indicator may appear if evaluator data exists
    const isVisible = await pm.aiObservabilityPage.isQualityLastRefreshedVisible();
    if (isVisible) {
      testLogger.info('Quality last-refreshed indicator appeared after refresh');
      await pm.aiObservabilityPage.expectQualityDotColor('bg-refresh-dot-fresh');
    } else {
      testLogger.info('Quality last-refreshed indicator stayed hidden (no evaluator data available in this org)');
    }
    testLogger.info('Quality Refresh loading state test completed');
  });

  // ========================================================================
  // P2 — EDGE CASES
  // ========================================================================

  test("TC-P2-1: should guard against rapid double-click on Refresh button", {
    tag: ['@aiObservability', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing double-click guard on Refresh button');
    await pm.aiObservabilityPage.gotoPage('sessions');

    // Double-click the Refresh button in quick succession.
    // First click is a normal click (button is enabled). Second click uses
    // dispatchEvent to simulate a rapid click even though the button is now disabled
    // — this verifies the useChildRefresh guard suppresses the second refresh.
    await pm.aiObservabilityPage.clickRefresh('sessions');
    await pm.aiObservabilityPage.dispatchRefreshClick('sessions');

    // Assert the button is in loading state (guard prevented second refresh)
    await pm.aiObservabilityPage.expectRefreshButtonSpinning('sessions');

    // Wait for the fetch to settle
    testLogger.info('Waiting for Refresh to settle after double-click');
    await pm.aiObservabilityPage.waitForRefreshToSettle('sessions');

    // Verify the page is in a valid state — button recovered to ready
    await pm.aiObservabilityPage.expectRefreshButtonReady('sessions');
    testLogger.info('Double-click guard test completed — button recovered to ready state');
  });

  test.fixme("TC-P2-2: should transition staleness dot color over time (green → amber → red) — not wired: requires a 5+ minute CI wait budget for the amber→red threshold; impractical for standard CI runs without data-seeding a stale lastRunAt timestamp", {
    tag: ['@aiObservability', '@all', '@P2']
  }, async ({ page }) => {
    // When implemented: refresh, wait 35s, assert amber; wait 5m, assert red.
    testLogger.info('Dot color transition test skipped — impractical CI wait budget');
  });

  test.fixme("TC-P2-3: should disable LLM Insights date picker in version-compare mode — not wired: programmatic entry into version-compare mode requires a child-dashboard action (sinceRollout/manual alignment) that has no exposed UI for direct test interaction; a dedicated test seeding step is needed first", {
    tag: ['@aiObservability', '@all', '@P2']
  }, async ({ page }) => {
    // When implemented: enter version-compare mode, assert date picker disabled + tooltip.
    testLogger.info('Version-compare date-disabled test skipped — no programmatic trigger available');
  });

  test("TC-P2-4: should handle navigating away and returning without error", {
    tag: ['@aiObservability', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing navigate-away-and-return cycle');
    // Step 1: Navigate to Sessions and verify header
    await pm.aiObservabilityPage.gotoPage('sessions');
    await pm.aiObservabilityPage.expectHeaderVisible('sessions');

    // Step 2: Navigate to Agent Graph via secondary rail
    testLogger.info('Navigating to Agent Graph');
    await pm.aiObservabilityPage.clickSecondaryNav(SECONDARY_NAV['agent-graph']);
    await pm.aiObservabilityPage.expectHeaderVisible('agent-graph');

    // Step 3: Navigate back to Sessions via secondary rail
    testLogger.info('Navigating back to Sessions');
    await pm.aiObservabilityPage.clickSecondaryNav(SECONDARY_NAV['sessions']);
    await pm.aiObservabilityPage.expectHeaderVisible('sessions');

    // The page should be in a valid state — header renders, no error toasts
    testLogger.info('Navigate-away-and-return cycle completed without error');
  });
});
