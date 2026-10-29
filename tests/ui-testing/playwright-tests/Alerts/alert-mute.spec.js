// Copyright 2026 OpenObserve Inc.


const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { seedAlertFixtures, deleteAlerts } = require('../utils/alerts-api-helpers.js');
const {
  createFiringSingle, createFiringMulti, waitFiring, waitGroupsFiring, listItem, downtime,
  pollUntil, endMutes, shoot,
} = require('../utils/alert-ack-mute-helpers.js');

const SYSTEM = 'system@openobserve.ai';
const HOUR_US = 3600 * 1e6;

test.describe.configure({ mode: 'serial' });

test.describe('Quick Mute from an alert', { tag: ['@alerts', '@alerts-mute', '@P1'] }, () => {
  let pm;
  let ack;
  const created = [];
  const names = [];

  test.beforeEach(async ({ page }, testInfo) => {
    test.setTimeout(12 * 60 * 1000);
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

  test('the dialog leads with Until it clears; 24 h hints the end tomorrow and asks before muting', async ({ page }) => {
    const alert = await createFiringSingle(page, 'qm_dialog', created);
    names.push(alert.name);
    await waitFiring(page, alert);
    await ack.openDetail(alert.id);

    await ack.headerMute('until');
    await ack.expectDialogOpen();
    const items = ack.dialogRoot().locator('[data-test^="quick-mute-preset-"]');
    await expect(items.first()).toHaveAttribute('data-test', 'quick-mute-preset-untilClear');
    await expect(ack.presetItem('untilClear')).toHaveAttribute('data-state', 'on');
    await expect(page.locator(ack.dialog.untilClearHint)).toBeVisible();
    await shoot(page, 'mk4-dialog-until-clear');

    await ack.choosePreset('24h');
    await expect(page.locator(ack.dialog.endsIn)).toHaveText(/^Until \d{1,2}:\d{2}\s?[AP]M tomorrow\.$/);
    await expect(page.locator(ack.dialog.confirm24h)).toBeVisible();
    await expect(page.locator(ack.dialog.secondary)).toHaveText('Use until it clears');
    await shoot(page, 'mk4-dialog-24h-confirm');
    expect((await listItem(page, alert.name)).active_downtime ?? null).toBeNull();

    await ack.dialogSecondary();
    await expect(ack.dialogRoot()).toHaveCount(0, { timeout: 15000 });
    await ack.expectToast('tomorrow at the latest');
    await expect(ack.mutedChip()).toContainText('until it clears', { timeout: 15000 });
    const untilClear = (await listItem(page, alert.name)).active_downtime;
    expect(untilClear).toMatchObject({ source: 'openobserve', end_on_clear: { alert_id: alert.id } });
    await ack.headerEndMute();
    await expect(ack.mutedChip()).toHaveCount(0, { timeout: 15000 });

    await ack.headerMute('until');
    await ack.expectDialogOpen();
    await ack.choosePreset('24h');
    await ack.fillReason('planned failover');
    await expect(page.locator(ack.dialog.confirm24h)).toBeVisible();
    const t0 = Date.now() * 1000;
    await ack.dialogSubmit();
    await expect(ack.mutedChip()).toBeVisible({ timeout: 15000 });
    const day = (await listItem(page, alert.name)).active_downtime;
    expect(day.end_on_clear).toBeUndefined();
    expect(Math.abs(day.ends_at - (t0 + 24 * HOUR_US))).toBeLessThan(120 * 1e6);
    const row = await downtime(page, day.id);
    expect(row).toMatchObject({ reason: 'planned failover', source: 'openobserve' });
    expect(row.targets).toEqual([{ module: 'alerts', folders: { kind: 'all' }, ids: [alert.id] }]);
  });

  test('a group muted from its row with This group names only that group, labels and all', async ({ page }) => {
    const multi = await createFiringMulti(page, 'qm_group', created);
    names.push(multi.name);
    const { byCity } = await waitGroupsFiring(page, multi, ['bangalore', 'mumbai']);
    const key = byCity.mumbai.group_key;

    await ack.openDetail(multi.id);
    await ack.openGroupsTab();
    await ack.groupMute(key, 'until');
    await ack.expectDialogOpen();
    await expect(page.locator(ack.dialog.groups)).toBeVisible();
    await expect(page.locator(ack.dialog.groupsThis)).toHaveAttribute('data-state', 'on');
    await expect(page.locator(ack.dialog.groupSelect)).toContainText('mumbai');
    await shoot(page, 'mk4-dialog-this-group');
    await ack.choosePreset('1h');
    await ack.dialogSubmit();
    await expect(ack.dialogRoot()).toHaveCount(0, { timeout: 15000 });
    await expect(ack.groupMuted(key)).toBeVisible({ timeout: 15000 });
    await expect(ack.groupMuted(byCity.bangalore.group_key)).toHaveCount(0);

    const chip = (await listItem(page, multi.name)).active_downtime;
    expect(chip.alert_groups).toEqual([{ alert_id: multi.id, group_key: key, group_labels: { city: 'mumbai' } }]);
    expect(chip.end_on_clear).toBeUndefined();
  });

  test('Until it clears from a group row ends when that group clears, and the Downtimes list says OpenObserve ended it', async ({ page }) => {
    const multi = await createFiringMulti(page, 'qm_clear', created);
    names.push(multi.name);
    const { byCity } = await waitGroupsFiring(page, multi, ['bangalore', 'mumbai']);
    const key = byCity.mumbai.group_key;

    await ack.openDetail(multi.id);
    await ack.openGroupsTab();
    await ack.groupMute(key, 'until-clear');
    await expect(ack.groupMuted(key)).toBeVisible({ timeout: 15000 });
    const chip = (await listItem(page, multi.name)).active_downtime;
    expect(chip.end_on_clear).toEqual({ alert_id: multi.id, group_key: key });

    await ack.openDowntimes();
    await expect(ack.downtimeCell(chip.id, 'schedule')).toContainText('Until it clears');
    await expect(ack.downtimeCell(chip.id, 'schedule')).toContainText('24 h at most');
    await expect(ack.downtimeCell(chip.id, 'when')).toContainText('ends when it clears');
    await expect(ack.downtimeCell(chip.id, 'when')).toContainText(/by \d{1,2}:\d{2}\s?[AP]M tomorrow/);
    await expect(ack.downtimeCell(chip.id, 'targets')).toContainText('city=mumbai');
    await shoot(page, 'mk19-list-until-clear-active');

    // Only bangalore keeps breaching, so mumbai clears at its next run.
    const ended = await pollUntil(page, () => downtime(page, chip.id), (d) => !!d?.cancelled_at,
      { timeoutMs: 480_000, everyMs: 5000, onTick: () => multi.feed(['bangalore']) });
    expect(ended?.cancelled_at, JSON.stringify(ended)).toBeTruthy();
    expect(ended.cancelled_by).toBe(SYSTEM);

    await ack.refreshDowntimes();
    await expect(ack.downtimeCell(chip.id, 'when')).toContainText('when it cleared', { timeout: 15000 });
    await expect(ack.downtimeCell(chip.id, 'when')).not.toContainText('ended by');
    await shoot(page, 'mk19-list-ended-on-clear');
  });
});
