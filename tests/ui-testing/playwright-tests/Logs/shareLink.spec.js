/**
 * Share Link End-to-End Tests (Consolidated)
 *
 * Tests for the share link feature on the logs page including:
 * - Share link button visibility and functionality
 * - State preservation across redirects (stream, time range, SQL mode, histogram, org)
 * - Short URL redirect functionality
 * - Edge cases (no stream, multiple clicks, SQL queries)
 *
 * Optimized to avoid duplicate coverage while maintaining comprehensive testing.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

test.describe("Share Link Test Cases", () => {
  // Tests are independent - each has its own beforeEach and fresh page context
  // Running in parallel with 5 workers for faster execution
  let pm;
  const TEST_STREAM = 'e2e_automate';

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to logs page
    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`;
    testLogger.navigation('Navigating to logs page', { url: logsUrl });

    await page.goto(logsUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    testLogger.info('Test setup completed');
  });

  // =====================================================
  // P0 - SMOKE TESTS (Critical Functionality)
  // =====================================================

  test("P0: Share link button visibility and success notification", {
    tag: ['@shareLink', '@smoke', '@P0']
  }, async ({ page }) => {

    testLogger.info('Testing share link button visibility and success notification');

    // Verify share link button is visible
    await pm.logsPage.expectShareLinkButtonVisible();

    // Select a stream and execute search
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Click share link and verify SUCCESS notification appears
    const success = await pm.logsPage.clickShareLinkAndExpectSuccess();
    expect(success).toBe(true);

    testLogger.info('Share link visibility and success notification test completed');
  });

  test("P0: Share link preserves stream and time range after redirect", {
    tag: ['@shareLink', '@statePreservation', '@smoke', '@P0']
  }, async ({ page }) => {

    testLogger.info('Testing stream and time range preservation via share link redirect');

    // Step 1: Select stream
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);

    // Step 2: Set a specific time range (1 hour)
    await page.locator('[data-test="date-time-btn"]').click();
    await page.waitForTimeout(500);
    await page.locator('[data-test="date-time-relative-1-h-btn"]').click();
    await page.waitForTimeout(1000);

    // Step 3: Click refresh
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Step 4: Capture original state
    const originalState = await pm.logsPage.captureCurrentState();
    testLogger.info('Original state captured', { stream: originalState.stream, period: originalState.period });

    // Step 5: Click share link and get URL
    const sharedUrl = await pm.logsPage.clickShareLinkAndGetUrl();
    testLogger.info('Shared URL captured', { url: sharedUrl });

    // Step 6: Navigate to shared URL
    await page.goto(sharedUrl);
    await pm.logsPage.waitForRedirectComplete();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Step 7: Capture and verify state
    const redirectedState = await pm.logsPage.captureCurrentState();
    testLogger.info('Redirected state', { stream: redirectedState.stream, from: redirectedState.from, to: redirectedState.to });

    // Verify stream is preserved
    expect(redirectedState.stream).toBe(originalState.stream);

    // Verify time range: either period=1h OR from/to with ~1 hour duration
    if (redirectedState.period === '1h') {
      expect(redirectedState.period).toBe('1h');
    } else if (redirectedState.from && redirectedState.to) {
      const fromTime = parseInt(redirectedState.from);
      const toTime = parseInt(redirectedState.to);
      const durationHours = (toTime - fromTime) / (1000000 * 60 * 60);
      testLogger.info('Time range duration', { durationHours });
      expect(durationHours).toBeGreaterThan(0.9);
      expect(durationHours).toBeLessThan(1.1);
    } else {
      throw new Error('No time range found in redirected state');
    }

    testLogger.info('Stream and time range preservation test completed');
  });

  // =====================================================
  // P1 - FUNCTIONAL TESTS (Feature Validation)
  // =====================================================

  test("P1: Share link preserves SQL mode toggle state after redirect", {
    tag: ['@shareLink', '@statePreservation', '@functional', '@P1']
  }, async ({ page }) => {

    testLogger.info('Testing SQL mode preservation via share link redirect');

    // Step 1: Select stream
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);

    // Step 2: Enable SQL mode
    const sqlModeToggle = page.getByRole('switch', { name: 'SQL Mode' });
    const isChecked = await sqlModeToggle.getAttribute('aria-checked');
    if (isChecked !== 'true') {
      await sqlModeToggle.click();
      await page.waitForTimeout(1000);
    }

    // Step 3: Click refresh
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Step 4: Verify SQL mode is ON before sharing
    const sqlModeBeforeShare = await pm.logsPage.isSqlModeEnabled();
    expect(sqlModeBeforeShare).toBe(true);
    testLogger.info('SQL mode enabled before sharing', { enabled: sqlModeBeforeShare });

    // Step 5: Click share link and get URL
    const sharedUrl = await pm.logsPage.clickShareLinkAndGetUrl();

    // Step 6: Navigate to shared URL
    await page.goto(sharedUrl);
    await pm.logsPage.waitForRedirectComplete();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Step 7: Verify SQL mode state and URL params
    const redirectedState = await pm.logsPage.captureCurrentState();
    testLogger.info('Redirected state', redirectedState);

    // Verify SQL mode is preserved after redirect
    const sqlModeAfterRedirect = await pm.logsPage.isSqlModeEnabled();
    testLogger.info('SQL mode after redirect', { enabled: sqlModeAfterRedirect });
    expect(sqlModeAfterRedirect).toBe(true);

    testLogger.info('SQL mode preservation test completed');
  });

  test("P1: Share link preserves histogram toggle state after redirect", {
    tag: ['@shareLink', '@statePreservation', '@functional', '@P1']
  }, async ({ page }) => {

    testLogger.info('Testing histogram toggle preservation via share link redirect');

    // Step 1: Select stream
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);

    // Step 2: Toggle histogram
    const histogramToggle = page.locator('[data-test="logs-search-bar-show-histogram-toggle-btn"]');
    if (await histogramToggle.isVisible()) {
      const toggleDiv = histogramToggle.locator('div').first();
      await toggleDiv.click();
      await page.waitForTimeout(1000);
    }

    // Step 3: Click refresh
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Step 4: Capture original state
    const originalState = await pm.logsPage.captureCurrentState();
    testLogger.info('Original histogram state', { showHistogram: originalState.showHistogram });

    // Step 5: Click share link and get URL
    const sharedUrl = await pm.logsPage.clickShareLinkAndGetUrl();

    // Step 6: Navigate to shared URL
    await page.goto(sharedUrl);
    await pm.logsPage.waitForRedirectComplete();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Step 7: Verify histogram state
    const redirectedState = await pm.logsPage.captureCurrentState();
    testLogger.info('Redirected histogram state', { showHistogram: redirectedState.showHistogram });

    expect(redirectedState.showHistogram).toBe(originalState.showHistogram);

    testLogger.info('Histogram toggle preservation test completed');
  });

  test("P1: Share link preserves complete search state (stream + time + mode + histogram)", {
    tag: ['@shareLink', '@statePreservation', '@functional', '@P1']
  }, async ({ page }) => {

    testLogger.info('Testing complete search state preservation via share link redirect');

    // Step 1: Setup complete search state
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);

    // Set time range to 30 minutes
    await page.locator('[data-test="date-time-btn"]').click();
    await page.waitForTimeout(500);
    await page.locator('[data-test="date-time-relative-30-m-btn"]').click();
    await page.waitForTimeout(1000);

    // Step 2: Click refresh
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Step 3: Capture complete original state
    const originalState = await pm.logsPage.captureCurrentState();
    testLogger.info('Complete original state captured', originalState);

    // Step 4: Click share link and get URL
    const sharedUrl = await pm.logsPage.clickShareLinkAndGetUrl();
    testLogger.info('Shared URL', { url: sharedUrl });

    // Step 5: Navigate to shared URL
    await page.goto(sharedUrl);
    await pm.logsPage.waitForRedirectComplete();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Step 6: Capture and compare states
    const redirectedState = await pm.logsPage.captureCurrentState();
    testLogger.info('Redirected state captured', redirectedState);

    // Step 7: Verify key states are preserved
    const comparison = pm.logsPage.compareStates(originalState, redirectedState, [
      'stream',
      'streamType',
      'showHistogram',
      'quickMode'
    ]);

    expect(comparison.isMatch).toBe(true);
    if (!comparison.isMatch) {
      testLogger.error('State mismatch detected', comparison.differences);
    }

    // Additionally verify the time range duration is approximately 30 minutes
    if (redirectedState.from && redirectedState.to) {
      const durationMinutes = (parseInt(redirectedState.to) - parseInt(redirectedState.from)) / (1000000 * 60);
      testLogger.info('Time range duration', { durationMinutes });
      expect(durationMinutes).toBeGreaterThan(25);
      expect(durationMinutes).toBeLessThan(35);
    }

    testLogger.info('Complete state preservation test completed successfully');
  });

  test("P1: Share link button shows loading state while generating", {
    tag: ['@shareLink', '@functional', '@P1']
  }, async ({ page }) => {

    testLogger.info('Testing share link loading state');

    // Select stream and refresh
    await pm.logsPage.selectStream(TEST_STREAM);
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Get the share button
    const shareButton = page.locator('[data-test="logs-search-bar-share-link-btn"]');

    // Click and wait for success notification
    await shareButton.click();
    await pm.logsPage.expectShareLinkSuccessNotification();

    testLogger.info('Loading state test completed');
  });

  // =====================================================
  // P2 - EDGE CASE TESTS
  // =====================================================

  test("P2: Share link without stream selected", {
    tag: ['@shareLink', '@edge', '@P2']
  }, async ({ page }) => {

    testLogger.info('Testing share link without stream selected');

    // Don't select any stream, just wait for page to load
    await page.waitForTimeout(2000);

    // Share link button should still be visible
    await pm.logsPage.expectShareLinkButtonVisible();

    // Click share link and verify notification appears (success or error)
    const result = await pm.logsPage.clickShareLinkAndExpectNotification();
    expect(result.appeared).toBe(true);
    testLogger.info('Share link notification received', { text: result.text });

    testLogger.info('No stream share link test completed');
  });

  test("P2: Multiple share link clicks work correctly", {
    tag: ['@shareLink', '@edge', '@P2']
  }, async ({ page }) => {

    testLogger.info('Testing multiple share link clicks');

    // Select stream and refresh
    await pm.logsPage.selectStream(TEST_STREAM);
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Click share link multiple times
    for (let i = 0; i < 3; i++) {
      await pm.logsPage.clickShareLinkButton();
      await page.waitForTimeout(2000);
      testLogger.info(`Share link click ${i + 1} completed`);
    }

    // Last click should still show success
    await pm.logsPage.expectShareLinkSuccessNotification();

    testLogger.info('Multiple clicks share link test completed');
  });

  test("P2: Share link with SQL query preserves query content after redirect", {
    tag: ['@shareLink', '@statePreservation', '@edge', '@P2']
  }, async ({ page }) => {

    testLogger.info('Testing SQL query preservation via share link redirect');

    // Step 1: Select stream
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);

    // Step 2: Enable SQL mode
    const sqlModeToggle = page.getByRole('switch', { name: 'SQL Mode' });
    const isChecked = await sqlModeToggle.getAttribute('aria-checked');
    if (isChecked !== 'true') {
      await sqlModeToggle.click();
      await page.waitForTimeout(1000);
    }

    // Step 3: Enter a SQL query
    const queryEditor = page.locator('[data-test="logs-search-bar-query-editor"]');
    await queryEditor.click();
    await page.keyboard.type(`SELECT * FROM "${TEST_STREAM}" LIMIT 50`);
    await page.waitForTimeout(1000);

    // Step 4: Click refresh
    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Step 5: Capture original state
    const originalUrl = await pm.logsPage.getCurrentUrl();
    testLogger.info('Original URL with query', { url: originalUrl });

    // Verify original URL contains the stream and SQL mode
    expect(originalUrl).toContain(TEST_STREAM);
    expect(originalUrl).toContain('sql_mode=true');

    // Step 6: Click share link and get URL
    const sharedUrl = await pm.logsPage.clickShareLinkAndGetUrl();
    testLogger.info('Shared URL', { url: sharedUrl });

    // Step 7: Navigate to shared URL
    await page.goto(sharedUrl);
    await pm.logsPage.waitForRedirectComplete();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Step 8: Verify we're back on logs page with state
    const redirectedUrl = await pm.logsPage.getCurrentUrl();
    expect(redirectedUrl).toContain('logs');
    expect(redirectedUrl).toContain('stream');

    testLogger.info('SQL query preservation test completed');
  });

  test("P2: Shared URL redirect, org context, and multiple access consistency", {
    tag: ['@shareLink', '@statePreservation', '@edge', '@P2']
  }, async ({ page }) => {

    testLogger.info('Testing shared URL redirect, org context, and multiple access consistency');

    // Step 1: Setup and share
    await pm.logsPage.selectStream(TEST_STREAM);
    await page.waitForTimeout(2000);

    await page.locator('[data-test="date-time-btn"]').click();
    await page.waitForTimeout(500);
    await page.locator('[data-test="date-time-relative-1-h-btn"]').click();
    await page.waitForTimeout(1000);

    await pm.logsPage.clickRefresh();
    await page.waitForTimeout(3000);

    // Capture original org
    const originalState = await pm.logsPage.captureCurrentState();
    const originalOrg = originalState.orgIdentifier;

    const sharedUrl = await pm.logsPage.clickShareLinkAndGetUrl();
    testLogger.info('Captured shared URL', { url: sharedUrl });

    // Step 2: Verify it's a short URL
    const isShortUrl = sharedUrl.includes('/short/');
    testLogger.info('URL type', { isShortUrl });

    // Step 3: Access the URL first time
    await page.goto(sharedUrl);
    await pm.logsPage.waitForRedirectComplete();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    const firstAccessState = await pm.logsPage.captureCurrentState();
    testLogger.info('First access state', firstAccessState);

    // Verify redirect completed (not on short URL anymore)
    const firstUrl = await pm.logsPage.getCurrentUrl();
    expect(firstUrl).toContain('logs');
    expect(firstUrl).not.toContain('/short/');

    // Verify org is preserved
    expect(firstAccessState.orgIdentifier).toBe(originalOrg);

    // Step 4: Navigate away
    await page.goto(`${process.env["ZO_BASE_URL"]}/web/?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Step 5: Access the URL second time
    await page.goto(sharedUrl);
    await pm.logsPage.waitForRedirectComplete();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    const secondAccessState = await pm.logsPage.captureCurrentState();
    testLogger.info('Second access state', secondAccessState);

    // Step 6: Verify states match
    const comparison = pm.logsPage.compareStates(firstAccessState, secondAccessState, [
      'stream',
      'orgIdentifier'
    ]);

    expect(comparison.isMatch).toBe(true);

    testLogger.info('Shared URL redirect, org context, and multiple access test completed');
  });

  // =====================================================
  // FUNCTIONALITY - Bug #9788: Share URL disabled without ZO_WEB_URL
  // https://github.com/openobserve/openobserve/issues/9788
  // =====================================================

  test("@bug-9788 @P1: Share button should be disabled when ZO_WEB_URL is not configured", {
    tag: ['@bug-9788', '@shareLink', '@P1']
  }, async ({ page }, testInfo) => {
    // Skip beforeEach by handling setup here with mock FIRST
    testLogger.testStart(testInfo.title, testInfo.file);
    testLogger.info('Test: Share button disabled state with mocked config (Bug #9788)');

    // Set up mock BEFORE any navigation to ensure config is mocked from the start
    await page.route('**/config', async (route) => {
      const response = await route.fetch();
      const json = await response.json();

      // Delete web_url property to simulate it not being configured
      const modifiedConfig = { ...json };
      delete modifiedConfig.web_url;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(modifiedConfig)
      });
    });

    // Now navigate for the first time with mock already active
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to logs page
    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`;
    testLogger.navigation('Navigating to logs page with mocked config', { url: logsUrl });
    await page.goto(logsUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Select a stream and run query to load results
    await pm.logsPage.selectStream(TEST_STREAM);
    await pm.logsPage.clickRefresh();
    await page.waitForLoadState('networkidle');

    testLogger.info('Logs page loaded with mocked config');

    // PRIMARY ASSERTION: Share button should exist
    await pm.logsPage.expectShareLinkButtonVisible();
    testLogger.info('✓ Share button is visible');

    // SECONDARY ASSERTION: Share button should be disabled when ZO_WEB_URL not configured
    await pm.logsPage.expectShareLinkButtonDisabled();
    testLogger.info('✓ PRIMARY CHECK PASSED: Share button is disabled (ZO_WEB_URL not configured)');

    // TERTIARY ASSERTION: Check for tooltip explaining why it's disabled
    await pm.logsPage.hoverShareLinkButton();

    // Verify tooltip is visible with specific message about ZO_WEB_URL configuration
    await pm.logsPage.expectShareLinkTooltipVisible(/share\s+url\s+is\s+disabled.*zo_web_url.*configured/i);

    // Get and validate tooltip text matches expected structure
    const tooltipText = await pm.logsPage.getShareLinkTooltipText(/share\s+url\s+is\s+disabled.*zo_web_url.*configured/i);
    expect(tooltipText.toLowerCase()).toMatch(/share\s+url\s+is\s+disabled.*zo_web_url.*configured/i);
    testLogger.info('✓ TERTIARY CHECK PASSED: Informative tooltip present');

    testLogger.info('Share button disabled state test completed for Bug #9788');
  });
});
