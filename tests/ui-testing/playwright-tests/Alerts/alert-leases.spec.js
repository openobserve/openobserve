// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  uniq, simpleAlert, createAlertForId, getAlert, deleteAlerts, seedAlertFixturesOnce,
} = require('../utils/alerts-api-helpers.js');
const {
  MINUTE_MS, usFromNow, createTemporaryAlert, setCreatesIncident, listLeases, activeLease, endLease, keepLease,
} = require('../utils/alert-lease-helpers.js');

const ROOT = process.env.ZO_ROOT_USER_EMAIL;
const REASON = 'checkout stopped receiving data';

test.describe.configure({ mode: 'parallel' });

test.describe('Alert leases — temporary alerts and timed incident creation', { tag: ['@alerts', '@alert-leases', '@P1'] }, () => {
  let pm;
  let ack;
  let lease;
  let created;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    ack = pm.alertAckPage;
    lease = pm.alertLeasePage;
    created = [];
    await seedAlertFixturesOnce(page);
    await navigateToBase(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteAlerts(page, created);
  });

  test('list: a temporary alert shows who created it and when it ends, the hover gives the reason, a plain alert shows no chip', async ({ page }) => {
    const base = uniq('lease_list');
    const temp = `${base}_tmp`;
    const plain = `${base}_plain`;
    created.push(await createTemporaryAlert(page, temp, { endsAtUs: usFromNow(120 * MINUTE_MS), reason: REASON }));
    created.push(await createAlertForId(page, simpleAlert(plain)));

    await ack.openList();
    await lease.searchList(base);
    await expect(lease.listRow(temp)).toBeVisible({ timeout: 30000 });
    await expect(lease.listRow(plain)).toBeVisible({ timeout: 30000 });

    const chip = lease.listChip(temp, 'created');
    await lease.expectChip(chip, 'created', ROOT);
    await lease.expectTooltip(chip, 'created', ROOT, REASON);
    await expect(lease.anyListChip(temp)).toHaveCount(1);
    await expect(lease.anyListChip(plain)).toHaveCount(0);
  });

  test('detail: the header shows the same temporary-alert chip as the list row', async ({ page }) => {
    const name = uniq('lease_detail');
    const id = await createTemporaryAlert(page, name, { endsAtUs: usFromNow(120 * MINUTE_MS), reason: REASON });
    created.push(id);

    await ack.openList();
    await lease.searchList(name);
    await lease.expectChip(lease.listChip(name, 'created'), 'created', ROOT);
    const listText = (await lease.listChip(name, 'created').textContent()).trim();

    await ack.openDetail(id);
    const chip = lease.detailChip('created');
    await lease.expectChip(chip, 'created', ROOT);
    await expect(chip).toHaveText(listText, { timeout: 15000 });
    await lease.expectTooltip(chip, 'created', ROOT, REASON);
    await expect(lease.anyDetailChip()).toHaveCount(1);
  });

  test('timed incident-creation changes show "turned on/off until" chips; an untimed change shows none', async ({ page }) => {
    const base = uniq('lease_incident');
    const onName = `${base}_on`;
    const offName = `${base}_off`;
    const untimedName = `${base}_untimed`;
    const onId = await createAlertForId(page, simpleAlert(onName));
    created.push(onId);
    const offId = await createAlertForId(page, simpleAlert(offName));
    created.push(offId);
    const untimedId = await createAlertForId(page, simpleAlert(untimedName));
    created.push(untimedId);

    const untilUs = usFromNow(120 * MINUTE_MS);
    const on = await setCreatesIncident(page, onId, { value: true, untilUs, reason: REASON });
    expect(on).toMatchObject({ creates_incident: true, lease: { kind: 'creates_incident', set_value: true, state: 'active', set_by: ROOT } });
    const off = await setCreatesIncident(page, offId, { value: false, untilUs, reason: REASON });
    expect(off).toMatchObject({ creates_incident: false, lease: { kind: 'creates_incident', set_value: false, state: 'active' } });
    const untimed = await setCreatesIncident(page, untimedId, { value: true });
    expect(untimed.creates_incident).toBe(true);
    expect(untimed.lease).toBeUndefined();
    expect(await listLeases(page, untimedId)).toEqual([]);

    await ack.openList();
    await lease.searchList(base);
    await expect(lease.listRow(untimedName)).toBeVisible({ timeout: 30000 });
    const onChip = lease.listChip(onName, 'creates_incident');
    await lease.expectChip(onChip, 'on', ROOT);
    await lease.expectTooltip(onChip, 'on', ROOT, REASON);
    await lease.expectChip(lease.listChip(offName, 'creates_incident'), 'off', ROOT);
    await expect(lease.anyListChip(onName)).toHaveCount(1);
    await expect(lease.anyListChip(offName)).toHaveCount(1);
    await expect(lease.anyListChip(untimedName)).toHaveCount(0);
  });

  test('ending a temporary alert early removes its chip and pauses it', async ({ page }) => {
    const name = uniq('lease_end');
    const id = await createTemporaryAlert(page, name, { endsAtUs: usFromNow(120 * MINUTE_MS), reason: REASON });
    created.push(id);
    const active = await activeLease(page, id, 'created');

    await ack.openList();
    await lease.searchList(name);
    await lease.expectChip(lease.listChip(name, 'created'), 'created', ROOT);
    await lease.expectRowEnabled(name, true);

    expect((await endLease(page, id, active.id)).state).toBe('ended');
    expect((await getAlert(page, id))?.enabled).toBe(false);

    await lease.reloadList();
    await lease.searchList(name);
    await expect(lease.listRow(name)).toBeVisible({ timeout: 30000 });
    await expect(lease.anyListChip(name)).toHaveCount(0, { timeout: 15000 });
    await lease.expectRowEnabled(name, false);
  });

  test('keeping a temporary alert removes its chip and leaves it running', async ({ page }) => {
    const name = uniq('lease_keep');
    const id = await createTemporaryAlert(page, name, { endsAtUs: usFromNow(120 * MINUTE_MS), reason: REASON });
    created.push(id);
    const active = await activeLease(page, id, 'created');

    await ack.openList();
    await lease.searchList(name);
    await lease.expectChip(lease.listChip(name, 'created'), 'created', ROOT);

    expect((await keepLease(page, id, active.id)).state).toBe('kept');
    expect((await getAlert(page, id))?.enabled).toBe(true);

    await lease.reloadList();
    await lease.searchList(name);
    await expect(lease.listRow(name)).toBeVisible({ timeout: 30000 });
    await expect(lease.anyListChip(name)).toHaveCount(0, { timeout: 15000 });
    await lease.expectRowEnabled(name, true);
  });

  test('a chip left open on the list disappears by itself when its lease ends, without a refetch', async ({ page }) => {
    // Waits on wall-clock time: the lease must outlast page load, then run out while the page sits open.
    test.setTimeout(5 * 60 * 1000);
    const name = uniq('lease_countdown');
    const endsAtUs = usFromNow(90 * 1000);
    created.push(await createTemporaryAlert(page, name, { endsAtUs, reason: REASON }));

    await ack.openList();
    await lease.searchList(name);
    const chip = lease.listChip(name, 'created');
    await lease.expectChip(chip, 'created', ROOT);
    const fetches = lease.recordListFetches();

    await expect(chip).toHaveCount(0, { timeout: 120000 });
    expect(Date.now(), 'chip must not vanish before the lease ends').toBeGreaterThanOrEqual(endsAtUs / 1000 - 5000);
    await expect(lease.listRow(name)).toBeVisible();
    expect(fetches, 'the chip must hide on the client countdown, not on a list refetch').toEqual([]);
  });
});
