// Runs the builders' SQL on the real engine over a seeded history and asserts the numbers the UI renders (AC-56).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { encodeDef } = require('../../pages/rumPages/rumProductAnalyticsPage.js');
const { rumTestContext } = require('../utils/rum-env.js');
const { seedRumAnalytics, runAppId, DAY_MS, HOUR_MS } = require('../utils/rum-analytics-ingestion.js');

const NOW = Date.now();
let facts = null;

test.describe('RUM Product Analytics on the real engine', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ timezoneId: 'UTC' });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    facts = await seedRumAnalytics(page, { appId: runAppId('pa-engine'), nowMs: NOW });
    await page.close();
    testLogger.info('Engine seed ready', { appId: facts.appId, sessions: facts.sessions });
  });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test('Pages list renders the page-key template of every vector (AC-4)', {
    tag: ['@rum', '@rumAnalytics', '@P0'],
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    // Only the key-vector sessions fall in this window, so all keys fit on one page of the list.
    const from = (NOW - 3 * DAY_MS - 3 * HOUR_MS - 60000) * 1000;
    const to = (NOW - 3 * DAY_MS - HOUR_MS) * 1000;
    await pa.goto('overview', { app: facts.appId, from, to });
    const keys = await pa.rankedKeys('pages');
    for (const v of facts.pageKeys) expect(keys, `page key for ${v.key}`).toContain(v.key);
    const body = await pa.overview.innerText();
    for (const secret of ['eyJhbGci', 'ana%40example.com', '12345', 'abc%2Bdef', '6c3984ca0a']) {
      expect(body, `raw URL fragment ${secret} never renders`).not.toContain(secret);
    }
  });

  test('Clicks list renders templated click keys and never the raw name (AC-43)', {
    tag: ['@rum', '@rumAnalytics', '@P0'],
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const from = (NOW - 3 * DAY_MS - 3 * HOUR_MS - 60000) * 1000;
    const to = (NOW - 3 * DAY_MS - HOUR_MS) * 1000;
    await pa.goto('overview', { app: facts.appId, from, to });
    const keys = await pa.rankedKeys('clicks');
    for (const v of facts.clickKeys) expect(keys, `click key for ${v.name}`).toContain(v.key);
    const body = await pa.overview.innerText();
    for (const secret of ['ana@example.com', '12345678', '3fa85f64']) {
      expect(body, `raw click fragment ${secret} never renders`).not.toContain(secret);
    }
  });

  test('Funnel counts match the seed, including B,A,B and B-then-A (AC-12)', {
    tag: ['@rum', '@rumAnalytics', '@P0'],
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    const { a, b, c } = facts.funnel;
    const funnel = encodeDef({ s: [['p', a], ['c', b], ['p', c]], u: 'sessions', w: 'session' });
    await pa.goto('funnels', { app: facts.appId, period: '7d', funnel });
    await pa.expectFunnelCounts(facts.funnel.counts);
    await expect(pa.funnelOrderLabel).toContainText('In order (other events allowed between)');

    // B then A: s4 (B,A,B) and s5 (B,A) both reach A after B; s1 and s2 do not.
    const reversed = encodeDef({ s: [['c', b], ['p', a]], u: 'sessions', w: 'session' });
    await pa.goto('funnels', { app: facts.appId, period: '7d', funnel: reversed });
    await pa.expectFunnelCounts([4, 2]);
  });

  test('Weekly retention grid cells match the seeded users, On and On or after (AC-31)', {
    tag: ['@rum', '@rumAnalytics', '@P0'],
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.pinRumDataStart(facts.retentionFromMs * 1000);
    await pa.goto('retention', {
      app: facts.appId,
      from: facts.retentionFromMs * 1000,
      to: NOW * 1000,
      per: 'week',
    });
    await expect(pa.retentionGrid).toBeVisible({ timeout: 45000 });
    await expect(pa.retentionCell(0, 0)).toBeVisible({ timeout: 45000 });
    // Week 0 cohort r1 and r2: r1 returns in weeks 1 and 2, r2 only in week 2.
    expect(await pa.retentionPct(0, 0)).toBe(100);
    expect(await pa.retentionPct(0, 1)).toBe(50);
    expect(await pa.retentionPct(0, 2)).toBe(100);
    // Week 1 cohort r3 never returns.
    expect(await pa.retentionPct(1, 0)).toBe(100);
    expect(await pa.retentionPct(1, 1)).toBe(0);

    await page.locator('[data-test="rum-analytics-retention-mode-after"]').click();
    await expect.poll(() => pa.retentionPct(0, 1), { timeout: 20000 }).toBe(100);
    expect(await pa.retentionPct(0, 2)).toBe(100);
    expect(await pa.retentionPct(1, 1)).toBe(0);
    expect(new URL(page.url()).searchParams.get('rmode')).toBe('after');
  });

  const basic = (user, pass) => ({ Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` });
  const eventsUrl = (baseUrl, orgId) =>
    `${baseUrl}/api/${orgId}/rum/analytics/named_events?app=${encodeURIComponent(facts.appId)}`;
  // page.request carries the global login's root cookie, which the server prefers over a Basic header.
  const apiAs = (playwright, headers) =>
    playwright.request.newContext({ extraHTTPHeaders: headers, storageState: { cookies: [], origins: [] } });

  test('a viewer role lists named events but gets 403 creating one (enterprise only)', {
    tag: ['@rum', '@rumAnalytics', '@enterprise', '@P1'],
  }, async ({ page, playwright }) => {
    const { orgId, baseUrl, email, password } = rumTestContext();
    const config = await (await page.request.get(`${baseUrl}/config`)).json();
    test.skip(config.build_type === 'opensource', 'RUM Product Analytics RBAC is enterprise-only');

    const root = await apiAs(playwright, basic(email, password));
    const viewer = `pa-viewer-${facts.appId}@e2e.test`;
    const viewerPassword = 'Viewer#12345678';
    let asViewer = null;
    let strayId = null;
    try {
      const created = await root.post(`${baseUrl}/api/${orgId}/users`, {
        data: { email: viewer, password: viewerPassword, role: 'viewer', first_name: 'pa', last_name: 'viewer' },
      });
      expect(created.ok(), await created.text()).toBe(true);
      asViewer = await apiAs(playwright, basic(viewer, viewerPassword));
      expect((await asViewer.get(eventsUrl(baseUrl, orgId))).status()).toBe(200);
      const res = await asViewer.post(eventsUrl(baseUrl, orgId), {
        data: { name: 'Viewer write', rules: [{ t: 'view', op: 'eq', value: '/web/a' }] },
      });
      if (res.status() === 201) strayId = (await res.json()).id;
      expect(res.status(), await res.text()).toBe(403);
    } finally {
      if (strayId) {
        await root.delete(
          `${baseUrl}/api/${orgId}/rum/analytics/named_events/${strayId}?app=${encodeURIComponent(facts.appId)}&force=true`,
        );
      }
      await root.delete(`${baseUrl}/api/${orgId}/users/${encodeURIComponent(viewer)}`);
      await asViewer?.dispose();
      await root.dispose();
    }
  });

  // A role built only from the preset dropdown, assigned to a user with no base rights (CR-31).
  for (const [preset, canWrite] of [['rum_viewer', false], ['rum_editor', true]]) {
    test(`a ${preset} preset role reads RUM data and ${canWrite ? 'can' : 'cannot'} write named events (enterprise only)`, {
      tag: ['@rum', '@rumAnalytics', '@enterprise', '@P1'],
    }, async ({ page, playwright }) => {
      const { orgId, baseUrl, email, password } = rumTestContext();
      const config = await (await page.request.get(`${baseUrl}/config`)).json();
      test.skip(config.build_type === 'opensource', 'Custom roles are enterprise-only');

      const iam = new PageManager(page).iamFormValidation;
      const role = `pa_${preset}_${facts.appId.slice(-8)}`.replace(/-/g, '_');
      const user = `pa-${preset}-${facts.appId}@e2e.test`;
      const userPassword = 'Preset#12345678';
      let eventId = null;
      const root = await apiAs(playwright, basic(email, password));
      let asUser = null;
      try {
        await navigateToBase(page);
        await iam.navigateToRolesTab();
        await iam.openRoleForm();
        await iam.fillRoleName(role);
        await iam.getRoleStartFromSelectLocator().click();
        for (const v of ['custom', 'readonly', 'dbm', 'k8s', 'rum_viewer', 'rum_editor']) {
          await expect(iam.getRoleStartFromOptionLocator(v)).toBeVisible();
        }
        await iam.getRoleStartFromOptionLocator(preset).click();
        await iam.submitRoleForm();
        await expect(page).toHaveURL(new RegExp(`preset=${preset}`), { timeout: 30000 });
        const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes(`/roles/${role}`));
        await page.locator('[data-test="edit-role-save-btn"]').click();
        expect((await saved).ok()).toBe(true);

        const made = await root.post(`${baseUrl}/api/${orgId}/users`, {
          data: { email: user, password: userPassword, role: 'user', first_name: 'pa', last_name: preset },
        });
        expect(made.ok(), await made.text()).toBe(true);
        const bound = await root.put(`${baseUrl}/api/${orgId}/roles/${role}`, {
          data: { add: [], remove: [], add_users: [user], remove_users: [] },
        });
        expect(bound.ok(), await bound.text()).toBe(true);

        asUser = await apiAs(playwright, basic(user, userPassword));
        const search = await asUser.post(`${baseUrl}/api/${orgId}/_search?type=logs&search_type=RUM`, {
          data: {
            query: {
              sql: `SELECT COUNT(*) AS n FROM "_rumdata" WHERE application_id = '${facts.appId}'`,
              start_time: (NOW - 30 * DAY_MS) * 1000,
              end_time: (NOW + HOUR_MS) * 1000,
              from: 0,
              size: 1,
            },
          },
        });
        expect(search.status(), await search.text()).toBe(200);
        expect((await asUser.get(eventsUrl(baseUrl, orgId))).status()).toBe(200);
        const write = await asUser.post(eventsUrl(baseUrl, orgId), {
          data: { name: `Preset ${preset}`, rules: [{ t: 'view', op: 'eq', value: '/web/a' }] },
        });
        if (write.status() === 201) eventId = (await write.json()).id;
        expect(write.status(), await write.text()).toBe(canWrite ? 201 : 403);
      } finally {
        if (eventId) {
          await root.delete(
            `${baseUrl}/api/${orgId}/rum/analytics/named_events/${eventId}?app=${encodeURIComponent(facts.appId)}&force=true`,
          );
        }
        await root.delete(`${baseUrl}/api/${orgId}/users/${encodeURIComponent(user)}`);
        await root.delete(`${baseUrl}/api/${orgId}/roles/${role}`);
        await asUser?.dispose();
        await root.dispose();
      }
    });
  }
});
