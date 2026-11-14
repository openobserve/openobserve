// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  orgId, uniqueName, isOnCallAvailable, getRoutingConfig,
  seedOnCallStream, createPagingAlert, waitForPages, createTeam, deleteTeamById,
} = require('../utils/oncall-seed.js');
const { deleteAlertInDefaultFolder, deleteLogStream, resolveOnCallResponse } = require('../utils/regression-alert-fixtures.js');

test.describe('On-call: an unrouted page opens cleanly (ENT#3151)', {
  tag: ['@oncall', '@enterprise', '@regression'],
}, () => {
  test.describe.configure({ mode: 'serial' });
  const created = { stream: null, alertId: null, pageId: null, teamId: null, skip: '' };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(360000);
    const page = await browser.newPage();
    try {
      const probe = await isOnCallAvailable(page);
      if (!probe.available) { created.skip = probe.reason || 'on-call is not available'; return; }
      const routing = await getRoutingConfig(page);
      if (routing?.default_team_id) { created.skip = 'the org has a default team, so no page can be unrouted'; return; }
      // An org with no team at all opens no record, so a bystander team makes the firing unrouted rather than ignored.
      created.teamId = (await createTeam(page, { name: uniqueName('ovn_a_unrouted_team') })).id;
      created.stream = uniqueName('ovn_a_unrouted_s');
      await seedOnCallStream(page, created.stream, { minutes: 5 });
      const alert = await createPagingAlert(page, { name: uniqueName('ovn_a_unrouted'), stream: created.stream, priority: 1 });
      created.alertId = alert.id;
      const pages = await waitForPages(page, { alertId: alert.id, expectTeamId: null });
      created.pageId = pages[0].id;
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      if (created.alertId) await deleteAlertInDefaultFolder(page, created.alertId);
      if (created.pageId) await resolveOnCallResponse(page, created.pageId);
      if (created.teamId) await deleteTeamById(page, created.teamId);
      if (created.stream) await deleteLogStream(page, created.stream);
    } finally {
      await page.close();
    }
  });

  test('a teamless page asks for no team called null, throws nothing and reads Unrouted', { tag: ['@bug-3151', '@P2'] }, async ({ page }, testInfo) => {
    test.skip(!!created.skip, created.skip);
    testLogger.testStart(testInfo.title, testInfo.file);
    const nullTeamCalls = [];
    const pageErrors = [];
    page.on('request', (req) => { if (/\/oncall\/teams\/(null|undefined)\b/.test(req.url())) nullTeamCalls.push(req.url()); });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await navigateToBase(page);
    const pm = new PageManager(page);
    await pm.oncallResponseDetailPage.goto(orgId(), created.pageId);
    await pm.oncallResponseDetailPage.expectDetailVisible();
    await pm.oncallResponseDetailPage.expectUnrouted();
    await pm.oncallResponseDetailPage.expectNoTeamOnlyVerbs();
    // The null-team loads fired on mount pre-fix, so let in-flight requests land before asserting none did.
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    expect(nullTeamCalls, 'no request may address a team called null').toEqual([]);
    expect(pageErrors, 'opening the page must throw nothing').toEqual([]);
  });
});
