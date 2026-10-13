// Copyright 2026 OpenObserve Inc.
//
// Settings Query Management Redirect — navigation/gating E2E tests.
//
// Query Management ("Running Queries") is an enterprise-only, meta-org-only
// settings section. On an OSS build the observable behavior is: (1) the Query
// Management tab is absent from the Settings rail, and (2) a direct URL to
// /settings/query_management redirects to the enterprise-locked page. The runtime
// "redirect back to General Settings" guard (PR #14803) is enterprise-only
// dead code on OSS, so it is recorded as a fixme gap rather than exercised.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Settings Query Management Redirect testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  const orgId = process.env['ORGNAME'] || 'default';

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test("should hide the Query Management tab from the Settings rail on an OSS build", {
    tag: ['@query-management-redirect', '@all', '@oss', '@P0']
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'opensource', `Runs only on OSS build (detected: ${edition})`);

    await pm.queryManagementPage.navigateToSettingsGeneral(orgId);
    await pm.queryManagementPage.expectSettingsRailVisible();
    await pm.queryManagementPage.expectGeneralPageTitleVisible();
    await pm.queryManagementPage.expectQueryManagementTabAbsent();

    testLogger.info('Query Management tab correctly absent from the OSS Settings rail');
  });

  test("should redirect to the enterprise-locked page when navigating directly to /settings/query_management on OSS", {
    tag: ['@query-management-redirect', '@all', '@oss', '@P0']
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'opensource', `Runs only on OSS build (detected: ${edition})`);

    await pm.queryManagementPage.navigateToQueryManagement(orgId);
    await pm.queryManagementPage.expectEnterpriseLockedPage();

    testLogger.info('Direct Query Management URL correctly redirects to the enterprise-locked page on OSS');
  });

  test("redirects Query Management back to General Settings outside the meta org (enterprise)", {
    tag: ['@query-management-redirect', '@all', '@enterprise', '@P1']
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'enterprise', `Runs only on Enterprise build (detected: ${edition})`);

    // PR #14803 (#12791): query_management is meta-org-only; on a non-meta org the guard redirects to General.
    await pm.queryManagementPage.navigateToQueryManagement(orgId);
    await pm.queryManagementPage.expectGeneralPageTitleVisible();
  });

  test("drills into a user's queries from User Summary on every click, not only the first (enterprise)", {
    tag: ['@query-management-drill-through', '@all', '@enterprise', '@P2']
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'enterprise', `Runs only on Enterprise build (detected: ${edition})`);

    // o2-enterprise#2876: the second drill-through left the User Summary table showing.
    const email = 'drill.user@example.com';
    const now = Date.now() * 1000;
    const runningQuery = (traceId, userId) => ({
      trace_id: traceId,
      user_id: userId,
      org_id: '_meta',
      search_type: 'dashboards',
      created_at: now - 5000000,
      started_at: now - 5000000,
      status: 'running',
      work_group: 'default',
      stream_type: 'logs',
      query: { start_time: now - 60000000, end_time: now, sql: 'SELECT 1' },
      scan_stats: { files: 1, records: 1, original_size: 1, compressed_size: 1 },
      search_event_context: { folder_name: 'f', dashboard_name: 'd' },
    });
    await pm.queryManagementPage.stubRunningQueries('_meta', [
      runningQuery('trace-a', email),
      runningQuery('trace-b', email),
      runningQuery('trace-c', 'other.user@example.com'),
    ]);

    await pm.queryManagementPage.navigateToRunningQueries('_meta');

    for (const round of [1, 2, 3]) {
      testLogger.info(`Drill-through round ${round}`);
      await pm.queryManagementPage.drillIntoUser(email);
      await pm.queryManagementPage.expectAllQueriesViewFor(email);

      await pm.queryManagementPage.selectQueryTypeTab('summary');
      await expect(pm.queryManagementPage.summaryList).toBeVisible();
    }
  });
});
