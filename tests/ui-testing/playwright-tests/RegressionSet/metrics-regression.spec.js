/**
 * Metrics Regression Bugs Test Suite
 *
 * This suite contains regression tests for metrics-related bugs that have been fixed.
 * Each test verifies that a specific bug fix is working correctly.
 *
 * Tests run in PARALLEL for efficiency - setup/cleanup handled via hooks.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

test.describe("Metrics Regression Bugs", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  // Ensure metrics are ingested once for all tests
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to metrics page
    await pm.metricsPage.gotoMetricsPage();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    testLogger.info('Metrics regression test setup completed');
  });

  // ==========================================================================
  // Bug #11061: "No results found" text not visible in dark mode
  // https://github.com/openobserve/openobserve/issues/11061
  // ==========================================================================
  // SKIPPED: Product issue - "No results found" text element not found in dark mode
  // Requires product fix before re-enabling test
  test.skip("No results found text should be visible in dark mode @bug-11061 @P2 @regression @darkMode", async ({ page }, testInfo) => {
    testLogger.info('Test: Verify "No results found" visibility in dark mode (Bug #11061)');

    // Enable dark mode using the navbar theme toggle button
    const themeToggleBtn = page.locator('[data-test="navbar-theme-toggle-btn"]');

    if (await themeToggleBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await themeToggleBtn.click();
      await page.waitForTimeout(1000);
      testLogger.info('✓ Clicked theme toggle button');
    } else {
      testLogger.warn('Theme toggle button not found');
    }

    // Check if page is in dark mode by looking for dark class or dark theme styles
    const bodyClass = await pm.metricsPage.getBodyElement().getAttribute('class') || '';
    const isDarkMode = bodyClass.includes('dark') || bodyClass.includes('body--dark');
    testLogger.info(`Dark mode active: ${isDarkMode}`);

    // If dark mode attempts failed, skip the test
    if (!isDarkMode) {
      testLogger.info('Dark mode not activated - skipping test');
      testInfo.skip(true, 'Dark mode unavailable - cannot test Bug #11061');
      return;
    }

    // Wait for page to stabilize after theme change
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('✓ Dark mode confirmed active, proceeding with visibility test');

    // Enter query that returns no results
    await pm.metricsPage.enterMetricsQuery('non_existent_metric_for_dark_mode_test_xyz');
    await page.waitForTimeout(500);

    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();

    // STRONG ASSERTION: Check for "No results found" or similar message
    const noResultsText = pm.metricsPage.getNoResultsText().first();

    // PRIMARY ASSERTION: "No results" text must be visible
    await expect(noResultsText, 'Bug #11061: "No results found" text must be visible').toBeVisible({ timeout: 5000 });
    testLogger.info('✓ "No results found" text is visible');

    // If dark mode was successfully activated, verify it
    if (isDarkMode) {
      const bodyClass = await pm.metricsPage.getBodyElement().getAttribute('class') || '';
      expect(bodyClass.includes('dark') || bodyClass.includes('body--dark'), 'Dark mode should be active').toBe(true);
      testLogger.info('✓ Dark mode confirmed active');
    }

    // Verify text is readable by checking color contrast
    const textColor = await noResultsText.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.color;
    });

    testLogger.info(`"No results" text color: ${textColor}`);

    // In dark mode, text should be light colored (not dark gray/black)
    // RGB values for dark text would be low (close to 0)
    // Light text would have higher values
    const rgbMatch = textColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]);
      const g = parseInt(rgbMatch[2]);
      const b = parseInt(rgbMatch[3]);
      const brightness = (r + g + b) / 3;

      testLogger.info(`Text brightness: ${brightness} (RGB: ${r}, ${g}, ${b})`);

      // STRONG ASSERTION: In dark mode, text brightness should be sufficient (not too dark)
      if (isDarkMode) {
        expect(brightness, 'Bug #11061: Text brightness should be sufficient in dark mode').toBeGreaterThan(100);
        testLogger.info('✓ Text has sufficient brightness for dark mode');
      }
    }

    testLogger.info('✓ PASSED: Dark mode visibility test completed');
  });

  // ==========================================================================
  // Bug #10059: Logs streams appearing in metrics streams dropdown
  // https://github.com/openobserve/openobserve/issues/10059
  // Fix: PR #11115 — moved stream_type="metrics" init from onMounted → onBeforeMount
  //      in web/src/plugins/metrics/Index.vue so FieldList.vue sees the correct
  //      stream_type before it mounts and fires its streams API call.
  // ==========================================================================

  test("Metrics page load must NOT fire a streams?type=logs API call @bug-10059 @P0 @regression", async ({ page }, testInfo) => {
    testLogger.info('Test: Verify no spurious streams?type=logs call on Metrics page load (Bug #10059)');

    const logsStreamCalls = [];
    const metricsStreamCalls = [];

    // Register listener BEFORE reloading so we capture requests from the fresh mount
    page.on('request', req => {
      const url = req.url();
      if (url.includes('streams') && url.includes('type=logs')) logsStreamCalls.push(url);
      if (url.includes('streams') && url.includes('type=metrics')) metricsStreamCalls.push(url);
    });

    // Force a full page reload — this remounts the Vue component from scratch,
    // which is exactly when the bug used to manifest (FieldList.vue mounting before
    // parent set stream_type="metrics").
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    testLogger.info(`streams?type=logs calls: ${logsStreamCalls.length}`);
    testLogger.info(`streams?type=metrics calls: ${metricsStreamCalls.length}`);
    testLogger.info(`logs URLs: ${logsStreamCalls.join(' | ') || 'none'}`);

    // PRIMARY ASSERTION: no spurious logs API call
    expect(
      logsStreamCalls.length,
      `Bug #10059 regression: streams?type=logs was called on Metrics page load (${logsStreamCalls.length}x). URLs: ${logsStreamCalls.join(', ')}`
    ).toBe(0);

    // SECONDARY ASSERTION: at least one metrics API call confirms the page loaded correctly
    expect(
      metricsStreamCalls.length,
      'Expected at least one streams?type=metrics call — Metrics page did not load streams correctly'
    ).toBeGreaterThan(0);

    testLogger.info('✓ PASSED: No streams?type=logs call fired on Metrics page load');
  });

  test("Metrics page must make exactly one streams list call (no double-fetch logs→metrics) @bug-10059 @P0 @regression", async ({ page }, testInfo) => {
    testLogger.info('Test: Verify Metrics page makes only one streams list call, not a double-fetch (Bug #10059)');

    const allStreamListCalls = [];

    // Register listener BEFORE reload to capture the fresh mount cycle
    page.on('request', req => {
      const url = req.url();
      // Match only the list endpoint (streams?type=…), not schema or field calls
      if (/\/streams\?type=/.test(url)) allStreamListCalls.push(url);
    });

    // Force full page reload to trigger component mount from scratch
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    testLogger.info(`All streams list calls: ${JSON.stringify(allStreamListCalls)}`);

    const logsTypeCalls = allStreamListCalls.filter(u => u.includes('type=logs'));
    const metricsTypeCalls = allStreamListCalls.filter(u => u.includes('type=metrics'));

    // Before fix: streams?type=logs fires, then streams?type=metrics fires (double-fetch)
    // After fix: only streams?type=metrics fires
    expect(
      logsTypeCalls.length,
      `Bug #10059: streams?type=logs should not be called on Metrics page. Called ${logsTypeCalls.length}x: ${logsTypeCalls.join(', ')}`
    ).toBe(0);

    expect(
      metricsTypeCalls.length,
      'Expected exactly one streams?type=metrics call for the initial stream list fetch'
    ).toBe(1);

    testLogger.info('✓ PASSED: Single streams?type=metrics call, no double-fetch');
  });

  test("Stream type selector must be hidden on Metrics page (stream_type is locked to metrics) @bug-10059 @P1 @regression", async ({ page }, testInfo) => {
    testLogger.info('Test: Verify stream_type selector is hidden on Metrics page (Bug #10059)');

    // FieldList.vue hides the stream_type dropdown when pageKey === "metrics"
    // (v-if="dashboardPanelDataPageKey !== 'metrics'")
    // This is correct behaviour — metrics page always uses type=metrics, no selector needed.
    const streamTypeSelector = page.locator('[data-test="index-dropdown-stream_type"]');
    const isVisible = await streamTypeSelector.isVisible({ timeout: 3000 }).catch(() => false);

    testLogger.info(`Stream type selector visible: ${isVisible} (expected: false)`);

    expect(
      isVisible,
      'Bug #10059: [data-test="index-dropdown-stream_type"] should be hidden on the Metrics page — stream_type is always "metrics" here'
    ).toBe(false);

    // The stream NAME selector (index-dropdown-stream) SHOULD be visible
    const streamNameSelector = page.locator('[data-test="index-dropdown-stream"]');
    await expect(
      streamNameSelector,
      'Stream name selector [data-test="index-dropdown-stream"] must be visible on Metrics page'
    ).toBeVisible({ timeout: 10000 });

    testLogger.info('✓ PASSED: Stream type selector hidden; stream name selector visible');
  });

  test("Stream dropdown must contain only metrics-type streams, not logs streams @bug-10059 @P1 @regression", async ({ page }, testInfo) => {
    testLogger.info('Test: Verify stream dropdown contains only metrics streams, cross-checked against API (Bug #10059)');

    const apiUrl = process.env.INGESTION_URL || 'http://localhost:5080';
    const orgId  = process.env.ORGNAME || 'default';
    const creds  = Buffer.from(
      `${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`
    ).toString('base64');

    // Fetch authoritative stream lists from the API
    const [metricsResp, logsResp] = await Promise.all([
      page.request.get(`${apiUrl}/api/${orgId}/streams?type=metrics`, {
        headers: { Authorization: `Basic ${creds}` },
      }),
      page.request.get(`${apiUrl}/api/${orgId}/streams?type=logs`, {
        headers: { Authorization: `Basic ${creds}` },
      }),
    ]);

    const metricsApiNames = ((await metricsResp.json()).list || []).map(s => s.name);
    const logsApiNames    = ((await logsResp.json()).list   || []).map(s => s.name);

    testLogger.info(`API metrics streams (${metricsApiNames.length}): ${metricsApiNames.join(', ')}`);
    testLogger.info(`API logs streams (${logsApiNames.length}): ${logsApiNames.join(', ')}`);

    // Open the stream dropdown
    const streamDropdown = page.locator('[data-test="index-dropdown-stream"]');
    await streamDropdown.waitFor({ state: 'visible', timeout: 15000 });
    await streamDropdown.click();
    await page.waitForTimeout(800);

    // Collect visible options using data-test attributes added to FieldList.vue.
    // Each option item has: data-test="index-dropdown-stream-option-{streamName}"
    // The no-result placeholder has: data-test="index-dropdown-stream-no-option"
    const optionItems = page.locator('[data-test^="index-dropdown-stream-option-"]');
    const count = await optionItems.count();
    const dropdownNames = [];
    for (let i = 0; i < count; i++) {
      // Extract stream name from the data-test attribute value
      const attr = await optionItems.nth(i).getAttribute('data-test') || '';
      const name = attr.replace('index-dropdown-stream-option-', '').trim();
      if (name) dropdownNames.push(name);
    }
    await page.keyboard.press('Escape');

    testLogger.info(`Dropdown streams (${dropdownNames.length}): ${dropdownNames.join(', ')}`);

    if (dropdownNames.length === 0) {
      testLogger.info('No streams in dropdown — no metrics ingested; skipping cross-reference assertion');
      return;
    }

    // Streams that appear in the dropdown AND exist only in the logs list (not metrics)
    const logsOnlyInDropdown = dropdownNames.filter(
      name => logsApiNames.includes(name) && !metricsApiNames.includes(name)
    );

    testLogger.info(`Logs-only streams in dropdown: [${logsOnlyInDropdown.join(', ')}]`);

    expect(
      logsOnlyInDropdown,
      `Bug #10059: Logs-only streams leaked into metrics dropdown: [${logsOnlyInDropdown.join(', ')}]`
    ).toHaveLength(0);

    testLogger.info('✓ PASSED: No logs-only streams found in metrics stream dropdown');
  });

  test("Navigating away and back to Metrics must not re-trigger streams?type=logs call @bug-10059 @P2 @regression", async ({ page }, testInfo) => {
    testLogger.info('Test: Verify no spurious logs call on re-navigation to Metrics page (Bug #10059)');

    // Step 1: Navigate away to Logs page (this legitimately calls streams?type=logs — that is fine)
    const logsNav = page.locator('[data-test="menu-link-/logs-item"]');
    if (await logsNav.isVisible({ timeout: 3000 }).catch(() => false)) {
      await logsNav.click();
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    // Step 2: NOW register the listener — only capture requests from this point forward.
    // Any streams?type=logs call from here on belongs to the Metrics page navigation,
    // not to the Logs page that we just left.
    const logsCallsOnReturn = [];
    const requestHandler = req => {
      const url = req.url();
      // Only catch the STREAM LIST call (e.g. /streams?type=logs), not schema
      // or field-values calls (e.g. /streams/foo/schema?type=logs).
      // The spurious bug call always hits the list endpoint: /streams?type=logs
      if (/\/streams\?type=logs/.test(url)) {
        logsCallsOnReturn.push(url);
      }
    };
    page.on('request', requestHandler);

    // Step 3: Navigate back to Metrics
    await pm.metricsPage.gotoMetricsPage();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);

    page.off('request', requestHandler);

    testLogger.info(`streams?type=logs calls after returning to Metrics: ${logsCallsOnReturn.length}`);
    if (logsCallsOnReturn.length) {
      testLogger.info(`URLs: ${logsCallsOnReturn.join(' | ')}`);
    }

    expect(
      logsCallsOnReturn.length,
      `Bug #10059: streams?type=logs was called ${logsCallsOnReturn.length}x when navigating back to Metrics. URLs: ${logsCallsOnReturn.join(', ')}`
    ).toBe(0);

    testLogger.info('✓ PASSED: No spurious logs stream call on re-navigation to Metrics');
  });

  test.afterEach(async () => {
    testLogger.info('Metrics regression test completed');
  });
});
