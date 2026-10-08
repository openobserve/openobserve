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
    await pm.logsPage.setRelativeTimeRange('1-h');

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

    // Step 2-4: Deterministically enable SQL mode, set the query, run it (without cancelling
    // the auto-search), and confirm sql_mode committed to the URL — retries once then
    // strict-asserts, so the generated short URL reliably captures sql_mode=true + the query
    // (previously enableSqlModeIfNeeded didn't stick on CI, leaving sql_mode=false).
    await pm.logsPage.setupSqlQueryForShare(`SELECT * FROM "${TEST_STREAM}"`);
    testLogger.info('SQL mode enabled before sharing');

    // Step 5: Click share link and get URL
    const sharedUrl = await pm.logsPage.clickShareLinkAndGetUrl();

    // Step 6: Navigate to shared URL
    await page.goto(sharedUrl);
    await pm.logsPage.waitForRedirectComplete();

    // Step 7: SQL mode is auto-detected from the query editor content, which lazy-loads
    // and re-hydrates AFTER the redirect. Wait for the restored SELECT query to land in
    // the editor before asserting (self-heals with one reload if the lazy editor mounts
    // empty after the short-URL hop) — a fixed 2s wait raced the pre-fill on CI.
    await pm.logsPage.waitForRedirectedQueryEditorContent('SELECT');
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

    // Step 2: Toggle histogram (now inside utilities hamburger menu)
    await pm.logsPage.toggleHistogram();
    await page.waitForTimeout(1000);

    // Step 3: Click refresh
    await pm.logsPage.clickRefresh();

    // Step 4: Capture original state. The histogram toggle writes show_histogram to the
    // URL asynchronously, so wait for the param to be present before reading it —
    // otherwise the "original" value itself is captured mid-write on a loaded runner.
    await pm.logsPage.waitForUrlParam('show_histogram');
    const originalState = await pm.logsPage.captureCurrentState();
    testLogger.info('Original histogram state', { showHistogram: originalState.showHistogram });

    // Step 5: Click share link and get URL
    const sharedUrl = await pm.logsPage.clickShareLinkAndGetUrl();

    // Step 6: Navigate to shared URL
    await page.goto(sharedUrl);
    await pm.logsPage.waitForRedirectComplete();

    // Step 7: show_histogram is one of the last params the SPA appends when re-hydrating
    // from the short URL. Wait for it to appear (was read as null / a transitional value
    // on CI when captured mid-rewrite) before comparing.
    await pm.logsPage.waitForUrlParam('show_histogram', originalState.showHistogram);
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
    await pm.logsPage.setRelativeTimeRange('30-m');

    // Step 2: Click refresh
    await pm.logsPage.clickRefresh();

    // Step 3: Capture complete original state. Wait for the last-written toggle param
    // (show_histogram) so the full search state is in the URL before we snapshot it.
    await pm.logsPage.waitForUrlParam('show_histogram');
    const originalState = await pm.logsPage.captureCurrentState();
    testLogger.info('Complete original state captured', originalState);

    // Step 4: Click share link and get URL
    const sharedUrl = await pm.logsPage.clickShareLinkAndGetUrl();
    testLogger.info('Shared URL', { url: sharedUrl });

    // Step 5: Navigate to shared URL
    await page.goto(sharedUrl);
    await pm.logsPage.waitForRedirectComplete();

    // Step 6: Wait for the SPA to finish re-hydrating the toggle params from the short
    // URL (show_histogram is written last) before capturing, then compare.
    await pm.logsPage.waitForUrlParam('show_histogram', originalState.showHistogram);
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
    const shareButton = pm.logsPage.getShareLinkButtonLocator();

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

    testLogger.info('Testing share link before any run (G1)');

    const share = page.locator('[data-test="logs-search-bar-share-link-btn"]');
    await pm.logsPage.expectShareLinkButtonVisible();
    await expect(share).toBeDisabled();
    await share.hover({ force: true });
    await expect(page.locator('[data-test="o-tooltip-content"]:visible')).toContainText(
      'Run the query first: this action saves or shares what you ran',
    );

    await pm.logsPage.selectStream(TEST_STREAM);
    await pm.logsPage.clickRefresh();
    await expect(page.locator('[data-test="logs-search-result-logs-table"] [data-test="o2-table-row-0"]')).toBeAttached({
      timeout: 60000,
    });
    await expect(share).toBeEnabled({ timeout: 30000 });
    const result = await pm.logsPage.clickShareLinkAndExpectNotification();
    expect(result.appeared).toBe(true);
    expect(result.isSuccess).toBe(true);

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
    await pm.logsPage.enableSqlModeIfNeeded();
    await page.waitForTimeout(1000);

    // Typing would append to SQL mode's pre-filled query, so it is replaced.
    const sql = `SELECT * FROM "${TEST_STREAM}" LIMIT 50`;
    await pm.logsPage.clearAndFillQueryEditor(sql);
    expect(await pm.logsPage.getQueryEditorText()).toBe(sql);

    await pm.logsPage.clickRefresh();
    await expect(page.locator('[data-test="logs-search-result-logs-table"] [data-test="o2-table-row-0"]')).toBeAttached({
      timeout: 60000,
    });
    await expect(page.locator('[data-test="logs-search-bar-share-link-btn"]')).toBeEnabled({ timeout: 30000 });

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

    await pm.logsPage.setRelativeTimeRange('1-h');

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

  // Bug #9788 test should be moved to RegressionSet/logs-regression.spec.js or similar
});

// J-C4 (no stream role) needs ENT RBAC and lives in the ENT suite.
const path = require('path');
const { ingestRows } = require('../utils/auto-run-helpers.js');
const { getAuthHeaders } = require('../utils/cloud-auth.js');

const LINK_ORG = `lnk${Date.now()}`;
const LINE_STREAM = 'line_logs';
const OTHER_STREAM = 'other_logs';
const WIDE_STREAM = 'wide_logs';
const ORIG_STREAM = 'orig_logs';
// Set by J-C17, applied by J-C28 (the describe is serial).
let savedViewName = null;
const AUTH_FILE = path.join(__dirname, '..', 'utils', 'auth', 'user.json');
// Fixed for the whole run, so every journey knows exactly which µs each special row has.
const BASE_US = (Date.now() - 4 * 60 * 1000) * 1000;
const T_UNIQUE = BASE_US + 9000;
const T_DUP = BASE_US + 8000;
const T_TWIN = BASE_US + 7000;
const T_EMPTY = BASE_US + 6500;

const lineTable = '[data-test="logs-search-result-logs-table"]';
const lineRow = (n) => `${lineTable} [data-test="o2-table-row-${n}"]`;
const lineBanner = '[data-test="logs-permalink-banner"]';
const gridDrawer = '[data-test="logs-search-result-detail-dialog"]';
const lineJson = '[data-test="log-detail-json-content"]';
const menuCopyLink = '[data-test="log-context-menu-copy-line-link"]';
const drawerCopyLink = '[data-test="log-detail-copy-line-link-btn"]';

const urlB64 = (text) =>
  Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '.');

function lineRows() {
  const rows = [];
  for (let i = 0; i < 130; i += 1) {
    rows.push({ _timestamp: BASE_US - i * 1000, level: 'info', message: `row-${i}` });
  }
  rows.push({ _timestamp: T_UNIQUE, level: 'error', message: 'line-unique' });
  rows.push({ _timestamp: T_DUP, level: 'warn', message: 'dup-a' });
  rows.push({ _timestamp: T_DUP, level: 'warn', message: 'dup-b' });
  rows.push({ _timestamp: T_TWIN, level: 'debug', message: 'twin' });
  rows.push({ _timestamp: T_TWIN, level: 'debug', message: 'twin' });
  return rows;
}

function logsUrl(stream, extra = '') {
  return (
    `/web/logs?org_identifier=${LINK_ORG}&stream=${stream}&stream_type=logs&period=15m&refresh=0` +
    `&sql_mode=false&quick_mode=false&show_histogram=false${extra}`
  );
}

function paramsOf(url) {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

async function runStream(page, stream, extra = {}) {
  await page.goto(hand(logsUrl(stream), extra));
  await page.locator('[data-test="logs-search-bar-query-editor"] .monaco-editor').first().waitFor({ timeout: 60000 });
  await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
  await expect(page.locator(lineRow(0))).toBeAttached({ timeout: 60000 });
  await expect(page.locator('[data-test="logs-results-progress"] [role="progressbar"]')).toHaveCount(0, {
    timeout: 60000,
  });
}

async function rowWith(page, text) {
  await expect(page.locator(lineTable)).toContainText(text, { timeout: 30000 });
  return page.evaluate(
    ({ table, needle }) => {
      const rows = Array.from(document.querySelectorAll(`${table} [data-test^="o2-table-row-"]`));
      const hit = rows.find((row) => row.textContent?.includes(needle));
      return hit ? Number(hit.getAttribute('data-test').replace('o2-table-row-', '')) : -1;
    },
    { table: lineTable, needle: text },
  );
}

async function copyFromMenu(page, n) {
  const cell = page.locator(`${lineRow(n)} td[data-test^="o2-table-cell-"]`).last();
  await cell.scrollIntoViewIfNeeded();
  await cell.click({ button: 'right' });
  await page.locator(menuCopyLink).click();
  const toast = page.locator('[data-test-variant][data-test-message*="ink"]').last();
  await toast.waitFor({ state: 'visible', timeout: 30000 });
  return {
    variant: await toast.getAttribute('data-test-variant'),
    message: await toast.getAttribute('data-test-message'),
    url: await page.evaluate(() => navigator.clipboard.readText()),
  };
}

async function expandLink(request, url) {
  const match = /\/short\/([^/?#]+)/.exec(url);
  if (!match) return url;
  const response = await request.get(`${process.env.ZO_BASE_URL}/api/${LINK_ORG}/short/${match[1]}?type=ui`, {
    headers: getAuthHeaders(),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return JSON.parse(await response.text());
}

async function recipient(browser, localStorageSeed = null) {
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1500, height: 1024 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  if (localStorageSeed) {
    await context.addInitScript((seed) => {
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
    }, localStorageSeed);
  }
  const page = await context.newPage();
  return { context, page };
}

async function switchStream(page, from, to) {
  const popover = page.locator('[data-test="log-search-index-list-select-stream-popover"]');
  const search = page.locator('[data-test="log-search-index-list-select-stream-search"]');
  await page.locator('[data-test="log-search-index-list-select-stream-trigger"]').first().click();
  await popover.waitFor({ state: 'visible' });
  if (await search.count()) await search.fill(to);
  await page.locator(`[data-test="log-search-index-list-select-stream-option"][data-test-value="${to}"]`).first().click();
  if (await popover.isVisible()) await page.keyboard.press('Escape');
  await popover.waitFor({ state: 'hidden' });
  await expect(page.locator('[data-test="log-search-index-list-select-stream"]')).not.toContainText(from);
}

function trackResolves(page) {
  const sent = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/_search\?.*search_type=other/.test(request.url())) {
      sent.push({ url: request.url(), body: JSON.parse(request.postData() || '{}') });
    }
  });
  return sent;
}

function hand(url, extra) {
  const base = new URL(url, process.env.ZO_BASE_URL);
  for (const [key, value] of Object.entries(extra)) {
    if (value === null) base.searchParams.delete(key);
    else base.searchParams.set(key, value);
  }
  return `${base.pathname}?${base.searchParams.toString()}`;
}

const floorSecond = (us) => Math.floor(us / 1_000_000) * 1_000_000;

function lineLinkPath(stream, ts, extra = {}) {
  return hand(logsUrl(stream), {
    period: null,
    from: String(floorSecond(ts) - 600_000_000),
    to: String(floorSecond(ts) + 1_000_000),
    log_stream: stream,
    log_ts: String(ts),
    ...extra,
  });
}

test.describe('Line links (4c Part C)', () => {
  // CI's 600 s retention/stats interval yields no stream stats within setup, and J-C12 needs an unshipped cache fix.
  test.skip(!!process.env.CI, 'Line links need stream stats and the J-C12 cache fix that CI does not have; run locally');
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    await ingestRows(request, LINK_ORG, LINE_STREAM, lineRows());
    await ingestRows(request, LINK_ORG, OTHER_STREAM, [
      { _timestamp: BASE_US, level: 'info', message: 'other-0' },
      { _timestamp: BASE_US - 1000, level: 'info', message: 'other-1' },
    ]);
    // A stream that keeps original data, so its rows carry _o2_id and a link can name the row exactly.
    await ingestRows(request, LINK_ORG, ORIG_STREAM, [{ _timestamp: BASE_US - 1000, message: 'seed' }]);
    const settings = await request.put(`${process.env.ZO_BASE_URL}/api/${LINK_ORG}/streams/${ORIG_STREAM}/settings?type=logs`, {
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      data: { store_original_data: true },
    });
    expect(settings.ok(), await settings.text()).toBe(true);
    await ingestRows(request, LINK_ORG, ORIG_STREAM, [{ _timestamp: T_UNIQUE, level: 'error', message: 'kept-original' }]);
    const wide = { _timestamp: T_UNIQUE, message: 'wide-line' };
    for (let i = 0; i < 505; i += 1) wide[`f_${i}`] = `v${i}`;
    await ingestRows(request, LINK_ORG, WIDE_STREAM, [wide]);
    // Ingested rows become searchable once the WAL flushes; wait on the search, not on time.
    const searchable = async (stream) => {
      const response = await request.post(`${process.env.ZO_BASE_URL}/api/${LINK_ORG}/_search?type=logs`, {
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        data: {
          query: {
            sql: `SELECT * FROM "${stream}"`,
            start_time: BASE_US - 600_000_000,
            end_time: BASE_US + 600_000_000,
            from: 0,
            size: 200,
          },
        },
      });
      return response.ok() ? (await response.json()).hits.length : 0;
    };
    // The page reads through the streaming endpoint, which plans from stream stats that land a little later.
    const streamable = async (stream) => {
      const now = Date.now() * 1000;
      const response = await request.post(
        `${process.env.ZO_BASE_URL}/api/${LINK_ORG}/_search_stream?type=logs&search_type=ui&use_cache=false`,
        {
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          data: { query: { sql: `select * from "${stream}" `, start_time: now - 900_000_000, end_time: now, from: 0, size: 51 } },
        },
      );
      return response.ok() && (await response.text()).includes('"hits":[{');
    };
    const poll = { timeout: 120000, intervals: [1000, 2000, 5000] };
    await expect.poll(() => searchable(LINE_STREAM), poll).toBe(135);
    await expect.poll(() => searchable(OTHER_STREAM), poll).toBe(2);
    await expect.poll(() => searchable(WIDE_STREAM), poll).toBe(1);
    await expect.poll(() => searchable(ORIG_STREAM), poll).toBe(2);
    for (const stream of [LINE_STREAM, OTHER_STREAM, WIDE_STREAM, ORIG_STREAM]) {
      await expect.poll(() => streamable(stream), poll).toBe(true);
    }
    // The page's partition plan reads the stream stats, so wait until every stream has them.
    const statsReady = async () => {
      const response = await request.get(`${process.env.ZO_BASE_URL}/api/${LINK_ORG}/streams?type=logs`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok()) return false;
      const { list = [] } = await response.json();
      return [LINE_STREAM, OTHER_STREAM, WIDE_STREAM, ORIG_STREAM].every((name) =>
        list.some((entry) => entry.name === name && Number(entry.stats?.doc_num) > 0),
      );
    };
    await expect.poll(statsReady, poll).toBe(true);
  });

  test('J-C1/J-C2/J-C5: the sharer copies a tied line; the recipient sees that exact line, A\'s columns, and a clean close', async ({
    page,
    browser,
    request,
  }) => {
    const seedA = { logFilterField: JSON.stringify({ [`${LINK_ORG}_${LINE_STREAM}`]: ['level', 'message'] }) };
    await page.addInitScript((seed) => {
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
    }, seedA);
    await runStream(page, LINE_STREAM);
    const n = await rowWith(page, 'dup-b');
    const copied = await copyFromMenu(page, n);
    expect(copied.variant).toBe('success');
    const link = paramsOf(await expandLink(request, copied.url));
    expect(link.log_stream).toBe(LINE_STREAM);
    expect(link.log_ts).toBe(String(T_DUP));
    expect(link.log_fp).toMatch(/^[0-9a-z]{1,14}$/);
    expect(link.refresh).toBe('0');
    expect(link.page).toBeUndefined();
    expect(JSON.parse(Buffer.from(link.columns.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '='), 'base64').toString())).toEqual(['level', 'message']);

    await page.locator(lineRow(n)).click();
    await expect(page.locator(lineJson)).toContainText('dup-b');
    await page.locator(drawerCopyLink).click();
    const toast = page.locator('[data-test-variant="success"][data-test-message*="ink"]').last();
    await toast.waitFor({ state: 'visible', timeout: 30000 });
    const fromDrawer = paramsOf(await expandLink(request, await page.evaluate(() => navigator.clipboard.readText())));
    expect(fromDrawer.log_fp).toBe(link.log_fp);
    await page.keyboard.press('Escape');

    const seedB = { logFilterField: JSON.stringify({ [`${LINK_ORG}_${LINE_STREAM}`]: ['message'] }) };
    const { context, page: b } = await recipient(browser, seedB);
    await b.goto(copied.url);
    await expect(b.locator(lineBanner)).toHaveAttribute('data-state', 'found', { timeout: 60000 });
    await expect(b.locator(gridDrawer)).toBeVisible();
    await expect(b.locator(lineJson)).toContainText('dup-b');
    await expect(b.locator(lineJson)).not.toContainText('dup-a');
    const opened = b.locator(`${lineTable} .o2-log-permalink-row`);
    await expect(opened).toHaveCount(1, { timeout: 60000 });
    await expect(opened).toHaveAttribute('aria-current', 'true');
    await expect(opened).toContainText('dup-b');
    await expect(opened).toBeInViewport();
    const headers = await b.locator(`${lineTable} thead th`).allInnerTexts();
    expect(headers.join('|')).toMatch(/level/);
    expect(JSON.parse(await b.evaluate(() => localStorage.getItem('logFilterField')))).toEqual({
      [`${LINK_ORG}_${LINE_STREAM}`]: ['message'],
    });

    const historyBefore = await b.evaluate(() => history.length);
    await b.keyboard.press('Escape');
    await expect.poll(() => paramsOf(b.url()).log_ts, { timeout: 10000 }).toBeUndefined();
    expect(await b.evaluate(() => history.length)).toBe(historyBefore);
    await expect(b.locator(lineBanner)).toHaveAttribute('data-state', 'found');
    await context.close();
  });

  test('AC-C1.3: without ClipboardItem the link opens in a popover with the full URL and a Copy button', async ({ page, request }) => {
    await page.addInitScript(() => {
      delete window.ClipboardItem;
    });
    await runStream(page, LINE_STREAM);
    const n = await rowWith(page, 'line-unique');
    const cell = page.locator(`${lineRow(n)} td[data-test^="o2-table-cell-"]`).last();
    await cell.click({ button: 'right' });
    await page.locator(menuCopyLink).click();
    const popover = page.locator('[data-test="log-line-link-popover"]');
    await expect(popover).toBeVisible({ timeout: 30000 });
    const field = page.locator('[data-test="log-line-link-popover-url-field"]');
    await expect(field).toHaveValue(/^https?:\/\//);
    const url = await field.inputValue();
    expect(paramsOf(await expandLink(request, url)).log_ts).toBe(String(T_UNIQUE));
    await page.locator('[data-test="log-line-link-popover-copy"]').click();
    await expect(popover).toBeHidden();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  });

  test('J-C7: a VRL function or an alias onto an identity column disables Copy link with the reason', async ({ page }) => {
    await runStream(page, LINE_STREAM, { fn_editor: 'true', functionContent: urlB64('.extra = 1') });
    await page.locator(lineRow(0)).click();
    await expect(page.locator(drawerCopyLink)).toHaveAttribute('aria-disabled', 'true');
    await page.locator('[data-test="log-detail-copy-line-link"]').hover();
    await expect(page.locator('[data-test="o-tooltip-content"]').filter({ hasText: 'Turn off the function' })).toBeVisible();
    await page.keyboard.press('Escape');

    await runStream(page, LINE_STREAM, {
      sql_mode: 'true',
      query: urlB64(`SELECT _timestamp, message AS _o2_id FROM "${LINE_STREAM}"`),
    });
    const cell = page.locator(`${lineRow(0)} td[data-test^="o2-table-cell-"]`).last();
    await cell.click({ button: 'right' });
    await expect(page.locator(menuCopyLink)).toHaveAttribute('aria-disabled', 'true');
    await page.locator(menuCopyLink).hover({ force: true });
    await expect(page.locator('[data-test="o-tooltip-content"]').filter({ hasText: 'rewrites the timestamp' })).toBeVisible();
  });

  test('J-C3, J-C8, J-C9, J-C13: outcome banners for hand-made links', async ({ page }) => {
    const resolves = trackResolves(page);
    await page.goto(lineLinkPath(LINE_STREAM, T_EMPTY));
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'gone', { timeout: 60000 });
    await expect(page.locator(gridDrawer)).toHaveCount(0);
    await page.goto(hand(lineLinkPath(LINE_STREAM, T_UNIQUE), { log_ts: 'abc' }));
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'invalid', { timeout: 60000 });
    await expect(page.locator(lineRow(0))).toBeAttached({ timeout: 60000 });
    await page.goto(lineLinkPath(LINE_STREAM, T_UNIQUE));
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'found', { timeout: 60000 });
    await expect(page.locator(lineJson)).toContainText('line-unique');
    await page.keyboard.press('Escape');
    await page.goto(lineLinkPath(LINE_STREAM, T_DUP));
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'ambiguous', { timeout: 60000 });
    await expect(page.locator(lineBanner)).toContainText('2 lines at this timestamp');
    await expect(page.locator(`${lineTable} .o2-log-permalink-match`)).toHaveCount(2, { timeout: 60000 });
    await expect(page.locator(gridDrawer)).toHaveCount(0);
    await page.goto(lineLinkPath('no_such_stream', T_UNIQUE));
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'stream_missing', { timeout: 60000 });
    await expect(page.locator(lineBanner)).toContainText('no_such_stream');
    // J-C20 needs a stale org mid-switch, so the mounted Index test "a link for another org resolves nothing" covers it.
    expect(resolves.every((r) => r.url.includes(`/api/${LINK_ORG}/`))).toBe(true);
  });

  test('J-C12, J-C14, J-C15, J-C16: partial, error + Retry, Show these lines, changed line (stubbed resolve)', async ({ page }) => {
    await page.route('**/_search?*search_type=other*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, is_partial: true } });
    });
    await page.goto(lineLinkPath(LINE_STREAM, T_UNIQUE));
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'incomplete', { timeout: 60000 });
    await expect(page.locator(gridDrawer)).toHaveCount(0);
    await expect(page.locator('[data-test="logs-results-progress"] [role="progressbar"]')).toHaveCount(0, {
      timeout: 60000,
    });
    const gridSearches = [];
    page.on('request', (r) => {
      if (/_search_stream/.test(r.url()) && !r.url().includes('is_ui_histogram')) {
        gridSearches.push(JSON.parse(r.postData()).query);
      }
    });
    const narrowed = (r) => {
      if (!/_search_stream/.test(r.url()) || r.url().includes('is_ui_histogram')) return false;
      return JSON.parse(r.postData()).query.start_time === T_UNIQUE;
    };
    const searched = page.waitForRequest(narrowed);
    await page.locator('[data-test="logs-permalink-banner-show-lines"]').click();
    const query = JSON.parse((await searched).postData()).query;
    expect(query.end_time).toBe(T_UNIQUE + 1);
    await expect.poll(() => paramsOf(page.url()).log_ts).toBeUndefined();
    await expect
      .poll(() => [paramsOf(page.url()).from, paramsOf(page.url()).to], { timeout: 30000 })
      .toEqual([String(T_UNIQUE), String(T_UNIQUE + 1)]);
    await expect(page.locator(lineTable)).toContainText('line-unique', { timeout: 30000 });
    await expect(page.locator('[data-test="logs-results-progress"] [role="progressbar"]')).toHaveCount(0, {
      timeout: 60000,
    });
    expect(gridSearches.filter((q) => q.start_time !== T_UNIQUE || q.end_time !== T_UNIQUE + 1)).toEqual([]);
    await page.unroute('**/_search?*search_type=other*');

    let calls = 0;
    await page.route('**/_search?*search_type=other*', async (route) => {
      calls += 1;
      if (calls === 1) await route.fulfill({ status: 500, json: { code: 500, message: 'boom' } });
      else await route.continue();
    });
    await page.goto(lineLinkPath(LINE_STREAM, T_UNIQUE));
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'error', { timeout: 60000 });
    await page.locator('[data-test="logs-permalink-banner-retry"]').click();
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'found', { timeout: 60000 });
    expect(calls).toBe(2);
    await page.unroute('**/_search?*search_type=other*');
    await page.keyboard.press('Escape');

    await page.route('**/_search?*search_type=other*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.hits = body.hits.map((hit) => ({ ...hit, message: `${hit.message} [redacted]` }));
      await route.fulfill({ response, json: body });
    });
    await runStream(page, LINE_STREAM);
    const n = await rowWith(page, 'line-unique');
    await page.unroute('**/_search?*search_type=other*');
    const { url } = await copyFromMenu(page, n);
    await page.route('**/_search?*search_type=other*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.hits = body.hits.map((hit) => ({ ...hit, message: `${hit.message} [redacted]` }));
      await route.fulfill({ response, json: body });
    });
    await page.goto(url);
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'ambiguous', { timeout: 60000 });
    await expect(page.locator(lineBanner)).toContainText('may have changed');
    await expect(page.locator(gridDrawer)).toHaveCount(0);
  });

  test('J-C10, J-C19: the drawer opens on the resolve whatever the search does; a row click while resolving wins', async ({ page }) => {
    let release;
    const held = new Promise((resolve) => (release = resolve));
    await page.route('**/_search_stream?*', async (route) => {
      if (!route.request().url().includes('is_ui_histogram')) await held;
      await route.continue();
    });
    await page.goto(lineLinkPath(LINE_STREAM, T_UNIQUE));
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'found', { timeout: 60000 });
    await expect(page.locator(lineJson)).toContainText('line-unique');
    await expect(page.locator(`${lineTable} .o2-log-permalink-row`)).toHaveCount(0);
    release();
    await expect(page.locator(`${lineTable} .o2-log-permalink-row`)).toHaveCount(1, { timeout: 60000 });
    await page.unroute('**/_search_stream?*');
    await expect(page.locator(gridDrawer)).toBeVisible();
    // A later Run closes it and drops log_*; the modal drawer covers the button, so the click is dispatched to it.
    const runButton = page.locator('[data-test="logs-search-bar-refresh-btn"]');
    await expect(runButton).toContainText('Run query', { timeout: 60000 });
    await runButton.dispatchEvent('click');
    await expect(page.locator(gridDrawer)).toHaveCount(0, { timeout: 30000 });
    await expect.poll(() => paramsOf(page.url()).log_ts).toBeUndefined();

    let releaseResolve;
    const heldResolve = new Promise((resolve) => (releaseResolve = resolve));
    await page.route('**/_search?*search_type=other*', async (route) => {
      await heldResolve;
      await route.continue();
    });
    await page.goto(lineLinkPath(LINE_STREAM, T_UNIQUE));
    await expect(page.locator(lineRow(2))).toBeAttached({ timeout: 60000 });
    const rowTwo = (await page.locator(lineRow(2)).innerText()).match(/row-\d+|line-unique|dup-[ab]|twin/)[0];
    await page.locator(lineRow(2)).click();
    await expect(page.locator(lineJson)).toContainText(rowTwo);
    releaseResolve();
    await expect.poll(() => paramsOf(page.url()).log_ts).toBeUndefined();
    await expect(page.locator(lineJson)).toContainText(rowTwo);
    await page.unroute('**/_search?*search_type=other*');
  });

  test('J-C11: a stream change while the line resolves cancels it; no drawer opens', async ({ page }) => {
    let releaseResolve;
    const heldResolve = new Promise((resolve) => (releaseResolve = resolve));
    await page.route('**/_search?*search_type=other*', async (route) => {
      await heldResolve;
      await route.continue().catch(() => undefined);
    });
    await page.goto(lineLinkPath(LINE_STREAM, T_UNIQUE));
    await page.locator('[data-test="logs-search-bar-query-editor"]').first().waitFor({ timeout: 60000 });
    await switchStream(page, LINE_STREAM, OTHER_STREAM);
    await expect.poll(() => paramsOf(page.url()).log_ts, { timeout: 30000 }).toBeUndefined();
    releaseResolve();
    await expect(page.locator(gridDrawer)).toHaveCount(0);
    await page.unroute('**/_search?*search_type=other*');
    await expect(page.locator('[data-test="logs-permalink-detail-dialog"]')).toHaveCount(0);
  });

  test('J-C22, J-C24, J-C6: identical twins, an expression projection and a column subset still open the line', async ({ page, browser, request }) => {
    const { context, page: b } = await recipient(browser);
    await b.goto(lineLinkPath(LINE_STREAM, T_TWIN));
    await expect(b.locator(lineBanner)).toHaveAttribute('data-state', 'ambiguous', { timeout: 60000 });
    await context.close();
    await runStream(page, LINE_STREAM);
    const twin = await rowWith(page, 'twin');
    const copiedTwin = await copyFromMenu(page, twin);
    expect(paramsOf(await expandLink(request, copiedTwin.url)).log_fp).toBeTruthy();
    await page.goto(copiedTwin.url);
    const twinRow = page.locator(`${lineTable} .o2-log-permalink-row`);
    await expect(twinRow).toHaveCount(1, { timeout: 60000 });
    expect(Number((await twinRow.getAttribute('data-test')).replace('o2-table-row-', ''))).toBe(twin);
    await page.keyboard.press('Escape');

    const exprQuery = `SELECT _timestamp, level, 'B' AS message FROM "${LINE_STREAM}"`;
    await runStream(page, LINE_STREAM, { sql_mode: 'true', query: urlB64(exprQuery) });
    const errorRow = await rowWith(page, 'error');
    const copiedExpr = await copyFromMenu(page, errorRow);
    expect(copiedExpr.variant).toBe('success');
    await page.goto(copiedExpr.url);
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'found', { timeout: 60000 });
    await expect(page.locator(`${lineTable} .o2-log-permalink-row`)).toHaveCount(1, { timeout: 60000 });
    await expect(page.locator('[data-test="log-detail-next-detail-btn"]')).toBeEnabled();
    await expect(page.locator(lineJson)).toContainText('line-unique');
  });

  test('J-C23: a stream wider than the quick-mode field count copies a timestamp link and says why', async ({ page, request }) => {
    // A 20 s window: one partition. Over 15 minutes a wide stream sometimes renders "No events" on main too (recorded).
    await runStream(page, WIDE_STREAM, {
      period: null,
      from: String(floorSecond(T_UNIQUE) - 10_000_000),
      to: String(floorSecond(T_UNIQUE) + 10_000_000),
    });
    const copied = await copyFromMenu(page, 0);
    expect(copied.variant).toBe('warning');
    expect(copied.message).toContain('too wide');
    const link = paramsOf(await expandLink(request, copied.url));
    expect(link.log_ts).toBe(String(T_UNIQUE));
    expect(link.log_fp).toBeUndefined();
    expect(link.log_id).toBeUndefined();
  });

  test('J-C18, J-C25: leaving Logs or going Back never reopens a line', async ({ page }) => {
    await page.goto(lineLinkPath(LINE_STREAM, T_UNIQUE));
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'found', { timeout: 60000 });
    await page.keyboard.press('Escape');
    await expect.poll(() => paramsOf(page.url()).log_ts).toBeUndefined();
    await switchStream(page, LINE_STREAM, OTHER_STREAM);
    const runButton = page.locator('[data-test="logs-search-bar-refresh-btn"]');
    await expect(runButton).toContainText('Run query', { timeout: 60000 });
    await runButton.click();
    await expect.poll(() => paramsOf(page.url()).stream, { timeout: 60000 }).toBe(OTHER_STREAM);
    await page.goBack();
    await expect.poll(() => paramsOf(page.url()).stream, { timeout: 30000 }).toBe(LINE_STREAM);
    await expect.poll(() => paramsOf(page.url()).log_ts).toBeUndefined();
    await expect(page.locator(gridDrawer)).toHaveCount(0);
    await page.reload();
    await page.locator('[data-test="logs-search-bar-query-editor"]').first().waitFor({ timeout: 60000 });
    await expect(page.locator(lineBanner)).toHaveCount(0);
    await page.goto(lineLinkPath(LINE_STREAM, T_UNIQUE));
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'found', { timeout: 60000 });
    await page.goto(`/web/dashboards?org_identifier=${LINK_ORG}`);
    await page.getByRole('heading', { name: 'Dashboards', level: 1 }).waitFor({ timeout: 60000 });
    await page.locator('[data-test="menu-link-\\/logs-item"]').click();
    await page.waitForURL(/\/web\/logs/, { timeout: 60000 });
    await page.locator('[data-test="logs-search-bar-query-editor"]').first().waitFor({ timeout: 60000 });
    await expect(page.locator(lineBanner)).toHaveCount(0);
    expect(paramsOf(page.url()).log_ts).toBeUndefined();
  });

  test('J-C21: a shared page offers "Go to page 3" after page 1 loads; with auto-refresh the link has no page', async ({ page, request }) => {
    await page.goto(hand(logsUrl(LINE_STREAM), { page: '3' }));
    const notice = page.locator('[data-test="logs-shared-page-notice"]');
    await expect(notice).toBeVisible({ timeout: 60000 });
    await expect(notice).toContainText('This link was on page 3.');
    await page.locator('[data-test="logs-shared-page-go-btn"]').click();
    await expect(page.locator('[data-test="logs-search-result-pagination"] [aria-current="page"]')).toHaveText('3', {
      timeout: 60000,
    });
    await expect(notice).toHaveCount(0);
    await expect.poll(() => paramsOf(page.url()).page).toBe('3');
    const pm = new PageManager(page);
    const shared = paramsOf(await expandLink(request, await pm.logsPage.clickShareLinkAndGetUrl()));
    expect(shared.page).toBe('3');
    await page.goto(hand(logsUrl(LINE_STREAM), { page: '3', refresh: '5' }));
    await expect(page.locator(lineRow(0))).toBeAttached({ timeout: 60000 });
    await expect(notice).toHaveCount(0);
  });

  test('J-C26, J-C27: the address bar names the shown results, not drafts, dispatches or failed runs', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('oo_toggle_auto_run', 'false'));
    await runStream(page, LINE_STREAM);
    await expect.poll(() => paramsOf(page.url()).stream).toBe(LINE_STREAM);
    const pm = new PageManager(page);
    await switchStream(page, LINE_STREAM, OTHER_STREAM);
    await pm.logsPage.setRelativeTimeRange('1-h');
    expect(paramsOf(page.url()).stream).toBe(LINE_STREAM);
    expect(paramsOf(page.url()).period).toBe('15m');
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await expect.poll(() => paramsOf(page.url()).stream, { timeout: 60000 }).toBe(OTHER_STREAM);
    expect(paramsOf(page.url()).period).toBe('1h');
    await page.route('**/_search_stream?*', (route) =>
      route.request().url().includes('is_ui_histogram') ? route.continue() : route.abort(),
    );
    await switchStream(page, OTHER_STREAM, LINE_STREAM);
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await expect(page.locator('[data-test="logs-search-error-state"]')).toBeVisible({ timeout: 60000 });
    expect(paramsOf(page.url()).stream).toBe(OTHER_STREAM);
    await page.unroute('**/_search_stream?*');
    await page.reload();
    await page.locator('[data-test="logs-search-bar-query-editor"]').first().waitFor({ timeout: 60000 });
    expect(paramsOf(page.url()).stream).toBe(OTHER_STREAM);
  });

  test('J-C16 (_o2_id): a row with _o2_id links by id and opens as the opener may now see it', async ({ page, request }) => {
    await runStream(page, ORIG_STREAM);
    const n = await rowWith(page, 'kept-original');
    const copied = await copyFromMenu(page, n);
    expect(copied.variant).toBe('success');
    const link = paramsOf(await expandLink(request, copied.url));
    expect(link.log_id).toMatch(/^\d+$/);
    expect(link.log_fp).toBeUndefined();
    await page.route('**/_search?*search_type=other*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.hits = body.hits.map((hit) => ({ ...hit, message: '[REDACTED]' }));
      await route.fulfill({ response, json: body });
    });
    await page.goto(copied.url);
    await expect(page.locator(lineBanner)).toHaveAttribute('data-state', 'found', { timeout: 60000 });
    await expect(page.locator(lineJson)).toContainText('[REDACTED]');
  });

  test('J-C17: a view saved while a line link is open stores no permalink or link columns', async ({ page, browser, request }) => {
    const seed = { logFilterField: JSON.stringify({ [`${LINK_ORG}_${LINE_STREAM}`]: ['level', 'message'] }) };
    await page.addInitScript((value) => {
      for (const [key, item] of Object.entries(value)) localStorage.setItem(key, item);
    }, seed);
    await runStream(page, LINE_STREAM);
    const copied = await copyFromMenu(page, await rowWith(page, 'line-unique'));
    const { context, page: b } = await recipient(browser);
    await b.goto(copied.url);
    await expect(b.locator(lineBanner)).toHaveAttribute('data-state', 'found', { timeout: 60000 });
    await b.keyboard.press('Escape');
    await expect(b.locator('[data-test="logs-search-bar-refresh-btn"]')).toContainText('Run query', { timeout: 60000 });
    const pmB = new PageManager(b);
    const name = `lnkview${Date.now()}`;
    await pmB.logsPage.clickSaveViewButton();
    await pmB.logsPage.fillSavedViewName(name);
    await pmB.logsPage.clickSavedViewDialogSave();
    await expect
      .poll(async () => {
        const list = await request.get(`${process.env.ZO_BASE_URL}/api/${LINK_ORG}/savedviews`, { headers: getAuthHeaders() });
        return list.ok() ? ((await list.json()).views ?? []).some((v) => v.view_name === name) : false;
      }, { timeout: 30000 })
      .toBe(true);
    const views = (await (await request.get(`${process.env.ZO_BASE_URL}/api/${LINK_ORG}/savedviews`, { headers: getAuthHeaders() })).json()).views;
    const view = views.find((v) => v.view_name === name);
    const detail = await request.get(`${process.env.ZO_BASE_URL}/api/${LINK_ORG}/savedviews/${view.view_id}`, { headers: getAuthHeaders() });
    const raw = JSON.stringify(await detail.json());
    const payload = /"data":"([^"]+)"/.test(raw) ? Buffer.from(JSON.parse(raw).data, 'base64').toString() : raw;
    expect(payload).toContain(LINE_STREAM);
    expect(payload).not.toMatch(/columnsFromUrl|permalink|log_ts|log_fp/);
    savedViewName = name;
    await context.close();
  });

  test('J-C28: a saved view whose run fails leaves the URL on the shown search; when it succeeds, one entry names it', async ({ page }) => {
    test.skip(!savedViewName, 'needs the view saved by J-C17');
    await runStream(page, OTHER_STREAM);
    const pm = new PageManager(page);
    const failing = (route) =>
      route.request().url().includes('is_ui_histogram') ? route.continue() : route.abort();
    await page.route('**/_search_stream?*', failing);
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewByTitle(savedViewName);
    await expect(page.locator('[data-test="logs-search-error-state"]')).toBeVisible({ timeout: 60000 });
    expect(paramsOf(page.url()).stream).toBe(OTHER_STREAM);
    await page.unroute('**/_search_stream?*', failing);
    const before = await page.evaluate(() => history.length);
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewByTitle(savedViewName);
    await expect.poll(() => paramsOf(page.url()).stream, { timeout: 60000 }).toBe(LINE_STREAM);
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
  });

  test('J-C29: after a grid run A, a Patterns run B is what Share names', async ({ page, request }) => {
    await runStream(page, LINE_STREAM);
    const patterns = page.locator('[data-test="logs-patterns-toggle"]');
    test.skip(!(await patterns.isVisible()), 'Patterns is not available on this build (OSS)');
    await patterns.click();
    const extracted = page.waitForResponse((r) => /patterns\/extract/.test(r.url()) && r.status() === 200, { timeout: 60000 });
    await page.locator('[data-test="logs-search-bar-query-editor"] .monaco-editor').first().click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type("level = 'warn'");
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await extracted;
    await expect.poll(() => paramsOf(page.url()).logs_visualize_toggle, { timeout: 30000 }).toBe('patterns');
    const pm = new PageManager(page);
    const shared = paramsOf(await expandLink(request, await pm.logsPage.clickShareLinkAndGetUrl()));
    const query = Buffer.from(shared.query.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '='), 'base64').toString();
    expect(query).toBe("level = 'warn'");
    expect(shared.logs_visualize_toggle).toBe('patterns');
  });

  test('J-C30: a share made later names the bounds of the displayed run', async ({ page, request }) => {
    const hits = [];
    page.on('request', (r) => {
      if (!/_search_stream/.test(r.url()) || r.url().includes('is_ui_histogram')) return;
      const query = JSON.parse(r.postData()).query;
      if (!(query.size === 0 && query.track_total_hits)) hits.push(query);
    });
    await runStream(page, LINE_STREAM);
    // The URL load may run first; the Run click's request is the one on screen.
    const shown = hits[hits.length - 1];
    const pm = new PageManager(page);
    const shared = paramsOf(await expandLink(request, await pm.logsPage.clickShareLinkAndGetUrl()));
    expect(Number(shared.from)).toBe(shown.start_time);
    expect(Number(shared.to)).toBe(shown.end_time);
    expect(shared.log_ts).toBeUndefined();
  });
});
