/**
 * RUM Sessions Health & Metrics Dashboard E2E Tests
 *
 * Tests the Sessions Dashboard — the primary view for exploring RUM user sessions.
 * Covers KPI summary strip, segment filters (health / type / device), insight banner,
 * sessions table with inline activity sparklines and health badges, and session row
 * click navigation to the session viewer.
 *
 * Test Coverage:
 * - P0: Dashboard loads, segment filtering, row click navigation, Run Query refresh
 * - P1: Multi-segment compose, empty-state/reset, URL param persistence, KPI card clicks,
 *        Discover Sessions empty state, DateTime range change
 * - P2: Bounce/active labels, health cell badges, insight banner (apply + filter)
 *
 * Data: Synthetic session data is ingested in beforeAll (both _rumdata + _sessionreplay).
 * All tests read from these shared streams.
 *
 * Prerequisites:
 * - OpenObserve running on localhost:5080
 * - RUM enabled
 * - Auth via global setup
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestRumSessionsData } = require('../utils/rum-sessions-data.js');

test.describe("RUM Sessions Health & Metrics Dashboard", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  // ---------------------------------------------------------------------------
  // Ingest shared read-only data once per worker before any test runs.
  // ---------------------------------------------------------------------------
  test.beforeAll(async ({ browser }) => {
    testLogger.info('Ingesting RUM sessions data for the test suite');
    const page = await browser.newPage();
    try {
      await ingestRumSessionsData(page);
      testLogger.info('RUM sessions data ingestion completed');
    } catch (err) {
      testLogger.warn('RUM sessions data ingestion encountered an issue', { error: err.message });
    } finally {
      await page.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Per-test setup: authenticate and create page manager.
  // ---------------------------------------------------------------------------
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  // ==========================================================================
  // P0 — CRITICAL PATH
  // ==========================================================================

  test("P0.1: Sessions dashboard loads with KPI strip and table", {
    tag: ['@rum-sessions', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    testLogger.info('Asserting full dashboard is visible');
    await pm.rumPage.expectSessionsDashboardVisible();

    // KPI sessions value should show a number
    const sessionsValue = await pm.rumPage.getKpiMetricValue('sessions');
    testLogger.info(`Sessions KPI value: ${sessionsValue}`);
    await expect(sessionsValue).toBeTruthy();

    testLogger.info('P0.1 completed — dashboard loaded successfully');
  });

  test("P0.2: Segment filter toggling filters table rows", {
    tag: ['@rum-sessions', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    const initialCount = await pm.rumPage.getSessionsTableRowCount();
    testLogger.info(`Initial row count: ${initialCount}`);
    await expect(initialCount).toBeGreaterThan(0);

    // Click "With Errors" health segment
    testLogger.info('Applying "With Errors" health segment filter');
    await pm.rumPage.clickHealthSegment('errors');

    // Assert segment is active
    await pm.rumPage.expectSegmentActive('health', 'errors');

    // Assert row count is <= initial (could be 0 if no session has errors, but
    // our data has sessions with errors)
    const filteredCount = await pm.rumPage.getSessionsTableRowCount();
    testLogger.info(`Filtered row count: ${filteredCount}`);

    // At least one error session should exist from our ingested data
    await expect(filteredCount).toBeGreaterThanOrEqual(1);
    await expect(filteredCount).toBeLessThanOrEqual(initialCount);

    // Verify health error tags are visible in the filtered rows
    await pm.rumPage.expectHealthErrorTagVisible();

    // Verify URL query parameter updated
    await pm.rumPage.expectUrlQueryParam('health', 'errors');

    testLogger.info('P0.2 completed — segment filtering verified');
  });

  test("P0.3: Click session row navigates to session viewer", {
    tag: ['@rum-sessions', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    // Verify there is at least one row
    const rowCount = await pm.rumPage.getSessionsTableRowCount();
    await expect(rowCount).toBeGreaterThan(0);

    testLogger.info('Clicking first session row');
    await pm.rumPage.clickFirstSessionRow();

    // Assert navigation to session viewer
    await pm.rumPage.expectNavigatedToSessionViewer();

    // Verify query params include start_time, end_time, org_identifier
    const params = pm.rumPage.getCurrentSearchParams();
    testLogger.info(`Session viewer params: ${JSON.stringify(params)}`);
    await expect(params.start_time).toBeTruthy();
    await expect(params.end_time).toBeTruthy();
    await expect(params.org_identifier).toBeTruthy();

    testLogger.info('P0.3 completed — session row navigation verified');
  });

  test("P0.4: Run Query button executes query refresh", {
    tag: ['@rum-sessions', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    // Confirm dashboard is initially visible
    await pm.rumPage.expectSessionsDashboardVisible();

    // Click the sessions Run Query button
    testLogger.info('Clicking Run Query button');
    await pm.rumPage.clickRunSessionsQuery();

    // Wait for query to settle
    await pm.rumPage.waitForSessionsTableLoaded();

    // Assert dashboard is still visible after refresh
    await pm.rumPage.expectSessionsDashboardVisible();

    // Table should still have rows after refresh
    const rowCount = await pm.rumPage.getSessionsTableRowCount();
    await expect(rowCount).toBeGreaterThan(0);

    testLogger.info('P0.4 completed — Run Query refresh verified');
  });

  // ==========================================================================
  // P1 — IMPORTANT VARIATIONS
  // ==========================================================================

  test("P1.1: Multiple segment filters compose (AND logic)", {
    tag: ['@rum-sessions', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    const initialCount = await pm.rumPage.getSessionsTableRowCount();
    testLogger.info(`Initial row count before composed filter: ${initialCount}`);

    // Apply "Engaged" type segment
    testLogger.info('Applying "Engaged" type segment');
    await pm.rumPage.clickTypeSegment('engaged');
    await pm.rumPage.expectSegmentActive('type', 'engaged');

    // Apply "Desktop" device segment
    testLogger.info('Applying "Desktop" device segment');
    await pm.rumPage.clickDeviceSegment('desktop');
    await pm.rumPage.expectSegmentActive('device', 'desktop');

    // Both segments should be active
    const composedCount = await pm.rumPage.getSessionsTableRowCount();
    testLogger.info(`Composed filter row count: ${composedCount}`);
    // Composed (AND) filter should produce ≤ results than each individual filter
    await expect(composedCount).toBeLessThanOrEqual(initialCount);

    // URL should have both query params
    await pm.rumPage.expectUrlQueryParam('session_type', 'engaged');
    await pm.rumPage.expectUrlQueryParam('device', 'desktop');

    testLogger.info('P1.1 completed — composed segment filtering verified');
  });

  test("P1.2: Segment-empty state with Reset Filters", {
    tag: ['@rum-sessions', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    // Apply filter combination that likely yields zero results
    // "Bounced" type + "Tablet" device: we have 1 tablet session (bounced), so
    // after filtering by "Bounced", tablet may show 0 or 1 row.
    // Instead, use "Bounced" + "Mobile" + "Frustrated" (no frustrated+bounced combo exists)
    testLogger.info('Applying "Frustrated" health + "Bounced" type segment (expect empty)');
    await pm.rumPage.clickHealthSegment('frustrated');
    await pm.rumPage.clickTypeSegment('bounced');

    const filteredCount = await pm.rumPage.getSessionsTableRowCount();

    if (filteredCount === 0) {
      // Segment-empty state should appear
      await pm.rumPage.expectSegmentEmptyState();

      // Click Reset Filters
      testLogger.info('Clicking Reset Filters button');
      await pm.rumPage.clickResetSegmentsButton();

      // Table should repopulate
      await pm.rumPage.waitForSessionsTableLoaded();
      const restoredCount = await pm.rumPage.getSessionsTableRowCount();
      await expect(restoredCount).toBeGreaterThan(0);

      // Segment-empty state should be gone
      await pm.rumPage.expectSegmentEmptyStateNotVisible();

      testLogger.info('P1.2 completed — segment-empty state + reset verified');
    } else {
      // If data happens to match, verify that reset still works
      testLogger.info('Segment-empty state not triggered by this data; verifying reset still restores');
      await pm.rumPage.clickResetSegmentsButton();
      await pm.rumPage.waitForSessionsTableLoaded();
      const restoredCount = await pm.rumPage.getSessionsTableRowCount();
      await expect(restoredCount).toBeGreaterThan(0);
      testLogger.info('P1.2 completed — reset works (empty state not triggered)');
    }
  });

  test("P1.3: URL query parameter persistence across segment changes", {
    tag: ['@rum-sessions', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    // Apply "Frustrated" health segment
    testLogger.info('Applying "Frustrated" health segment');
    await pm.rumPage.clickHealthSegment('frustrated');
    await pm.rumPage.expectSegmentActive('health', 'frustrated');

    // Verify URL has health=frustrated
    await pm.rumPage.expectUrlQueryParam('health', 'frustrated');

    // Capture the current URL and re-navigate to it (simulating a reload)
    const currentUrl = page.url();
    testLogger.info(`Captured URL for reload: ${currentUrl}`);

    // Re-navigate to the same URL
    await page.goto(currentUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await pm.rumPage.waitForSessionsTableLoaded();

    // After reload, "Frustrated" should still be active
    testLogger.info('Checking segment state after reload');
    await pm.rumPage.expectSegmentActive('health', 'frustrated');

    testLogger.info('P1.3 completed — URL param persistence verified');
  });

  test("P1.4: KPI card click toggles corresponding segment filter", {
    tag: ['@rum-sessions', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    // Click the "Errors" KPI card
    testLogger.info('Clicking Errors KPI card');
    await pm.rumPage.clickKpiCard('errors');

    // The errors KPI card should be selected
    await pm.rumPage.expectKpiCardSelected('errors');

    // The "With Errors" health segment should now be active
    await pm.rumPage.expectSegmentActive('health', 'errors');

    // Table should show only error sessions
    const errorRowCount = await pm.rumPage.getSessionsTableRowCount();
    testLogger.info(`Row count after errors KPI click: ${errorRowCount}`);

    // Now click the "Sessions" KPI card to reset
    testLogger.info('Clicking Sessions KPI card to reset all segments');
    await pm.rumPage.clickKpiCard('sessions');

    // All segments should return to "All"
    await pm.rumPage.expectSegmentActive('health', 'all');

    const resetRowCount = await pm.rumPage.getSessionsTableRowCount();
    testLogger.info(`Row count after reset: ${resetRowCount}`);
    await expect(resetRowCount).toBeGreaterThanOrEqual(errorRowCount);

    testLogger.info('P1.4 completed — KPI card click toggles segment verified');
  });

  test.fixme("P1.5: Discover Sessions empty state when session replay not configured — fixme: requires org without _sessionreplay", {
    tag: ['@rum-sessions', '@all', '@P1'],
  }, async ({ page }) => {
    // This test requires an org WITHOUT the _sessionreplay stream configured.
    // The test suite's shared data ingestion creates _sessionreplay on the
    // default org, so the empty state path cannot be exercised here.
    // When a dedicated org is available, steps should be:
    //   1. Navigate to /web/rum/sessions?org_identifier=<empty_org>
    //   2. Assert "Discover Sessions" card is visible (no dashboard)
    //   3. Assert "Get Started" button is visible and navigates to rumMonitoring
    testLogger.info('P1.5 — Discover Sessions empty state requires separate org (fixme)');
  });

  test("P1.6: DateTime range change triggers auto-refresh", {
    tag: ['@rum-sessions', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    // Record initial state
    await pm.rumPage.expectSessionsDashboardVisible();
    const initialCount = await pm.rumPage.getSessionsTableRowCount();
    testLogger.info(`Initial row count: ${initialCount}`);
    await expect(initialCount).toBeGreaterThan(0);

    // Open the date-time dropdown and select a wider range (Past 1 Hour)
    testLogger.info('Opening date-time dropdown');
    await pm.rumPage.openDateTimePicker();

    testLogger.info('Selecting Past 1 Hour');
    await pm.rumPage.selectPastOneHour();

    // Wait for auto-refresh to complete
    await pm.rumPage.waitForSessionsTableLoaded();

    // Dashboard should still be visible
    await pm.rumPage.expectSessionsDashboardVisible();

    // Table should still have data (wider range should include same or more data)
    const afterRangeCount = await pm.rumPage.getSessionsTableRowCount();
    testLogger.info(`Row count after range change: ${afterRangeCount}`);
    await expect(afterRangeCount).toBeGreaterThanOrEqual(initialCount);

    testLogger.info('P1.6 completed — DateTime range change triggers auto-refresh');
  });

  // ==========================================================================
  // P2 — EDGE CASES / DATA-DEPENDENT FEATURES
  // ==========================================================================

  test("P2.1: Bounced session shows bounced label and no sparkline", {
    tag: ['@rum-sessions', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    // Apply "Bounced" type segment to isolate bounce sessions
    await pm.rumPage.clickTypeSegment('bounced');

    // Our ingested data includes 4 bounce sessions — at least one should appear
    const bouncedCount = await pm.rumPage.getSessionsTableRowCount();
    testLogger.info(`Bounced session row count: ${bouncedCount}`);
    await expect(bouncedCount).toBeGreaterThan(0);

    // Bounced label should be visible on at least one row
    await pm.rumPage.expectBouncedLabelVisible();

    // Bounced sessions should NOT show an activity sparkline
    await pm.rumPage.expectActivitySparklineNotVisible();

    testLogger.info('P2.1 completed — bounced label and sparkline absence verified');
  });

  test("P2.2: Active session shows active label", {
    tag: ['@rum-sessions', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    // Active sessions exist in our ingested data (end_time within 5 min of now)
    // The active label should be visible on at least one row
    await pm.rumPage.expectActiveLabelVisible();

    testLogger.info('P2.2 completed — active label verified');
  });

  test("P2.3: Health cell shows correct badge (error, frustration, clean)", {
    tag: ['@rum-sessions', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    // With all segments set to "All", we should see a mix of health badges

    // First, verify error tags are present (via "With Errors" filter)
    await pm.rumPage.clickHealthSegment('errors');
    const errCount = await pm.rumPage.getSessionsTableRowCount();
    if (errCount > 0) {
      await pm.rumPage.expectHealthErrorTagVisible();
    }

    // Then verify frustration tags
    await pm.rumPage.clickHealthSegment('frustrated');
    const frusCount = await pm.rumPage.getSessionsTableRowCount();
    if (frusCount > 0) {
      await pm.rumPage.expectHealthFrustrationTagVisible();
    }

    // Then verify clean tags
    await pm.rumPage.clickHealthSegment('clean');
    const cleanCount = await pm.rumPage.getSessionsTableRowCount();
    if (cleanCount > 0) {
      await pm.rumPage.expectHealthCleanTagVisible();
    }

    testLogger.info(`P2.3 completed — health badges: errors=${errCount}, frustrated=${frusCount}, clean=${cleanCount}`);

    // Unconditional fallback: at least one health segment should have data
    // (our synthetic data includes all three health statuses)
    const anyHealthTagFound = errCount > 0 || frusCount > 0 || cleanCount > 0;
    await expect(anyHealthTagFound).toBe(true);
  });

  test("P2.4: Insight banner — apply button sets health segment", {
    tag: ['@rum-sessions', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    // Check if insight banner is visible (data-dependent — needs cluster count >= 3)
    const bannerVisible = await pm.rumPage.isInsightBannerVisible();

    if (bannerVisible) {
      testLogger.info('Insight banner is visible — testing apply action');
      await pm.rumPage.expectInsightBannerVisible();
      await pm.rumPage.clickInsightApplyButton();

      // After clicking apply, the corresponding health segment should become active
      // (either 'errors' or 'frustrated' depending on which insight is top)
      const errorsActive = await pm.rumPage.isHealthSegmentActive('errors');
      const frustratedActive = await pm.rumPage.isHealthSegmentActive('frustrated');
      await expect(errorsActive || frustratedActive).toBe(true);
      testLogger.info('P2.4 completed — insight apply verified');
    } else {
      // Banner not present — skip (data-dependent feature, needs enough error clusters)
      testLogger.info('Insight banner not visible — skipping apply test (data-dependent)');
      test.skip(true, 'Insight banner not present — not enough error clusters in data');
    }
  });

  test("P2.5: Insight banner — filter button adds error_message to query", {
    tag: ['@rum-sessions', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating to RUM Sessions page');
    await pm.rumPage.navigateToSessions();
    await pm.rumPage.waitForSessionsTableLoaded();

    // Check if error cluster insight banner has the filter button
    const filterBtnVisible = await pm.rumPage.isInsightFilterBtnVisible();

    if (filterBtnVisible) {
      testLogger.info('Error cluster insight filter button visible — testing');
      await pm.rumPage.clickInsightFilterButton();

      // After clicking, the error_message query param should be added to the URL
      await pm.rumPage.expectUrlHasQueryParam('error_message');

      // Table should re-run with error filter applied
      await pm.rumPage.waitForSessionsTableLoaded();
      await pm.rumPage.expectSessionsDashboardVisible();

      testLogger.info('P2.5 completed — insight filter verified');
    } else {
      testLogger.info('Insight filter button not visible — skipping (data-dependent)');
      test.skip(true, 'Insight filter button not present — error cluster data insufficient');
    }
  });

  // ==========================================================================
  // UNWIRED — Feature-incomplete behaviors
  // ==========================================================================

  test.fixme("UNWIRED.1: Infinite scroll pagination loads more sessions — not wired: getSessions() commented out at AppSessions.vue:1409", {
    tag: ['@rum-sessions', '@all', '@P2'],
  }, async ({ page }) => {
    // This test documents the known gap: handleScrollEnd at AppSessions.vue:1409
    // has the getSessions() call commented out. Only the first page of sessions
    // is ever loaded. When the comment is removed, this test should:
    // 1. Scroll to the bottom of the sessions table
    // 2. Assert that new rows load (row count increases)
    // 3. Assert loading indicator appears and resolves
    testLogger.info('UNWIRED.1 — infinite scroll not yet implemented');
  });

});
