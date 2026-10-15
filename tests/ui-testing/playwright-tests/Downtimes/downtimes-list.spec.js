// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');
const fx = require('../utils/downtimes-fixtures.js');

const PREFIX = 'e2e_dt_list';
const ENT_2848 = 'https://github.com/openobserve/o2-enterprise/issues/2848';

const gate = { ready: false, config: {} };
const shared = { stream: null, dest: null, alertX: null };

test.describe.configure({ mode: 'parallel' });

test.describe('Downtimes list and detail', { tag: ['@downtimes', '@enterprise', '@all'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(5 * 60_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      gate.config = await dt.assertDowntimesEnabled(page);
      gate.ready = true;
      const wp = fx.workerPrefix(PREFIX, testInfo);
      await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
      const run = dt.uniqueName('r').slice(-8);
      shared.stream = `${wp}_${run}_stream`;
      await dt.seedStream(page, shared.stream, { minutes: 5, services: [`svc-x-${run}`] });
      shared.dest = (await dt.seedSinkDestination(page, `${wp}_${run}`)).destination;
      shared.alertX = await dt.createSqlAlert(page, {
        name: `${wp}_${run}_alert_x`,
        stream: shared.stream,
        sql: `SELECT count(*) AS c FROM "${shared.stream}"`,
        destinations: [shared.dest],
        frequencyMinutes: 60,
        periodMinutes: 60,
        enabled: false,
      });
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    reg = { prefix: dt.uniqueName(fx.workerPrefix(PREFIX, testInfo)), folders: [] };
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({ page }) => {
    if (reg) await dt.cleanupDowntimes(page, { prefix: reg.prefix, folderIds: reg.folders });
  });

  test.afterAll(async ({ browser }, testInfo) => {
    if (!gate.ready) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    const wp = fx.workerPrefix(PREFIX, testInfo);
    await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
    await dt.deleteAlertsAndFolders(page, [shared.alertX]);
    await dt.deleteDestinationsByPrefix(page, `${wp}_`);
    await context.close();
  });

  test('DT-L-01 stat tiles count the folder and filter the list by status', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.activeDowntime(page, reg, f, shared.alertX.id);
    const s = await fx.scheduledDowntime(page, reg, f, shared.alertX.id);
    const c = await fx.cancelledDowntime(page, reg, f, shared.alertX.id);
    const items = (await dt.listDowntimes(page, { folder_id: f })).items;

    await pm.downtimesPage.gotoList(f);
    for (const status of ['active', 'scheduled', 'cancelled']) {
      await pm.downtimesPage.expectStatTileCount(status, items.filter((r) => r.status === status).length);
    }
    await pm.downtimesPage.expectStatTileCount('total', items.length);

    await pm.downtimesPage.clickStatTile('active');
    await pm.downtimesPage.expectUrl(/status=active/);
    await pm.downtimesPage.expectRowVisible(a.id);
    await pm.downtimesPage.expectRowHidden(s.id);
    await pm.downtimesPage.expectRowHidden(c.id);

    await pm.downtimesPage.clickStatTile('active');
    for (const row of [a, s, c]) await pm.downtimesPage.expectRowVisible(row.id);

    await pm.downtimesPage.clickStatTile('active');
    await pm.downtimesPage.expectRowHidden(s.id);
    await pm.downtimesPage.clickStatTile('total');
    for (const row of [a, s, c]) await pm.downtimesPage.expectRowVisible(row.id);
  });

  test('DT-L-02 type toggle, search, and the All-folders scope', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg, 'f');
    const g = await fx.newDowntimeFolder(page, reg, 'g');
    const once = await fx.scheduledDowntime(page, reg, f, shared.alertX.id, 'oncerow');
    const daily = await dt.createDowntime(page, f, { name: `${reg.prefix}_dailyrow`, targets: [dt.alertIdsTarget([shared.alertX.id])], schedule: dt.dailyWindow() });
    const other = await fx.scheduledDowntime(page, reg, g, shared.alertX.id, 'other');

    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.setType('recurring');
    await pm.downtimesPage.expectRowVisible(daily.id);
    await pm.downtimesPage.expectRowHidden(once.id);
    await pm.downtimesPage.setType('once');
    await pm.downtimesPage.expectRowVisible(once.id);
    await pm.downtimesPage.expectRowHidden(daily.id);
    await pm.downtimesPage.setType('all');

    await pm.downtimesPage.search('_oncerow');
    await pm.downtimesPage.expectRowVisible(once.id);
    await pm.downtimesPage.expectRowHidden(daily.id);

    await pm.downtimesPage.search(other.name);
    await pm.downtimesPage.setScope('this');
    await pm.downtimesPage.expectRowHidden(other.id);
    await pm.downtimesPage.setScope('all');
    await pm.downtimesPage.expectRowVisible(other.id);
  });

  test('DT-L-03 the Status and "Ends / next" columns read per state', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.activeDowntime(page, reg, f, shared.alertX.id);
    const s = await fx.scheduledDowntime(page, reg, f, shared.alertX.id);
    const c = await fx.cancelledDowntime(page, reg, f, shared.alertX.id);

    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.expectRowStatus(a.id, 'Active');
    await pm.downtimesPage.expectRowWhen(a.id, /in (\d+ minutes|about 1 hour)/);
    await pm.downtimesPage.expectRowStatus(s.id, 'Scheduled');
    await pm.downtimesPage.expectRowWhen(s.id, /next/);
    await pm.downtimesPage.expectRowStatus(c.id, 'Cancelled');
    await pm.downtimesPage.expectRowWhen(c.id, '—');
  });

  test('DT-L-04 a row flips from Scheduled to Active without a reload', { tag: ['@P1'] }, async ({ page }) => {
    test.setTimeout(4 * 60_000);
    const f = await fx.newDowntimeFolder(page, reg);
    const start = Date.now() + 75_000;
    const s = await fx.scheduledDowntime(page, reg, f, shared.alertX.id, 'flip', dt.windowFromMs(start, start + 3600_000));

    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.expectRowStatus(s.id, 'Scheduled');
    const loads = pm.downtimesPage.trackNavigations();
    await pm.downtimesPage.expectRowStatus(s.id, 'Active', { timeout: 120_000 });
    expect(loads.count, 'the status must flip without a page reload').toBe(0);
  });

  test('DT-L-05 extends a running downtime by 1 h from the list; a scheduled one cannot be extended', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.activeDowntime(page, reg, f, shared.alertX.id);
    const s = await fx.scheduledDowntime(page, reg, f, shared.alertX.id);
    const before = await dt.getDowntime(page, a.id, f);

    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.expectExtendDisabled(s.id);
    await pm.downtimesPage.extendPreset(a.id, '1h');
    await pm.downtimesPage.expectToast('Extended until');

    const after = await dt.getDowntime(page, a.id, f);
    expect(Math.abs(after.schedule.ends_at - before.schedule.ends_at - 3600 * dt.MICROS)).toBeLessThanOrEqual(5 * dt.MICROS);
  });

  test('DT-L-06 End now: Keep running leaves it active, End now ends it early', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.activeDowntime(page, reg, f, shared.alertX.id);

    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.clickEndNow(a.id);
    await pm.downtimesPage.expectConfirm({ title: 'End this downtime now?', ok: 'End now', cancel: 'Keep running' });
    await pm.downtimesPage.dismissConfirm();
    await pm.downtimesPage.expectRowStatus(a.id, 'Active');
    expect((await dt.getDowntime(page, a.id, f)).status).toBe('active');

    await pm.downtimesPage.clickEndNow(a.id);
    await pm.downtimesPage.confirm();
    await pm.downtimesPage.expectToast('Downtime cancelled');
    await pm.downtimesPage.expectRowStatus(a.id, 'Ended early');
    expect((await dt.getDowntime(page, a.id, f)).status).toBe('ended_early');
  });

  test('DT-L-07 cancels a scheduled downtime after Keep downtime is offered', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const s = await fx.scheduledDowntime(page, reg, f, shared.alertX.id);

    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.clickCancel(s.id);
    await pm.downtimesPage.expectConfirm({ ok: 'Cancel downtime', cancel: 'Keep downtime' });
    await pm.downtimesPage.dismissConfirm();
    await pm.downtimesPage.expectRowStatus(s.id, 'Scheduled');

    await pm.downtimesPage.clickCancel(s.id);
    await pm.downtimesPage.confirm();
    await pm.downtimesPage.expectToast('Downtime cancelled');
    await pm.downtimesPage.expectRowStatus(s.id, 'Cancelled');
    expect((await dt.getDowntime(page, s.id, f)).status).toBe('cancelled');
  });

  test('DT-L-08 Delete is offered only for finished downtimes', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.activeDowntime(page, reg, f, shared.alertX.id);
    const c = await fx.cancelledDowntime(page, reg, f, shared.alertX.id);

    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.openMore(a.id);
    await pm.downtimesPage.expectMoreItemAbsent(a.id, 'delete');
    await pm.downtimesPage.closeMenu();

    await pm.downtimesPage.deleteRow(c.id);
    await pm.downtimesPage.expectToast('Downtime deleted');
    await pm.downtimesPage.expectRowHidden(c.id);
    expect((await dt.getDowntimeResponse(page, c.id, f)).status()).toBe(404);
  });

  test('DT-L-09 Duplicate opens the create page as "Copy of" with the same target, and Cancel creates nothing', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const s = await fx.scheduledDowntime(page, reg, f, shared.alertX.id, 'dup');
    const before = (await dt.listDowntimes(page, { folder_id: f })).total;

    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.duplicateRow(s.id);
    await pm.downtimesPage.expectUrl(new RegExp(`/downtimes/add\\?.*duplicate=${s.id}`));
    await pm.downtimesPage.expectTitle(`Copy of ${s.name}`);
    await pm.downtimesPage.expectSpecificItemSelected('alerts', shared.alertX.id);
    await pm.downtimesPage.cancelCreate();
    expect((await dt.listDowntimes(page, { folder_id: f })).total).toBe(before);
  });

  test('DT-L-10 moves a downtime to another folder', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg, 'f');
    const g = await fx.newDowntimeFolder(page, reg, 'g');
    const s = await fx.scheduledDowntime(page, reg, f, shared.alertX.id, 'move');

    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.moveRow(s.id, g, `${reg.prefix}_g`);
    await pm.downtimesPage.expectRowHidden(s.id);
    expect((await dt.getDowntime(page, s.id, g)).folder_id).toBe(g);

    await pm.downtimesPage.gotoList(g);
    await pm.downtimesPage.expectRowVisible(s.id);
  });

  test('DT-L-11 a folder that still holds downtimes cannot be deleted, an empty one can', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const c = await fx.cancelledDowntime(page, reg, f, shared.alertX.id);

    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.deleteFolderFromSidebar(f);
    await pm.downtimesPage.expectToast('Folder contains downtimes, please move/delete downtimes from folder');
    await pm.downtimesPage.expectFolderInSidebar(f, true);

    expect((await dt.deleteDowntime(page, c.id, f)).ok()).toBe(true);
    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.deleteFolderFromSidebar(f);
    await pm.downtimesPage.expectFolderInSidebar(f, false);
  });

  test('DT-D-01 detail shows Overview, the Affected count and empty Notifications and Suppressed tabs', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.activeDowntime(page, reg, f, shared.alertX.id);
    // The detail's affected list reads an inventory cached for up to 60 s (downtimes/inventory.rs INVENTORY_TTL).
    await expect.poll(async () => (await dt.getDowntime(page, a.id, f)).affected?.alerts?.length ?? 0, {
      message: 'the API must report the targeted alert as affected', timeout: 90_000, intervals: [3000],
    }).toBeGreaterThan(0);
    const affected = (await dt.getDowntime(page, a.id, f)).affected.alerts.length;

    await pm.downtimesPage.gotoDetail(a.id, f);
    await pm.downtimesPage.expectDetailStatus('Active');
    await pm.downtimesPage.expectScheduleBand();
    await pm.downtimesPage.expectDetailTabLabel('affected', `Affected · ${affected}`);

    await pm.downtimesPage.openDetailTab('affected');
    await pm.downtimesPage.expectAffectedAlertsContain(shared.alertX.name);
    await pm.downtimesPage.openDetailTab('notifications');
    await pm.downtimesPage.expectNotificationsEmpty('No notifications sent yet');
    await pm.downtimesPage.openDetailTab('suppressed');
    await pm.downtimesPage.expectSuppressedEmpty('Nothing has been suppressed yet');
  });

  test('DT-D-02 extends a downtime "Until…" from the detail page', { tag: ['@P1'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.activeDowntime(page, reg, f, shared.alertX.id);
    const end = fx.minutesFromNow(150);

    await pm.downtimesPage.gotoDetail(a.id, f);
    await pm.downtimesPage.extendUntilFromDetail(end);
    await pm.downtimesPage.expectToast('Extended until');

    const after = await dt.getDowntime(page, a.id, f);
    expect(Math.abs(after.schedule.ends_at / 1000 - end.getTime())).toBeLessThanOrEqual(60_000);
  });

  test('DT-L-12 rows share one height and their action slots line up', { tag: ['@P2'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const rows = [await fx.activeDowntime(page, reg, f, shared.alertX.id), await fx.scheduledDowntime(page, reg, f, shared.alertX.id), await fx.cancelledDowntime(page, reg, f, shared.alertX.id)];

    await pm.downtimesPage.gotoList(f);
    for (const r of rows) await pm.downtimesPage.expectRowVisible(r.id);
    const boxes = await Promise.all(rows.map((r) => pm.downtimesPage.rowBox(r.id)));
    const actions = await Promise.all(rows.map((r) => pm.downtimesPage.actionsBox(r.id)));
    for (const b of boxes) expect(Math.abs(b.height - boxes[0].height)).toBeLessThanOrEqual(1);
    for (const x of actions) expect(Math.abs(x.x - actions[0].x)).toBeLessThanOrEqual(1);
  });

  test('DT-D-03 a missing id shows Downtime not found', { tag: ['@P2'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    await pm.downtimesPage.gotoDetail(`${reg.prefix.replace(/_/g, '')}missing`, f);
    await pm.downtimesPage.expectNotFound('Downtime not found');
  });

  test('DT-D-04 "Mute now for 1 h" on the detail page creates a child downtime', { tag: ['@P2'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.activeDowntime(page, reg, f, shared.alertX.id, 'parent');

    await pm.downtimesPage.gotoDetail(a.id, f);
    await pm.downtimesPage.muteForHourFromDetail();
    await pm.downtimesPage.expectToast('Downtime created');

    const child = await dt.pollUntil(page, async () => (await dt.listDowntimes(page, { search: a.name })).items.find((r) => r.name === `${a.name} · mute 1 h`),
      (row) => !!row, { timeoutMs: 20_000, intervalMs: 2000 });
    expect(child, `a child named "${a.name} · mute 1 h" must exist`).toBeTruthy();
    expect(child.status).toBe('active');
  });

  test('DT-L-13 the Matched column is not hidden behind the row actions', { tag: ['@P2'] }, async ({ page }) => {
    test.fixme(true, `Matched column hidden behind the actions — ${ENT_2848}`);
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.activeDowntime(page, reg, f, shared.alertX.id);
    await pm.downtimesPage.gotoList(f);
    const matched = await pm.downtimesPage.cellBox(a.id, 'matched');
    const actions = await pm.downtimesPage.actionsBox(a.id);
    const overlaps = matched.x < actions.x + actions.width && matched.x + matched.width > actions.x;
    expect(overlaps, 'the Matched cell must not sit under the action slot').toBe(false);
  });

  test('DT-L-14 a row offers Duplicate exactly once at desktop width (icon plus ⋮ menu), and it opens a copy', { tag: ['@P2'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a = await fx.activeDowntime(page, reg, f, shared.alertX.id);
    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.openMore(a.id);
    expect(await pm.downtimesPage.visibleDuplicateControlCount(a.id), 'Duplicate must appear once across the icon and the open menu').toBe(1);
    await pm.downtimesPage.closeMenu();

    await pm.downtimesPage.duplicateRow(a.id);
    await pm.downtimesPage.expectUrl(new RegExp(`/downtimes/add\\?.*duplicate=${a.id}`));
    await pm.downtimesPage.expectTitle(`Copy of ${a.name}`);
  });

  test('DT-L-15 bulk-cancels two active downtimes', { tag: ['@P2'] }, async ({ page }) => {
    const f = await fx.newDowntimeFolder(page, reg);
    const a1 = await fx.activeDowntime(page, reg, f, shared.alertX.id, 'bulk1');
    const a2 = await fx.activeDowntime(page, reg, f, shared.alertX.id, 'bulk2');

    await pm.downtimesPage.gotoList(f);
    await pm.downtimesPage.selectRows([a1.id, a2.id]);
    await pm.downtimesPage.bulkCancel();
    await pm.downtimesPage.expectToast('2 downtimes cancelled');
    expect((await dt.getDowntime(page, a1.id, f)).status).toBe('ended_early');
    expect((await dt.getDowntime(page, a2.id, f)).status).toBe('ended_early');
  });
});
