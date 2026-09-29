// rum-11749-session-trace-correlation.spec.js
// RUM Regression — request/trace correlation is discoverable in a session (#11749)
//
// A RUM session records the backend trace id of every request the page made, but
// there was no way to get at it from the session: you had to already know a trace
// id and go to Traces yourself. The fix gives the session player sidebar a
// first-class Traces tab, next to Breadcrumbs and Tags, listing the session's
// correlated traces with a count, flagging the failed ones, and opening a trace's
// waterfall inline without leaving the replay.
//
// Only Vitest covered this (PlayerTracesTab.spec.ts, useCorrelatedTracesStream.spec.ts),
// which is why the issue kept its Needs-Automation label: those specs stub the
// search, so they cannot catch the correlation itself breaking — a schema change to
// the trace-id column, or traces landing in a stream the tab does not probe, passes
// every unit test and leaves the tab empty for real users.
//
// The fixture therefore exercises the real join: RUM resource events carrying
// `_o2_trace_id`, and real spans under those ids in the traces stream.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');
const crypto = require('crypto');

// The tab reads the RUM internal namespace, which is mid-migration from `_oo_` to
// `_o2_`; `_o2_` is the preferred spelling, so the fixture writes that one.
const TRACE_ID_FIELD = '_o2_trace_id';

// These become session and trace ids, so they are generated with crypto rather
// than a pseudo-random source, which CodeQL reads as insecure randomness in that
// position. Same helper the trace generators in utils/service-graph-ingestion.js use.
const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

// One failing request among the three, because "which call broke" is the question
// this tab exists to answer.
function buildFixture() {
  const sessionId = `e2e${hex(6)}`;
  const viewId = hex(8);
  const now = Date.now();
  const requests = [
    { traceId: hex(16), url: 'https://shop.example.com/api/checkout', op: 'POST /api/checkout', failed: false },
    { traceId: hex(16), url: 'https://shop.example.com/api/cart', op: 'GET /api/cart', failed: false },
    { traceId: hex(16), url: 'https://shop.example.com/api/pay', op: 'POST /api/pay', failed: true },
  ];
  return { sessionId, viewId, now, requests };
}

function rumRows({ sessionId, viewId, now, requests }) {
  const base = {
    session_id: sessionId,
    view_id: viewId,
    view_url: 'https://shop.example.com/checkout',
    view_loading_type: 'initial_load',
    service: 'shop-frontend',
    application_id: 'e2e-rum-app',
    source: 'browser',
  };
  const rows = [{ ...base, _timestamp: (now - 60000) * 1000, date: now - 60000, type: 'view', usr_id: 'e2e-user' }];
  requests.forEach((req, index) => {
    const at = now - 60000 + (index + 1) * 500;
    rows.push({
      ...base,
      _timestamp: at * 1000,
      date: at,
      type: 'resource',
      resource_url: req.url,
      resource_type: 'fetch',
      resource_method: req.op.split(' ')[0],
      resource_status_code: req.failed ? 500 : 200,
      resource_duration: 120000000 + index * 50000000,
      [TRACE_ID_FIELD]: req.traceId,
    });
  });
  return rows;
}

function tracePayload({ now, requests }) {
  const attr = (key, value) => ({ key, value: { stringValue: String(value) } });
  const startNs = BigInt(now - 60000) * 1000000n;
  return {
    resourceSpans: requests.map((req) => ({
      resource: { attributes: [attr('service.name', req.failed ? 'payment-api' : 'shop-api')] },
      scopeSpans: [
        {
          scope: { name: 'rum-correlation' },
          spans: [
            {
              traceId: req.traceId,
              spanId: hex(8),
              name: req.op,
              kind: 2,
              startTimeUnixNano: String(startNs),
              endTimeUnixNano: String(startNs + 150000000n),
              attributes: [attr('http.url', req.url)],
              status: req.failed ? { code: 2, message: 'payment declined' } : { code: 1 },
            },
          ],
        },
      ],
    })),
  };
}

test.describe('RUM session trace correlation (#11749)', () => {
  test.describe.configure({ mode: 'serial' });

  let fixture;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      fixture = buildFixture();
      const org = getOrgIdentifier() || 'default';
      const headers = getAuthHeaders();
      const base = (process.env['INGESTION_URL'] || process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');

      const rum = await page.request.post(`${base}/api/${org}/_rumdata/_json`, {
        headers,
        data: rumRows(fixture),
      });
      expect(rum.status(), 'RUM events must ingest').toBe(200);

      const traces = await page.request.post(`${base}/api/${org}/v1/traces`, {
        headers,
        data: tracePayload(fixture),
      });
      expect(traces.status(), 'correlated traces must ingest').toBe(200);

      testLogger.info('Ingested RUM correlation fixture', {
        sessionId: fixture.sessionId,
        traces: fixture.requests.length,
      });
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const org = getOrgIdentifier() || 'default';
    await page.goto(`${baseUrl}/web/rum/sessions/view/${fixture.sessionId}?org_identifier=${org}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('P1: the session player offers a Traces tab listing the correlated traces', {
    tag: ['@rum', '@sessionReplay', '@regression', '@P1', '@all'],
  }, async ({ page }) => {
    // Discoverability is the whole issue: the tab sits with Breadcrumbs and Tags,
    // not behind a menu or a trace id the user has to already know.
    const tracesTab = page.locator('[data-test="tab-traces"]');
    await expect(tracesTab).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-test="tab-breadcrumbs"]')).toBeVisible();
    await expect(page.locator('[data-test="tab-tags"]')).toBeVisible();

    await tracesTab.click();

    // The count proves the RUM-to-traces join actually resolved. A stubbed unit
    // test cannot fail here; a broken trace-id column or stream probe will.
    const countBadge = page.locator('[data-test="rum-player-traces-tab-count-badge"]');
    await expect(countBadge).toBeVisible({ timeout: 30000 });
    await expect(countBadge).toContainText(String(fixture.requests.length));

    await expect(page.locator('[data-test="rum-player-traces-tab-empty"]')).toHaveCount(0);
    await expect(page.locator('[data-test="rum-player-traces-tab-error"]')).toHaveCount(0);

    // Every request the session made is listed, by the route the user recognises.
    const table = page.locator('[data-test="rum-player-traces-tab-table"]');
    await expect(table).toBeVisible();
    for (const req of fixture.requests) {
      await expect(table).toContainText(req.op);
    }
  });

  test('P1: the failed request is flagged in the list', {
    tag: ['@rum', '@sessionReplay', '@regression', '@P1', '@all'],
  }, async ({ page }) => {
    await page.locator('[data-test="tab-traces"]').click();
    await expect(page.locator('[data-test="rum-player-traces-tab-table"]')).toBeVisible({
      timeout: 30000,
    });

    const failed = fixture.requests.filter((r) => r.failed);
    const errorBadge = page.locator('[data-test="rum-player-traces-tab-error-count-badge"]');
    await expect(errorBadge).toBeVisible();
    await expect(errorBadge).toContainText(String(failed.length));

    // The row for the failing call carries the error status, so "which one broke"
    // is answerable without opening each trace.
    const failingRow = page
      .locator('[data-test^="o2-table-row-"]')
      .filter({ hasText: failed[0].op });
    await expect(failingRow).toHaveCount(1);
    await expect(failingRow).toContainText(/error/i);
  });

  test('P2: a trace opens its waterfall inline, without leaving the session', {
    tag: ['@rum', '@sessionReplay', '@regression', '@P2', '@all'],
  }, async ({ page }) => {
    await page.locator('[data-test="tab-traces"]').click();
    await expect(page.locator('[data-test="rum-player-traces-tab-table"]')).toBeVisible({
      timeout: 30000,
    });

    const sessionUrl = page.url();
    const target = fixture.requests.find((r) => r.failed);
    await page
      .locator('[data-test^="o2-table-row-"]')
      .filter({ hasText: target.op })
      .click();

    // Inline: the trace detail replaces the list inside the sidebar, and a back
    // control returns to it — the user never leaves the replay.
    await expect(page.locator('[data-test="rum-player-traces-tab-back-btn"]')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator('[data-test="trace-details-waterfall-tab"]')).toBeVisible();
    await expect(page.locator('[data-test="rum-player-traces-tab-table"]')).toHaveCount(0);
    expect(page.url(), 'opening a trace must not navigate away from the session').toBe(sessionUrl);

    // And back returns to the list rather than stranding the user in the trace.
    await page.locator('[data-test="rum-player-traces-tab-back-btn"]').click();
    await expect(page.locator('[data-test="rum-player-traces-tab-table"]')).toBeVisible({
      timeout: 15000,
    });
  });
});
