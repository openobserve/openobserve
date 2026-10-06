// Each describe owns a fresh org whose _rumdata schema differs from a full one in exactly one optional field (ENT#2798-2801).

const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { encodeDef } = require('../../../pages/rumPages/rumProductAnalyticsPage.js');
const {
  createRumStateOrg,
  rumSchemaFields,
  seedBuilt,
  ensureSessionReplayStream,
  buildFunnelSessions,
  buildMobileScreensSeed,
  buildViewsTwoPageSeed,
  runAppId,
  DAY_MS,
  HOUR_MS,
} = require('../../utils/rum-analytics-ingestion.js');

const TAGS = ['@rum', '@rumAnalytics', '@rum-product-analytics', '@regression', '@P0', '@all'];
const SEARCH_URL = /\/api\/[^/]+\/_search(\?|$)/;
// The app probe of an org that never ingested RUM answers 400 "stream not found" (code 20002) by design; the shell handles it.
const STREAM_NOT_FOUND = /"code":\s*20002|Search stream not found/;

const funnelParam = (steps, extra = {}) => encodeDef({ s: steps, u: 'sessions', w: 'session', ...extra });

const sqlOf = (request) => {
  try {
    const body = JSON.parse(request.postData() || '{}');
    const sql = body.query?.sql || '';
    return body.encoding === 'base64' ? Buffer.from(sql, 'base64').toString('utf8') : sql;
  } catch {
    return '';
  }
};

/** Records every `_search` answered with HTTP 400 (SQL + message) and the SQL of every 200; attach before the first goto. */
function watchSearch400(page) {
  const bad = [];
  const ok = [];
  const reads = [];
  let pending = 0;
  const onRequest = (r) => {
    if (SEARCH_URL.test(r.url())) pending++;
  };
  const onDone = (r) => {
    if (SEARCH_URL.test(r.url())) pending = Math.max(0, pending - 1);
  };
  const onResponse = (r) => {
    if (!SEARCH_URL.test(r.url())) return;
    if (r.status() === 200) ok.push(sqlOf(r.request()));
    if (r.status() !== 400) return;
    const entry = { sql: sqlOf(r.request()).slice(0, 600), message: '' };
    bad.push(entry);
    reads.push(r.text().then((t) => { entry.message = t.slice(0, 300); }).catch(() => {}));
  };
  page.on('request', onRequest);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);
  page.on('response', onResponse);
  return {
    bad,
    ok,
    // A search still in flight could answer 400 after the check, so wait for every one to finish first.
    settled: async () => {
      await expect.poll(() => pending, { timeout: 60000, message: '_search requests still in flight' }).toBe(0);
      await Promise.all(reads);
    },
    stop: () => {
      page.off('request', onRequest);
      page.off('requestfinished', onDone);
      page.off('requestfailed', onDone);
      page.off('response', onResponse);
    },
  };
}

const describe400 = (bad) => bad.map((b) => `${b.message}\n${b.sql}`).join('\n---\n');

async function expectNo400(w) {
  await w.settled();
  expect(w.bad, describe400(w.bad)).toEqual([]);
}

/** Creates the org, ingests each seed into it and checks the schema is in the state the describe needs. */
async function prepareStateOrg(browser, prefix, seeds, { has = [], lacks = [], extra = null } = {}) {
  const page = await browser.newPage();
  try {
    const { identifier } = await createRumStateOrg(page, prefix);
    const nowMs = Date.now();
    const facts = [];
    for (const build of seeds) facts.push(await seedBuilt(page, build(nowMs), { nowMs, orgId: identifier }));
    if (extra) await extra(page, identifier, facts, nowMs);
    const fields = await rumSchemaFields(page, identifier);
    if (seeds.length) {
      expect(fields, `setup defect: ${identifier} has no _rumdata schema`).not.toBeNull();
      for (const f of has) expect(fields.has(f), `setup defect: ${identifier} schema lacks ${f}`).toBe(true);
      for (const f of lacks) expect(fields.has(f), `setup defect: ${identifier} schema has ${f}`).toBe(false);
    } else {
      expect(fields, `setup defect: ${identifier} already has a _rumdata stream`).toBeNull();
    }
    testLogger.info('State org ready', { prefix, org: identifier, apps: facts.map((f) => f.appId) });
    return { org: identifier, facts, nowMs };
  } finally {
    await page.close();
  }
}

test.describe('RUM Product Analytics schema-state regressions', () => {
  test.describe.configure({ mode: 'default' });
  test.use({ timezoneId: 'UTC' });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test.describe('view_name in the org schema (ENT#2798)', () => {
    let state = null;
    let web = null;
    let mob = null;

    test.beforeAll(async ({ browser }) => {
      state = await prepareStateOrg(browser, 'pa_vn', [
        (now) => buildFunnelSessions(runAppId('pa-vn-web'), now),
        (now) => buildMobileScreensSeed(runAppId('pa-vn-mob'), now),
      ], { has: ['view_name', 'session_has_replay', 'action_target_name', 'geo_info_country'] });
      [web, mob] = state.facts;
    });

    test('a web app in an org with view_name loads Pages, Entry/Exit, the funnel and the quick starts (ENT#2798)', {
      tag: TAGS,
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const w = watchSearch400(page);
      try {
        await pa.goto('overview', { app: web.appId, period: '7d' }, { org: state.org });
        const keys = await pa.rankedKeys('pages');
        for (const k of [web.funnel.a, web.funnel.c, '/web/help']) expect(keys, `pages list ${k}`).toContain(k);
        await pa.expectRankedSessions('pages', web.funnel.a, 6);
        await pa.showPagesView('entry');
        await pa.expectTopRankedRow('pages', web.funnel.a, 6);
        await pa.showPagesView('exit');
        await pa.expectTopRankedRow('pages', web.exit.key, web.exit.sessions);
        await pa.expectNoPanelError('rum-analytics-overview-pages');

        await pa.goto('funnels', {
          app: web.appId,
          period: '7d',
          funnel: funnelParam([['p', web.funnel.a], ['c', web.funnel.b], ['p', web.funnel.c]]),
        }, { org: state.org });
        await pa.expectFunnelCounts(web.funnel.counts);
        await pa.expectNoPanelError('rum-analytics-funnel');

        await pa.goto('funnels/build', { app: web.appId, period: '7d' }, { org: state.org });
        await expect(pa.funnelCold).toBeVisible({ timeout: 30000 });
        await expect(pa.funnelEntryStart0).toContainText(web.funnel.a, { timeout: 30000 });
        await expect(pa.funnelEntriesFailed).toHaveCount(0);
        await pa.waitForNetworkQuiet();
        await expectNo400(w);
      } finally {
        w.stop();
      }
    });

    test('a mobile app ranks screens by view_name and funnels and paths over them (ENT#2798)', {
      tag: TAGS,
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const { home, product, cart } = mob.screens;
      const w = watchSearch400(page);
      try {
        await pa.goto('overview', { app: mob.appId, period: '7d' }, { org: state.org });
        const keys = await pa.rankedKeys('pages');
        for (const k of [home, product, cart]) expect(keys, `pages list ${k}`).toContain(k);
        for (const k of keys) expect(k, 'every screen has a key').not.toMatch(/^$|^\(not set\)$/);
        await pa.expectRankedSessions('pages', product, mob.pages[product]);
        await pa.showPagesView('entry');
        await pa.expectTopRankedRow('pages', mob.entry.key, mob.entry.sessions);
        await pa.showPagesView('exit');
        await pa.expectTopRankedRow('pages', mob.exit.key, mob.exit.sessions);
        await pa.expectNoPanelError('rum-analytics-overview-pages');

        await pa.goto('funnels', {
          app: mob.appId,
          period: '7d',
          funnel: funnelParam([['p', home], ['p', product], ['p', cart]]),
        }, { org: state.org });
        await pa.expectFunnelCounts(mob.funnel);

        await pa.goto('paths', { app: mob.appId, period: '7d', anchor: encodeDef(['p', home]) }, { org: state.org });
        await pa.expectFlowRendered();
        await expect(pa.pathsTopRow(0)).toContainText(product, { timeout: 30000 });
        await pa.expectNoPanelError('rum-analytics-paths');
        await pa.waitForNetworkQuiet();
        await expectNo400(w);
      } finally {
        w.stop();
      }
    });
  });

  test.describe('no session_has_replay in the org schema (ENT#2799)', () => {
    let state = null;
    let app = null;

    test.beforeAll(async ({ browser }) => {
      state = await prepareStateOrg(browser, 'pa_norep', [
        (now) => buildFunnelSessions(runAppId('pa-norep'), now, { replay: false }),
      ], { has: ['action_target_name', 'geo_info_country'], lacks: ['session_has_replay'] });
      [app] = state.facts;
    });

    test('suggestions and all three drop-off sections load without session_has_replay (ENT#2799)', {
      tag: TAGS,
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const w = watchSearch400(page);
      try {
        await pa.goto('funnels', { app: app.appId, period: '7d', funnel: funnelParam([['p', app.funnel.a]]) }, { org: state.org });
        await expect(pa.suggestion(app.funnel.b).first()).toBeVisible({ timeout: 30000 });
        await expect(pa.funnelSuggestionsError).toHaveCount(0);
        await pa.suggestion(app.funnel.b).first().click();
        await pa.expectFunnelCounts([6, 3]);

        await pa.goto('funnels', {
          app: app.appId,
          period: '7d',
          funnel: funnelParam([['p', app.funnel.a], ['c', app.funnel.b], ['p', app.funnel.c]]),
        }, { org: state.org });
        await pa.expectFunnelCounts(app.funnel.counts);
        await pa.openDropoff(0);
        await expect(pa.dropoffDrawer).toContainText('3 sessions dropped after step 1');
        await expect(pa.dropoffNextRow0).toContainText('Left the app', { timeout: 30000 });
        // Dropped s3, s5, s6: only s6 errors; converted s1, s2, s4: only s2 errors.
        await expect(pa.dropoffErrorDropped).toContainText('33', { timeout: 30000 });
        await expect(pa.dropoffErrorConverted).toContainText('33');
        await expect(pa.dropoffSessionsCap).toContainText('All 3 sessions listed', { timeout: 30000 });
        for (let i = 0; i < 3; i++) await expect(pa.dropoffSessionReplayTag(i)).toContainText('No replay');
        await pa.expectNoPanelError('rum-analytics-dropoff-next', 'rum-analytics-dropoff-health', 'rum-analytics-dropoff-sessions-panel');
        await pa.waitForNetworkQuiet();
        await expectNo400(w);
      } finally {
        w.stop();
      }
    });

    test('Paths and the branch drawer load without session_has_replay (ENT#2799)', {
      tag: TAGS,
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const w = watchSearch400(page);
      try {
        await pa.goto('paths', { app: app.appId, period: '7d', anchor: encodeDef(['p', app.funnel.a]) }, { org: state.org });
        await pa.expectFlowRendered();
        await expect(pa.pathsTopRow(0)).toBeVisible({ timeout: 30000 });
        await pa.expectNoPanelError('rum-analytics-paths');

        await expect(pa.topPathSessionsBtn(0)).toHaveText(/^[\d,]+ sessions?$/, { timeout: 30000 });
        const label = await pa.topPathSessionsBtn(0).innerText();
        const n = Number(label.replace(/[^\d]/g, ''));
        expect(n, `top path count from "${label}"`).toBeGreaterThan(0);
        testLogger.info('Top path branch total', { n });
        await pa.topPathSessionsBtn(0).click();
        await expect(pa.branchDrawer).toBeVisible();
        await expect(pa.branchSessionRow0Open).toBeVisible({ timeout: 30000 });
        await expect(pa.branchSessionsCap).toContainText(String(n));
        await expect(pa.branchSessionReplayTag(0)).toContainText('No replay');
        await pa.expectNoPanelError('rum-analytics-paths-branch');
        await pa.waitForNetworkQuiet();
        await expectNo400(w);
      } finally {
        w.stop();
      }
    });
  });

  test.describe('RUM Sessions list with _sessionreplay but no session_has_replay (ENT#2799, #15107)', () => {
    let state = null;

    test.beforeAll(async ({ browser }) => {
      state = await prepareStateOrg(browser, 'pa_srnorep', [
        (now) => buildFunnelSessions(runAppId('pa-srnorep'), now, { replay: false }),
      ], {
        lacks: ['session_has_replay'],
        extra: (page, org, facts, now) => ensureSessionReplayStream(page, facts[0].appId, now, { orgId: org }),
      });
    });

    test('the Sessions list renders its empty list instead of failing on session_has_replay (ENT#2799)', {
      tag: TAGS,
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const w = watchSearch400(page);
      try {
        await pa.gotoRumSessions({ org: state.org, from: (state.nowMs - DAY_MS) * 1000, to: (Date.now() + HOUR_MS) * 1000 });
        await expect(pa.sessionsTable).toBeVisible({ timeout: 45000 });
        // No session can have a replay without the field, so the list is empty by design (the 1 = 0 filter).
        await expect(pa.sessionsNoData).toBeVisible({ timeout: 45000 });
        await pa.waitForNetworkQuiet();
        await pa.expectPageNotToContain(/unknown field/i);
        await expect(pa.toasts.filter({ hasText: 'session_has_replay' })).toHaveCount(0);
        await w.settled();
        expect(w.ok.some((sql) => /FROM "_rumdata"[\s\S]*GROUP BY session_id/.test(sql)), 'the Sessions list query ran and answered 200').toBe(true);
        await expectNo400(w);
      } finally {
        w.stop();
      }
    });
  });

  test.describe('no action_target_name in the org schema (ENT#2800)', () => {
    let state = null;
    let app = null;

    test.beforeAll(async ({ browser }) => {
      state = await prepareStateOrg(browser, 'pa_noclk', [
        (now) => buildViewsTwoPageSeed(runAppId('pa-noclk'), now),
      ], { has: ['session_has_replay', 'geo_info_country'], lacks: ['action_target_name'] });
      [app] = state.facts;
    });

    test('Overview says clicks are not captured while Pages still rank (ENT#2800)', {
      tag: TAGS,
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const w = watchSearch400(page);
      try {
        await pa.goto('overview', { app: app.appId, period: '7d' }, { org: state.org });
        await expect(pa.clicksNotCaptured).toBeVisible({ timeout: 30000 });
        await expect(pa.clicksNotCaptured).toContainText('Click tracking is not captured');
        await pa.expectTopRankedRow('pages', app.landing, app.landingSessions);
        await pa.expectNoPanelError('rum-analytics-overview-clicks', 'rum-analytics-overview-pages');
        await pa.waitForNetworkQuiet();
        await expectNo400(w);
      } finally {
        w.stop();
      }
    });

    test('Paths all and pages render, clicks-only is an empty state, and From lists pages (ENT#2800)', {
      tag: TAGS,
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const w = watchSearch400(page);
      try {
        await pa.goto('paths', { app: app.appId, period: '7d', anchor: encodeDef(['p', app.landing]) }, { org: state.org });
        await pa.expectFlowRendered();
        await expect(pa.pathsTopTable).toContainText('/web/pricing', { timeout: 30000 });
        await pa.expectNoPanelError('rum-analytics-paths');

        await pa.setPathsInclude('pages');
        await pa.expectFlowRendered();
        for (const next of app.next) await expect(pa.pathsTopTable).toContainText(next, { timeout: 30000 });

        await pa.setPathsInclude('clicks');
        await expect(pa.pathsEmpty).toBeVisible({ timeout: 30000 });
        await expect(pa.pathsEmpty).toContainText('No sessions reached');
        await expect(pa.pathsEmpty).toContainText('in this range');
        await pa.expectNoPanelError('rum-analytics-paths');

        const options = await pa.pathsAnchorOptionLabels();
        for (const key of [app.landing, '/web/pricing']) expect(options, `From picker lists ${key}`).toContain(key);
        await pa.waitForNetworkQuiet();
        await expectNo400(w);
      } finally {
        w.stop();
      }
    });
  });

  test.describe('no geo_info_country in the org schema (ENT#2801)', () => {
    let state = null;
    let app = null;

    test.beforeAll(async ({ browser }) => {
      state = await prepareStateOrg(browser, 'pa_nogeo', [
        (now) => buildFunnelSessions(runAppId('pa-nogeo'), now, { omit: ['geo_info_country'] }),
      ], { has: ['session_has_replay', 'action_target_name'], lacks: ['geo_info_country'] });
      [app] = state.facts;
    });

    test('a country breakdown link computes the plain funnel without geo_info_country (ENT#2801)', {
      tag: TAGS,
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const w = watchSearch400(page);
      try {
        await pa.goto('funnels', {
          app: app.appId,
          period: '7d',
          funnel: funnelParam([['p', app.funnel.a], ['c', app.funnel.b], ['p', app.funnel.c]], { b: 'country' }),
        }, { org: state.org });
        await pa.expectFunnelCounts(app.funnel.counts);
        await pa.expectNoPanelError('rum-analytics-funnel');
        await pa.waitForNetworkQuiet();
        await expectNo400(w);
      } finally {
        w.stop();
      }
    });
  });

  test.describe('an org that never ingested RUM', () => {
    let state = null;

    test.beforeAll(async ({ browser }) => {
      state = await prepareStateOrg(browser, 'pa_empty', []);
    });

    test('shows the RUM onboarding state, not empty panels', {
      tag: ['@rum', '@rumAnalytics', '@rum-product-analytics', '@P1', '@all'],
    }, async ({ page }) => {
      const pa = new PageManager(page).rumProductAnalyticsPage;
      const w = watchSearch400(page);
      try {
        await pa.goto('overview', { period: '7d' }, { org: state.org });
        await expect(pa.noData).toBeVisible({ timeout: 30000 });
        await expect(pa.noData).toContainText('Monitor your users with Real User Monitoring');
        await expect(pa.emptyWebCard).toBeVisible();
        await expect(pa.emptySessionCard).toBeVisible();
        await expect(pa.overview).toHaveCount(0);
        await pa.waitForNetworkQuiet();
        await w.settled();
        const unexpected = w.bad.filter((b) => !STREAM_NOT_FOUND.test(b.message));
        expect(unexpected, describe400(unexpected)).toEqual([]);
      } finally {
        w.stop();
      }
    });
  });
});
