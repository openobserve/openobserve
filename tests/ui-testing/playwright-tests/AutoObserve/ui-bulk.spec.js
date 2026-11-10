// The bulk review drawer against a real server: creates only what is ticked, reports a refused folder per row, and Undo deletes exactly what it created.
const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const { BulkReviewPage, BASE } = require('../../pages/autoobservePages/bulkReviewPage.js');

const ORG = process.env.ORGNAME || 'default';
const READER = process.env.U4_READER_EMAIL || '';
const READER_PASSWORD = process.env.U4_READER_PASSWORD || '';
// lane: enterprise test build; oss: the same tree built without enterprise.
const BUILD = process.env.U4_BUILD || 'lane';
const INGEST = ['ingest-b', 'ingest-c', 'ingest-d'];
const GROUPS = ['team-ingest', '__no_team__', 'team-payments'];

const auth = () =>
  `Basic ${Buffer.from(`${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`).toString('base64')}`;

async function api(playwright, method, path, data) {
  const request = await playwright.request.newContext();
  const res = await request.fetch(`${BASE()}${path}`, { method, headers: { Authorization: auth() }, data });
  const body = await res.json().catch(() => null);
  await request.dispose();
  return { status: res.status(), body };
}

const folders = async (playwright) =>
  Object.fromEntries(
    ((await api(playwright, 'GET', `/api/v2/${ORG}/folders/alerts`)).body.list || []).map((f) => [f.name, f.folderId]),
  );

const alertsIn = async (playwright, folderId) =>
  (await api(playwright, 'GET', `/api/v2/${ORG}/alerts?folder=${folderId}`)).body.list || [];

const removeByName = async (playwright, folderId, names) => {
  for (const alert of await alertsIn(playwright, folderId)) {
    if (names.includes(alert.name)) await api(playwright, 'DELETE', `/api/v2/${ORG}/alerts/${alert.alert_id}?folder=${folderId}`);
  }
};

const noDataName = (key) => `svc-${key}-no-data`;
// The fields scenario's one creatable row: svc-ingest-b in namespace ns-b, whose stream fields the drawer reads.
const READ_B = 'svc-ingest-b-ns-b-no-data';

test.describe.configure({ mode: 'serial' });

test.describe('Bulk review drawer', { tag: ['@autoobserve', '@enterprise'] }, () => {
  test.skip(BUILD !== 'lane', 'enterprise test build only');
  let ids = {};

  test.beforeAll(async ({ playwright }) => {
    ids = await folders(playwright);
    expect(ids.ingest && ids.payments).toBeTruthy();
    const names = [...[...INGEST, 'ingest-e', 'ingest-f'].map(noDataName), READ_B];
    await removeByName(playwright, ids.ingest, names);
    if (!(await alertsIn(playwright, ids.ingest)).some((a) => a.name === 'keep-me')) {
      const keep = {
        name: 'keep-me', stream_type: 'logs', stream_name: 'ingest_b', is_real_time: false,
        query_condition: { type: 'sql', sql: 'SELECT count(*) AS n FROM "ingest_b"', conditions: null },
        trigger_condition: { period: 15, operator: '>=', threshold: 1, frequency: 5, silence: 10 },
        destinations: ['ingest-oncall'], enabled: false, description: 'made before the review',
      };
      expect((await api(playwright, 'POST', `/api/v2/${ORG}/alerts?folder=${ids.ingest}`, keep)).status).toBe(200);
    }
  });

  test('root creates exactly the three ticked alerts, and Undo deletes exactly those', async ({ page, playwright }) => {
    const bulk = new BulkReviewPage(page);
    await bulk.open(ORG);
    await expect(bulk.title).toHaveText('Add 12 no-data alerts');
    await expect(bulk.rule).toContainText('Nothing is saved until you click Add alerts.');
    await bulk.tickOnly(GROUPS, INGEST);
    await expect(bulk.footer).toContainText('3 alerts will be created in folder ingest.');
    await expect(bulk.create).toHaveText('Add alerts');
    await bulk.create.click();
    const toast = bulk.toast('3 alerts created in folder ingest.');
    await expect(toast).toBeVisible({ timeout: 30000 });
    await expect(bulk.drawer).toBeHidden();

    const created = (await alertsIn(playwright, ids.ingest)).filter((a) => INGEST.map(noDataName).includes(a.name));
    expect(created.map((a) => a.name).sort()).toEqual(INGEST.map(noDataName).sort());
    for (const alert of created) {
      expect(alert.description).toMatch(/^Created from an AutoObserve suggestion for svc-ingest-/);
    }

    await toast.locator('[data-test="o-toast-action-btn"]').click();
    await expect(bulk.toast('3 alerts removed.')).toBeVisible({ timeout: 30000 });
    const after = (await alertsIn(playwright, ids.ingest)).map((a) => a.name);
    expect(after.filter((n) => INGEST.map(noDataName).includes(n))).toEqual([]);
    expect(after).toContain('keep-me');
  });

  test('Undo is gone once the user leaves the page, and nothing is deleted later', async ({ page, playwright }) => {
    const bulk = new BulkReviewPage(page);
    await bulk.open(ORG);
    await bulk.tickOnly(GROUPS, ['ingest-e']);
    await bulk.create.click();
    await expect(bulk.toast('1 alert created in folder ingest.')).toBeVisible({ timeout: 30000 });
    await page.goto(`${BASE()}/web/alerts?org_identifier=${ORG}`);
    await expect(bulk.toast('1 alert created in folder ingest.')).toHaveCount(0);
    await page.waitForTimeout(3000);
    expect((await alertsIn(playwright, ids.ingest)).map((a) => a.name)).toContain(noDataName('ingest-e'));
    await removeByName(playwright, ids.ingest, [noDataName('ingest-e')]);
  });

  test('a reader sees a red reason for the folder they cannot write, and no retry for it', async ({ browser, playwright }) => {
    test.skip(!READER, 'needs U4_READER_EMAIL');
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(`${BASE()}/web/login`);
    await page.fill('[data-test="login-user-id-field"]', READER);
    await page.fill('[data-test="login-password-field"]', READER_PASSWORD);
    await page.locator('[data-test="login-sign-in"]').click();
    await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 60000 });

    const bulk = new BulkReviewPage(page);
    await bulk.open(ORG, 'm12', `ids=payments:${ids.payments},ingest:${ids.ingest}`);
    await bulk.tickOnly(GROUPS, ['ingest-e', 'ingest-f', 'j']);
    await bulk.create.click();
    await expect(bulk.failures).toContainText("1 of 3 alerts wasn't created.", { timeout: 30000 });
    await expect(bulk.failure('j')).toHaveText(
      "svc-j: You can't create alerts. Your role is missing the Create permission on Alerts. The alert was going to folder payments.",
    );
    await expect(bulk.retry('j')).toHaveCount(0);
    await expect(bulk.rowResult('ingest-e', 'created')).toBeVisible();
    await expect(bulk.rowResult('j', 'failed')).toBeVisible();
    expect((await alertsIn(playwright, ids.payments)).map((a) => a.name)).not.toContain(noDataName('j'));

    await bulk.toast('2 alerts created in folder ingest.').locator('[data-test="o-toast-action-btn"]').click();
    await expect(bulk.toast('2 alerts removed.')).toBeVisible({ timeout: 30000 });
    const left = (await alertsIn(playwright, ids.ingest)).map((a) => a.name);
    expect(left).not.toContain(noDataName('ingest-e'));
    expect(left).not.toContain(noDataName('ingest-f'));
    await context.close();
  });

  test('rows say which stream field is missing, and only the row whose fields check out is created', async ({ page, playwright }) => {
    const bulk = new BulkReviewPage(page);
    await bulk.open(ORG, 'fields');
    await expect(bulk.reason('no-cluster')).toHaveText(
      "Stream ingest_c has no cluster field, so this alert can't be limited to cluster cluster-k.",
    );
    await expect(bulk.reason('no-service')).toHaveText(
      "Stream ingest_d has no service field, so this alert can't be limited to svc-ingest-d.",
    );
    await expect(bulk.reason('unreadable')).toHaveText(
      "Couldn't read the fields of stream gone_logs, so this alert can't be checked. Reopen the review to try again.",
      { timeout: 30000 },
    );
    await expect(bulk.reason('read-b')).toHaveCount(0, { timeout: 30000 });
    await expect(bulk.create).toHaveText('Add alerts');
    await bulk.create.click();
    const toast = bulk.toast('1 alert created in folder ingest.');
    await expect(toast).toBeVisible({ timeout: 30000 });
    const made = (await alertsIn(playwright, ids.ingest)).find((a) => a.name === READ_B);
    expect(made).toBeTruthy();
    const full = await api(playwright, 'GET', `/api/v2/${ORG}/alerts/${made.alert_id}?folder=${ids.ingest}`);
    expect(full.body.query_condition.sql).toContain(`"service_name" = 'svc-ingest-b'`);
    expect(full.body.query_condition.sql).toContain(`"k8s_namespace_name" = 'ns-b'`);
    await toast.locator('[data-test="o-toast-action-btn"]').click();
    await expect(bulk.toast('1 alert removed.')).toBeVisible({ timeout: 30000 });
    expect((await alertsIn(playwright, ids.ingest)).map((a) => a.name)).not.toContain(READ_B);
  });

  test("a second batch joins the first batch's Undo, which removes both", async ({ page, playwright }) => {
    // A phone, where the earlier toast would sit over the reopened review footer.
    await page.setViewportSize({ width: 390, height: 844 });
    const bulk = new BulkReviewPage(page);
    await bulk.open(ORG);
    await bulk.tickOnly(GROUPS, ['ingest-b']);
    await bulk.create.click();
    await expect(bulk.toast('1 alert created in folder ingest.')).toBeVisible({ timeout: 30000 });
    await bulk.openButton('m12').click();
    await expect(bulk.drawer).toBeVisible({ timeout: 30000 });
    await expect(bulk.toast('1 alert created in folder ingest.')).toHaveCount(0);
    await bulk.tickOnly(GROUPS, ['ingest-c']);
    await bulk.create.click();
    const toast = bulk.toast('2 alerts created in folder ingest.');
    await expect(toast).toBeVisible({ timeout: 30000 });
    await expect(bulk.toast('1 alert created in folder ingest.')).toHaveCount(0);
    const two = ['ingest-b', 'ingest-c'].map(noDataName);
    expect((await alertsIn(playwright, ids.ingest)).map((a) => a.name)).toEqual(expect.arrayContaining(two));
    await toast.locator('[data-test="o-toast-action-btn"]').click();
    await expect(bulk.toast('2 alerts removed.')).toBeVisible({ timeout: 30000 });
    const left = (await alertsIn(playwright, ids.ingest)).map((a) => a.name);
    expect(left.filter((n) => two.includes(n))).toEqual([]);
    expect(left).toContain('keep-me');
  });

  test('focus moves into the drawer and back to the button that opened it', async ({ page }) => {
    const bulk = new BulkReviewPage(page);
    await bulk.goto(ORG);
    const opener = bulk.openButton('one');
    await opener.click();
    await expect(bulk.drawer).toBeVisible({ timeout: 30000 });
    await expect(bulk.title).toHaveText('Add 1 no-data alert');
    expect(await bulk.drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await bulk.cancel.click();
    await expect(bulk.drawer).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test.describe('Bulk review on a build without enterprise', { tag: ['@autoobserve'] }, () => {
  test.skip(BUILD !== 'oss', 'OSS build only');

  test('the harness route and the drawer do not exist', async ({ page }) => {
    const bulk = new BulkReviewPage(page);
    await bulk.goto(ORG);
    await page.waitForTimeout(3000);
    await expect(bulk.harness).toHaveCount(0);
    await expect(bulk.drawer).toHaveCount(0);
  });
});
