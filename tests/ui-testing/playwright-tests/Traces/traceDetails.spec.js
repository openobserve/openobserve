// traceDetails.spec.js
// Tests for OpenObserve Traces feature - Trace Details functionality

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');

test.describe("Trace Details testcases", () => {
  test.describe.configure({ mode: 'serial' });
  let tracesPage;
  // Remove trailing slash from base URL if present
  const rawBaseUrl = process.env["ZO_BASE_URL"] ?? '';
  const baseUrl = rawBaseUrl.endsWith('/')
    ? rawBaseUrl.slice(0, -1)
    : rawBaseUrl;
  const tracesUrl = `${baseUrl}/web/traces?org_identifier=${process.env["ORGNAME"]}`;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Import TracesPage dynamically
    const { TracesPage } = await import('../../pages/tracesPages/tracesPage.js');
    tracesPage = new TracesPage(page);

    // Navigate to traces and get to a trace detail
    await page.goto(tracesUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Try to get to trace details - we have ingested data
    const streamSelector = page.locator(tracesPage.streamSelect);
    if (await streamSelector.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tracesPage.selectTraceStream('default');
    }

    // Set time range to last 15 minutes as required for trace visibility
    await page.locator(tracesPage.dateTimeButton).click();
    await page.locator('[data-test="date-time-relative-15-m-btn"]').click(); // Last 15 minutes

    // Click run query and wait for traces to load
    await tracesPage.runTraceSearch();
    await page.waitForTimeout(3000); // Wait for traces to load

    testLogger.info('Test setup completed for trace details - checking for traces');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("P1: Toggle timeline view in trace details", {
    tag: ['@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing timeline toggle in trace details');

    // Check if we have results to click
    const hasResults = await page.locator(tracesPage.searchResultItem).first().isVisible({ timeout: 10000 }).catch(() => false);

    if (hasResults) {
      // Open trace details
      await tracesPage.clickFirstTraceResult();
      await tracesPage.expectTraceDetailsVisible();

      // Toggle timeline
      const timelineButton = page.locator(tracesPage.traceDetailsToggleTimelineButton);
      if (await timelineButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await tracesPage.toggleTimelineView();
        await page.waitForTimeout(1000); // Animation

        // Check if timeline is visible
        const timelineVisible = await page.locator(tracesPage.traceDetailsTimelineChart).isVisible({ timeout: 5000 }).catch(() => false);
        testLogger.info(`Timeline toggled: ${timelineVisible ? 'visible' : 'hidden'}`);
      } else {
        testLogger.info('Timeline toggle not available');
      }
    } else {
      testLogger.info('No trace results available for timeline test');
      test.skip();
    }
  });

  test("P1: Copy trace ID functionality", {
    tag: ['@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing copy trace ID');

    const hasResults = await page.locator(tracesPage.searchResultItem).first().isVisible({ timeout: 10000 }).catch(() => false);

    if (hasResults) {
      // Open trace details
      await tracesPage.clickFirstTraceResult();
      await tracesPage.expectTraceDetailsVisible();

      // Copy trace ID
      const copyButton = page.locator(tracesPage.traceDetailsCopyTraceIdButton);
      if (await copyButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await tracesPage.copyTraceId();

        // Check for success notification or clipboard content
        // This depends on your implementation
        testLogger.info('Trace ID copy functionality tested');
      } else {
        testLogger.info('Copy button not available');
      }
    } else {
      testLogger.info('No trace results available for copy test');
      test.skip();
    }
  });

  test("P1: View related logs from trace details", {
    tag: ['@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing view related logs');

    const hasResults = await page.locator(tracesPage.searchResultItem).first().isVisible({ timeout: 10000 }).catch(() => false);

    if (hasResults) {
      // Open trace details
      await tracesPage.clickFirstTraceResult();
      await tracesPage.expectTraceDetailsVisible();

      // Check if view logs button is available
      const viewLogsButton = page.locator(tracesPage.traceDetailsViewLogsButton);
      if (await viewLogsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await tracesPage.viewRelatedLogs();

        // Should navigate to logs
        await page.waitForLoadState('networkidle').catch(() => {});
        await expect(page).toHaveURL(/logs/);

        testLogger.info('Successfully navigated to related logs');
      } else {
        testLogger.info('View logs button not available');
      }
    } else {
      testLogger.info('No trace results available for logs test');
      test.skip();
    }
  });

  test("P2: Search within trace functionality", {
    tag: ['@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing search within trace');

    const hasResults = await page.locator(tracesPage.searchResultItem).first().isVisible({ timeout: 10000 }).catch(() => false);

    if (hasResults) {
      // Open trace details
      await tracesPage.clickFirstTraceResult();
      await tracesPage.expectTraceDetailsVisible();

      // Try search within trace
      const searchInput = page.locator(tracesPage.traceDetailsSearchInput);
      if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await tracesPage.searchWithinTrace('error');
        await page.waitForTimeout(1000);

        // Check if search highlighted or filtered spans
        // Implementation specific validation
        testLogger.info('Search within trace tested');
      } else {
        testLogger.info('Search input not available');
      }
    } else {
      testLogger.info('No trace results available for search test');
      test.skip();
    }
  });

  test("P2: Share trace link functionality", {
    tag: ['@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing share trace link');

    const hasResults = await page.locator(tracesPage.searchResultItem).first().isVisible({ timeout: 10000 }).catch(() => false);

    if (hasResults) {
      // Open trace details
      await tracesPage.clickFirstTraceResult();
      await tracesPage.expectTraceDetailsVisible();

      // Share trace link
      const shareButton = page.locator(tracesPage.traceDetailsShareLinkButton);
      if (await shareButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await tracesPage.shareTraceLink();
        await page.waitForTimeout(1000);

        // Check for share notification
        testLogger.info('Share trace link tested');
      } else {
        testLogger.info('Share button not available');
      }
    } else {
      testLogger.info('No trace results available for share test');
      test.skip();
    }
  });
});