// RUM items of the o2-enterprise#3129 retest list; every screen here is OSS, so the spec runs on both builds.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTraces } = require('../../utils/trace-ingestion.js');
const {
  ensureRumStateOrg,
  seedBuilt,
  SessionBuilder,
  runAppId,
} = require('../../utils/rum-analytics-ingestion.js');

const tags = (priority) => ['@bug-3129', priority, '@regression', '@rumRegression'];
const MINUTE_MS = 60 * 1000;
const CHECKOUT = 'https://shop.example.com/checkout';
const CART = 'https://shop.example.com/cart';
// A non-default org, because a link that drops its org still works in the default one.
const STATE_ORG = 'rum_3129_sessions';

test.describe('RUM Error Tracking: the Distributed Trace card (o2-enterprise#3129 B2)', () => {
  test.describe.configure({ mode: 'parallel' });

  let fixture = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const traces = await ingestTraces(page, 1);
      expect(traces.successful, 'Precondition: the backend trace must ingest').toBe(1);
      const appId = runAppId('e2e-3129-trace');
      const session = new SessionBuilder(appId, `${appId}-s1`, Date.now() - MINUTE_MS).view(CHECKOUT).error('TypeError: e2e trace card');
      const errorRow = session.rows.find((row) => row.type === 'error');
      errorRow.error_id = `${appId}-err`;
      errorRow._o2_trace_id = traces.traceIds[0];
      await seedBuilt(page, { rows: session.rows, facts: { appId } });
      fixture = { errorId: errorRow.error_id, timestampUs: errorRow._timestamp, traceId: traces.traceIds[0] };
      testLogger.info('Seeded an error correlated to a backend trace', fixture);
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test('the card finds the backend spans of the error\'s trace and enables View Trace Details', {
    tag: tags('@P2'),
  }, async ({ page }) => {
    const rum = new PageManager(page).rumPage;
    const traceSearches = rum.watchTraceSearches();

    await rum.gotoErrorViewer(fixture.errorId, fixture.timestampUs);
    await rum.expectBackendTraceFound();

    expect(traceSearches.length, 'the card must have searched the traces stream').toBeGreaterThan(0);
    expect(traceSearches.filter((status) => status >= 400), 'the server must accept the card\'s trace search').toEqual([]);
  });
});

test.describe('RUM Sessions list in a non-default org (o2-enterprise#3129 B3, B5, B6)', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ timezoneId: 'UTC' });

  let org = null;
  let appId = null;
  let sessionIds = [];

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      ({ identifier: org } = await ensureRumStateOrg(page, STATE_ORG));
      appId = runAppId('e2e-3129');
      const now = Date.now();
      const rows = [];
      sessionIds = [0, 1].map((i) => {
        const session = new SessionBuilder(appId, `${appId}-s${i}`, now - (20 - i * 5) * MINUTE_MS, { user: `u${i}@e2e.test` });
        session.view(CHECKOUT).click('pay-btn', CHECKOUT).view(CART).click('remove-btn', CART);
        rows.push(...session.rows);
        return session.sessionId;
      });
      // SDK telemetry is session-independent, so its rows reach _rumdata with no session_id.
      for (let i = 0; i < 2; i += 1) {
        const at = now - (10 - i) * MINUTE_MS;
        rows.push({
          _timestamp: at * 1000,
          date: at,
          type: 'telemetry',
          application_id: appId,
          service: 'pa-e2e',
          source: 'browser',
          telemetry_type: 'log',
          telemetry_status: 'debug',
          telemetry_message: 'e2e telemetry',
        });
      }
      await seedBuilt(page, { rows, facts: { appId } }, { nowMs: now, orgId: org });
      testLogger.info('Seeded sessions without replay plus session-less telemetry', { org, appId, sessionIds });
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  const openList = async (page) => {
    const sessions = new PageManager(page).rumSessionsPage;
    await sessions.gotoSessionsList({ org, filter: `application_id='${appId}'`, period: '1h' });
    await sessions.expectSessionsTableVisible(30000);
    return sessions;
  };

  test('a Session Viewer opened from the list keeps its org, so a reload reopens the same session', {
    tag: tags('@P2'),
  }, async ({ page }) => {
    const sessions = await openList(page);
    await sessions.waitForSessionRowsPresent();
    await sessions.openFirstSession();
    const sessionId = `(${sessionIds.join('|')})`;
    await sessions.expectSessionViewerUrlKeepsOrg(sessionId, org);

    await sessions.reloadSessionViewer();
    await sessions.expectSessionViewerUrlKeepsOrg(sessionId, org);
    await sessions.expectEventsOnlyState();
  });

  test('the Activity column loads for a session that has no replay', {
    tag: tags('@P3'),
  }, async ({ page }) => {
    const sessions = await openList(page);
    await sessions.waitForSessionRowsPresent();
    for (const sessionId of sessionIds) await sessions.expectActivityLoadedFor(sessionId);
  });

  test('SDK telemetry rows without a session id are not listed as a session', {
    tag: tags('@P3'),
  }, async ({ page }) => {
    const sessions = await openList(page);
    await sessions.expectSessionRowCount(sessionIds.length);
    await sessions.expectEverySessionRowHasAnId();
  });
});
