// Copyright 2026 OpenObserve Inc.


const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { seedAlertFixtures, deleteAlerts, api, urls } = require('../utils/alerts-api-helpers.js');
const {
  createFiringSingle, createFiringMulti, waitFiring, waitGroupsFiring, downtime, endMutes, shoot,
} = require('../utils/alert-ack-mute-helpers.js');

const ROOT = process.env.ZO_ROOT_USER_EMAIL;

async function muteViaApi(page, alertId, body) {
  const r = await api(page, 'post', `${urls().v2}/alerts/${alertId}/mute?folder=default`, body);
  if (r.status() !== 201) throw new Error(`mute ${alertId}: ${r.status()} ${await r.text()}`);
  return r.json();
}

test.describe.configure({ mode: 'serial' });

test.describe('Downtimes list — quick mutes from an alert', { tag: ['@alerts', '@downtimes', '@P1'] }, () => {
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

  test('a group mute shows its Group chip, then +N for more groups; until-clear says how it ends', async ({ page }) => {
    const multi = await createFiringMulti(page, 'dt_group', created, ['bangalore', 'mumbai', 'delhi']);
    names.push(multi.name);
    const { byCity } = await waitGroupsFiring(page, multi, ['bangalore', 'mumbai', 'delhi']);

    const one = await muteViaApi(page, multi.id, { until_clear: true, group_keys: [byCity.mumbai.group_key] });
    expect(one.alert_groups).toEqual([{ alert_id: multi.id, group_key: byCity.mumbai.group_key, group_labels: { city: 'mumbai' } }]);

    await ack.openDowntimes();
    await expect(ack.downtimeCell(one.downtime_id, 'quick-mute')).toBeVisible();
    await expect(ack.downtimeCell(one.downtime_id, 'targets')).toContainText('city=mumbai');
    await expect(ack.downtimeCell(one.downtime_id, 'schedule')).toContainText('Until it clears');
    await expect(ack.downtimeCell(one.downtime_id, 'schedule')).toContainText('24 h at most');
    await expect(ack.downtimeCell(one.downtime_id, 'when')).toContainText('ends when it clears');
    await shoot(page, 'mk19-list-group-chip');

    // The Group chip and the Ends text stay whole on a 1400 px window.
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(ack.downtimeCell(one.downtime_id, 'targets')).toContainText('Group: city=mumbai');
    await shoot(page, 'c5-mk19-list-1400');
    await page.setViewportSize(viewport);

    await api(page, 'post', `${urls().v2}/alerts/${multi.id}/mute/${one.downtime_id}/cancel?folder=default`);
    const many = await muteViaApi(page, multi.id, {
      minutes: 60,
      group_keys: ['bangalore', 'mumbai', 'delhi'].map((c) => byCity[c].group_key),
    });
    expect(many.alert_groups).toHaveLength(3);
    await ack.refreshDowntimes();
    await expect(ack.downtimeCell(many.downtime_id, 'targets-more')).toContainText('+');
    await shoot(page, 'mk19-list-group-more');
  });

  test('a quick mute is extended and ended from the list', async ({ page }) => {
    const alert = await createFiringSingle(page, 'dt_extend', created);
    names.push(alert.name);
    await waitFiring(page, alert);
    const muted = await muteViaApi(page, alert.id, { minutes: 30 });

    await ack.openDowntimes();
    await expect(ack.downtimeCell(muted.downtime_id, 'quick-mute')).toBeVisible();
    await page.locator(`[data-test="downtime-list-${muted.downtime_id}-extend"]`).click();
    await page.locator(`[data-test="downtime-list-${muted.downtime_id}-extend-1h"]`).click();
    await expect.poll(async () => (await downtime(page, muted.downtime_id))?.version, { timeout: 15000 }).toBeGreaterThan(muted.version);
    const extended = await downtime(page, muted.downtime_id);
    const end = (d) => d.schedule?.end ?? d.current_window?.end ?? d.ends_at;
    expect(end(extended) - muted.ends_at).toBeGreaterThanOrEqual(3600 * 1e6 - 5e6);
    await shoot(page, 'mk19-list-extended');

    await page.locator(`[data-test="downtime-list-${muted.downtime_id}-end-now"]`).click();
    await page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]').click();
    await expect.poll(async () => (await downtime(page, muted.downtime_id))?.cancelled_at, { timeout: 15000 }).toBeTruthy();
    expect((await downtime(page, muted.downtime_id)).cancelled_by).toBe(ROOT);
  });
});
