// Copyright 2026 OpenObserve Inc.

// Downtimes — the org-wide banner (plan Spec 8, DT-B-01..04); expected text comes from GET /api/{org}/announcements.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');

const PREFIX = 'e2e_dt_banner';
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const gate = { available: false, reason: 'gate not probed', config: {} };
const shared = { stream: null, dest: null };

// Serial by the approved plan: banners are org-wide, so parallel banner tests would rewrite each other's combined message.
test.describe.configure({ mode: 'serial' });

test.describe('Downtime org banner', { tag: ['@downtimes', '@enterprise', '@all'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      Object.assign(gate, await dt.isDowntimesAvailable(page));
      if (!gate.available) return;
      const wp = workerPrefix(testInfo);
      await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
      const run = dt.uniqueName('r').slice(-8);
      shared.stream = `${wp}_${run}_stream`;
      await dt.seedStream(page, shared.stream, { minutes: 5, services: [`svc-ban-${run}`] });
      shared.dest = (await dt.seedSinkDestination(page, `${wp}_${run}`)).destination;
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    reg = null;
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!gate.available, `Downtimes are not testable here — ${gate.reason}`);
    reg = { prefix: dt.uniqueName(workerPrefix(testInfo)), alerts: [], folders: [] };
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.downtimesPage.clearDismissedBanners();
  });

  test.afterEach(async ({ page }) => {
    if (!reg) return;
    await dt.cleanupDowntimes(page, { prefix: reg.prefix, folderIds: reg.folders });
    await dt.deleteAlertsAndFolders(page, reg.alerts);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    if (!gate.available) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    const wp = workerPrefix(testInfo);
    await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
    await dt.deleteDestinationsByPrefix(page, `${wp}_`);
    await context.close();
  });

  async function folderAndAlert(page) {
    const f = await dt.createDowntimeFolder(page, `${reg.prefix}_f`);
    reg.folders.push(f);
    const alert = await dt.createSqlAlert(page, {
      name: `${reg.prefix}_alert`,
      stream: shared.stream,
      sql: `SELECT count(*) AS c FROM "${shared.stream}"`,
      destinations: [shared.dest],
      frequencyMinutes: 60,
      periodMinutes: 60,
      enabled: false,
    });
    reg.alerts.push(alert);
    return { f, alert };
  }

  const banner = (page, name, f, alert, { showBanner = true, schedule = dt.activeWindow() } = {}) => dt.createDowntime(page, f, {
    name: `${reg.prefix}_${name}`,
    targets: [dt.alertIdsTarget([alert.id])],
    schedule,
    show_banner: showBanner,
  });

  /** The one generated downtime banner, read from the API the page renders. */
  async function apiBanner(page) {
    const [b] = await dt.downtimeBanners(page);
    return b ?? null;
  }

  const entries = (b) => String(b.id).replace(/^downtime:/, '').split(',').filter(Boolean);

  // ------------------------------------------------------------------ P1

  test('DT-B-01 one active downtime: message, countdown and the "View downtime" CTA; show_banner:false shows nothing', { tag: ['@P1'] }, async ({ page }) => {
    const { f, alert } = await folderAndAlert(page);
    const quiet = await banner(page, 'quiet', f, alert, { showBanner: false });
    await page.reload();
    await pm.downtimesPage.expectBannerById(quiet.id, false);

    const loud = await banner(page, 'loud', f, alert);
    // Banner counts read an inventory cached for up to 60 s, so a fresh alert is counted only after the next reload of it.
    const b = await dt.pollUntil(page, () => apiBanner(page),
      (x) => !!x && (entries(x).length > 1 || / muted\.$/.test(x.message)), { timeoutMs: 90_000, intervalMs: 5000 });
    await page.reload();
    expect(b, 'the announcements API must carry a downtime banner').toBeTruthy();
    expect(b.id, 'the banner names our downtime').toContain(loud.id);
    expect(b.id, 'a show_banner:false downtime is never part of it').not.toContain(quiet.id);
    const single = entries(b).length === 1;
    expect(b.message).toMatch(single ? new RegExp(`^${escapeRe(`${loud.name} is active. 1 alert is muted.`)}$`) : /\d+ downtimes are active\./);

    await pm.downtimesPage.expectBannerById(loud.id, true);
    await pm.downtimesPage.expectBannerText(b.message);
    await pm.downtimesPage.expectBannerCountdown(/ends in \d+ minutes/);

    const cta = (b.ctas ?? [b.cta]).filter(Boolean)[0];
    expect(cta.text).toBe(single ? 'View downtime' : 'View downtimes');
    await pm.downtimesPage.clickBannerCta(cta.text);
    await pm.downtimesPage.expectUrl(single ? new RegExp(`/downtimes/${loud.id}`) : /status=active.*scope=all|scope=all.*status=active/);
  });

  test('DT-B-02 several active downtimes: combined message, "first ends in", and the "View downtimes" CTA', { tag: ['@P1'] }, async ({ page }) => {
    const { f, alert } = await folderAndAlert(page);
    const d20 = await banner(page, 'twenty', f, alert, { schedule: dt.activeWindow({ startOffsetSec: -60, durationSec: 21 * 60 }) });
    const d40 = await banner(page, 'forty', f, alert, { schedule: dt.activeWindow({ startOffsetSec: -60, durationSec: 41 * 60 }) });
    await page.reload();

    const b = await apiBanner(page);
    expect(b.id).toContain(d20.id);
    expect(b.id).toContain(d40.id);
    const n = entries(b).length;
    expect(b.message).toContain(`${n} downtimes are active.`);
    await pm.downtimesPage.expectBannerText(new RegExp(`${n} downtimes are active\\.`));

    const minutes = Math.floor((Number(b.ends_at) / 1000 - Date.now()) / 60_000);
    await pm.downtimesPage.expectBannerCountdown(new RegExp(`first ends in (${minutes - 1}|${minutes}|${minutes + 1}) minutes`));
    expect(minutes, 'on a fresh org the first end is ours, ~20 minutes away').toBeLessThanOrEqual(20);

    await pm.downtimesPage.clickBannerCta('View downtimes');
    await pm.downtimesPage.expectUrl(/status=active/);
    await pm.downtimesPage.expectUrl(/scope=all/);
    await pm.downtimesPage.expectRowVisible(d20.id);
    await pm.downtimesPage.expectRowVisible(d40.id);
  });

  test('DT-B-03 the banner clears at the window end without a reload', { tag: ['@P1'] }, async ({ page }) => {
    test.setTimeout(4 * 60_000);
    const { f, alert } = await folderAndAlert(page);
    const startMs = Date.now() - 30_000;
    const endMs = Date.now() + 75_000;
    const short = await banner(page, 'short', f, alert, { schedule: dt.windowFromMs(startMs, endMs) });
    await page.reload();
    await pm.downtimesPage.expectBannerById(short.id, true);

    const loads = pm.downtimesPage.trackNavigations();
    await pm.downtimesPage.expectBannerById(short.id, false, { timeout: endMs + 30_000 - Date.now() });
    expect(loads.count, 'the banner must clear without a page reload').toBe(0);
  });

  // ------------------------------------------------------------------ P2

  test('DT-B-04 a dismissal holds after reload but is per browser', { tag: ['@P2'] }, async ({ page, browser }) => {
    const { f, alert } = await folderAndAlert(page);
    const d = await banner(page, 'dismiss', f, alert);
    await page.reload();
    await pm.downtimesPage.expectBannerById(d.id, true);
    await pm.downtimesPage.dismissBanner(d.id);
    // Absence after a reload proves nothing until the banners have been fetched again.
    await Promise.all([
      page.waitForResponse((r) => /\/api\/[^/]+\/announcements(\?|$)/.test(r.url()) && r.request().method() === 'GET', { timeout: 30000 }),
      page.reload(),
    ]);
    await pm.downtimesPage.expectBannerById(d.id, false);

    const state = await page.context().storageState();
    state.origins = state.origins.map((o) => ({ ...o, localStorage: o.localStorage.filter((e) => e.name !== 'o2_dismissed_announcements') }));
    const other = await browser.newContext({ storageState: state });
    try {
      const page2 = await other.newPage();
      await navigateToBase(page2);
      const pm2 = new PageManager(page2);
      await pm2.downtimesPage.expectBannerById(d.id, true);
    } finally {
      await other.close();
    }
  });
});
