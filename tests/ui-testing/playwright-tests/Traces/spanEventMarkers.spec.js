// spanEventMarkers.spec.js
// Tests for OpenObserve Traces feature - Trace Span Event Markers
// Feature: span-event-markers — severity-coloured markers across the waterfall
// (span-event-marker), tree per-span count badge (span-event-count-badge), and
// sidebar mini-timeline (span-event-timeline-marker), plus the marker-click
// cross-surface handoff to the sidebar Events tab.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');

test.describe("Trace Span Event Markers testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  // Deterministic error traces seeded ONCE for the file. Every test only READS
  // these (shared/read-only), so parallel workers can't collide on them. Only
  // the server span of each trace carries events (one exception -> severity error).
  const seededTraceIds = [];

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      const result = await ingestTraces(page, 3, { forceScenario: 'error' });
      seededTraceIds.push(...result.traceIds);
      testLogger.info('Seeded deterministic error traces for span event markers', {
        successful: result.successful,
        failed: result.failed,
        traceIds: result.traceIds,
      });
    } catch (e) {
      // Non-fatal at seed time: each test still asserts the marker surfaces, and
      // Playwright's retry gives ingestion/indexing another beat.
      testLogger.warn('Span-event trace seeding failed (continuing)', { error: e.message });
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // Microseconds-since-epoch window bracketing the just-ingested trace so the
  // direct route's get_trace_details can resolve the span list.
  function computeTraceWindowUs() {
    const nowMs = Date.now();
    return {
      fromUs: (nowMs - 15 * 60 * 1000) * 1000,
      toUs: (nowMs + 60 * 1000) * 1000,
    };
  }

  // ─── P0 — Critical path ────────────────────────────────────────────────────
  test("should render waterfall span-event markers and a tree count badge for an error span", {
    tag: ['@span-event-markers', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying waterfall markers + tree badge render for a span carrying an exception event');

    const { fromUs, toUs } = computeTraceWindowUs();
    await pm.tracesPage.navigateToTraceDetails(seededTraceIds[0], 'default', fromUs, toUs);

    // Wait for the span list to hydrate (spanList -> spanMap -> events) before
    // asserting markers — the resolver renders nothing until it has the events.
    await expect(pm.tracesPage.getSpanEventMarkers().first()).toBeVisible({ timeout: 30000 });

    // Exception-first severity => error tier.
    await expect(pm.tracesPage.getSpanEventMarkers().first()).toHaveAttribute('data-event-severity', 'error');

    // The tree badge mirrors the same total (one exception event).
    await expect(pm.tracesPage.getSpanEventCountBadges().first()).toBeVisible({ timeout: 30000 });
    await expect(pm.tracesPage.getSpanEventCountBadges().first()).toContainText('1');

    testLogger.info('Waterfall markers and tree badge verified');
  });

  // ─── P1 — Important ────────────────────────────────────────────────────────
  test("should open the sidebar Events tab and expand the matching event row when a marker is clicked", {
    tag: ['@span-event-markers', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying marker-click cross-surface handoff to the sidebar Events tab');

    const { fromUs, toUs } = computeTraceWindowUs();
    await pm.tracesPage.navigateToTraceDetails(seededTraceIds[0], 'default', fromUs, toUs);

    // Waterfall markers must render (sidebar closed) before one can be clicked.
    await expect(pm.tracesPage.getSpanEventMarkers().first()).toBeVisible({ timeout: 30000 });
    await pm.tracesPage.clickFirstSpanEventMarker();

    // Handoff: the sidebar opens with the Events tab active.
    await pm.tracesPage.expectSidebarEventsTabActive();

    // The mini-timeline re-plots the event against the span's own duration.
    await expect(pm.tracesPage.getSpanEventTimelineMarkers().first()).toBeVisible({ timeout: 20000 });
    await expect(pm.tracesPage.getSpanEventTimelineMarkers().first()).toHaveAttribute('data-event-severity', 'error');

    // The events table renders and the matching row is expanded (JSON preview).
    await pm.tracesPage.expectEventsTableVisible();
    await pm.tracesPage.expectEventRowExpanded();

    testLogger.info('Marker-click handoff to the Events tab verified');
  });

  test("should render the tree badge error variant with a trailing error tally of 1", {
    tag: ['@span-event-markers', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying the tree badge error-outline variant and trailing error tally');

    const { fromUs, toUs } = computeTraceWindowUs();
    await pm.tracesPage.navigateToTraceDetails(seededTraceIds[0], 'default', fromUs, toUs);

    // The badge's trailing error tally only renders when errors > 0 (server span).
    await expect(pm.tracesPage.getSpanEventErrorCounts().first()).toBeVisible({ timeout: 30000 });
    await expect(pm.tracesPage.getSpanEventErrorCounts().first()).toContainText('1');

    testLogger.info('Tree badge error tally verified');
  });

  test("should show a sidebar mini-timeline whose marker count matches the events-table row count", {
    tag: ['@span-event-markers', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying manual Events-tab inspection: mini-timeline markers == table rows');

    const { fromUs, toUs } = computeTraceWindowUs();
    await pm.tracesPage.navigateToTraceDetails(seededTraceIds[0], 'default', fromUs, toUs);

    // Select the server span (the one carrying events) and open the Events tab.
    await pm.tracesPage.clickSpanBlockWithEvents();
    await pm.tracesPage.openSidebarEventsTab();

    await expect(pm.tracesPage.getSpanEventTimelineMarkers().first()).toBeVisible({ timeout: 20000 });

    const markerCount = await pm.tracesPage.getSpanEventTimelineMarkers().count();
    const rowCount = await pm.tracesPage.getEventsTableRows().count();

    expect(markerCount).toBeGreaterThan(0);
    expect(markerCount).toBe(rowCount);
    await expect(pm.tracesPage.getSpanEventTimelineMarkers().first()).toHaveAttribute('data-event-severity', 'error');

    testLogger.info('Mini-timeline marker/row parity verified', { markerCount, rowCount });
  });

  // ─── P2 — Edge cases ───────────────────────────────────────────────────────
  test("should show the no-events empty state for a span without an events payload", {
    tag: ['@span-event-markers', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying the no-events empty state for the root span (no events payload)');

    const { fromUs, toUs } = computeTraceWindowUs();
    await pm.tracesPage.navigateToTraceDetails(seededTraceIds[0], 'default', fromUs, toUs);

    // The root span (first span-block) carries no events in the ingest helper.
    await pm.tracesPage.clickFirstSpanBlock();
    await pm.tracesPage.openSidebarEventsTab();

    await pm.tracesPage.expectNoEventsEmptyStateVisible();
    await expect(pm.tracesPage.getSpanEventTimelineMarkers()).toHaveCount(0);

    testLogger.info('No-events empty state verified');
  });

  test.fixme("should render info and warning severity markers from level/severity_text events — not wired: no e2e ingest payload produces level/severity_text events (trace-ingestion.js:122-138)", {
    tag: ['@span-event-markers', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Info/warning severity markers require an ingest payload carrying level/severity_text');
    const { fromUs, toUs } = computeTraceWindowUs();
    await pm.tracesPage.navigateToTraceDetails(seededTraceIds[0], 'default', fromUs, toUs);
    await expect(pm.tracesPage.getSpanEventMarkers().first()).toBeVisible({ timeout: 30000 });
    await expect(pm.tracesPage.getSpanEventMarkers().first()).toHaveAttribute('data-event-severity', /info|warning/);
  });
});
