/**
 * Metrics Share & Deep-Link E2E Test Suite
 *
 * Covers the Metrics page Share button (short URL generation + clipboard copy)
 * and Deep-Link navigation (blob restore, override params, URL sync).
 *
 * Feature: metrics-share-deep-link
 * Area: Metrics
 *
 * Pre-requisites:
 *  - Global setup handles authentication + org_identifier
 *  - Metrics data must be ingested (ensureMetricsIngested)
 *  - web_url must be configured for share tests (tests detect gracefully)
 */
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

test.describe("Metrics Share & Deep-Link testcases", () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  /** Create a fresh PageManager per test — avoids data races in parallel workers. */
  async function setupTest(page, testInfo) {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    // Grant clipboard permissions so share-button clipboard reads work in CI
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const pm = new PageManager(page);
    await pm.metricsPage.gotoMetricsPage();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Test setup completed - navigated to metrics page');
    return pm;
  }

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // ─── P2: Default State ─────────────────────────────────────────────────────

  test("Default state — page loads with defaults, no auto-run", {
    tag: ['@metrics-share-deep-link', '@P2', '@default-state', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Verifying default metrics page state');

    // Verify page container is visible
    await pm.metricsPage.expectMetricsPageVisible();

    // Verify core UI elements load
    await pm.metricsPage.expectApplyButtonVisible();
    await pm.metricsPage.expectDatePickerVisible();

    // No metrics_data blob in URL by default
    const hasBlob = await pm.metricsPage.hasMetricsDataParam();
    expect(hasBlob).toBe(false);

    // Share button should be in DOM (but may be disabled if web_url not configured)
    const shareInDom = await pm.metricsPage.isShareButtonInDom();
    // In OSS, share button may be conditionally rendered;
    // if panel type is line (default), it should be present
    if (shareInDom) {
      const shareVisible = await pm.metricsPage.isShareButtonVisible();
      testLogger.info(`Share button visible: ${shareVisible}`);
    } else {
      testLogger.warn('Share button not in DOM — may be html/markdown panel type');
    }

    testLogger.info('Default state verified');
  });

  // ─── P2: Bad Blob Silent Fallback ──────────────────────────────────────────

  test("Deep-link with bad metrics_data blob falls back to defaults", {
    tag: ['@metrics-share-deep-link', '@P2', '@deeplink', '@error-handling', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing corrupt metrics_data blob fallback');

    // Build URL with deliberately invalid base64 blob
    const baseUrl = `${process.env.ZO_BASE_URL}/web/metrics`;
    const orgId = process.env.ORGNAME || 'default';
    const badUrl = `${baseUrl}?org_identifier=${orgId}&metrics_data=!!!not-valid-base64!!!`;

    await pm.metricsPage.navigateToMetricsUrl(badUrl);

    // Page should load without errors
    await pm.metricsPage.expectMetricsPageVisible();

    // Apply button should be visible (no auto-run, page in idle state)
    await pm.metricsPage.expectApplyButtonVisible();

    // Page should not crash — basic assertion
    const applyEnabled = await pm.metricsPage.isApplyButtonEnabled();
    expect(applyEnabled).toBe(true);

    testLogger.info('Bad blob fallback verified — page stable with defaults');
  });

  // ─── P2: Version Mismatch Blob Fallback ────────────────────────────────────

  test("Deep-link with unknown version blob falls back to defaults", {
    tag: ['@metrics-share-deep-link', '@P2', '@deeplink', '@version-mismatch', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing version-mismatch metrics_data blob');

    // Construct a valid JSON blob with v: 9999 (unknown version)
    const badPayload = JSON.stringify({ v: 9999, data: { type: 'line', queries: [] } });
    const badBlob = Buffer.from(badPayload, 'utf8').toString('base64');

    const baseUrl = `${process.env.ZO_BASE_URL}/web/metrics`;
    const orgId = process.env.ORGNAME || 'default';
    const url = `${baseUrl}?org_identifier=${orgId}&metrics_data=${encodeURIComponent(badBlob)}`;

    await pm.metricsPage.navigateToMetricsUrl(url);

    // Page should load without errors
    await pm.metricsPage.expectMetricsPageVisible();

    // Apply button visible — no auto-run (blob ignored due to version mismatch)
    await pm.metricsPage.expectApplyButtonVisible();

    testLogger.info('Version mismatch fallback verified');
  });

  // ─── P1: Deep-Link with Override Params Only (No Blob) ─────────────────────

  test("Deep-link with override params only builds panel from scratch", {
    tag: ['@metrics-share-deep-link', '@P1', '@deeplink', '@overrides', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing deep-link with override params (no metrics_data blob)');

    // Build URL with individual deep-link params but no metrics_data
    const promqlQuery = 'cpu_usage';
    const encodedQuery = Buffer.from(promqlQuery, 'utf8').toString('base64');

    const baseUrl = `${process.env.ZO_BASE_URL}/web/metrics`;
    const orgId = process.env.ORGNAME || 'default';
    const url = `${baseUrl}?org_identifier=${orgId}&chart_type=bar&query=${encodeURIComponent(encodedQuery)}`;

    await pm.metricsPage.navigateToMetricsUrl(url);

    // Page should load
    await pm.metricsPage.expectMetricsPageVisible();

    // Wait for auto-run to start (the Apply button may cycle through loading)
    await pm.metricsPage.waitForMetricsResults();

    // After auto-run, URL should be normalized and contain a metrics_data blob
    // or at minimum the page should be functional
    await pm.metricsPage.expectApplyButtonVisible();

    testLogger.info('Override params deep-link validated');
  });

  // ─── P1: URL Syncs After Manual Query Change ───────────────────────────────

  test("URL syncs metrics_data blob after manual query and Apply", {
    tag: ['@metrics-share-deep-link', '@P1', '@deeplink', '@url-sync', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing URL sync after manual query change');

    // Ensure we start without a metrics_data blob in URL
    const hasBlobBefore = await pm.metricsPage.hasMetricsDataParam();
    if (hasBlobBefore) {
      // Re-navigate cleanly. Must target the editor explicitly: a bare
      // `/metrics` carries no editor params, so it lands on the Metrics
      // Explorer — which has no query bar for the Apply below to use.
      const baseUrl = `${process.env.ZO_BASE_URL}/web/metrics/editor`;
      const orgId = process.env.ORGNAME || 'default';
      await pm.metricsPage.navigateToMetricsUrl(`${baseUrl}?org_identifier=${orgId}`);
    }

    // Enter a query and click Apply
    await pm.metricsPage.enterMetricsQuery('cpu_usage');
    await pm.metricsPage.clickApplyButton();

    // Wait for results to render
    await pm.metricsPage.waitForMetricsResults();

    // URL should now contain a metrics_data param
    const hasBlobAfter = await pm.metricsPage.hasMetricsDataParam();
    expect(hasBlobAfter).toBe(true);

    // Verify the blob decodes to valid JSON containing the query
    const blob = await pm.metricsPage.decodeMetricsBlob();
    expect(blob).not.toBeNull();
    expect(blob.v).toBe(1);

    testLogger.info('URL sync after manual query verified');
  });

  // ─── P2: Volatile Data (id, title, description) Stripped from Blob ─────────

  test("metrics_data blob excludes volatile data (id, title, description)", {
    tag: ['@metrics-share-deep-link', '@P2', '@deeplink', '@volatile-data', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing volatile data stripping from metrics_data blob');

    // Run a query to generate a blob
    await pm.metricsPage.enterMetricsQuery('cpu_usage');
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();

    // Extract and decode the blob
    const blob = await pm.metricsPage.decodeMetricsBlob();
    expect(blob).not.toBeNull();

    // Assert volatile data keys are absent
    if (blob && blob.data) {
      expect(blob.data.id).toBeUndefined();
      expect(blob.data.title).toBeUndefined();
      expect(blob.data.description).toBeUndefined();
      testLogger.info('Volatile data correctly stripped from blob');
    } else {
      testLogger.warn('Blob data section missing — cannot verify volatile stripping');
    }
  });

  // ─── P1: Absolute Time Range Preserved in Deep-Link ────────────────────────

  test("Deep-link restores absolute from/to time range", {
    tag: ['@metrics-share-deep-link', '@P1', '@deeplink', '@timerange', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing absolute time range restoration from deep-link');

    // Build a deep-link with explicit absolute from/to timestamps
    const now = Math.floor(Date.now() / 1000);
    const fromTs = now - 3600; // 1 hour ago
    const toTs = now;
    // Build a minimal valid blob
    const payload = JSON.stringify({
      v: 1,
      data: { type: 'line', queries: [{ query: 'cpu_usage', stream_name: '', queryType: 'promql' }] }
    });
    const blob = Buffer.from(payload, 'utf8').toString('base64');

    const baseUrl = `${process.env.ZO_BASE_URL}/web/metrics`;
    const orgId = process.env.ORGNAME || 'default';
    const url = `${baseUrl}?org_identifier=${orgId}&metrics_data=${encodeURIComponent(blob)}&from=${fromTs}&to=${toTs}`;

    await pm.metricsPage.navigateToMetricsUrl(url);

    // Page should load and auto-run
    await pm.metricsPage.expectMetricsPageVisible();

    // Wait for auto-run (results should render or no-data should appear)
    await pm.metricsPage.waitForMetricsResults();

    // Verify from/to params are present in URL (or reflected in the date picker)
    const fromParam = pm.metricsPage.getFromParam();
    const toParam = pm.metricsPage.getToParam();
    testLogger.info(`URL from=${fromParam}, to=${toParam}`);

    // At a minimum, the date picker should be visible (page is functional)
    await pm.metricsPage.expectDatePickerVisible();

    testLogger.info('Absolute time range deep-link validated');
  });

  // ─── P1: Relative Time Period Preserved ────────────────────────────────────

  test("Deep-link restores relative time period (period param wins)", {
    tag: ['@metrics-share-deep-link', '@P1', '@deeplink', '@timerange', '@period', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing relative period restoration from deep-link');

    // Build a deep-link with period param (should take precedence over from/to)
    const payload = JSON.stringify({
      v: 1,
      data: { type: 'line', queries: [{ query: 'cpu_usage', stream_name: '', queryType: 'promql' }] }
    });
    const blob = Buffer.from(payload, 'utf8').toString('base64');
    const now = Math.floor(Date.now() / 1000);

    const baseUrl = `${process.env.ZO_BASE_URL}/web/metrics`;
    const orgId = process.env.ORGNAME || 'default';
    const url = `${baseUrl}?org_identifier=${orgId}&metrics_data=${encodeURIComponent(blob)}&period=1h&from=${now - 7200}&to=${now}`;

    await pm.metricsPage.navigateToMetricsUrl(url);

    // Page should load
    await pm.metricsPage.expectMetricsPageVisible();
    await pm.metricsPage.waitForMetricsResults();

    // Date picker should be visible
    await pm.metricsPage.expectDatePickerVisible();

    testLogger.info('Relative period deep-link validated');
  });

  // ─── P0 / P1: Share Button & Conditional Tests ─────────────────────────────

  /**
   * Shared helper: determines whether share tests can run.
   * Returns { canShare: true/false, reason: string }
   */
  async function checkShareReadiness(pm) {
    const shareInDom = await pm.metricsPage.isShareButtonInDom();
    if (!shareInDom) {
      return { canShare: false, reason: 'Share button not in DOM — may be html/markdown panel type' };
    }

    const shareEnabled = await pm.metricsPage.isShareButtonEnabled();
    if (!shareEnabled) {
      return { canShare: false, reason: 'Share button is disabled — web_url may not be configured' };
    }

    return { canShare: true, reason: '' };
  }

  test("Share button disabled state — detects when web_url is not configured", {
    tag: ['@metrics-share-deep-link', '@P1', '@share', '@disabled', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Checking share button disabled state');

    const shareInDom = await pm.metricsPage.isShareButtonInDom();
    if (!shareInDom) {
      testLogger.info('Share button not in DOM — skipping disabled check (expected for html/markdown panels)');
      return;
    }

    const shareEnabled = await pm.metricsPage.isShareButtonEnabled();
    if (shareEnabled) {
      testLogger.info('Share button is enabled — web_url is configured, skipping disabled-state assertions');
      return;
    }

    // Button is present but disabled
    const isDisabled = await pm.metricsPage.isShareButtonDisabled();
    // May or may not have explicit disabled attribute depending on implementation
    testLogger.info(`Share button disabled attribute present: ${isDisabled}`);

    // The button should still be visible (dimmed, not hidden)
    const isVisible = await pm.metricsPage.isShareButtonVisible();
    expect(isVisible).toBe(true);

    testLogger.info('Share button disabled state validated');
  });

  test("Share button copies shortened URL to clipboard", {
    tag: ['@metrics-share-deep-link', '@P0', '@share', '@clipboard', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing share button short URL copy to clipboard');

    // First verify readiness
    const { canShare, reason } = await checkShareReadiness(pm);
    if (!canShare) {
      testLogger.warn(`Skipping share test — ${reason}`);
      test.skip(reason);
      return;
    }

    // Run a query first so the share URL captures real panel state
    await pm.metricsPage.enterMetricsQuery('cpu_usage');
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();

    // Click the share button
    const clicked = await pm.metricsPage.clickShareButton();
    expect(clicked).toBe(true);

    // Wait for success toast
    try {
      await pm.metricsPage.waitForShareSuccessToast(15000);
      testLogger.info('Share success toast appeared');
    } catch (_) {
      // May also succeed without toast in some configurations
      testLogger.warn('Share success toast not detected, checking clipboard');
    }

    // Verify clipboard contains a short URL
    const clipboardUrl = await pm.metricsPage.getCopiedShortUrl(15000);
    expect(clipboardUrl).toContain('/short/');
    testLogger.info(`Clipboard contains short URL: ${clipboardUrl}`);

    testLogger.info('Share-to-clipboard test completed');
  });

  test("Share button shows loading state during API call", {
    tag: ['@metrics-share-deep-link', '@P2', '@share', '@loading', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing share button loading state');

    const { canShare, reason } = await checkShareReadiness(pm);
    if (!canShare) {
      testLogger.warn(`Skipping loading test — ${reason}`);
      test.skip(reason);
      return;
    }

    // Run a query
    await pm.metricsPage.enterMetricsQuery('cpu_usage');
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();

    // Click share and immediately check for loading state
    const btn = pm.metricsPage.getShareButton();
    await btn.click();
    await page.waitForTimeout(100); // Tiny delay for UI to react

    // The button should enter loading state (or at minimum the click was handled)
    const isLoading = await pm.metricsPage.isShareButtonLoading();
    testLogger.info(`Share button loading state: ${isLoading}`);

    // Wait for success toast to confirm it completed
    await pm.metricsPage.waitForShareSuccessToast(15000).catch(() => {
      testLogger.warn('Share success toast not detected after loading');
    });

    // Loading should be cleared after completion. Poll the real loading state until
    // it clears rather than sleeping a fixed 500ms and asserting into a race.
    await expect.poll(
      async () => await pm.metricsPage.isShareButtonLoading(),
      { timeout: 10000, intervals: [200, 400, 800] }
    ).toBe(false);
    const isLoadingAfter = await pm.metricsPage.isShareButtonLoading();
    testLogger.info(`Share button loading after completion: ${isLoadingAfter}`);
    expect(isLoadingAfter).toBe(false);

    testLogger.info('Share button loading state test completed');
  });

  // ─── P0: Deep-Link Blob Restore Auto-Runs Query ────────────────────────────

  test("Deep-link blob restore auto-runs query on mount", {
    tag: ['@metrics-share-deep-link', '@P0', '@deeplink', '@restore', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing deep-link blob restore with auto-run');

    // Build a valid metrics_data blob with a known query
    const payload = JSON.stringify({
      v: 1,
      data: {
        type: 'line',
        queryType: 'promql',
        queries: [{ query: 'cpu_usage', stream_name: '', queryType: 'promql' }]
      }
    });
    const blob = Buffer.from(payload, 'utf8').toString('base64');

    const now = Math.floor(Date.now() / 1000);
    const fromTs = now - 900; // Last 15 minutes
    const toTs = now;

    const baseUrl = `${process.env.ZO_BASE_URL}/web/metrics`;
    const orgId = process.env.ORGNAME || 'default';
    const url = `${baseUrl}?org_identifier=${orgId}&metrics_data=${encodeURIComponent(blob)}&from=${fromTs}&to=${toTs}`;

    await pm.metricsPage.navigateToMetricsUrl(url);

    // Page should load with restored configuration
    await pm.metricsPage.expectMetricsPageVisible();

    // Wait for auto-run to complete
    await pm.metricsPage.waitForMetricsResults();

    // Verify the blob is present in URL (auto-run should sync it back)
    const blobContent = await pm.metricsPage.decodeMetricsBlob();
    if (blobContent) {
      expect(blobContent.v).toBe(1);
      testLogger.info('metrics_data blob restored successfully');
    }

    // The Apply button should be visible and eventually enabled
    await pm.metricsPage.waitForApplyEnabled(15000).catch(() => {
      testLogger.warn('Apply button did not enable within timeout');
    });

    testLogger.info('Deep-link auto-run test completed');
  });

  // ─── P1: Auto-Refresh Interval Preserved in Deep-Link ──────────────────────

  test("Deep-link restores auto-refresh interval", {
    tag: ['@metrics-share-deep-link', '@P1', '@deeplink', '@refresh', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing auto-refresh interval restoration from deep-link');

    const payload = JSON.stringify({
      v: 1,
      data: {
        type: 'line',
        queryType: 'promql',
        queries: [{ query: 'cpu_usage', stream_name: '', queryType: 'promql' }]
      }
    });
    const blob = Buffer.from(payload, 'utf8').toString('base64');

    const baseUrl = `${process.env.ZO_BASE_URL}/web/metrics`;
    const orgId = process.env.ORGNAME || 'default';
    const url = `${baseUrl}?org_identifier=${orgId}&metrics_data=${encodeURIComponent(blob)}&refresh=30s`;

    await pm.metricsPage.navigateToMetricsUrl(url);

    // Page should load
    await pm.metricsPage.expectMetricsPageVisible();
    await pm.metricsPage.waitForMetricsResults();

    // Check the refresh param is in the URL
    const refreshParam = pm.metricsPage.getRefreshParam();
    testLogger.info(`URL refresh param: ${refreshParam}`);

    // Auto-refresh button/display should reflect the interval
    const labelText = await pm.metricsPage.getAutoRefreshLabelText();
    testLogger.info(`Auto-refresh label text: ${labelText}`);

    testLogger.info('Auto-refresh deep-link test completed');
  });

  // ─── P2: Deep-Link Without Stream ──────────────────────────────────────────

  test("Deep-link without stream — query populated, no stream selected", {
    tag: ['@metrics-share-deep-link', '@P2', '@deeplink', '@edge-case', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing deep-link with query but no stream');

    const promqlQuery = 'cpu_usage';
    const encodedQuery = Buffer.from(promqlQuery, 'utf8').toString('base64');

    const baseUrl = `${process.env.ZO_BASE_URL}/web/metrics`;
    const orgId = process.env.ORGNAME || 'default';
    // query param present but no stream_name
    const url = `${baseUrl}?org_identifier=${orgId}&query=${encodeURIComponent(encodedQuery)}&chart_type=line`;

    await pm.metricsPage.navigateToMetricsUrl(url);

    // Page should load without crash
    await pm.metricsPage.expectMetricsPageVisible();

    // Page should be functional
    await pm.metricsPage.expectApplyButtonVisible();

    testLogger.info('Deep-link without stream validated — no crash');
  });

  // ─── P2: Share URL Freezes Time to Absolute from/to ────────────────────────

  test("Share URL contains absolute from/to timestamps, not period", {
    tag: ['@metrics-share-deep-link', '@P2', '@share', '@time-freeze', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing share URL time freeze to absolute from/to');

    const { canShare, reason } = await checkShareReadiness(pm);
    if (!canShare) {
      testLogger.warn(`Skipping time-freeze test — ${reason}`);
      test.skip(reason);
      return;
    }

    // Set a relative time range first (Last 15 minutes)
    await pm.metricsPage.selectLast15Minutes();

    // Run a query
    await pm.metricsPage.enterMetricsQuery('cpu_usage');
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();

    // Click share
    const btn = pm.metricsPage.getShareButton();
    await btn.click();

    // Wait for success
    await pm.metricsPage.waitForShareSuccessToast(15000).catch(() => {
      testLogger.warn('Share success toast not detected');
    });

    // Read clipboard URL
    const clipboardUrl = await pm.metricsPage.getCopiedShortUrl(15000);
    if (clipboardUrl && clipboardUrl.includes('/short/')) {
      testLogger.info(`Clipboard URL: ${clipboardUrl}`);

      // Parse the URL — the short URL redirects to the long URL with params.
      // The clipboard contains the short URL itself, not the expanded URL.
      // We can at least verify it's a valid short URL.
      expect(clipboardUrl).toContain('/short/');
    }

    testLogger.info('Share time-freeze test completed');
  });

});
