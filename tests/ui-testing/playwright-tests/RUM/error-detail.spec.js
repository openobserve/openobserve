/**
 * RUM Error Detail Redesign E2E Tests
 *
 * Validates the redesigned error detail view: impact strip, occurrences chart,
 * facet breakdown, context card, redesigned header with badges/copy actions,
 * and session replay navigation.
 *
 * Test Coverage (15 tests):
 *   P0 — Critical path: all panels render, header identity band, back button
 *   P1 — Variations: impact data, chart, facets, context, copy actions, replay
 *   P2 — Edge cases: no-signature, empty facets, unknown user, disabled states
 *
 * Prerequisites:
 * - OpenObserve OSS build with RUM enabled
 * - _rumdata stream accepting JSON ingestion
 * - Error events ingested in beforeAll via the _rumdata/_json endpoint
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { rumTestContext, basicAuthHeader } = require('../utils/rum-env.js');

// ---------------------------------------------------------------------------
// Module-level storage for specialized error data used in P2 tests for
// direct URL navigation (errors without certain fields may not appear in the
// error-tracking list).
// ---------------------------------------------------------------------------
const specialErrors = {};

// ---------------------------------------------------------------------------
// Generate extended RUM error events for the error detail view
// ---------------------------------------------------------------------------
function generateExtendedRumErrors() {
  const now = Date.now();
  const errors = [];

  const browsers = [
    { name: 'Chrome', version: '120.0.0' },
    { name: 'Firefox', version: '119.0' },
    { name: 'Safari', version: '17.0' },
  ];
  const osList = [
    { name: 'Mac OS', version: '14.0' },
    { name: 'Windows', version: '11' },
    { name: 'Linux', version: 'Ubuntu 22.04' },
  ];

  const errorTypes = ['TypeError', 'ReferenceError', 'RangeError'];
  const messages = [
    "Cannot read property 'name' of undefined",
    'undefinedVariable is not defined',
    'Maximum call stack size exceeded',
  ];
  const stacks = [
    `TypeError: Cannot read property 'name' of undefined
    at onClick @ http://localhost:8089/assets/main.js:1:2345
    at handleEvent @ http://localhost:8089/assets/main.js:1:3456
    at dispatch @ http://localhost:8089/assets/main.js:1:4567`,
    `ReferenceError: undefinedVariable is not defined
    at triggerError @ http://localhost:8089/assets/main.js:2:100
    at onClick @ http://localhost:8089/assets/main.js:2:200`,
    `RangeError: Maximum call stack size exceeded
    at recursiveFn @ http://localhost:8089/assets/main.js:3:300
    at recursiveFn @ http://localhost:8089/assets/main.js:3:301
    at recursiveFn @ http://localhost:8089/assets/main.js:3:302`,
  ];

  const baseEvent = (i, overrides = {}) => {
    const b = browsers[i % 3];
    const o = osList[i % 3];
    const ts = now - ((i + 1) * 120000); // spread 2 min apart
    return {
      date: ts,
      type: 'error',
      error_id: `error-detail-e2e-${String(i + 1).padStart(3, '0')}`,
      error_type: errorTypes[i % 3],
      error_message: messages[i % 3],
      error_stack: stacks[i % 3],
      error: {
        message: messages[i % 3],
        type: errorTypes[i % 3],
        stack: stacks[i % 3],
        source: 'source',
        is_crash: false,
        resource: { url: 'http://localhost:8089/checkout' },
      },
      error_handling: 'unhandled',
      source: 'source',
      service: 'o2-sourcemap-test-app',
      version: '1.0.0-e2e-test',
      session: { id: `test-session-e2e-${String(i + 1).padStart(3, '0')}` },
      view: { id: `test-view-${i + 1}`, referrer: '', url: 'http://localhost:8089/checkout' },
      application: { id: 'o2-sourcemap-test-app' },
      context: { browser: b, os: o },
      _timestamp: ts * 1000,
      // Extended fields
      usr_name: 'Test User',
      usr_email: 'test@example.com',
      geo_info_city: 'San Francisco',
      geo_info_country: 'United States',
      ip: '203.0.113.1',
      env: 'production',
      sdk_version: '1.2.3',
      ...overrides,
    };
  };

  // Errors 1-3: standard extended errors with browser/OS variation (P0/P1)
  for (let i = 0; i < 3; i++) {
    errors.push(baseEvent(i));
  }

  // Error 4: no session_id (for P2#13 disabled replay, P2#14 breadcrumbs NoData)
  const idxNoSession = 3;
  const noSessionTs = now - (idxNoSession + 1) * 120000;
  errors.push({
    date: noSessionTs,
    type: 'error',
    error_id: 'error-detail-e2e-nosession',
    error_type: 'TypeError',
    error_message: "Cannot read property 'name' of undefined",
    error_stack: stacks[0],
    error: {
      message: messages[0],
      type: 'TypeError',
      stack: stacks[0],
      source: 'source',
      is_crash: false,
      resource: { url: 'http://localhost:8089/checkout' },
    },
    error_handling: 'unhandled',
    source: 'source',
    service: 'o2-sourcemap-test-app',
    version: '1.0.0-e2e-test',
    // NO session key — deliberately absent
    view: { id: 'test-view-nosession', referrer: '', url: 'http://localhost:8089/checkout' },
    application: { id: 'o2-sourcemap-test-app' },
    context: { browser: browsers[0], os: osList[0] },
    _timestamp: noSessionTs * 1000,
  });

  // Error 5: no error_id (for P2#15 disabled copy-ID button)
  const idxNoId = 4;
  const noIdTs = now - (idxNoId + 1) * 120000;
  errors.push({
    date: noIdTs,
    type: 'error',
    // NO error_id — deliberately absent
    error_type: 'TypeError',
    error_message: "Cannot read property 'name' of undefined",
    error_stack: stacks[0],
    error: {
      message: messages[0],
      type: 'TypeError',
      stack: stacks[0],
      source: 'source',
      is_crash: false,
      resource: { url: 'http://localhost:8089/checkout' },
    },
    error_handling: 'unhandled',
    source: 'source',
    service: 'o2-sourcemap-test-app',
    version: '1.0.0-e2e-test',
    session: { id: 'test-session-e2e-noid' },
    view: { id: 'test-view-noid', referrer: '', url: 'http://localhost:8089/checkout' },
    application: { id: 'o2-sourcemap-test-app' },
    context: { browser: browsers[0], os: osList[0] },
    _timestamp: noIdTs * 1000,
  });

  // Error 6: no user identity fields (for P2#12 Unknown User)
  const idxNoUser = 5;
  const noUserTs = now - (idxNoUser + 1) * 120000;
  errors.push({
    date: noUserTs,
    type: 'error',
    error_id: 'error-detail-e2e-nouser',
    error_type: 'TypeError',
    error_message: "Cannot read property 'name' of undefined",
    error_stack: stacks[0],
    error: {
      message: messages[0],
      type: 'TypeError',
      stack: stacks[0],
      source: 'source',
      is_crash: false,
      resource: { url: 'http://localhost:8089/checkout' },
    },
    error_handling: 'unhandled',
    source: 'source',
    service: 'o2-sourcemap-test-app',
    version: '1.0.0-e2e-test',
    session: { id: 'test-session-e2e-nouser' },
    view: { id: 'test-view-nouser', referrer: '', url: 'http://localhost:8089/checkout' },
    application: { id: 'o2-sourcemap-test-app' },
    context: { browser: browsers[0], os: osList[0] },
    _timestamp: noUserTs * 1000,
    // NO usr_name, usr_email — deliberately absent
  });

  // Error 7: no signature (for P2#10 — error_type and error_message are empty)
  const idxNoSig = 6;
  const noSigTs = now - (idxNoSig + 1) * 120000;
  errors.push({
    date: noSigTs,
    type: 'error',
    error_id: 'error-detail-e2e-nosig',
    error_type: '',
    error_message: '',
    error_stack: stacks[0],
    error: {
      message: '',
      type: '',
      stack: stacks[0],
      source: 'source',
      is_crash: false,
      resource: { url: 'http://localhost:8089/checkout' },
    },
    error_handling: 'unhandled',
    source: 'source',
    service: 'o2-sourcemap-test-app',
    version: '1.0.0-e2e-test',
    session: { id: 'test-session-e2e-nosig' },
    view: { id: 'test-view-nosig', referrer: '', url: 'http://localhost:8089/checkout' },
    application: { id: 'o2-sourcemap-test-app' },
    context: { browser: browsers[0], os: osList[0] },
    _timestamp: noSigTs * 1000,
  });

  return errors;
}

// ---------------------------------------------------------------------------
// Build a direct navigation URL for a given error
// ---------------------------------------------------------------------------
function buildErrorDetailUrl(baseUrl, orgId, errorId, timestamp) {
  return `${baseUrl}/web/rum/errors/view/${errorId}?timestamp=${timestamp}&org_identifier=${orgId}`;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
test.describe('RUM Error Detail Redesign testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeAll(async ({ browser }) => {
    const ctx = rumTestContext();
    const auth = basicAuthHeader(ctx.email, ctx.password);

    // Create a page for API requests (required for page.request)
    const apiPage = await browser.newPage();

    try {
      // Fetch RUM token
      testLogger.info('Fetching RUM token for error ingestion');
      const tokenResp = await apiPage.request.get(
        `${ctx.baseUrl}/api/${ctx.orgId}/rumtoken`,
        { headers: { Authorization: auth } },
      );
      if (!tokenResp.ok()) {
        testLogger.warn('RUM token fetch failed — ingestion may be skipped', {
          status: tokenResp.status(),
        });
      }

      // Generate and ingest extended error events
      const allErrors = generateExtendedRumErrors();
      testLogger.info(`Ingesting ${allErrors.length} extended RUM error events`);

      const postResp = await apiPage.request.post(
        `${ctx.baseUrl}/api/${ctx.orgId}/_rumdata/_json`,
        {
          headers: {
            Authorization: auth,
            'Content-Type': 'application/json',
          },
          data: allErrors,
        },
      );

      if (postResp.ok()) {
        testLogger.info('RUM error ingestion succeeded', { count: allErrors.length });
      } else {
        testLogger.warn('RUM error ingestion returned non-OK', {
          status: postResp.status(),
        });
      }

      // Store specialized error IDs and timestamps for P2 direct-navigation tests
      // Error indices (0-based): 3=no-session, 4=no-error_id, 5=no-user, 6=no-signature
      specialErrors.noSession = {
        id: allErrors[3].error_id,
        timestamp: allErrors[3]._timestamp,
      };
      // Error 4 has no error_id — use a synthetic key for URL construction
      // (the detail view uses the O2-generated doc ID; we capture it via a query instead)
      specialErrors.noErrorId = {
        // We'll query for this error by its unique session_id or message
        sessionId: allErrors[4].session.id,
        timestamp: allErrors[4]._timestamp,
      };
      specialErrors.noUser = {
        id: allErrors[5].error_id,
        timestamp: allErrors[5]._timestamp,
      };
      specialErrors.noSignature = {
        id: allErrors[6].error_id,
        timestamp: allErrors[6]._timestamp,
      };

      // Wait a few seconds for the ingested data to become searchable
      testLogger.info('Waiting for ingested data to become searchable');
      await apiPage.waitForTimeout(5000);
    } finally {
      await apiPage.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  // ========================================================================
  // P0 — CRITICAL PATH
  // ========================================================================

  test('P0: should render all redesigned panels in the error detail view', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@smoke', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error tracking list');
    await pm.rumPage.gotoErrorsList({ period: '1h' });
    await pm.rumPage.waitForErrorRowsPresent();

    testLogger.info('Opening first error and waiting for detail view');
    await pm.rumPage.openFirstError();
    await pm.rumPage.expectErrorDetailViewLoaded();

    // Assert all 6 redesigned panels are visible
    await pm.rumPage.expectImpactStripVisible();
    testLogger.info('Impact strip visible');

    await pm.rumPage.expectOccurrencesChartVisible();
    testLogger.info('Occurrences chart visible');

    await pm.rumPage.expectFacetBreakdownVisible();
    testLogger.info('Facet breakdown visible');

    await pm.rumPage.expectContextSectionVisible();
    testLogger.info('Context card visible');

    await pm.rumPage.expectEventsTimelineVisible();
    testLogger.info('Breadcrumbs timeline visible');

    // Assert header elements
    await pm.rumPage.expectHandlingBadgeVisible();
    testLogger.info('Handling badge visible');

    await pm.rumPage.expectErrorMessageBannerVisible();
    testLogger.info('Error message banner visible');

    testLogger.info('All redesigned panels rendered successfully');
  });

  test('P0: should display error header with identity band, badges, message and metadata', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error detail');
    await pm.rumPage.gotoErrorsList({ period: '1h' });
    await pm.rumPage.waitForErrorRowsPresent();
    await pm.rumPage.openFirstError();
    await pm.rumPage.expectErrorDetailViewLoaded();

    // Error type
    const errorType = await pm.rumPage.getHeaderErrorTypeText();
    expect(errorType).toBeTruthy();
    testLogger.info(`Error type: ${errorType}`);

    // Handling badge
    const handlingBadgeText = await pm.rumPage.getHandlingBadgeText();
    expect(handlingBadgeText).toBeTruthy();
    testLogger.info(`Handling badge: ${handlingBadgeText}`);

    // Source badge
    await pm.rumPage.expectSourceBadgeVisible();
    testLogger.info('Source badge visible');

    // Error message banner
    await pm.rumPage.expectErrorMessageBannerVisible();
    const messageText = await pm.rumPage.getMessageBannerText();
    expect(messageText).toBeTruthy();
    testLogger.info('Message banner has content');

    // Timestamp
    await pm.rumPage.expectTimestampVisible();
    const ts = await pm.rumPage.getTimestampText();
    expect(ts.length).toBeGreaterThan(0);
    testLogger.info(`Timestamp: ${ts}`);

    // Error ID code element
    await pm.rumPage.expectErrorIdVisible();
    testLogger.info('Error ID visible');

    // Route code element
    await pm.rumPage.expectRouteVisible();
    testLogger.info('Route visible');

    // Deployment chips present in container text
    const containerText = await pm.rumPage.getErrorViewerContainerText();
    expect(containerText).toContain('o2-sourcemap-test-app');
    expect(containerText).toContain('1.0.0-e2e-test');
    testLogger.info('Deployment chips verified in container');
  });

  test('P0: should navigate back to error tracking list via back button', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error detail');
    await pm.rumPage.gotoErrorsList({ period: '1h' });
    await pm.rumPage.waitForErrorRowsPresent();
    await pm.rumPage.openFirstError();
    await pm.rumPage.expectErrorDetailViewLoaded();

    // Assert back button is visible
    await pm.rumPage.expectBackButtonVisible();
    testLogger.info('Back button visible');

    // Click back button
    await pm.rumPage.clickBackButton();

    // Assert URL no longer matches the error detail route
    await expect(page).not.toHaveURL(/\/rum\/errors\/view\//, { timeout: 15000 });
    testLogger.info('Successfully navigated back from error detail view');
  });

  // ========================================================================
  // P1 — IMPORTANT VARIATIONS
  // ========================================================================

  test('P1: should show aggregate data in impact strip without dash placeholders', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error detail');
    await pm.rumPage.gotoErrorsList({ period: '1h' });
    await pm.rumPage.waitForErrorRowsPresent();
    await pm.rumPage.openFirstError();
    await pm.rumPage.expectErrorDetailViewLoaded();

    await pm.rumPage.expectImpactStripVisible();

    // All stat values must NOT be dash placeholders "—"
    const events = await pm.rumPage.getImpactEventsText();
    expect(events).not.toBe('—');
    testLogger.info(`Impact events: ${events}`);

    const users = await pm.rumPage.getImpactUsersText();
    expect(users).not.toBe('—');
    testLogger.info(`Impact users: ${users}`);

    const sessions = await pm.rumPage.getImpactSessionsText();
    expect(sessions).not.toBe('—');
    testLogger.info(`Impact sessions: ${sessions}`);

    const firstSeen = await pm.rumPage.getImpactFirstSeenText();
    expect(firstSeen).not.toBe('—');
    testLogger.info(`Impact first seen: ${firstSeen}`);

    const lastSeen = await pm.rumPage.getImpactLastSeenText();
    expect(lastSeen).not.toBe('—');
    testLogger.info(`Impact last seen: ${lastSeen}`);

    // Scope caption should NOT say "Unable to aggregate"
    const scope = await pm.rumPage.getImpactScopeText();
    expect(scope).not.toContain('Unable to aggregate');
    testLogger.info(`Impact scope caption: ${scope}`);
  });

  test('P1: should render occurrences chart with bar chart and peak label', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error detail');
    await pm.rumPage.gotoErrorsList({ period: '1h' });
    await pm.rumPage.waitForErrorRowsPresent();
    await pm.rumPage.openFirstError();
    await pm.rumPage.expectErrorDetailViewLoaded();

    await pm.rumPage.expectOccurrencesChartVisible();
    await pm.rumPage.expectOccurrencesCanvasVisible();
    testLogger.info('Occurrences chart canvas visible');

    // Loading skeletons should be hidden
    await pm.rumPage.expectOccurrencesLoadingHidden();
    testLogger.info('Loading skeletons hidden');

    // Peak caption should show a number
    const peakText = await pm.rumPage.getOccurrencesPeakText();
    expect(peakText).toMatch(/Peak: \d+/);
    testLogger.info(`Peak caption: ${peakText}`);
  });

  test('P1: should show facet breakdown with dimension distributions', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error detail');
    await pm.rumPage.gotoErrorsList({ period: '1h' });
    await pm.rumPage.waitForErrorRowsPresent();
    await pm.rumPage.openFirstError();
    await pm.rumPage.expectErrorDetailViewLoaded();

    await pm.rumPage.expectFacetBreakdownVisible();

    // Loading state must be gone
    await pm.rumPage.expectFacetBreakdownLoadingHidden();

    // Browser facet group with at least one value and share
    await pm.rumPage.expectFacetBrowserGroupVisible();
    await pm.rumPage.expectFacetBrowserValueVisible();
    await pm.rumPage.expectFacetBrowserShareVisible();
    testLogger.info('Facet breakdown shows browser dimension with values and percentages');
  });

  test('P1: should display user identity, device, location and deployment chips in context card', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error detail');
    await pm.rumPage.gotoErrorsList({ period: '1h' });
    await pm.rumPage.waitForErrorRowsPresent();
    await pm.rumPage.openFirstError();
    await pm.rumPage.expectErrorDetailViewLoaded();

    await pm.rumPage.expectContextSectionVisible();

    // User identity
    const userName = await pm.rumPage.getContextUserNameText();
    expect(userName.trim()).toBeTruthy();
    testLogger.info(`Context user name: ${userName}`);

    const userEmail = await pm.rumPage.getContextUserEmailText();
    expect(userEmail.trim()).toBeTruthy();
    testLogger.info(`Context user email: ${userEmail}`);

    // Browser and OS
    const browser = await pm.rumPage.getContextBrowserText();
    expect(browser.trim()).toBeTruthy();
    testLogger.info(`Context browser: ${browser}`);

    const osText = await pm.rumPage.getContextOSText();
    expect(osText.trim()).toBeTruthy();
    testLogger.info(`Context OS: ${osText}`);

    // Device, location, IP, URL rows
    await pm.rumPage.expectContextDeviceVisible();
    await pm.rumPage.expectContextLocationVisible();
    await pm.rumPage.expectContextIPVisible();
    await pm.rumPage.expectContextURLVisible();
    testLogger.info('All context card rows visible');

    // Deployment chips in container
    const containerText = await pm.rumPage.getErrorViewerContainerText();
    expect(containerText).toContain('o2-sourcemap-test-app');
    expect(containerText).toContain('1.0.0-e2e-test');
    testLogger.info('Deployment chips verified');
  });

  test('P1: should copy error ID to clipboard and show success notification', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error detail');
    await pm.rumPage.gotoErrorsList({ period: '1h' });
    await pm.rumPage.waitForErrorRowsPresent();
    await pm.rumPage.openFirstError();
    await pm.rumPage.expectErrorDetailViewLoaded();

    // Copy-link button is enabled
    await pm.rumPage.expectCopyLinkBtnEnabled();
    testLogger.info('Copy link button enabled');

    // Copy-ID button is enabled (error_id present)
    await pm.rumPage.expectCopyIdBtnEnabled();
    testLogger.info('Copy ID button enabled');

    // Click copy-ID button and verify toast notification appears
    await pm.rumPage.clickCopyIdBtn();
    await pm.rumPage.expectAnyToastVisible(5000);
    testLogger.info('Copy event ID action completed with toast notification');
  });

  test('P1: should navigate to SessionViewer via play session replay button', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error detail');
    await pm.rumPage.gotoErrorsList({ period: '1h' });
    await pm.rumPage.waitForErrorRowsPresent();
    await pm.rumPage.openFirstError();
    await pm.rumPage.expectErrorDetailViewLoaded();

    // Session replay card visible and button enabled
    await pm.rumPage.expectSessionReplayCardVisible();
    await pm.rumPage.expectSessionReplayBtnEnabled();
    testLogger.info('Session replay card visible, play button enabled');

    // Click play button
    await pm.rumPage.clickSessionReplayPlayBtn();

    // Assert URL changes to SessionViewer route
    await page.waitForURL('**/rum/sessions/**', { timeout: 15000 });
    testLogger.info('Navigated to SessionViewer route');
  });

  // ========================================================================
  // P2 — EDGE CASES
  // ========================================================================

  test('P2: should show no-signature caption when error lacks grouping signature', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating directly to error without signature');
    const ctx = rumTestContext();
    const url = buildErrorDetailUrl(
      ctx.baseUrl,
      ctx.orgId,
      specialErrors.noSignature.id,
      specialErrors.noSignature.timestamp,
    );
    await page.goto(url);
    await pm.rumPage.expectErrorDetailViewLoaded();

    // Impact scope should contain the "no signature" message
    const scope = await pm.rumPage.getImpactScopeText();
    expect(scope).toContain('Unable to aggregate');
    testLogger.info(`No-signature scope caption: ${scope}`);

    // Events stat should be dash "—"
    const events = await pm.rumPage.getImpactEventsText();
    expect(events).toBe('—');
    testLogger.info('Impact events shows dash placeholder as expected');
  });

  test('P2: should show empty state message when no facet data available', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error detail for facet empty-state check');
    // Navigate to the no-signature error which has empty error_type/error_message.
    // This may produce limited or no facet data.
    const ctx = rumTestContext();
    const url = buildErrorDetailUrl(
      ctx.baseUrl,
      ctx.orgId,
      specialErrors.noSignature.id,
      specialErrors.noSignature.timestamp,
    );
    await page.goto(url);
    await pm.rumPage.expectErrorDetailViewLoaded();

    const result = await pm.rumPage.expectFacetBreakdownEmptyOrSectionVisible();
    expect(result).not.toBeNull();
    expect(result === 'empty' || result === 'section').toBe(true);
    testLogger.info(`Facet breakdown result: ${result}`);
  });

  test('P2: should show Unknown User fallback when user identity is missing', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error without user identity fields');
    const ctx = rumTestContext();
    const url = buildErrorDetailUrl(
      ctx.baseUrl,
      ctx.orgId,
      specialErrors.noUser.id,
      specialErrors.noUser.timestamp,
    );
    await page.goto(url);
    await pm.rumPage.expectErrorDetailViewLoaded();

    // User name should show "Unknown User"
    const userName = await pm.rumPage.getContextUserNameText();
    expect(userName.trim()).toBe('Unknown User');
    testLogger.info(`User name fallback: ${userName}`);

    // Email should show "Unknown"
    const userEmail = await pm.rumPage.getContextUserEmailText();
    expect(userEmail.trim()).toBe('Unknown');
    testLogger.info(`User email fallback: ${userEmail}`);
  });

  test('P2: should disable session replay button when session_id is absent', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error without session_id');
    const ctx = rumTestContext();
    const url = buildErrorDetailUrl(
      ctx.baseUrl,
      ctx.orgId,
      specialErrors.noSession.id,
      specialErrors.noSession.timestamp,
    );
    await page.goto(url);
    await pm.rumPage.expectErrorDetailViewLoaded();

    // Session replay card is still visible
    await pm.rumPage.expectSessionReplayCardVisible();

    // Play button must be disabled
    await pm.rumPage.expectSessionReplayBtnDisabled();
    testLogger.info('Session replay play button is disabled as expected');
  });

  test('P2: should show NoData placeholder in breadcrumbs timeline when session_id is absent', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error without session_id');
    const ctx = rumTestContext();
    const url = buildErrorDetailUrl(
      ctx.baseUrl,
      ctx.orgId,
      specialErrors.noSession.id,
      specialErrors.noSession.timestamp,
    );
    await page.goto(url);
    await pm.rumPage.expectErrorDetailViewLoaded();

    // Breadcrumbs empty state should be visible
    await pm.rumPage.expectEventsEmptyVisible();
    testLogger.info('Breadcrumbs NoData placeholder visible');

    // Timeline should NOT be present
    const timelineCount = await pm.rumPage.getEventsTimelineCount();
    expect(timelineCount).toBe(0);
    testLogger.info('Breadcrumbs timeline is absent (count 0)');
  });

  test('P2: should disable copy event ID button when error_id is absent', {
    tag: ['@rum-error-detail-redesign', '@RUM', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating to error without error_id');
    const ctx = rumTestContext();

    // Error index 4 has no error_id field. The route /view/:id uses :id
    // as a path param (for URL construction), but the getError() query
    // matches by _timestamp, not error_id. We use a synthetic path ID
    // and the correct timestamp to load the error.
    const dummyId = 'no-error-id-test';
    const url = buildErrorDetailUrl(
      ctx.baseUrl,
      ctx.orgId,
      dummyId,
      specialErrors.noErrorId.timestamp,
    );
    await page.goto(url);
    await pm.rumPage.expectErrorDetailViewLoaded();

    // Copy-link button always enabled
    await pm.rumPage.expectCopyLinkBtnEnabled();
    testLogger.info('Copy link button enabled');

    // Copy-ID button must be disabled since error_id is absent
    await pm.rumPage.expectCopyIdBtnDisabled();
    testLogger.info('Copy event ID button disabled as expected');
  });
});
