// Seed: s1..s6 reach /web/a; s1, s2, s4 then click b-btn; only s1 views /web/c; s1 and s3 claim replay with no _sessionreplay rows.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const { rumTestContext } = require('../utils/rum-env.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { encodeDef, funnelParam, sqlOf } = require('../../pages/rumPages/rumProductAnalyticsPage.js');
const {
  apiContext,
  ensureSessionReplayStream,
  seedRumAnalytics,
  seedViewsOnlyApp,
  seedPlaceholderIdentityApp,
  seedLongPageApp,
  seedBuilt,
  ensureRumStateOrg,
  buildUsersModeSeed,
  buildSyntheticMixSeed,
  runAppId,
  DAY_MS,
} = require('../utils/rum-analytics-ingestion.js');

const NOW = Date.now();
let facts = null;
let viewsOnlyApp = null;
let placeholderApp = null;
let longPageApp = null;
let usersApp = null;

const PA_TAGS = (priority) => ['@rum', '@rumAnalytics', priority, '@all'];

async function rumSchemaHas(page, field) {
  const { orgId, baseUrl, headers } = apiContext();
  const res = await page.request.get(`${baseUrl}/api/${orgId}/streams/_rumdata/schema?type=logs`, { headers });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()).schema || []).some((f) => f.name === field);
}

// The app probe and the summary run on every scope load, so either one on a cross-link means the shell re-entered.
const SCOPE_SQL = /AS app, COUNT\(DISTINCT session_id\)|va_rows/;

/** Records `_search` requests whose SQL matches `pattern` until `stop()`, which detaches the listener. */
function recordSearches(page, pattern) {
  const seen = [];
  const onRequest = (r) => {
    if (/\/_search(\?|$)/.test(r.url()) && pattern.test(sqlOf(r))) seen.push(sqlOf(r).slice(0, 200));
  };
  page.on('request', onRequest);
  return () => {
    page.off('request', onRequest);
    return seen;
  };
}

/** Resolves after `quietMs` with no request in flight; Playwright's networkidle is not reset by history navigation. */
async function waitForNetworkQuiet(page, quietMs = 1000, timeoutMs = 30000) {
  let inflight = 0;
  let last = Date.now();
  const up = () => {
    inflight++;
    last = Date.now();
  };
  const down = () => {
    inflight = Math.max(0, inflight - 1);
    last = Date.now();
  };
  page.on('request', up);
  page.on('requestfinished', down);
  page.on('requestfailed', down);
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (inflight === 0 && Date.now() - last >= quietMs) return;
      await page.waitForTimeout(100);
    }
    throw new Error(`The network was never quiet for ${quietMs} ms`);
  } finally {
    page.off('request', up);
    page.off('requestfinished', down);
    page.off('requestfailed', down);
  }
}

const ANALYTICS_URL = /\/api\/[^/]+\/rum\/analytics\/(named_events|funnels)(\/([0-9A-Za-z]{27}))?(\/funnels)?\?/;

/** Collects the ids of every named event and saved funnel the page creates, for API cleanup. */
function recordCreates(page) {
  const created = { events: new Set(), funnels: new Set() };
  const onResponse = async (r) => {
    const m = r.url().match(ANALYTICS_URL);
    if (!m || r.request().method() !== 'POST' || r.status() !== 201) return;
    const body = await r.json().catch(() => null);
    if (body?.id) created[m[1] === 'named_events' ? 'events' : 'funnels'].add(body.id);
  };
  page.on('response', onResponse);
  return { created, stop: () => page.off('response', onResponse) };
}

const analyticsUrl = (kind, app, id = '', extra = '') => {
  const { orgId, baseUrl } = apiContext();
  const path = kind === 'events' ? 'named_events' : 'funnels';
  return `${baseUrl}/api/${orgId}/rum/analytics/${path}${id ? `/${id}` : ''}?app=${encodeURIComponent(app)}${extra}`;
};

/** Deletes what a test created and checks each row is gone; soft, so it never hides the test's own error. */
async function cleanupAnalytics(page, app, created) {
  const { headers } = apiContext();
  const failed = [];
  for (const kind of ['funnels', 'events']) {
    for (const id of created[kind]) {
      const res = await page.request.delete(analyticsUrl(kind, app, id, '&force=true'), { headers }).catch((e) => e);
      const status = res.status?.() ?? String(res);
      if (status !== 204 && status !== 404) failed.push(`DELETE ${kind} ${id}: ${status}`);
      const after = await page.request.get(analyticsUrl(kind, app, id), { headers }).catch((e) => e);
      if (after.status?.() !== 404) failed.push(`GET ${kind} ${id}: ${after.status?.() ?? after}`);
    }
  }
  expect.soft(failed).toEqual([]);
}

async function createViaApi(page, kind, app, body) {
  const { headers } = apiContext();
  const res = await page.request.post(analyticsUrl(kind, app), { headers, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

test.describe('RUM Product Analytics', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ timezoneId: 'UTC' });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    facts = await seedRumAnalytics(page, { appId: runAppId('pa-ui'), nowMs: NOW });
    viewsOnlyApp = (await seedViewsOnlyApp(page, { appId: `${facts.appId}-views`, nowMs: NOW })).appId;
    placeholderApp = await seedPlaceholderIdentityApp(page, { appId: `${facts.appId}-ph`, nowMs: NOW });
    longPageApp = await seedLongPageApp(page, { appId: `${facts.appId}-long`, nowMs: NOW });
    usersApp = await seedBuilt(page, buildUsersModeSeed(`${facts.appId}-users`, NOW), { nowMs: NOW });
    await page.close();
    testLogger.info('UI seed ready', { appId: facts.appId, viewsOnlyApp });
  });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test('Product Analytics sits under Experience after RUM and Synthetics, and RUM keeps only its own tabs (AC-39, AC-40)', {
    tag: PA_TAGS('@P0'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.gotoRum('');
    await expect(page).toHaveURL(/\/rum\/performance/, { timeout: 30000 });
    const tabs = await pa.rumTabs.evaluateAll((els) => els.map((e) => e.getAttribute('data-test')));
    expect(tabs).toEqual([
      'rum-tab-performance',
      'rum-tab-sessions',
      'rum-tab-error-tracking',
      'rum-tab-source-maps',
    ]);

    await expect(page.locator('[data-test="menu-link-/product-analytics-item"]')).toHaveCount(0);
    await pa.openExperienceMenu();
    // Synthetics is feature-gated, so it is the only optional child; the order around it is fixed.
    const children = await pa.menuFlyoutItems.evaluateAll((els) => els.map((e) => e.getAttribute('data-test')));
    expect(children.filter((c) => c !== 'nav-group-item-synthetics')).toEqual([
      'nav-group-item-RUM',
      'nav-group-item-productAnalytics',
    ]);
    expect(children.at(-1)).toBe('nav-group-item-productAnalytics');
    await pa.menuLink.click();
    await expect(page).toHaveURL(/\/product-analytics\/overview/, { timeout: 30000 });
    for (const name of pa.subTabNames()) await expect(pa.subTab(name)).toBeVisible();
    await expect(pa.rumMenuLink).toHaveAttribute('aria-current', 'page');

    await pa.openSubTab('paths');
    await pa.expectSubTabActive('paths');
    await pa.openExperienceMenu();
    await expect(pa.menuLink).toHaveAttribute('aria-current', 'page');

    // The shell is kept alive across modules, so reopening it from the menu must resume a sub-tab, not an empty body (F1).
    await pa.rumMenuLink.click();
    await expect(page).toHaveURL(/\/rum\//, { timeout: 30000 });
    await pa.openFromMenu();
    await expect(page).toHaveURL(/\/product-analytics\/paths/, { timeout: 30000 });
    await expect(pa.paths).toBeVisible();
    await pa.expectSubTabActive('paths');
  });

  test('opens on Overview with the busiest app and last 7 days, lists ready (AC-1)', {
    tag: PA_TAGS('@P0'),
  }, async ({ page }) => {
    const { orgId, baseUrl, headers } = apiContext();
    const sql = `SELECT application_id AS app, COUNT(DISTINCT session_id) AS sessions FROM "_rumdata" WHERE application_id IS NOT NULL AND application_id <> '' AND session_id IS NOT NULL GROUP BY application_id ORDER BY sessions DESC LIMIT 100`;
    const res = await page.request.post(`${baseUrl}/api/${orgId}/_search?type=logs`, {
      headers,
      data: { query: { sql, start_time: (NOW - 7 * DAY_MS) * 1000, end_time: Date.now() * 1000, from: 0, size: 100 } },
    });
    const hits = (await res.json()).hits || [];
    const top = Number(hits[0]?.sessions);
    const busiest = hits.filter((h) => Number(h.sessions) === top).map((h) => h.app);

    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto(null);
    await expect(page).toHaveURL(/\/product-analytics\/overview/);
    await expect.poll(() => pa.query().get('app'), { timeout: 30000 }).not.toBeNull();
    expect(busiest).toContain(pa.query().get('app'));
    expect(pa.query().get('period')).toBe('7d');
    await pa.expectSubTabActive('overview');
    await expect(pa.rankedRow('pages', 0, 'key')).toBeVisible({ timeout: 30000 });
  });

  test('app, env and range live in the URL and carry across sub-tabs and reload (AC-6)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('overview', { app: facts.appId, period: '2d' });
    await pa.openSubTab('funnels');
    await pa.pickOption('rum-analytics-env-select', { value: 'e2e' });
    await pa.closePopovers();
    await expect.poll(() => pa.query().getAll('env')).toEqual(['e2e']);
    await pa.openSubTab('paths');
    expect(pa.query().get('app')).toBe(facts.appId);
    expect(pa.query().get('period')).toBe('2d');
    expect(pa.query().getAll('env')).toEqual(['e2e']);
    await pa.openSubTab('retention');
    expect(pa.query().getAll('env')).toEqual(['e2e']);

    await page.reload();
    await expect(pa.root).toBeVisible({ timeout: 30000 });
    expect(pa.query().get('app')).toBe(facts.appId);
    expect(pa.query().getAll('env')).toEqual(['e2e']);
    await expect(page.locator('[data-test="rum-analytics-env-select-trigger"]')).toContainText('e2e');
    await expect(pa.shareBtn).toBeVisible();
  });

  test('empty range offers Last 30 days; an app without click names explains it (AC-8)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const from = (NOW - 60 * DAY_MS) * 1000;
    const to = (NOW - 59 * DAY_MS) * 1000;
    await pa.goto('overview', { app: facts.appId, from, to });
    await expect(pa.overviewEmpty).toBeVisible({ timeout: 30000 });
    await pa.widenRangeBtn.click();
    await expect.poll(() => pa.query().get('period')).toBe('30d');
    await expect(pa.rankedRow('pages', 0, 'key')).toBeVisible({ timeout: 30000 });

    await pa.goto('overview', { app: viewsOnlyApp, period: '7d' });
    await expect(pa.clicksNotCaptured).toBeVisible({ timeout: 30000 });
    await expect(pa.clicksSetupLink).toBeVisible();
    expect(await pa.rankedKeys('pages')).toContain('/web/landing');
  });

  test('Pages list switches to Entry and Exit pages in one click (AC-42)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('overview', { app: facts.appId, period: '7d' });
    await expect(pa.rankedRow('pages', 0, 'key')).toBeVisible({ timeout: 30000 });
    await page.locator('[data-test="rum-analytics-overview-pages-view-entry"]').click();
    await expect(pa.rankedRow('pages', 0, 'key')).toHaveText('/web/a', { timeout: 30000 });
    await expect(pa.rankedRow('pages', 0, 'sessions')).toHaveText('6');
    await page.locator('[data-test="rum-analytics-overview-pages-view-exit"]').click();
    await expect(pa.rankedRow('pages', 0, 'key')).toHaveText('/web/c', { timeout: 30000 });
    await expect(pa.rankedRow('pages', 0, 'sessions')).toHaveText('4');
  });

  test('Trends chart shows sessions and one series per trended key (AC-48)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('overview', { app: facts.appId, period: '7d' });
    await expect(pa.trends).toBeVisible({ timeout: 30000 });
    await expect(pa.trends.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await expect(pa.rankedRow('pages', 0, 'trend-btn')).toHaveAttribute('aria-pressed', 'false');
    await pa.rowAction('pages', 0, 'trend-btn');
    await expect(pa.rankedRow('pages', 0, 'trend-btn')).toHaveAttribute('aria-pressed', 'true');
    await expect(pa.trends).toBeInViewport();
    await pa.rowAction('pages', 1, 'trend-btn');
    await expect(page.locator('[data-test="rum-analytics-trends-series-0"]')).toBeVisible();
    await expect(page.locator('[data-test="rum-analytics-trends-series-1"]')).toBeVisible();
    await pa.rowAction('pages', 1, 'trend-btn');
    await expect(pa.rankedRow('pages', 1, 'trend-btn')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-test="rum-analytics-trends-series-1"]')).toHaveCount(0);
    await page.locator('[data-test="rum-analytics-trends-clear-btn"]').click();
    await expect(page.locator('[data-test="rum-analytics-trends-series-0"]')).toHaveCount(0);
  });

  test('Build funnel from an Overview row, then two suggestions, gives a 3-step funnel (AC-10, AC-12)', {
    tag: PA_TAGS('@P0'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('overview', { app: facts.appId, period: '7d' });
    const row = await pa.rowIndexOf('pages', '/web/a');
    await waitForNetworkQuiet(page);
    const scopeLoads = recordSearches(page, SCOPE_SQL);
    await pa.rowAction('pages', row, 'funnel-btn');
    await expect(page).toHaveURL(/\/product-analytics\/funnels/);
    await expect(pa.step(0)).toContainText('/web/a');
    await expect(pa.suggestion('b-btn').first()).toBeVisible({ timeout: 30000 });
    await waitForNetworkQuiet(page);
    expect(scopeLoads(), 'Build funnel must not reload the scope (F18)').toEqual([]);
    expect(await page.locator('[data-test^="rum-analytics-funnel-suggestion-"]').count()).toBeLessThanOrEqual(5);
    await pa.suggestion('b-btn').first().click();
    await expect(pa.suggestion('/web/c').first()).toBeVisible({ timeout: 30000 });
    await pa.suggestion('/web/c').first().click();
    await pa.expectFunnelCounts([6, 3, 1]);
    await expect(pa.funnelOrderLabel).toContainText('In order (other events allowed between)');
  });

  test('steps are picked, removed and reordered; the funnel recomputes each time (AC-13)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const funnel = funnelParam([['p', '/web/a'], ['c', 'b-btn']]);
    await pa.goto('funnels', { app: facts.appId, period: '7d', funnel });
    await pa.expectFunnelCounts([6, 3]);
    await expect(page.getByRole('button', { name: /^Run$/ })).toHaveCount(0);

    await pa.pickOption('rum-analytics-funnel-add-step-select', { label: '/web/c', search: '/web/c' });
    await pa.expectFunnelCounts([6, 3, 1]);

    await page.locator('[data-test="rum-analytics-funnel-step-1-move-down"]').click();
    await expect(pa.step(1)).toContainText('/web/c');
    await pa.expectFunnelCounts([6, 1, 0]);

    await page.locator('[data-test="rum-analytics-funnel-step-2-move-up"]').click();
    await expect(pa.step(1)).toContainText('b-btn');
    await pa.expectFunnelCounts([6, 3, 1]);

    await page.locator('[data-test="rum-analytics-funnel-step-2-remove"]').click();
    await pa.expectFunnelCounts([6, 3]);
  });

  test('Breakdown by browser splits every step and sums to the funnel (AC-47)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const funnel = funnelParam([['p', '/web/a'], ['c', 'b-btn']]);
    await pa.goto('funnels', { app: facts.appId, period: '7d', funnel });
    await pa.expectFunnelCounts([6, 3]);
    await pa.pickOption('rum-analytics-funnel-breakdown-select', { value: 'browser' });
    await expect(pa.breakdown).toBeVisible({ timeout: 30000 });
    await expect(pa.breakdown).toContainText('Chrome');
    await expect(pa.breakdown).toContainText('Firefox');
    await expect(pa.breakdown).toContainText('Total');
    // The row id sits on the label cell; the counts are in the rest of its table row.
    const rowText = (label) => page
      .locator('tr', { has: page.locator('[data-test^="rum-analytics-funnel-breakdown-row-"]', { hasText: label }) })
      .first()
      .innerText();
    const chrome = await rowText('Chrome');
    const firefox = await rowText('Firefox');
    // Chrome: s1..s4 reach A, s1, s2, s4 click B; Firefox: s5, s6 reach A, neither clicks B.
    expect(chrome.replace(/\s+/g, ' ')).toMatch(/\b4\b.*\b3\b/);
    expect(firefox.replace(/\s+/g, ' ')).toMatch(/\b2\b.*\b0\b/);
    await expect.poll(() => pa.query().get('funnel')).not.toBe(funnel);
  });

  test('drop-off drawer, Session Viewer at the drop-off moment, and Back to the same funnel (AC-16, AC-17, AC-18, AC-19)', {
    tag: PA_TAGS('@P0'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const funnel = funnelParam([['p', '/web/a'], ['c', 'b-btn'], ['p', '/web/c']]);
    await pa.goto('funnels', { app: facts.appId, period: '7d', funnel });
    await pa.expectFunnelCounts([6, 3, 1]);

    await pa.openDropoff(0);
    await expect(pa.dropoffDrawer).toContainText('3 sessions dropped after step 1');
    await expect(page.locator('[data-test="rum-analytics-dropoff-next-row-0"]')).toContainText('Left the app', { timeout: 30000 });
    await expect(page.locator('[data-test="rum-analytics-dropoff-error-dropped"]')).toContainText('33', { timeout: 30000 });
    await expect(page.locator('[data-test="rum-analytics-dropoff-error-converted"]')).toContainText('33');
    const frustration = page.locator('[data-test="rum-analytics-dropoff-frustration-dropped"]');
    // Other RUM specs may add action_frustration_type to the shared org's _rumdata; this seed never sets it.
    if (await rumSchemaHas(page, 'action_frustration_type')) await expect(frustration.locator(':scope > span').last()).toHaveText(/^0\.0%$/);
    else await expect(frustration).toHaveCount(0);
    await expect(page.locator('[data-test="rum-analytics-dropoff-sessions-cap"]')).toContainText('3', { timeout: 30000 });
    // s3 carries replay and sorts first.
    const replayTag = page.locator('[data-test="rum-analytics-dropoff-sessions-row-0-replay"]');
    await expect(replayTag).toContainText('Replay');

    await replayTag.click();
    await expect(page).toHaveURL(/\/rum\/sessions\/view\//, { timeout: 30000 });
    const q = new URL(page.url()).searchParams;
    expect(q.get('from')).toBe('analytics');
    expect(Number(q.get('event_time'))).toBeGreaterThan(0);
    await expect(pa.sessionViewerContext).toBeVisible({ timeout: 30000 });
    await expect(pa.sessionViewerContext).toContainText('/web/a');
    await expect(pa.sessionViewerEventsOnly).toBeVisible({ timeout: 30000 });
    await expect(pa.sessionViewerNoReplay).toHaveCount(0);
    await expect(pa.sessionViewerStepMark.first()).toBeVisible({ timeout: 30000 });

    const stop = recordSearches(page, new RegExp(`application_id\\s*=\\s*'${facts.appId}'`));
    await page.goBack();
    await expect(page).toHaveURL(/\/product-analytics\/funnels/);
    await pa.expectFunnelCounts([6, 3, 1]);
    await waitForNetworkQuiet(page);
    expect(stop(), 'Back to the funnel issues no new search').toEqual([]);
  });

  test('See paths of dropped sessions opens Paths filtered to them (AC-25)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const funnel = funnelParam([['p', '/web/a'], ['c', 'b-btn']]);
    await pa.goto('funnels', { app: facts.appId, period: '7d', funnel });
    await pa.expectFunnelCounts([6, 3]);
    await pa.openDropoff(0);
    await waitForNetworkQuiet(page);
    const scopeLoads = recordSearches(page, SCOPE_SQL);
    await page.locator('[data-test="rum-analytics-dropoff-paths-btn"]').click();
    await expect(page).toHaveURL(/\/product-analytics\/paths/);
    await expect(pa.pathsSessionFilter).toBeVisible({ timeout: 30000 });
    await expect(pa.pathsSessionFilter).toContainText('3');
    await expect(pa.pathsFlow).toBeVisible({ timeout: 30000 });
    await waitForNetworkQuiet(page);
    expect(scopeLoads(), 'See paths must not reload the scope (F18)').toEqual([]);
  });

  test('Paths from an Overview row, then a branch drawer into Session Viewer (AC-23, AC-25, AC-26)', {
    tag: PA_TAGS('@P0'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('overview', { app: facts.appId, period: '7d' });
    const row = await pa.rowIndexOf('pages', '/web/a');
    await waitForNetworkQuiet(page);
    const scopeLoads = recordSearches(page, SCOPE_SQL);
    await pa.rowAction('pages', row, 'paths-btn');
    await expect(page).toHaveURL(/\/product-analytics\/paths/);
    await expect(pa.pathsFlow).toBeVisible({ timeout: 30000 });
    await expect(pa.pathsFlow.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await expect(pa.pathsTopTable).toBeVisible({ timeout: 30000 });
    await waitForNetworkQuiet(page);
    expect(scopeLoads(), 'Open paths must not reload the scope (F18)').toEqual([]);
    await expect(page.locator('[data-test="rum-analytics-paths-top-row-0"]')).toBeVisible();

    await expect(pa.topPathSessionsBtn(0)).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(pa.topPathSessionsBtn(0)).toHaveText(/^~?[\d,]+ sessions?$/);
    await pa.topPathSessionsBtn(0).click();
    await expect(pa.branchDrawer).toBeVisible();
    await pa.expectFullHeight(pa.branchDrawer);
    const first = page.locator('[data-test="rum-analytics-paths-branch-sessions-row-0-replay"]');
    await expect(first).toBeVisible({ timeout: 30000 });
    await first.click();
    await expect(page).toHaveURL(/\/rum\/sessions\/view\//, { timeout: 30000 });
    expect(Number(new URL(page.url()).searchParams.get('event_time'))).toBeGreaterThan(0);
  });

  test('Retention without a user id shows the unlock state, never a grid (AC-30)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('retention', { app: viewsOnlyApp, period: '7d' });
    await expect(pa.retentionUnlock).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-test="rum-analytics-retention-unlock-snippet"]')).toContainText('setUser');
    await expect(page.locator('[data-test="rum-analytics-retention-unlock-docs-link"]')).toBeVisible();
    await expect(page.locator('[data-test="rum-analytics-retention-unlock-unidentified"]')).toContainText('3');
    await expect(pa.retentionGrid).toHaveCount(0);
  });

  test('a constant usr_email shows the placeholder reason and a disabled Users unit (scope addition 6)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('retention', { app: placeholderApp.appId, period: '7d' });
    await expect(pa.retentionUnlock).toBeVisible({ timeout: 30000 });
    await expect(pa.retentionUnlock).toContainText(/placeholder or a constant setUser call/);
    await expect(pa.retentionUnlock).toContainText('usr_email');
    await expect(pa.retentionUnlock).toContainText('100.0%');
    await expect(pa.retentionUnlock).not.toContainText('Call setUser once the user is known');
    await expect(page.locator('body')).not.toContainText(placeholderApp.email);

    await pa.goto('funnels', {
      app: placeholderApp.appId,
      period: '7d',
      funnel: funnelParam([['p', '/web/landing'], ['p', '/web/next']]),
    });
    await expect(pa.step(0)).toContainText('/web/landing', { timeout: 30000 });
    const users = page.locator('[data-test="rum-analytics-funnel-count-by-users"]');
    await expect(users).toBeDisabled();
    // OTooltip binds to the disabled button, which takes no pointer events, so the reason is asserted on the visible hint.
    const hint = page.locator('[data-test="rum-analytics-funnel-identity-hint"]');
    await expect(hint).toContainText(/placeholder or a constant setUser call/, { timeout: 30000 });
    await expect(hint).toContainText('100.0%');
    await expect(page.locator('body')).not.toContainText(placeholderApp.email);
  });

  test('Retention renders with zero clicks; a cell drawer lists users and opens Sessions (AC-31, AC-35)', {
    tag: PA_TAGS('@P0'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.pinRumDataStart(facts.retentionFromMs * 1000);
    await pa.goto('retention', { app: facts.appId, from: facts.retentionFromMs * 1000, to: NOW * 1000 });
    await expect(pa.retentionGrid).toBeVisible({ timeout: 45000 });
    await expect(pa.retention).toContainText(/first seen in range/i);
    await expect(pa.retentionCell(0, 1)).toBeVisible({ timeout: 45000 });

    await pa.retentionCell(0, 1).click();
    await expect(pa.retentionCellDrawer).toBeVisible();
    const user0 = page.locator('[data-test="rum-analytics-retention-user-0"]');
    await expect(user0).toContainText('r1@e2e.test', { timeout: 30000 });
    await page.locator('[data-test="rum-analytics-retention-drawer-lost-tab"]').click();
    await expect(page.locator('[data-test="rum-analytics-retention-user-0"]')).toContainText('r2@e2e.test', { timeout: 30000 });

    await page.locator('[data-test="rum-analytics-retention-user-0-sessions-btn"]').click();
    await expect(page).toHaveURL(/\/rum\/sessions(\?|$)/, { timeout: 30000 });
    const filter = Buffer.from(new URL(page.url()).searchParams.get('query') || '', 'base64').toString('utf8');
    expect(filter).toContain('r2@e2e.test');
  });

  test('Sessions with an absolute range: Back from a session issues no new list search (AC-39)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await ensureSessionReplayStream(page, facts.appId, NOW);
    const url = new URL(`${pa.base}/web/rum/sessions`);
    url.searchParams.set('org_identifier', pa.org);
    url.searchParams.set('from', String((NOW - 7 * 24 * 3600 * 1000) * 1000));
    url.searchParams.set('to', String(NOW * 1000));
    url.searchParams.set('query', Buffer.from(`application_id='${facts.appId}'`).toString('base64'));
    await page.goto(url.toString());
    const rows = page.locator('[data-test="rum-sessions-table"] tbody tr', { hasText: '@e2e.test' });
    await expect(rows.first()).toBeVisible({ timeout: 45000 });
    await rows.first().click();
    await expect(page).toHaveURL(/\/rum\/sessions\/view\//, { timeout: 30000 });
    await page.waitForLoadState('networkidle');

    const stop = recordSearches(page, new RegExp(`application_id\\s*=\\s*'${facts.appId}'`));
    await page.goBack();
    await expect(page).toHaveURL(/\/rum\/sessions\?/);
    await expect(rows.first()).toBeVisible({ timeout: 30000 });
    await waitForNetworkQuiet(page);
    expect(stop(), 'Back to an absolute-range Sessions list issues no new list search').toEqual([]);
  });

  test('named events: create, use in Features and as a funnel step, then delete (AC-44, AC-45)', {
    tag: PA_TAGS('@P0'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const name = `Reached A ${facts.appId.slice(-4)}`;
    await pa.goto('overview', { app: facts.appId, period: '7d' });
    const row = await pa.rowIndexOf('pages', '/web/a');
    const pageSessions = await pa.numberIn(pa.rankedRow('pages', row, 'sessions'));
    const pageUsers = await pa.numberIn(pa.rankedRow('pages', row, 'users'));

    const rec = recordCreates(page);
    try {
      await pa.createPageEvent(name, '/web/a');
      await pa.openSubTab('overview');
      await expect(pa.featuresTable).toBeVisible({ timeout: 30000 });
      await expect(pa.featuresTable).toContainText(name);
      await expect(page.locator('[data-test="rum-analytics-overview-features-table-row-0-sessions"]')).toHaveText(String(pageSessions), { timeout: 30000 });
      await expect(page.locator('[data-test="rum-analytics-overview-features-table-row-0-users"]')).toHaveText(String(pageUsers));

      await pa.newFunnel();
      await page.locator('[data-test="rum-analytics-funnel-first-step-select-trigger"], [data-test="rum-analytics-funnel-add-step-select-trigger"]').first().click();
      const firstOption = page.locator('[data-test$="-step-select-option"]').first();
      await expect(firstOption).toContainText(name, { timeout: 20000 });
      await firstOption.click();
      await expect(pa.step(0)).toContainText(name);
      await pa.pickOption('rum-analytics-funnel-add-step-select', { label: 'b-btn', search: 'b-btn' });
      await pa.expectFunnelCounts([6, 3]);

      // A reload is a first open; the slowed named-events list widens the window in which a failure banner could flash.
      const eventFunnelUrl = page.url();
      expect(eventFunnelUrl).toContain('funnel=');
      await page.addInitScript(() => {
        window.__eventsBannerSeen = false;
        new MutationObserver(() => {
          if (document.querySelector('[data-test="rum-analytics-funnel-events-unavailable"]')) window.__eventsBannerSeen = true;
        }).observe(document, { childList: true, subtree: true });
      });
      const slowList = async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      };
      const EVENTS_LIST = /\/api\/[^/]+\/rum\/analytics\/named_events\?/;
      await page.route(EVENTS_LIST, slowList);
      await page.goto(eventFunnelUrl);
      await expect(pa.step(0)).toContainText(name, { timeout: 30000 });
      await pa.expectFunnelCounts([6, 3]);
      expect(await page.evaluate(() => window.__eventsBannerSeen), 'a first open never shows the named-events failure banner').toBe(false);
      await page.unroute(EVENTS_LIST, slowList);

      await pa.openNamedEvents();
      await pa.deleteNamedEvent(name);
    } finally {
      rec.stop();
      await cleanupAnalytics(page, facts.appId, rec.created);
    }
  });

  test('named events: two can be created from the list in one visit, then both are deleted', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const suffix = facts.appId.slice(-4);
    const created = [[`Twice A ${suffix}`, '/web/a'], [`Twice B ${suffix}`, '/web/c']];
    // Cleanup uses the ids the creates returned, so a failed list never leaves rows behind.
    const rec = recordCreates(page);
    await pa.goto('overview', { app: facts.appId, period: '7d' });
    await pa.openNamedEvents();
    try {
      for (const [name, url] of created) {
        await expect(pa.newEventBtn).toBeEnabled({ timeout: 20000 });
        await pa.newEventBtn.click();
        await expect(pa.eventSaveBtn).not.toHaveAttribute('aria-busy', 'true');
        await pa.fillPageEvent(name, url);
        await pa.eventSaveBtn.click();
        await expect(pa.namedEventsList).toBeVisible({ timeout: 20000 });
        await expect(pa.namedEventNames().filter({ hasText: name })).toHaveCount(1, { timeout: 20000 });
      }
      expect(rec.created.events.size).toBe(created.length);
    } finally {
      rec.stop();
      await cleanupAnalytics(page, facts.appId, rec.created);
    }
  });

  test('saved funnels: save, open by link in a fresh page, Edited, Save, Rename, Save as, Duplicate, delete and fall back (AC-67, AC-70)', {
    tag: PA_TAGS('@P0'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const suffix = facts.appId.slice(-4);
    const name = `Saved ${suffix}`;
    const savedName = page.locator('[data-test="rum-analytics-funnel-saved-name"]');
    const edited = page.locator('[data-test="rum-analytics-funnel-dirty-tag"]');
    const rec = recordCreates(page);
    const fresh = await page.context().newPage();
    try {
      await pa.goto('funnels', {
        app: facts.appId,
        period: '7d',
        funnel: funnelParam([['p', facts.funnel.a], ['c', facts.funnel.b]]),
      });
      await pa.expectFunnelCounts([6, 3]);
      await expect(savedName).toHaveText('Unsaved funnel');
      await pa.saveFunnel(name);
      await expect(savedName).toHaveText(name);
      await expect.poll(() => pa.query().get('sf')).toMatch(/^[0-9A-Za-z]{27}$/);
      const sf = pa.query().get('sf');
      const sfLink = page.url();

      // A shared link with only the id opens the saved steps under the reader's scope.
      const reader = new PageManager(fresh).rumProductAnalyticsPage;
      await reader.goto('funnels', { app: facts.appId, period: '7d', sf });
      // A list link naming a funnel forwards to the builder.
      await expect(fresh).toHaveURL(/\/product-analytics\/funnels\/build/, { timeout: 30000 });
      await expect(fresh.locator('[data-test="rum-analytics-funnel-saved-name"]')).toHaveText(name, { timeout: 30000 });
      await reader.expectFunnelCounts([6, 3]);

      await pa.pickOption('rum-analytics-funnel-breakdown-select', { value: 'browser' });
      await expect(edited).toHaveText('Edited');
      const put = pa.waitForAnalyticsWrite('funnel', 'PUT');
      await page.locator('[data-test="rum-analytics-funnel-save-btn"]').click();
      expect((await put).status).toBe(200);
      await expect(edited).toBeHidden();

      await pa.saveFunnel(`Renamed ${suffix}`, 'rename');
      await expect(savedName).toHaveText(`Renamed ${suffix}`);
      await pa.saveFunnel(`Copy ${suffix}`, 'save-as');
      await expect(savedName).toHaveText(`Copy ${suffix}`);
      await pa.saveFunnel(null, 'duplicate');
      await expect(savedName).toHaveText(`Copy of Copy ${suffix}`);
      expect(rec.created.funnels.size).toBe(3);

      // Copy link names the builder, so a reader lands on the funnel, not the list.
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
      await page.locator('[data-test="rum-analytics-funnel-saved-menu-btn"]').click();
      await page.locator('[data-test="rum-analytics-funnel-saved-menu-copy-link"]').click();
      const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
      if (copied !== null) expect(new URL(copied).pathname).toMatch(/\/product-analytics\/funnels\/build$/);

      await pa.openSavedFunnel(`Renamed ${suffix}`);
      const list = await pa.openSavedFunnels();
      // A link copied from the list opens the list, so its URL names no funnel.
      expect(pa.query().get('sf')).toBeNull();
      expect(pa.query().get('funnel')).toBeNull();
      const current = await (await pa.savedFunnelRow(`Renamed ${suffix}`)).getAttribute('data-test');
      await expect(list.locator(`[data-test="${current}-current"]`)).toHaveText('Current');
      await pa.openSavedFunnel(`Renamed ${suffix}`);
      await page.locator('[data-test="rum-analytics-funnel-saved-menu-btn"]').click();
      await page.locator('[data-test="rum-analytics-funnel-saved-menu-delete"]').click();
      await page.locator('[data-test="o-dialog-primary-btn"]').click();
      // Deleting returns to the list, without the funnel.
      await expect(page).toHaveURL(/\/product-analytics\/funnels(\?|$)/);
      await expect(list).toBeVisible({ timeout: 20000 });
      await expect(list.locator('[data-test^="rum-analytics-saved-funnel-row-"]').filter({ hasText: new RegExp(`^Renamed ${suffix}$`) })).toHaveCount(0);

      // The deleted funnel's link falls back to the steps it carried, and says so.
      await fresh.goto(sfLink);
      await expect(fresh.locator('[data-test="rum-analytics-funnel-saved-missing"]')).toBeVisible({ timeout: 30000 });
      await reader.expectFunnelCounts([6, 3]);
      await expect.poll(() => reader.query().get('sf')).toBeNull();
    } finally {
      rec.stop();
      await fresh.close();
      await cleanupAnalytics(page, facts.appId, rec.created);
    }
  });

  test('saved funnels: a save over a funnel changed in another page opens Reload or Overwrite naming who (AC-70)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const name = `Conflict ${facts.appId.slice(-4)}`;
    const row = await createViaApi(page, 'funnels', facts.appId, {
      name,
      def: { s: [['p', facts.funnel.a], ['c', facts.funnel.b]], u: 'sessions', w: 'session' },
      sql: 'SELECT 1 AS x_axis_1 FROM "_rumdata"',
    });
    const other = await page.context().newPage();
    try {
      const first = new PageManager(page).rumProductAnalyticsPage;
      const second = new PageManager(other).rumProductAnalyticsPage;
      for (const p of [first, second]) {
        await p.goto('funnels', { app: facts.appId, period: '7d', sf: row.id });
        await expect(p.page.locator('[data-test="rum-analytics-funnel-saved-name"]')).toHaveText(name, { timeout: 30000 });
      }
      await first.pickOption('rum-analytics-funnel-breakdown-select', { value: 'browser' });
      const put = first.waitForAnalyticsWrite('funnel', 'PUT');
      await page.locator('[data-test="rum-analytics-funnel-save-btn"]').click();
      expect((await put).status).toBe(200);

      await second.pickOption('rum-analytics-funnel-breakdown-select', { value: 'os' });
      const conflict = second.waitForAnalyticsWrite('funnel', 'PUT');
      await other.locator('[data-test="rum-analytics-funnel-save-btn"]').click();
      expect((await conflict).status).toBe(409);
      const dialog = other.locator('[data-test="rum-analytics-funnel-conflict-dialog"]');
      await expect(dialog).toContainText(`${rumTestContext().email} changed "${name}" at`);
      const overwrite = second.waitForAnalyticsWrite('funnel', 'PUT');
      await dialog.locator('[data-test="o-dialog-primary-btn"]').click();
      const res = await overwrite;
      expect(res.status).toBe(200);
      expect(res.body.def.b).toBe('os');
      expect(res.body.version).toBe(3);
    } finally {
      await other.close();
      await cleanupAnalytics(page, facts.appId, { events: new Set(), funnels: new Set([row.id]) });
    }
  });

  test('saved funnels: a failed list keeps an sf link for Retry, and renaming another funnel deleted elsewhere leaves the open one alone (F48, F50)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const suffix = facts.appId.slice(-4);
    const def = { s: [['p', facts.funnel.a], ['c', facts.funnel.b]], u: 'sessions', w: 'session' };
    const sql = 'SELECT 1 AS x_axis_1 FROM "_rumdata"';
    const open = await createViaApi(page, 'funnels', facts.appId, { name: `Open ${suffix}`, def, sql });
    const other = await createViaApi(page, 'funnels', facts.appId, { name: `Other ${suffix}`, def, sql });
    const created = { events: new Set(), funnels: new Set([open.id, other.id]) };
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const savedName = page.locator('[data-test="rum-analytics-funnel-saved-name"]');
    const edited = page.locator('[data-test="rum-analytics-funnel-dirty-tag"]');
    const list = /\/api\/[^/]+\/rum\/analytics\/funnels\?/;
    let listDown = true;
    const writes = [];
    const onRequest = (r) => {
      if (/\/rum\/analytics\/funnels/.test(r.url()) && r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
    };
    try {
      await page.route(list, (route) =>
        listDown && route.request().method() === 'GET'
          ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"internal_error","message":"down"}' })
          : route.fallback());
      await pa.goto('funnels', { app: facts.appId, period: '7d', sf: open.id, funnel: funnelParam([['p', facts.funnel.a], ['c', facts.funnel.b]]) });
      const failed = page.locator('[data-test="rum-analytics-funnel-saved-link-failed"]');
      await expect(failed).toBeVisible({ timeout: 30000 });
      await expect(page.locator('[data-test="rum-analytics-funnel-saved-missing"]')).toBeHidden();
      await expect(savedName).toHaveText('Unsaved funnel');
      expect(pa.query().get('sf')).toBe(open.id);
      listDown = false;
      await page.locator('[data-test="rum-analytics-funnel-saved-link-retry-btn"]').click();
      await expect(savedName).toHaveText(`Open ${suffix}`, { timeout: 30000 });
      await expect(failed).toBeHidden();
      expect(pa.query().get('sf')).toBe(open.id);
      await page.unroute(list);

      const unbroken = pa.query().get('funnel');
      await pa.pickOption('rum-analytics-funnel-breakdown-select', { value: 'browser' });
      await expect(edited).toHaveText('Edited');
      // The URL is synced after the debounced recompute, so the edited funnel is read once it lands.
      await expect.poll(() => pa.query().get('funnel')).not.toBe(unbroken);
      const funnelBefore = pa.query().get('funnel');
      const { headers } = apiContext();
      expect((await page.request.delete(analyticsUrl('funnels', facts.appId, other.id), { headers })).status()).toBe(204);
      page.on('request', onRequest);
      await pa.savedFunnelRowAction(`Other ${suffix}`, 'rename');
      const dialog = page.locator('[data-test="rum-analytics-save-funnel-dialog"]');
      await dialog.locator('[data-test="rum-analytics-save-funnel-name-field"]').fill(`Other renamed ${suffix}`);
      const put = pa.waitForAnalyticsWrite('funnel', 'PUT');
      await dialog.locator('[data-test="o-dialog-primary-btn"]').click();
      expect((await put).status).toBe(404);
      await expect(page.locator('[data-test="o-toast-message"]').filter({ hasText: `"Other ${suffix}" was deleted elsewhere; the list was refreshed` })).toBeVisible({ timeout: 20000 });
      await expect(dialog).toBeHidden();
      // Reopening the open funnel from the list brings back its unsaved edits.
      await pa.openSavedFunnel(`Open ${suffix}`);
      await expect(edited).toHaveText('Edited');
      expect(pa.query().get('sf')).toBe(open.id);
      expect(pa.query().get('funnel')).toBe(funnelBefore);
      expect(writes.filter((w) => w.startsWith('POST'))).toEqual([]);
    } finally {
      page.off('request', onRequest);
      await page.unroute(list).catch(() => {});
      await cleanupAnalytics(page, facts.appId, created);
    }
  });

  test('deleting a named event a saved funnel uses asks once, naming the funnel, which then shows Deleted event (AC-69)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const suffix = facts.appId.slice(-4);
    const ev = await createViaApi(page, 'events', facts.appId, {
      name: `In use ${suffix}`,
      rules: [{ t: 'view', op: 'eq', value: facts.funnel.a }],
    });
    const funnelName = `Uses event ${suffix}`;
    const funnel = await createViaApi(page, 'funnels', facts.appId, {
      name: funnelName,
      def: { s: [['e', ev.id], ['c', facts.funnel.b]], u: 'sessions', w: 'session' },
      sql: 'SELECT 1 AS x_axis_1 FROM "_rumdata"',
    });
    const created = { events: new Set([ev.id]), funnels: new Set([funnel.id]) };
    try {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      await pa.goto('overview', { app: facts.appId, period: '7d' });
      await pa.openNamedEvents();
      const rowId = await pa.namedEventRowId(ev.name);
      await page.locator(`[data-test="${rowId}-delete-btn"]`).click();
      await expect(page.locator('[data-test="o-dialog-panel"], [role="alertdialog"], [role="dialog"]').last()).toContainText(`1 saved funnel: ${funnelName}`);
      const del = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes(`/named_events/${ev.id}?`));
      await page.locator('[data-test="o-dialog-primary-btn"]').click();
      const res = await del;
      expect(res.status()).toBe(204);
      expect(res.url()).toContain('force=true');

      await pa.goto('funnels', { app: facts.appId, period: '7d', sf: funnel.id });
      await expect(page.locator('[data-test="rum-analytics-funnel-saved-name"]')).toHaveText(funnelName, { timeout: 30000 });
      await expect(page.locator('[data-test="rum-analytics-funnel-step-0-deleted"]')).toBeVisible({ timeout: 30000 });
    } finally {
      await cleanupAnalytics(page, facts.appId, created);
    }
  });

  test('an On page longer than 1,024 characters is an inline field error and saves nothing (F46)', {
    tag: PA_TAGS('@P2'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const writes = [];
    const onRequest = (r) => {
      if (ANALYTICS_URL.test(r.url()) && r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
    };
    page.on('request', onRequest);
    const rec = recordCreates(page);
    try {
      await pa.goto('overview', { app: longPageApp.appId, period: '7d' });
      const row = await pa.rowIndexOf('clicks', 'long-btn');
      // Define as event pre-fills the click's top page only once the click-pages search has landed.
      await expect(pa.rankedRow('clicks', row, 'pages')).toHaveText('1', { timeout: 30000 });
      await pa.rowAction('clicks', row, 'define-event-btn');
      const editor = pa.eventEditor;
      await expect(editor.locator('[data-test="rum-analytics-named-events-form"]')).toBeVisible({ timeout: 20000 });
      await expect(editor.locator('[data-test="rum-analytics-named-events-rule-0-on-page-trigger"]')).toHaveAttribute(
        'data-test-selected-value',
        longPageApp.pageKey,
      );
      await pa.eventSaveBtn.click();
      await expect(editor.locator('[data-test="rum-analytics-named-events-rule-0"]')).toContainText(
        'This page is too long (at most 1,024 characters)',
      );
      await expect(editor.locator('[data-test="rum-analytics-named-events-form"]')).toBeVisible();
      expect(writes).toEqual([]);
      // Back returns to Overview, where Define as event was clicked.
      await page.locator('[data-test="rum-analytics-event-editor-back-btn"]').click();
      await expect(page).toHaveURL(/\/product-analytics\/overview/);
    } finally {
      page.off('request', onRequest);
      rec.stop();
      await cleanupAnalytics(page, longPageApp.appId, rec.created);
    }
  });

  test('Add to dashboard: funnel panel lands on a dashboard; Trends opens the dialog (AC-53)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const { orgId, baseUrl, headers } = apiContext();
    const title = `pa-e2e-${facts.appId}`;
    const created = await page.request.post(`${baseUrl}/api/${orgId}/dashboards?folder=default`, {
      headers,
      data: { version: 8, title, description: 'RUM analytics e2e', tabs: [{ tabId: 'default', name: 'Default', panels: [] }] },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const body = await created.json();
    const dashboardId = (body[`v${body.version}`] || body).dashboardId;
    try {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const funnel = funnelParam([['p', '/web/a'], ['c', 'b-btn']]);
      await pa.goto('funnels', { app: facts.appId, period: '7d', funnel });
      await pa.expectFunnelCounts([6, 3]);
      await pa.funnelAddDashboardBtn.click();
      await expect(pa.addToDashboardDialog).toBeVisible();
      await expect(pa.addToDashboardNotice).toBeVisible();
      await pa.pickOption('dashboard-dropdown-dashboard-selection', { label: title, search: title });
      await page.locator('[data-test="metrics-new-dashboard-panel-title-field"]').fill('Funnel e2e');
      const add = pa.addToDashboardDialog.locator('[data-test="o-dialog-primary-btn"]');
      await expect(add).toBeEnabled({ timeout: 15000 });
      await add.click();
      await expect(pa.addToDashboardDialog).toBeHidden({ timeout: 15000 });

      await expect.poll(async () => {
        const res = await page.request.get(`${baseUrl}/api/${orgId}/dashboards/${dashboardId}`, { headers });
        const d = await res.json();
        const inner = d[`v${d.version}`] || d;
        const panels = (inner.tabs || []).flatMap((t) => t.panels || []);
        return panels.map((p) => `${p.type}|${p.queryType}|${(p.queries || [])[0]?.fields?.stream}`);
      }, { timeout: 20000 }).toEqual(['bar|sql|_rumdata']);

      await pa.goto('overview', { app: facts.appId, period: '7d' });
      await expect(pa.trendsAddDashboardBtn).toBeVisible({ timeout: 30000 });
      await pa.trendsAddDashboardBtn.click();
      await expect(pa.addToDashboardDialog).toBeVisible();
    } finally {
      await page.request.delete(`${baseUrl}/api/${orgId}/dashboards/${dashboardId}?folder=default`, { headers });
    }
  });

  test('Funnels with no steps list entry pages and Recent funnels (AC-58)', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('funnels/build', { app: facts.appId, period: '7d' });
    await expect(pa.funnelCold).toBeVisible({ timeout: 30000 });
    const entry = page.locator('[data-test="rum-analytics-funnel-entry-start-0"]');
    await expect(entry).toContainText('/web/a', { timeout: 30000 });
    expect(await page.locator('[data-test^="rum-analytics-funnel-entry-start-"]').count()).toBeLessThanOrEqual(5);
    await entry.click();
    await expect(pa.step(0)).toContainText('/web/a');
    await pa.suggestion('b-btn').first().click();
    await pa.expectFunnelCounts([6, 3]);

    await page.locator('[data-test="rum-analytics-funnel-clear-btn"]').click();
    await expect(pa.funnelCold).toBeVisible();
    const recent = page.locator('[data-test="rum-analytics-funnel-recent-0"]');
    await expect(recent).toContainText('b-btn');
    await recent.click();
    await pa.expectFunnelCounts([6, 3]);
  });

  for (const theme of ['light', 'dark']) {
    test(`funnel, retention and paths are readable in the ${theme} theme (AC-41)`, {
      tag: PA_TAGS('@P2'),
    }, async ({ page }) => {
      await page.addInitScript((mode) => window.localStorage.setItem('theme', mode), theme);
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const funnel = funnelParam([['p', '/web/a'], ['c', 'b-btn']]);
      await pa.goto('funnels', { app: facts.appId, period: '7d', funnel });
      await pa.expectFunnelCounts([6, 3]);
      const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark') || document.body.classList.contains('body--dark'));
      expect(isDark).toBe(theme === 'dark');
      expect(await pa.contrastOf(pa.stepCount(0))).toBeGreaterThanOrEqual(4.5);

      await pa.pinRumDataStart(facts.retentionFromMs * 1000);
      await pa.goto('retention', { app: facts.appId, from: facts.retentionFromMs * 1000, to: NOW * 1000 });
      await expect(pa.retentionCell(0, 1)).toBeVisible({ timeout: 45000 });
      expect(await pa.contrastOf(pa.retentionCell(0, 1))).toBeGreaterThanOrEqual(4.5);

      await pa.goto('paths', { app: facts.appId, period: '7d', anchor: encodeDef(['p', '/web/a']) });
      const canvas = pa.pathsFlow.locator('canvas').first();
      await expect(canvas).toBeVisible({ timeout: 30000 });
      const colours = () => canvas.evaluate((el) => {
        const ctx = el.getContext('2d');
        const { data } = ctx.getImageData(0, 0, el.width, el.height);
        const seen = new Set();
        for (let i = 0; i < data.length; i += 4 * 97) {
          if (data[i + 3] > 200) seen.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
        }
        return seen.size;
      });
      await expect.poll(colours, { timeout: 15000 }).toBeGreaterThanOrEqual(3);
    });
  }

  /** Records the status of every named-event or saved-funnel write until `stop()`. */
  function recordWrites(page) {
    const writes = [];
    const onResponse = (r) => {
      if (ANALYTICS_URL.test(r.url()) && r.request().method() !== 'GET') writes.push(`${r.request().method()} ${r.status()}`);
    };
    page.on('response', onResponse);
    return { writes, stop: () => page.off('response', onResponse) };
  }

  test('Users mode counts identified users and names the sessions it leaves out', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('funnels', { app: usersApp.appId, period: '7d', funnel: funnelParam([['p', '/web/a'], ['p', '/web/c']]) });
    await pa.expectFunnelCounts([usersApp.sessionsAtA, 0]);
    await expect(pa.funnelLeftOut).toHaveCount(0);
    await expect(pa.countBy('users')).toBeEnabled({ timeout: 30000 });

    await pa.selectCountBy('users');
    await expect.poll(() => pa.funnelFromUrl()?.u).toBe('users');
    await pa.expectFunnelCounts(usersApp.windows.session);
    await expect(pa.funnelLeftOut).toContainText(
      `${usersApp.leftOut} of ${usersApp.sessionsAtA} step-1 sessions had no identity and are left out`,
      { timeout: 30000 },
    );
    await expect(pa.funnelLeftOut).toContainText('usr_email');

    await pa.selectCountBy('sessions');
    await pa.expectFunnelCounts([usersApp.sessionsAtA, 0]);
    await expect(pa.funnelLeftOut).toHaveCount(0);
  });

  test('the conversion window changes cross-session conversion in Users mode', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('funnels', { app: usersApp.appId, period: '7d', funnel: funnelParam([['p', '/web/a'], ['p', '/web/c']]) });
    await pa.expectFunnelCounts([usersApp.sessionsAtA, 0]);
    // Sessions are one window by definition, so Sessions mode shows a fixed tag, not a picker.
    await expect(pa.funnelWindowFixed).toBeVisible();
    await expect(pa.funnelWindowTrigger).toHaveCount(0);

    await pa.selectCountBy('users');
    for (const w of ['session', '1h', '1d']) {
      await pa.pickConversionWindow(w);
      await pa.expectFunnelCounts(usersApp.windows[w]);
      await expect.poll(() => pa.funnelFromUrl()?.w).toBe(w);
    }
  });

  test('the named-event editor rejects empty, over-long, duplicate and invalid-regex input without saving', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const suffix = facts.appId.slice(-4);
    const existing = await createViaApi(page, 'events', facts.appId, {
      name: `Checkout ${suffix}`,
      rules: [{ t: 'view', op: 'eq', value: facts.funnel.a }],
    });
    const rec = recordCreates(page);
    const w = recordWrites(page);
    try {
      await pa.goto('overview', { app: facts.appId, period: '7d' });
      await pa.openNewEventEditor();
      await pa.fillRuleValue(0, facts.funnel.a);
      await pa.expectEventSaveRejected('Name is required');

      await pa.eventNameField.fill('n'.repeat(81));
      await pa.expectEventSaveRejected('Use at most 80 characters');

      await pa.eventNameField.fill(`CHECKOUT ${suffix}`);
      await pa.expectEventSaveRejected('A named event with this name already exists');

      await pa.eventNameField.fill(`Regex ${suffix}`);
      await pa.setRuleOp(0, 'regex');
      await pa.fillRuleValue(0, '([');
      await pa.expectEventSaveRejected('Not a valid pattern');
      expect(w.writes.filter((x) => x.startsWith('POST 201')), 'no named event was created').toEqual([]);

      await pa.eventCancelBtn.click();
      await expect(pa.eventDiscardDialog).toBeVisible({ timeout: 20000 });
      await pa.eventDiscardConfirmBtn.click();
      await expect(pa.namedEventsList).toBeVisible({ timeout: 20000 });
      await expect(pa.namedEventNames().filter({ hasText: new RegExp(`checkout ${suffix}`, 'i') })).toHaveCount(1, { timeout: 20000 });
    } finally {
      w.stop();
      rec.stop();
      rec.created.events.add(existing.id);
      await cleanupAnalytics(page, facts.appId, rec.created);
    }
  });

  test('the named-event editor offers three page operators, previews matches, caps rules at 10 and asks before discarding', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const rec = recordCreates(page);
    const w = recordWrites(page);
    try {
      await pa.goto('overview', { app: facts.appId, period: '7d' });
      await pa.openNewEventEditor();
      expect(await pa.ruleOpOptionLabels(0)).toEqual(['Equals', 'Starts with', 'Matches regex']);
      await pa.setRuleOp(0, 'eq');
      await pa.fillRuleValue(0, facts.funnel.a);
      // s1..s6 view /web/a; no other seeded session does.
      await expect(pa.eventPreview).toHaveText('Matched 6 sessions in range', { timeout: 30000 });

      for (let i = 1; i < 10; i++) {
        await pa.addRuleBtn.click();
        await expect(pa.ruleRow(i)).toBeVisible();
      }
      await expect(pa.eventRules).toHaveCount(10);
      await expect(pa.addRuleBtn).toBeDisabled();

      await pa.eventCancelBtn.click();
      await expect(pa.eventDiscardDialog).toBeVisible({ timeout: 20000 });
      await expect(pa.eventDiscardDialog).toContainText('Discard changes?');
      await pa.eventDiscardConfirmBtn.click();
      await expect(pa.namedEventsList).toBeVisible({ timeout: 20000 });
      expect(w.writes, 'leaving the editor writes nothing').toEqual([]);
    } finally {
      w.stop();
      rec.stop();
      await cleanupAnalytics(page, facts.appId, rec.created);
    }
  });

  test('the save-funnel dialog rejects empty, over-long and case-duplicate names', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const suffix = facts.appId.slice(-4);
    const existing = await createViaApi(page, 'funnels', facts.appId, {
      name: `Flow ${suffix}`,
      def: { s: [['p', facts.funnel.a], ['c', facts.funnel.b]], u: 'sessions', w: 'session' },
      sql: 'SELECT 1 AS x_axis_1 FROM "_rumdata"',
    });
    const rec = recordCreates(page);
    const w = recordWrites(page);
    try {
      await pa.goto('funnels', { app: facts.appId, period: '7d', funnel: funnelParam([['p', facts.funnel.a], ['c', facts.funnel.b]]) });
      await pa.expectFunnelCounts([6, 3]);
      await expect(pa.funnelSavedName).toHaveText('Unsaved funnel');
      await pa.openSaveFunnelDialog();
      await pa.expectSaveFunnelRejected('', 'Name is required');
      await pa.expectSaveFunnelRejected('f'.repeat(81), 'Use at most 80 characters');
      await pa.expectSaveFunnelRejected(`FLOW ${suffix}`, 'A saved funnel with this name already exists');
      await pa.closeSaveFunnelDialog();
      expect(w.writes.filter((x) => x.startsWith('POST 201')), 'no saved funnel was created').toEqual([]);
      await expect(pa.funnelSavedName).toHaveText('Unsaved funnel');
    } finally {
      w.stop();
      rec.stop();
      rec.created.funnels.add(existing.id);
      await cleanupAnalytics(page, facts.appId, rec.created);
    }
  });

  test('Paths Previous from /web/a shows Session start as the only predecessor', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('paths', { app: facts.appId, period: '7d', anchor: encodeDef(['p', facts.funnel.a]), dir: 'prev', inc: 'pages' });
    await expect(pa.pathsDirection('prev')).toHaveAttribute('data-state', 'on', { timeout: 30000 });
    await expect(pa.pathsInclude('pages')).toHaveAttribute('data-state', 'on');
    await pa.expectFlowRendered();
    // No seeded session views another page before /web/a.
    await expect(pa.pathsTopRow(0)).toContainText('Session start', { timeout: 30000 });
    await expect(pa.pathsTopRow(0)).toContainText(facts.funnel.a);
    await expect(pa.topPathSessionsBtn(0)).toHaveText(/^6 sessions$/);
    await expect(pa.pathsTopRow(1)).toHaveCount(0);
  });

  test('Paths include toggles change which steps appear', {
    tag: PA_TAGS('@P1'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('paths', { app: facts.appId, period: '7d', anchor: encodeDef(['p', facts.funnel.a]) });
    await pa.expectFlowRendered();
    await expect(pa.pathsTopTable).toContainText(facts.funnel.b, { timeout: 30000 });

    await pa.setPathsInclude('pages');
    // One combined check, so a table that is empty while it reloads cannot satisfy the absence on its own.
    await expect.poll(async () => {
      const text = await pa.pathsTopText();
      return text.includes('/web/help') && !text.includes(facts.funnel.b);
    }, { timeout: 30000, message: 'Pages only lists /web/help and drops the b-btn click' }).toBe(true);

    // The include filter applies to the anchor too, so clicks-only paths start from a click.
    await pa.goto('paths', { app: facts.appId, period: '7d', anchor: encodeDef(['c', facts.funnel.b]) });
    await pa.setPathsInclude('clicks');
    await pa.expectFlowRendered();
    const pageKeys = [facts.funnel.a, facts.funnel.c, '/web/help'];
    await expect.poll(async () => {
      const text = await pa.pathsTopText();
      return text.includes(facts.funnel.b) && !pageKeys.some((k) => text.includes(k));
    }, { timeout: 30000, message: 'Clicks only lists the b-btn click and no page' }).toBe(true);
    await pa.expectNoPanelError('rum-analytics-paths');
  });

  test('Trends holds at most 5 series; a 6th trend button is disabled until one is removed, and Clear removes them all', {
    tag: PA_TAGS('@P2'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('overview', { app: facts.appId, period: '7d' });
    const keys = await pa.rankedKeys('pages');
    expect(keys.length, 'the seed ranks at least six pages').toBeGreaterThanOrEqual(6);
    for (let i = 0; i < 5; i++) {
      await pa.rowAction('pages', i, 'trend-btn');
      await expect(pa.trendSeries(i)).toBeVisible({ timeout: 30000 });
    }
    await expect(pa.rankedRow('pages', 5, 'trend-btn')).toBeDisabled();

    // The trend button toggles, so a second click on a trended row removes just that series.
    await pa.rowAction('pages', 0, 'trend-btn');
    await expect(pa.trendSeries(4)).toHaveCount(0, { timeout: 30000 });
    await expect(pa.trendSeries(3)).toBeVisible();
    await expect(pa.rankedRow('pages', 0, 'trend-btn')).toHaveAttribute('aria-pressed', 'false');
    await expect(pa.rankedRow('pages', 5, 'trend-btn')).toBeEnabled();
    await pa.rowAction('pages', 5, 'trend-btn');
    await expect(pa.trendSeries(4)).toBeVisible({ timeout: 30000 });
    await expect(pa.rankedRow('pages', 0, 'trend-btn')).toBeDisabled();

    await pa.trendsClearBtn.click();
    await expect(pa.trendSeries(0)).toHaveCount(0, { timeout: 30000 });
    await expect(pa.rankedRow('pages', 5, 'trend-btn')).toBeEnabled();
  });

  test('Alert me needs two steps, then opens a create-alert prefill on _rumdata for the app', {
    tag: PA_TAGS('@P2'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('funnels', { app: facts.appId, period: '7d', funnel: funnelParam([['p', facts.funnel.a]]) });
    await expect(pa.step(0)).toContainText(facts.funnel.a, { timeout: 30000 });
    await expect(pa.funnelAlertBtn).toBeDisabled();
    await expect(pa.funnelAlertBtn).toHaveAttribute('aria-label', 'Build a funnel of two or more steps to alert on it');

    await pa.goto('funnels', { app: facts.appId, period: '7d', funnel: funnelParam([['p', facts.funnel.a], ['c', facts.funnel.b]]) });
    await pa.expectFunnelCounts([6, 3]);
    await expect(pa.funnelAlertBtn).toBeEnabled({ timeout: 30000 });
    await pa.funnelAlertBtn.click();
    await expect(pa.alertDialog).toBeVisible({ timeout: 20000 });
    await expect(pa.alertQueryPreview).toContainText('_rumdata');
    await expect(pa.alertQueryPreview).toContainText(facts.appId);
  });

  test('Add to dashboard is disabled for breakdown and Users funnels', {
    tag: PA_TAGS('@P2'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const steps = [['p', facts.funnel.a], ['c', facts.funnel.b]];
    const reason = 'Dashboards support Sessions funnels without breakdown';
    await pa.goto('funnels', { app: facts.appId, period: '7d', funnel: funnelParam(steps, { b: 'browser' }) });
    await expect(pa.breakdown).toBeVisible({ timeout: 30000 });
    expect(pa.funnelFromUrl()?.b).toBe('browser');
    await expect(pa.funnelAddDashboardBtn).toBeDisabled();
    await expect(pa.funnelAddDashboardBtn).toHaveAttribute('aria-label', reason);

    await pa.goto('funnels', { app: facts.appId, period: '7d', funnel: funnelParam(steps, { u: 'users' }) });
    await expect(pa.countBy('users')).toHaveAttribute('data-state', 'on', { timeout: 30000 });
    await expect(pa.funnelAddDashboardBtn).toBeDisabled();
    await expect(pa.funnelAddDashboardBtn).toHaveAttribute('aria-label', reason);
  });

  test('a malformed link resets with a banner; a link naming a deleted event drops that step with a notice', {
    tag: PA_TAGS('@P2'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('funnels/build', { app: facts.appId, period: '7d', funnel: 'not-a-funnel' });
    await expect(pa.invalidLink).toBeVisible({ timeout: 30000 });
    await expect(pa.invalidLink).toContainText('Part of this link was invalid and was reset');
    await pa.invalidLinkDismiss.click();
    await expect(pa.invalidLink).toBeHidden();
    await expect(pa.funnelCold).toBeVisible({ timeout: 30000 });

    // A well-formed id that no named event has.
    const ghost = `e2eGhost${'0'.repeat(19)}`;
    await pa.goto('funnels/build', { app: facts.appId, period: '7d', funnel: funnelParam([['p', facts.funnel.a], ['e', ghost]]) });
    await expect(pa.deletedEventLink).toBeVisible({ timeout: 30000 });
    await expect(pa.step(0)).toContainText(facts.funnel.a);
    await pa.expectFunnelCounts([6]);
  });

  test('a failed suggestions query shows an error with Retry instead of hiding (ENT#2799 follow-up)', {
    tag: PA_TAGS('@P2'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    // Only the next-steps query has this tail (nextAfterSql with dropped = false).
    const NEXT_STEPS = /WHERE nty IS NOT NULL GROUP BY nty, nk/;
    const SEARCH = /\/api\/[^/]+\/_search(\?|$)/;
    let failing = true;
    const failNextSteps = (route) => (failing && NEXT_STEPS.test(sqlOf(route.request()))
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":500,"message":"e2e injected failure"}' })
      : route.fallback());
    await page.route(SEARCH, failNextSteps);
    try {
      await pa.goto('funnels', { app: facts.appId, period: '7d', funnel: funnelParam([['p', facts.funnel.a]]) });
      await expect(pa.funnelSuggestionsError).toBeVisible({ timeout: 30000 });
      await expect(pa.suggestion(facts.funnel.b)).toHaveCount(0);

      failing = false;
      await page.unroute(SEARCH, failNextSteps);
      await pa.funnelSuggestionsRetryBtn.click();
      await expect(pa.suggestion(facts.funnel.b).first()).toBeVisible({ timeout: 30000 });
      await expect(pa.funnelSuggestionsError).toHaveCount(0);
    } finally {
      failing = false;
      await page.unroute(SEARCH, failNextSteps).catch(() => {});
    }
  });

  test('Retention disables Per: day when the range spans more than 36 days', {
    tag: PA_TAGS('@P2'),
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('retention', { app: facts.appId, period: '60d' });
    await expect(pa.retention).toBeVisible({ timeout: 30000 });
    await pa.openRetentionGranularity();
    const day = pa.retentionGranularityOption('day');
    await expect(day).toHaveAttribute('data-disabled', '');
    await expect(day).toHaveAttribute('data-test-label', /more than 36 periods/);
    const week = pa.retentionGranularityOption('week');
    await expect(week).not.toHaveAttribute('data-disabled', '');
    await week.click();
    await expect(pa.retentionGranularityTrigger).toHaveAttribute('data-test-selected-value', 'week');
    await expect.poll(() => pa.query().get('per')).toBe('week');
  });

  test.describe('open defects (do not assert current behaviour)', () => {
    // These fixmes track o2-enterprise#2809; un-fixme each one when its item closes.
    test.fixme('o2-enterprise#2809 (M1): the date picker label follows the URL range after a reload', {
      tag: PA_TAGS('@P2'),
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      await pa.goto('overview', { app: facts.appId, period: '2d' });
      await page.reload();
      await expect(pa.root).toBeVisible({ timeout: 30000 });
      expect(pa.query().get('period')).toBe('2d');
      await expect(pa.datePicker).toContainText(/2 Days/i, { timeout: 30000 });
      await expect(pa.datePicker).not.toContainText(/7 Days/i);
    });

    test.fixme('o2-enterprise#2809 (M2): the Sessions KPI excludes the synthetic sessions the strip says it excludes', {
      tag: PA_TAGS('@P2'),
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const mix = await seedBuilt(page, buildSyntheticMixSeed(`${facts.appId}-syn`, Date.now()));
      await pa.goto('overview', { app: mix.appId, period: '7d' });
      await expect(pa.syntheticExcluded).toContainText(String(mix.synthetic), { timeout: 30000 });
      await expect(pa.kpiSessions).toContainText(new RegExp(`\\b${mix.real}\\b`), { timeout: 30000 });
      await expect(pa.kpiSessions).not.toContainText(new RegExp(`\\b${mix.real + mix.synthetic}\\b`));
    });

    test.fixme('o2-enterprise#2809 (M3): retention data-start follows current data, so the earliest cohort shows without a stats pin', {
      tag: PA_TAGS('@P2'),
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      await pa.goto('retention', { app: facts.appId, from: facts.retentionFromMs * 1000, to: NOW * 1000, per: 'week' });
      await expect(pa.retentionCell(0, 0)).toBeVisible({ timeout: 45000 });
      expect(await pa.retentionPct(0, 0)).toBe(100);
      expect(await pa.retentionPct(0, 1)).toBe(50);
    });

    test.fixme('o2-enterprise#2809 (M4): View in Sessions without a _sessionreplay stream opens the Sessions list', {
      tag: PA_TAGS('@P2'),
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const { identifier: org } = await ensureRumStateOrg(page, 'pa_noreplay');
      const now = Date.now();
      const seed = await seedBuilt(page, buildUsersModeSeed(runAppId('pa-noreplay'), now), { nowMs: now, orgId: org });
      await pa.goto('retention', { app: seed.appId, period: '7d' }, { org });
      await expect(pa.retentionCell(0, 0)).toBeVisible({ timeout: 45000 });
      await pa.retentionCell(0, 0).click();
      await expect(pa.retentionUser0).toBeVisible({ timeout: 30000 });
      await pa.retentionUser0SessionsBtn.click();
      await expect(page).toHaveURL(/\/rum\/sessions(\?|$)/, { timeout: 30000 });
      await expect(pa.sessionsTable).toBeVisible({ timeout: 30000 });
    });

    test.fixme('o2-enterprise#2809 (M5): KPIs never flash "No user id set" while an app with users loads', {
      tag: PA_TAGS('@P2'),
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      await pa.watchKpiText('No user id set');
      await pa.goto('overview', { app: facts.appId, period: '7d' });
      await expect(pa.rankedRow('pages', 0, 'key')).toBeVisible({ timeout: 30000 });
      await pa.waitForNetworkQuiet();
      expect(await pa.kpiTextSeen(), 'the KPI strip showed the no-identity placeholder').toBe(false);
    });

    test.fixme('o2-enterprise#2809 (m1): drop-off durations carry no floating-point noise', {
      tag: PA_TAGS('@P2'),
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      await pa.goto('funnels', {
        app: facts.appId,
        period: '7d',
        funnel: funnelParam([['p', facts.funnel.a], ['c', facts.funnel.b], ['p', facts.funnel.c]]),
      });
      await pa.expectFunnelCounts([6, 3, 1]);
      await pa.openDropoff(0);
      await expect(pa.dropoffSessionsCap).toContainText('3', { timeout: 30000 });
      await expect(pa.dropoffDrawer).not.toContainText(/\d\.\d{4,}s/);
    });

    /** A saved funnel whose first step is a named event deleted with force. */
    async function funnelWithDeletedEvent(page, suffix) {
      const ev = await createViaApi(page, 'events', facts.appId, {
        name: `Gone ${suffix}`,
        rules: [{ t: 'view', op: 'eq', value: facts.funnel.a }],
      });
      const funnel = await createViaApi(page, 'funnels', facts.appId, {
        name: `Uses gone ${suffix}`,
        def: { s: [['e', ev.id], ['c', facts.funnel.b]], u: 'sessions', w: 'session' },
        sql: 'SELECT 1 AS x_axis_1 FROM "_rumdata"',
      });
      const { headers } = apiContext();
      const del = await page.request.delete(analyticsUrl('events', facts.appId, ev.id, '&force=true'), { headers });
      expect(del.status()).toBe(204);
      return { ev, funnel };
    }

    test.fixme('o2-enterprise#2809 (m2): a deleted-event step reads Deleted event, never the raw id', {
      tag: PA_TAGS('@P2'),
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const { ev, funnel } = await funnelWithDeletedEvent(page, `${facts.appId.slice(-4)}m2`);
      try {
        await pa.goto('funnels', { app: facts.appId, period: '7d', sf: funnel.id });
        await expect(pa.step(0)).toContainText('Deleted event', { timeout: 30000 });
        await expect(pa.step(0)).not.toContainText(ev.id);
      } finally {
        await cleanupAnalytics(page, facts.appId, { events: new Set(), funnels: new Set([funnel.id]) });
      }
    });

    test.fixme('o2-enterprise#2809 (m3): the Save tooltip on a deleted-event funnel names the deleted step', {
      tag: PA_TAGS('@P2'),
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const { funnel } = await funnelWithDeletedEvent(page, `${facts.appId.slice(-4)}m3`);
      try {
        await pa.goto('funnels', { app: facts.appId, period: '7d', sf: funnel.id });
        await expect(pa.funnelSavedName).toHaveText(funnel.name, { timeout: 30000 });
        const tip = await pa.saveBtnTooltip();
        await expect(tip).toContainText('Remove the deleted event step first');
        await expect(tip).not.toContainText('No changes to save');
      } finally {
        await cleanupAnalytics(page, facts.appId, { events: new Set(), funnels: new Set([funnel.id]) });
      }
    });
  });
});
