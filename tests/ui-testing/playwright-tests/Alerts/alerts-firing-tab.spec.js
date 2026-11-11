// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  api, urls, uniq, ingest, findAlertIdInFolder, seedAlertFixtures, createAlertFolder,
  deleteAlertInFolder, deleteAlertFolder, DEST,
} = require('../utils/alerts-api-helpers.js');
const {
  fastSingleAlert, waitFiring, listItem, acks, createUser, deleteUser, ackAs, pollUntil, history,
} = require('../utils/alert-ack-mute-helpers.js');

const ROOT = process.env.ZO_ROOT_USER_EMAIL;
const BAD_DEST = 'firing_tab_bad_dest';

const fixtures = { folderId: null, folderName: null, alerts: {}, stream: null };

async function createIn(page, key, { folder = 'default', priority, destination = DEST }) {
  const name = uniq(`firing_${key}`);
  const r = await api(page, 'post', `${urls().v2}/alerts?folder=${folder}`, {
    ...fastSingleAlert(name, fixtures.stream),
    destinations: [destination],
    ...(priority ? { priority } : {}),
  });
  if (r.status() !== 200) throw new Error(`create ${name}: ${r.status()} ${await r.text()}`);
  const id = await findAlertIdInFolder(page, name, folder);
  fixtures.alerts[key] = { name, id, folder, feed: fixtures.feed };
}

async function seed(page) {
  if (fixtures.stream) return;
  await seedAlertFixtures(page);
  const { v1 } = urls();
  await api(page, 'post', `${v1}/alerts/destinations`, {
    name: BAD_DEST, url: 'http://127.0.0.1:9/nope', method: 'post', template: 'auto_p0_tmpl', type: 'http',
  }).catch(() => {});
  fixtures.stream = uniq('firing_tab_s');
  fixtures.feed = () => ingest(fixtures.page, fixtures.stream, [{ i: 1 }, { i: 2 }, { i: 3 }]);
  await fixtures.feed();
  fixtures.folderName = uniq('firing_folder');
  fixtures.folderId = await createAlertFolder(page, fixtures.folderName);
  await createIn(page, 'p1', { priority: 1 });
  await createIn(page, 'p3', { folder: fixtures.folderId, priority: 3 });
  await createIn(page, 'failed', { priority: 4, destination: BAD_DEST });
  await createIn(page, 'take', { folder: fixtures.folderId, priority: 2 });
  await createIn(page, 'bulk', { folder: fixtures.folderId, priority: 5 });
  for (const alert of Object.values(fixtures.alerts)) {
    await waitFiring(page, alert);
  }
  await pollUntil(page, () => listItem(page, fixtures.alerts.failed.name),
    (item) => item?.last_outcome === 'notify_failed',
    { timeoutMs: 180_000, onTick: fixtures.alerts.failed.feed });
}

test.describe.configure({ mode: 'serial' });

test.describe('Alerts Firing tab', { tag: ['@alerts', '@alerts-firing', '@P1'] }, () => {
  let firing;

  test.beforeEach(async ({ page }, testInfo) => {
    test.setTimeout(8 * 60 * 1000);
    testLogger.testStart(testInfo.title, testInfo.file);
    fixtures.page = page;
    await navigateToBase(page);
    await seed(page);
    await fixtures.feed();
    firing = new PageManager(page).alertFiringPage;
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    for (const alert of Object.values(fixtures.alerts)) await deleteAlertInFolder(page, alert.id, alert.folder);
    await deleteAlertFolder(page, fixtures.folderId);
    await api(page, 'delete', `${urls().v1}/alerts/destinations/${BAD_DEST}`).catch(() => {});
    await page.close();
  });

  test('Firing is the first tab, shows live counts, and /alerts still opens All alerts', async ({ page }) => {
    await firing.open();
    expect((await firing.tabOrder())[0]).toBe('alertFiring');
    const badge = Number(await page.locator('[data-test="alert-section-tab-alertFiring-badge"]').textContent());
    expect(badge).toBeGreaterThanOrEqual(Object.keys(fixtures.alerts).length);
    await expect(firing.chip('firing')).toContainText(String(badge));
    await expect(firing.chip('failed')).toContainText(/[1-9]/);
    await expect(firing.rowName(fixtures.alerts.p1.id)).toBeVisible({ timeout: 30000 });

    await firing.chip('failed').click();
    await expect(firing.rowName(fixtures.alerts.failed.id)).toBeVisible();
    await expect(firing.rowName(fixtures.alerts.p1.id)).toHaveCount(0);

    await page.goto(`/web/alerts?org_identifier=${urls().org}&folder=default`);
    await expect(firing.tab('alertList')).toHaveAttribute('aria-selected', 'true', { timeout: 30000 });
    await expect(page).not.toHaveURL(/alerts\/firing/);
  });

  test('a row opens the drawer without resizing the table; checkboxes only select; ?alert= links in', async ({ page }) => {
    const { p1, p3 } = fixtures.alerts;
    await firing.open();
    await expect(firing.rowName(p1.id)).toBeVisible({ timeout: 30000 });
    const before = await firing.table.boundingBox();

    await firing.rowName(p1.id).click();
    await expect(firing.drawerTitle).toContainText(p1.name);
    await expect(page).toHaveURL(new RegExp(`alert=${p1.id}`));
    const after = await firing.table.boundingBox();
    expect(after.width).toBe(before.width);

    await firing.rowName(p3.id).click();
    await expect(firing.drawerTitle).toContainText(p3.name);
    await expect(firing.drawerTitle).not.toContainText(p1.name);

    await firing.open(`&alert=${p1.id}`);
    await expect(firing.drawerTitle).toContainText(p1.name, { timeout: 30000 });
    await page.keyboard.press('Escape');
    await expect(firing.drawer).toBeHidden();

    await firing.rowCheckbox(p3.id).click();
    await expect(firing.bulkAck).toBeVisible();
    await expect(firing.drawer).toBeHidden();
    await expect(page).not.toHaveURL(/alert=/);
  });

  test('the drawer shows real history and View all opens the alert', async ({ page }) => {
    const { p1 } = fixtures.alerts;
    await pollUntil(page, () => history(page, p1.id), (hits) => hits.length > 0, { onTick: p1.feed });
    await firing.open(`&alert=${p1.id}`);
    await expect(firing.historyEvents.first()).toBeVisible({ timeout: 30000 });
    await expect(firing.logs).toHaveAttribute('href', /logs/);
    await firing.viewAll.click();
    await expect(page).toHaveURL(new RegExp(`alerts/detail/${p1.id}`));
  });

  test('bulk Acknowledge reports what it skipped', async ({ page }) => {
    const { bulk, p3 } = fixtures.alerts;
    await firing.open();
    await expect(firing.rowName(bulk.id)).toBeVisible({ timeout: 30000 });
    await firing.rowCheckbox(bulk.id).click();
    await firing.rowCheckbox(p3.id).click();
    await expect(firing.bulkAck).toContainText('2');

    // Someone else acks one between the selection and the click, so the server reports no change.
    const other = await createUser(page, 'admin');
    try {
      const raced = await ackAs(page, other, p3.id, { group_key: '' });
      expect(raced.status, raced.body).toBe(200);
    } finally {
      await deleteUser(page, other.email);
    }
    await firing.bulkAck.click();
    await expect(firing.toast.filter({ hasText: '1 acknowledged, 1 skipped' })).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => (await acks(page, bulk.id)).map((a) => a.acked_by)).toContain(ROOT);
  });

  test('Take over moves an ack from someone else to me', async ({ page }) => {
    const { take } = fixtures.alerts;
    const other = await createUser(page, 'admin');
    try {
      const held = await ackAs(page, other, take.id, { group_key: '' });
      expect(held.status, held.body).toBe(200);
      await firing.open();
      await firing.chip('acked').click();
      await expect(firing.rowName(take.id)).toBeVisible({ timeout: 30000 });
      await firing.rowName(take.id).click();
      await expect(firing.ackChip).toBeVisible({ timeout: 15000 });
      await firing.takeOver.click();
      await expect.poll(async () => (await acks(page, take.id))[0]?.acked_by, { timeout: 15000 }).toBe(ROOT);
      await expect(firing.takeOver).toBeHidden({ timeout: 15000 });
    } finally {
      await deleteUser(page, other.email);
    }
  });

  test('a dragged tab stays where it was dropped after a reload', async ({ page }) => {
    await firing.open();
    await expect(firing.tab('alertList')).toBeVisible();
    await firing.dragTab('alertList', 'alertFiring');
    await expect.poll(async () => (await firing.tabOrder())[0]).toBe('alertList');
    await page.reload();
    await expect(firing.tab('alertFiring')).toBeVisible({ timeout: 30000 });
    expect((await firing.tabOrder())[0]).toBe('alertList');
    await page.evaluate(() => localStorage.removeItem('o2_alert_section_tab_order'));
  });

  test('a failed refresh keeps the rows behind a Retry banner', async ({ page }) => {
    const { p1 } = fixtures.alerts;
    await firing.open();
    await expect(firing.rowName(p1.id)).toBeVisible({ timeout: 30000 });

    const pattern = (url) => firing.isListRequest(url);
    await page.route(pattern, (route) => route.abort());
    await firing.refresh.click();
    await expect(firing.banner).toBeVisible({ timeout: 15000 });
    await expect(firing.staleTag).toBeVisible();
    await expect(firing.rowName(p1.id)).toBeVisible();

    await page.unroute(pattern);
    await firing.retry.click();
    await expect(firing.banner).toBeHidden({ timeout: 15000 });
    await expect(firing.rowName(p1.id)).toBeVisible();
  });

  test('a search that hides everything shows the filtered empty state, not Nothing firing', async () => {
    await firing.open();
    await firing.search.fill('no_alert_has_this_name');
    await expect(firing.empty).toBeVisible();
    await expect(firing.empty).not.toContainText('Nothing firing');
  });
});
