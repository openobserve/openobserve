// Copyright 2026 OpenObserve Inc.
//
// Settings Query Management Redirect — navigation/gating E2E tests.
//
// Query Management ("Running Queries") is an enterprise-only, meta-org-only
// settings section. On an OSS build the route is never registered and the
// sidebar tab is hidden, so the observable behavior is: (1) the Query
// Management tab is absent from the Settings rail, and (2) a direct URL to
// /settings/query_management falls through to the 404 page. The runtime
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

  test("should render the 404 page when navigating directly to /settings/query_management on OSS", {
    tag: ['@query-management-redirect', '@all', '@oss', '@P0']
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'opensource', `Runs only on OSS build (detected: ${edition})`);

    await pm.queryManagementPage.navigateToQueryManagement(orgId);
    await pm.queryManagementPage.expect404Page();

    testLogger.info('Direct Query Management URL correctly falls through to 404 on OSS');
  });

  test.fixme("Query Management → General Settings redirect is not wired on OSS — route never registered (useManagementRoutes.ts:145-159)", {
    tag: ['@query-management-redirect', '@all', '@enterprise', '@P1']
  }, async ({ page }) => {
    // The query_management route only registers inside `if (config.isEnterprise == "true")`,
    // so on OSS route.name never equals "query_management" and handleSettingsRouting's
    // redirect branch (index.vue:141-147) is dead code. Exercisable only on an enterprise
    // build against a non-meta org.
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'enterprise', `Runs only on Enterprise build (detected: ${edition})`);

    await pm.queryManagementPage.navigateToQueryManagement(orgId);
    await pm.queryManagementPage.expectGeneralPageTitleVisible();
  });
});
