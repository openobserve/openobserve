// Copyright 2026 OpenObserve Inc.

// Expected banner text is read from GET /api/{org}/announcements, so the assertions follow the server's wording and counts.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');
const fx = require('../utils/downtimes-fixtures.js');

const PREFIX = 'e2e_dt_banner';

const gate = { ready: false, config: {} };
const shared = { stream: null, dest: null };

// Serial: the banner is one org-wide combination of every active downtime, so parallel banner tests would rewrite each other's message.
test.describe.configure({ mode: 'serial' });

test.describe('Downtime org banner', { tag: ['@downtimes', '@enterprise', '@all'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      gate.config = await dt.assertDowntimesEnabled(page);
      gate.ready = true;
      const wp = fx.workerPrefix(PREFIX, testInfo);
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
    testLogger.testStart(testInfo.title, testInfo.file);
    reg = { prefix: dt.uniqueName(fx.workerPrefix(PREFIX, testInfo)), alerts: [], folders: [] };
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
    if (!gate.ready) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    const wp = fx.workerPrefix(PREFIX, testInfo);
    await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
    await dt.deleteDestinationsByPrefix(page, `${wp}_`);
    await context.close();
  });

  test('DT-B-01 one active downtime: message, countdown and the "View downtime" CTA; show_banner:false shows nothing', { tag: ['@P1'] }, async ({ page }) => {
    const { f, alert } = await fx.disabledAlertWithFolder(page, reg, shared);
    const quiet = await fx.bannerDowntime(page, reg, { suffix: 'quiet', folderId: f, alertId: alert.id, showBanner: false });
    await pm.downtimesPage.reload();
    await pm.downtimesPage.expectBannerById(quiet.id, false);

    const loud = await fx.bannerDowntime(page, reg, { suffix: 'loud', folderId: f, alertId: alert.id });
    const b = await dt.waitForBannerNaming(page, loud.id);
    await pm.downtimesPage.reload();
    expect(b, 'the announcements API must carry a downtime banner').toBeTruthy();
    expect(b.id, 'the banner names our downtime').toContain(loud.id);
    expect(b.id, 'a show_banner:false downtime is never part of it').not.toContain(quiet.id);
    // Another spec's active show_banner downtime folds into the same banner, so the single-row wording holds only when ours is alone.
    const single = dt.bannerEntries(b).length === 1;
    expect(b.message).toMatch(single ? new RegExp(`^${dt.escapeRegExp(`${loud.name} is active. 1 alert is muted.`)}$`) : /\d+ downtimes are active\./);

    await pm.downtimesPage.expectBannerById(loud.id, true);
    await pm.downtimesPage.expectBannerText(b.message);
    await pm.downtimesPage.expectBannerCountdown(/ends in \d+ minutes/);

    const cta = (b.ctas ?? [b.cta]).filter(Boolean)[0];
    expect(cta.text).toBe(single ? 'View downtime' : 'View downtimes');
    await pm.downtimesPage.clickBannerCta(cta.text);
    await pm.downtimesPage.expectUrl(single ? new RegExp(`/downtimes/${loud.id}`) : /status=active.*scope=all|scope=all.*status=active/);
  });

  test('DT-B-02 several active downtimes: combined message, "first ends in", and the "View downtimes" CTA', { tag: ['@P1'] }, async ({ page }) => {
    const { f, alert } = await fx.disabledAlertWithFolder(page, reg, shared);
    const w20 = dt.activeWindow({ startOffsetSec: -60, durationSec: 21 * 60 });
    const d20 = await fx.bannerDowntime(page, reg, { suffix: 'twenty', folderId: f, alertId: alert.id, schedule: w20 });
    const d40 = await fx.bannerDowntime(page, reg, { suffix: 'forty', folderId: f, alertId: alert.id, schedule: dt.activeWindow({ startOffsetSec: -60, durationSec: 41 * 60 }) });
    await pm.downtimesPage.reload();

    const b = await dt.downtimeBanner(page);
    expect(b, 'the announcements API must carry a downtime banner').toBeTruthy();
    expect(b.id).toContain(d20.id);
    expect(b.id).toContain(d40.id);
    const n = dt.bannerEntries(b).length;
    expect(b.message).toContain(`${n} downtimes are active.`);
    await pm.downtimesPage.expectBannerText(new RegExp(`${n} downtimes are active\\.`));

    // The first end is the earliest of every active window, so another spec's row may end sooner but never later than ours.
    expect(Number(b.ends_at), 'the banner counts down to the earliest end, which is at most our 20-minute row').toBeLessThanOrEqual(w20.ends_at);
    const minutes = Math.floor((Number(b.ends_at) / 1000 - Date.now()) / 60_000);
    await pm.downtimesPage.expectBannerCountdown(new RegExp(`first ends in (${minutes - 1}|${minutes}|${minutes + 1}) minutes`));

    await pm.downtimesPage.clickBannerCta('View downtimes');
    await pm.downtimesPage.expectUrl(/status=active/);
    await pm.downtimesPage.expectUrl(/scope=all/);
    await pm.downtimesPage.expectRowVisible(d20.id);
    await pm.downtimesPage.expectRowVisible(d40.id);
  });

  test('DT-B-03 the banner clears at the window end without a reload', { tag: ['@P1'] }, async ({ page }) => {
    test.setTimeout(4 * 60_000);
    const { f, alert } = await fx.disabledAlertWithFolder(page, reg, shared);
    const startMs = Date.now() - 30_000;
    const endMs = Date.now() + 75_000;
    const short = await fx.bannerDowntime(page, reg, { suffix: 'short', folderId: f, alertId: alert.id, schedule: dt.windowFromMs(startMs, endMs) });
    await pm.downtimesPage.reload();
    await pm.downtimesPage.expectBannerById(short.id, true);

    const loads = pm.downtimesPage.trackNavigations();
    await pm.downtimesPage.expectBannerById(short.id, false, { timeout: endMs + 30_000 - Date.now() });
    expect(loads.count, 'the banner must clear without a page reload').toBe(0);
  });

  test('DT-B-04 a dismissal holds after reload but is per browser', { tag: ['@P2'] }, async ({ page, browser }) => {
    const { f, alert } = await fx.disabledAlertWithFolder(page, reg, shared);
    const d = await fx.bannerDowntime(page, reg, { suffix: 'dismiss', folderId: f, alertId: alert.id });
    await pm.downtimesPage.reload();
    await pm.downtimesPage.expectBannerById(d.id, true);
    await pm.downtimesPage.dismissBanner(d.id);
    await pm.downtimesPage.reloadAndWaitForBanners();
    await pm.downtimesPage.expectBannerById(d.id, false);

    const other = await browser.newContext({ storageState: await pm.downtimesPage.storageStateWithoutDismissals() });
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
