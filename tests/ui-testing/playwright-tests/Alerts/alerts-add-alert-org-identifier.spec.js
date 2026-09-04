// Copyright 2026 OpenObserve Inc.

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { seedAlertFixtures, createAlertFolder, uniq } = require('../utils/alerts-api-helpers.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe('Alert creation redirect preserves org identifier', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await seedAlertFixtures(page);
    await navigateToBase(page);
  });

  test('back redirect preserves org_identifier and folder (folder=default)', { tag: ['@alerts', '@alerts-add-alert-org-identifier', '@all'] }, async ({ page }) => {
    const org = getOrgIdentifier();
    testLogger.info('Opening add-alert form in org', { org });
    await page.goto(`/web/alerts/add?org_identifier=${org}&folder=default`);
    await pm.alertsPage.expectAddAlertFormVisible();
    testLogger.info('Clicking header back button and asserting org/folder preservation');
    await pm.alertsPage.expectBackRedirectPreservesOrg(org, 'default');
    testLogger.info('Test completed');
  });

  test('back redirect preserves a non-default folder value', { tag: ['@alerts', '@alerts-add-alert-org-identifier', '@all'] }, async ({ page }) => {
    const org = getOrgIdentifier();
    // Seed a real folder so AlertList doesn't normalize a nonexistent folder back to default (racing the assertion).
    const folderId = await createAlertFolder(page, uniq('prod_alerts'));
    testLogger.info('Opening add-alert form with non-default folder', { org, folder: folderId });
    await page.goto(`/web/alerts/add?org_identifier=${org}&folder=${folderId}`);
    await pm.alertsPage.expectAddAlertFormVisible();
    testLogger.info('Clicking header back button and asserting org/folder preservation');
    await pm.alertsPage.expectBackRedirectPreservesOrg(org, folderId);
    testLogger.info('Test completed');
  });
});
