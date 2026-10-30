// Copyright 2026 OpenObserve Inc.


const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { seedAlertFixtures, deleteAlerts, getAlertGroups, isFiringOutcome } = require('../utils/alerts-api-helpers.js');
const {
  createFiringSingle, createFiringMulti, waitFiring, waitGroupsFiring, listItem, acks, history,
  pollUntil, createUser, deleteUser, ackAs, endMutes, downtime, incidentsEnabled, shoot,
} = require('../utils/alert-ack-mute-helpers.js');

const ROOT = process.env.ZO_ROOT_USER_EMAIL;

test.describe.configure({ mode: 'serial' });

test.describe('Alert acknowledge and mute — alert screens', { tag: ['@alerts', '@alerts-ack', '@P1'] }, () => {
  let pm;
  let ack;
  const created = [];
  const names = [];

  test.beforeEach(async ({ page }, testInfo) => {
    test.setTimeout(8 * 60 * 1000);
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    ack = pm.alertAckPage;
    await seedAlertFixtures(page);
    await navigateToBase(page);
  });

  test.afterEach(async ({ page }) => {
    await endMutes(page, names);
    await deleteAlerts(page, created);
    created.length = 0;
    names.length = 0;
  });

  test('detail: acknowledge, take over and unacknowledge a firing alert, and the history shows each step', async ({ page }) => {
    const alert = await createFiringSingle(page, 'ack_detail', created);
    names.push(alert.name);
    const other = await createUser(page, 'admin');
    try {
      await waitFiring(page, alert);
      await ack.openDetail(alert.id);
      await expect(ack.ackButton()).toBeVisible();
      await shoot(page, 'mk1-detail-firing');

      await ack.acknowledgeFromHeader();
      await expect(ack.ackChip()).toBeVisible({ timeout: 15000 });
      await expect(ack.ackButton()).toHaveCount(0);
      let rows = await acks(page, alert.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ acked_by: ROOT, ack_source: 'ui', group_key: '' });
      await shoot(page, 'mk1-detail-acked');

      // A run while acked delivers nothing and records who kept it quiet.
      const suppressed = await pollUntil(page, () => history(page, alert.id),
        (h) => h.some((r) => r.acked_by === ROOT && r.status !== 'ack_event'),
        { timeoutMs: 180_000, onTick: alert.feed });
      expect(suppressed.some((r) => r.acked_by === ROOT && r.status !== 'ack_event'), JSON.stringify(suppressed.slice(0, 5))).toBe(true);

      const taken = await ackAs(page, other, alert.id, { take_over: true });
      expect(taken.status, taken.body).toBe(200);
      expect(JSON.parse(taken.body).acks[0].acked_by).toBe(other.email);
      await ack.reload();
      await expect(ack.ackChip()).toContainText(other.email.split('@')[0]);
      await ack.takeOverFromHeader();
      await expect.poll(async () => (await acks(page, alert.id))[0]?.acked_by, { timeout: 15000 }).toBe(ROOT);
      rows = await acks(page, alert.id);
      expect(rows[0].taken_over_from).toBe(other.email);
      await expect(ack.ackChip()).toContainText(ROOT.split('@')[0]);

      await ack.unackFromHeader();
      await expect(ack.ackButton()).toBeVisible({ timeout: 15000 });
      await expect(ack.ackChip()).toHaveCount(0);
      expect(await acks(page, alert.id)).toHaveLength(0);

      const events = await pollUntil(page, () => history(page, alert.id),
        (h) => ['ack', 'take_over', 'unack'].every((a) => h.some((r) => r.status === 'ack_event' && r.ack_action === a)),
        { timeoutMs: 90_000 });
      for (const a of ['ack', 'take_over', 'unack']) {
        expect(events.some((r) => r.status === 'ack_event' && r.ack_action === a), `${a} event in ${JSON.stringify(events.slice(0, 8))}`).toBe(true);
      }

      await pm.alertHistoryPage.navigate();
      await pm.alertHistoryPage.selectAlert(alert.name);
      await pm.alertHistoryPage.clickManualSearch();
      await expect(page.locator('[data-test="alert-history-table"] tbody tr').filter({ hasNotText: alert.name })).toHaveCount(0, { timeout: 30000 });
      await expect(page.locator('[data-test="alert-history-ack-event-text"]').filter({ hasText: 'Taken over by' }).first()).toBeVisible({ timeout: 30000 });
      await expect(page.locator('[data-test="alert-history-ack-event-text"]').filter({ hasText: 'Unacknowledged by' }).first()).toBeVisible();
      await expect(page.locator('[data-test="alert-history-ack-dedup"]').first()).toContainText('suppressed by ack');
      await shoot(page, 'mk5-history-ack-rows');
    } finally {
      await deleteUser(page, other.email);
    }
  });

  test('list: row Acknowledge marks the row and the Acknowledged tile filters to it; a multi-alert row acks every firing group', async ({ page }) => {
    const one = await createFiringSingle(page, 'ack_list_a', created);
    const two = await createFiringSingle(page, 'ack_list_b', created);
    const multi = await createFiringMulti(page, 'ack_list_m', created);
    names.push(one.name, two.name, multi.name);
    await Promise.all([waitFiring(page, one), waitFiring(page, two)]);
    await waitGroupsFiring(page, multi, ['bangalore', 'mumbai']);

    await ack.openList();
    await ack.rowAcknowledge(one.name);
    await expect(ack.listAcked(one.name)).toBeVisible({ timeout: 15000 });
    await expect(ack.listAcked(two.name)).toHaveCount(0);
    expect((await listItem(page, one.name)).ack).toMatchObject({ acked_by: ROOT, ack_source: 'ui' });

    await ack.rowAcknowledge(multi.name);
    await expect(ack.listAcked(multi.name)).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => (await listItem(page, multi.name))?.ack?.groups_acked, { timeout: 15000 }).toBe(2);
    await shoot(page, 'mk3-list-acked');

    await ack.clickAcknowledgedTile();
    await expect(ack.listRow(one.name)).toBeVisible();
    await expect(ack.listRow(multi.name)).toBeVisible();
    await expect(ack.listRow(two.name)).toHaveCount(0);
    await shoot(page, 'mk3-list-acknowledged-filter');
    await ack.clickAcknowledgedTile();
  });

  test('groups tab: acknowledge one group, the header counts the rest, then unacknowledge it', async ({ page }) => {
    const multi = await createFiringMulti(page, 'ack_groups', created);
    names.push(multi.name);
    const { byCity } = await waitGroupsFiring(page, multi, ['bangalore', 'mumbai']);
    const key = byCity.mumbai.group_key;

    await ack.openDetail(multi.id);
    await ack.openGroupsTab();
    await expect(ack.ackButton()).toContainText('Acknowledge 2 firing groups');
    await ack.groupAction(key, 'ack');
    await expect(ack.groupOutcome(key)).toContainText('Acknowledged', { timeout: 15000 });
    await expect(ack.ackButton()).toContainText('Acknowledge 1 firing group');
    const rows = await acks(page, multi.id);
    expect(rows.map((r) => r.group_key)).toEqual([key]);
    await shoot(page, 'mk2-groups-one-acked');

    await ack.groupAction(key, 'unack');
    await expect(ack.ackButton()).toContainText('Acknowledge 2 firing groups', { timeout: 15000 });
    expect(await acks(page, multi.id)).toHaveLength(0);
  });

  test('detail: mute until it clears, extend by 1 h, then end the mute', async ({ page }) => {
    const alert = await createFiringSingle(page, 'mute_detail', created);
    names.push(alert.name);
    await waitFiring(page, alert);
    await ack.openDetail(alert.id);

    await ack.headerMute('until-clear');
    await expect(ack.mutedChip()).toContainText('until it clears', { timeout: 15000 });
    const item = await listItem(page, alert.name);
    expect(item.active_downtime).toMatchObject({ source: 'openobserve', version: 1, end_on_clear: { alert_id: alert.id } });
    await shoot(page, 'mk1-detail-muted-until-clear');

    const before = item.active_downtime;
    await ack.headerExtend('1h');
    await expect(ack.mutedChip()).not.toContainText('until it clears', { timeout: 15000 });
    const after = (await listItem(page, alert.name)).active_downtime;
    expect(after.id).toBe(before.id);
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.end_on_clear).toBeUndefined();
    const nowUs = Date.now() * 1000;
    expect(after.ends_at).toBeGreaterThan(nowUs + 55 * 60 * 1e6);
    expect(after.ends_at).toBeLessThan(nowUs + 65 * 60 * 1e6);
    await shoot(page, 'mk1-detail-muted-extended');

    await ack.headerEndMute();
    await expect(ack.mutedChip()).toHaveCount(0, { timeout: 15000 });
    expect((await listItem(page, alert.name)).active_downtime ?? null).toBeNull();
    const row = await downtime(page, before.id);
    expect(row.cancelled_by).toBe(ROOT);
  });

  test('list: mute a row for 1 h, extend it, then end the mute now', async ({ page }) => {
    const alert = await createFiringSingle(page, 'mute_list', created);
    names.push(alert.name);
    await waitFiring(page, alert);
    await ack.openList();

    await ack.rowMute(alert.name, '1h');
    await expect(ack.listMuted(alert.name)).toBeVisible({ timeout: 15000 });
    const first = (await listItem(page, alert.name)).active_downtime;
    expect(first).toMatchObject({ source: 'openobserve', version: 1 });
    await shoot(page, 'mk3-list-muted');

    await ack.rowExtend(alert.name, '30m');
    await expect.poll(async () => (await listItem(page, alert.name)).active_downtime?.version, { timeout: 15000 }).toBeGreaterThan(first.version);
    const extended = (await listItem(page, alert.name)).active_downtime;
    expect(extended.ends_at - first.ends_at).toBeGreaterThanOrEqual(30 * 60 * 1e6 - 5e6);

    await ack.rowEndMute(alert.name);
    await expect(ack.listMuted(alert.name)).toHaveCount(0, { timeout: 15000 });
    expect((await listItem(page, alert.name)).active_downtime ?? null).toBeNull();
  });

  test('groups tab: mute one group until it clears; only that group shows muted', async ({ page }) => {
    const multi = await createFiringMulti(page, 'mute_groups', created);
    names.push(multi.name);
    const { byCity } = await waitGroupsFiring(page, multi, ['bangalore', 'mumbai']);
    const muted = byCity.mumbai.group_key;
    const other = byCity.bangalore.group_key;

    await ack.openDetail(multi.id);
    await ack.openGroupsTab();
    await ack.groupMute(muted, 'until-clear');
    await expect(ack.groupMuted(muted)).toBeVisible({ timeout: 15000 });
    await expect(ack.groupMuted(other)).toHaveCount(0);
    const chip = (await listItem(page, multi.name)).active_downtime;
    expect(chip.end_on_clear).toEqual({ alert_id: multi.id, group_key: muted });
    expect(chip.alert_groups).toHaveLength(1);
    expect(chip.alert_groups[0]).toMatchObject({ alert_id: multi.id, group_key: muted, group_labels: { city: 'mumbai' } });
    await shoot(page, 'mk2-groups-one-muted');

    const groups = await getAlertGroups(page, multi.id);
    expect((groups.list || []).filter((g) => isFiringOutcome(g.last_outcome)).length).toBeGreaterThanOrEqual(2);
  });

  test('detail: the Incident tile names the firing incident and opens it (MK-1)', async ({ page }) => {
    test.skip(!(await incidentsEnabled(page)), 'incidents_enabled is false, so no firing joins an incident');
    const alert = await createFiringSingle(page, 'ack_incident', created, { creates_incident: true });
    names.push(alert.name);
    await waitFiring(page, alert);
    const item = await pollUntil(page, () => listItem(page, alert.name), (a) => !!a?.incident?.id,
      { timeoutMs: 180_000, onTick: alert.feed });
    await ack.openDetail(alert.id);
    const tile = page.locator('[data-test="alerts-alertdetail-tile-incident"]');
    await expect(tile).toContainText('Incident');
    await expect(tile).toContainText(item.incident.title || item.incident.id);
    await shoot(page, 'mk1-detail-incident');
    await tile.click();
    await expect(page).toHaveURL(new RegExp(`/incidents/${item.incident.id}`));
  });
});
