const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { getAuthHeaders } = require('../../utils/cloud-auth.js');
const {
  MICROS,
  HOUR_MICROS,
  DAY_MICROS,
  baseUrl,
  orgId,
  uniqueName,
  isOnCallAvailable,
  createTeam,
  addTeamMembers,
  rotation,
  setTeamSchedule,
  detachPolicyFromRotations,
  seedOnCallStream,
  seedNotificationDestination,
  createPagingAlert,
  triggerAlertOrLetSchedulerFire,
  waitForPages,
  getRoutingConfig,
  deleteTeamById,
} = require('../../utils/oncall-seed.js');
const {
  createOrgUser,
  deleteOrgUser,
  oncallUserEmail,
  resolveResponse,
} = require('../../utils/oncall-seed-ext.js');

const ROOT_EMAIL = String(process.env.ZO_ROOT_USER_EMAIL || '').toLowerCase();
const OVERRIDES_PATH = /\/oncall\/teams\/[^/]+\/overrides(\?|$)/;
const UNROUTED_HINT = '[data-test="oncall-section-hint-unrouted"]';
const ROUTED_HINT = '[data-test="oncall-section-hint-routed"]';
const RINGING_HEADER = '[data-test="oncall-section-header-ringing"]';
const SELECT_CHECKBOX = '[data-test="o2-table-select-cell"] [aria-label]';

test.describe.configure({ mode: 'serial' });

test.describe('On-call P2 fixes (o2-enterprise#3160)', {
  tag: ['@oncall', '@enterprise', '@regression', '@alertsRegression'],
}, () => {
  let pm;
  const gate = { available: false, reason: '' };
  const made = { alerts: [], pages: [], team: null, user: null, stream: null, destination: null, tag: '' };
  let seededPages = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      Object.assign(gate, await isOnCallAvailable(page));
      if (!gate.available || !ROOT_EMAIL) return;

      made.tag = uniqueName(`e2e_ent3160_w${testInfo.workerIndex}`);
      const user = oncallUserEmail(made.tag, 'peer');
      await createOrgUser(page, { email: user });
      made.user = user;
      made.team = await createTeam(page, { name: `${made.tag}_team` });
      await addTeamMembers(page, made.team.id, [ROOT_EMAIL, user]);
      // Adding members provisions a ladder naming their default rotations, which would refuse the schedule replace.
      await detachPolicyFromRotations(page, made.team.id);

      // The peer's rotation comes first so a countdown read off rotations[0] would name the wrong shift.
      const now = Date.now() * 1000;
      await setTeamSchedule(page, made.team.id, {
        rotations: [
          rotation({ id: 'peer', name: 'Peer shift', members: [user], shiftMicros: DAY_MICROS, anchorMicros: now - HOUR_MICROS }),
          rotation({ id: 'mine', name: 'Root shift', members: [ROOT_EMAIL], shiftMicros: HOUR_MICROS, anchorMicros: now - 50 * 60 * MICROS }),
        ],
      });
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!gate.available, `On-call is not testable here — ${gate.reason}`);
    test.skip(!made.team, 'ZO_ROOT_USER_EMAIL is unset, so the viewer cannot be put on a rotation');
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const headers = getAuthHeaders();
    const tryDelete = (url) => page.request.delete(url, { headers }).catch(() => null);
    const v1 = `${baseUrl()}/api/${orgId()}`;
    for (const id of made.pages) await resolveResponse(page, id).catch(() => null);
    for (const id of made.alerts) await tryDelete(`${baseUrl()}/api/v2/${orgId()}/alerts/${id}?folder=default`);
    if (made.team) await deleteTeamById(page, made.team.id);
    if (made.destination) {
      await tryDelete(`${v1}/alerts/destinations/${made.destination}`);
      await tryDelete(`${v1}/alerts/templates/${made.tag}_tmpl`);
    }
    if (made.stream) await tryDelete(`${v1}/streams/${made.stream}?type=logs`);
    // The self-ingest destination writes its deliveries into a sink stream of its own.
    if (made.destination) await tryDelete(`${v1}/streams/${made.tag}_sink?type=logs`);
    if (made.user) await deleteOrgUser(page, made.user);
    await context.close();
  });

  /** Two pages on the team at one priority, plus one page no team claims; seeded once for the tests that need pages. */
  async function ensurePages(page) {
    if (seededPages) return seededPages;
    const service = `${made.tag}_svc`;
    made.stream = `${made.tag}_stream`;
    await seedOnCallStream(page, made.stream, { services: [service] });
    made.destination = await seedNotificationDestination(page, made.tag);

    const specs = [
      { key: 'alpha', teamId: made.team.id },
      { key: 'bravo', teamId: made.team.id },
      { key: 'teamless', teamId: undefined },
    ];
    const alerts = [];
    for (const spec of specs) {
      const alert = await createPagingAlert(page, {
        name: `${made.tag}_${spec.key}`,
        stream: made.stream,
        teamId: spec.teamId,
        priority: 1,
        destinations: [made.destination],
      });
      made.alerts.push(alert.id);
      alerts.push({ ...spec, alert });
      await triggerAlertOrLetSchedulerFire(page, alert.id);
    }
    seededPages = {};
    for (const { key, teamId, alert } of alerts) {
      const [record] = await waitForPages(page, { alertId: alert.id, teamId });
      made.pages.push(record.id);
      seededPages[key] = { name: alert.name, record };
    }
    return seededPages;
  }

  test('opening a team schedule never asks for overrides with an unset window', {
    tag: ['@bug-ent3160', '@P2'],
  }, async ({ page }) => {
    const calls = [];
    page.on('response', (res) => {
      const url = new URL(res.url());
      if (OVERRIDES_PATH.test(url.pathname + url.search)) {
        calls.push({ from: url.searchParams.get('from'), to: url.searchParams.get('to'), status: res.status() });
      }
    });

    await pm.oncallTeamDetailPage.goto(orgId(), made.team.id, 'schedule');
    await expect(page.locator('[data-test="oncall-schedule-timeline"]').first()).toBeVisible({ timeout: 30000 });
    await expect.poll(() => calls.length, { message: 'the cover list reads its overrides', timeout: 20000 }).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle').catch(() => {});
    testLogger.info('overrides calls', { calls });

    expect(calls.filter((c) => c.from === '0' || c.to === '0'), 'no overrides read with from=0 / to=0').toEqual([]);
    expect(calls.filter((c) => c.status >= 400), 'every overrides read succeeds').toEqual([]);
  });

  test('the "you are on call" countdown follows the rotation the viewer holds', {
    tag: ['@bug-ent3160', '@P2'],
  }, async ({ page }) => {
    await pm.oncallPagesListPage.goto(orgId());
    const banner = page.locator('[data-test="oncall-shift-banner"]');
    await expect(banner).toBeVisible({ timeout: 30000 });
    await expect(banner.locator('[data-test="oncall-shift-banner-team"]')).toContainText(made.team.name, { timeout: 30000 });

    const handover = (await banner.locator('[data-test="oncall-shift-banner-handover"]').innerText()).trim();
    testLogger.info('handover countdown', { handover });
    // The viewer's shift is an hour long; the peer's day-long shift is ~23h from handing over.
    expect(handover, 'the countdown is under an hour, not the peer rotation\'s day').not.toMatch(/\d+\s*[hd]\b/);
    expect(handover).toMatch(/\d+\s*[ms]\b/);
  });

  test('pages sharing a priority get distinct row checkbox labels', {
    tag: ['@bug-ent3160', '@P2'],
  }, async ({ page }) => {
    test.setTimeout(420_000);
    const pages = await ensurePages(page);

    await pm.oncallPagesListPage.goto(orgId());
    await pm.oncallPagesListPage.expectListVisible();
    await pm.oncallPagesListPage.search(`${made.tag}_`);
    const rows = page.locator('[data-test^="o2-table-row-"]');
    await expect(rows.filter({ hasText: pages.alpha.name })).toHaveCount(1, { timeout: 30000 });
    await expect(rows.filter({ hasText: pages.bravo.name })).toHaveCount(1);

    const alphaLabel = await rows.filter({ hasText: pages.alpha.name }).locator(SELECT_CHECKBOX).first().getAttribute('aria-label');
    const bravoLabel = await rows.filter({ hasText: pages.bravo.name }).locator(SELECT_CHECKBOX).first().getAttribute('aria-label');
    testLogger.info('row checkbox labels', { alphaLabel, bravoLabel });

    expect(alphaLabel, 'the label carries the row position and its title').toMatch(/^Select row \d+, /);
    expect(alphaLabel).toContain(pages.alpha.name);
    expect(bravoLabel).toMatch(/^Select row \d+, /);
    expect(bravoLabel).toContain(pages.bravo.name);
    expect(alphaLabel).not.toBe(bravoLabel);
  });

  test('Ringing says when a ringing page has no team and so is not paging', {
    tag: ['@bug-ent3160', '@P2'],
  }, async ({ page }) => {
    test.setTimeout(420_000);
    const routing = await getRoutingConfig(page);
    test.skip(Boolean(routing?.default_team_id), 'this org routes everything to a catch-all team, so no page can be teamless');
    const pages = await ensurePages(page);
    expect(pages.teamless.record.team_id ?? null, 'precondition: nothing claimed the teamless page').toBeFalsy();

    await pm.oncallPagesListPage.goto(orgId());
    await pm.oncallPagesListPage.expectListVisible();
    await pm.oncallPagesListPage.search(`${made.tag}_`);
    const hint = page.locator(UNROUTED_HINT);
    await expect(hint).toBeVisible({ timeout: 30000 });
    await expect(hint).toContainText(/no team, so (it is|they are) not paging/);
    const header = page.locator(RINGING_HEADER);
    await expect(header.locator(ROUTED_HINT), 'routed pages are still paging alongside the teamless one').toContainText(/of these (is|are) still paging/);
    await expect(header, 'the header must not claim every ringing page is paging').not.toContainText('nobody has acknowledged — these are still paging');
  });
});
