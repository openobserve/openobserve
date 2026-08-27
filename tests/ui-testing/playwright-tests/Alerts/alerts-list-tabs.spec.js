// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const {
  uniq,
  createAlert,
  findAlertId,
  deleteAlerts,
  seedAlertFixtures,
  simpleAlert,
  realtimeAlert,
  compositeAlert,
} = require('../utils/alerts-api-helpers.js');

/**
 * Alerts list tab control — the AppTabs -> OToggleGroup migration.
 *
 * The four alert-type tabs moved into the table toolbar as an OToggleGroup with
 * data-test renamed tab-{value} -> alert-list-tab-{value}; the header gained a
 * subtitle and renders the section switcher below the title. These tests assert
 * the render surface and filter semantics directly (no wizard): fixtures are
 * seeded through the canonical API helper so is_real_time / alert_type are
 * deterministic, matching how alerts-composite-ui.spec.js and
 * alerts-priority-tags.spec.js already seed the same surfaces.
 */

/** Seed one alert via the API and return its { id, name }. */
async function seedAlert(page, payload, name) {
  const response = await createAlert(page, payload);
  expect(response.status(), await response.text()).toBe(200);
  const id = await findAlertId(page, name);
  expect(id).toBeTruthy();
  return { id, name };
}

test.describe('Alerts list tab control', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let createdIds;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    createdIds = [];
    await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await pm.alertsPage.waitForAlertListPageReady();
    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ page }) => {
    await deleteAlerts(page, [...createdIds].reverse());
  });

  test('should render the four OSS alert-type tabs and hide the enterprise-only Anomaly tab', {
    tag: ['@alerts-ui-refactor', '@alerts', '@all', '@P0'],
  }, async () => {
    testLogger.info('Verifying the migrated OToggleGroup tab control renders the four OSS tabs');

    await pm.alertsPage.expectAlertListPageVisible();
    await pm.alertsPage.expectAlertListTableVisible();
    await pm.alertsPage.expectAlertListTabsRender();

    testLogger.info('Test completed');
  });

  test('should set a tab active and filter rows to the matching alert type', {
    tag: ['@alerts-ui-refactor', '@alerts', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Seeding a realtime alert and a composite alert (two children)');
    await seedAlertFixtures(page);

    const realtimeName = uniq('rt_tab');
    const childAName = uniq('comp_child_a');
    const childBName = uniq('comp_child_b');
    const compositeName = uniq('comp_parent');

    const realtime = await seedAlert(page, realtimeAlert(realtimeName), realtimeName);
    const childA = await seedAlert(page, simpleAlert(childAName), childAName);
    const childB = await seedAlert(page, simpleAlert(childBName), childBName);
    const composite = await seedAlert(
      page,
      compositeAlert(compositeName, [childA.id, childB.id]),
      compositeName,
    );
    createdIds.push(realtime.id, childA.id, childB.id, composite.id);

    await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
    await pm.alertsPage.waitForAlertListPageReady();

    testLogger.info('All tab shows every seeded alert', { realtime: realtime.name, composite: composite.name });
    await pm.alertsPage.expectAlertListTabActive('all');
    await pm.alertsPage.expectAlertNameCellVisible(realtime.name);
    await pm.alertsPage.expectCompositeBadgeVisible(composite.id);

    testLogger.info('Composite tab shows only the composite alert');
    await pm.alertsPage.clickAlertListTab('composite');
    await pm.alertsPage.expectAlertListTabActive('composite');
    await pm.alertsPage.expectCompositeBadgeVisible(composite.id);
    await pm.alertsPage.expectAlertNameCellHidden(realtime.name);

    testLogger.info('Realtime tab shows only the realtime alert');
    await pm.alertsPage.clickAlertListTab('realTime');
    await pm.alertsPage.expectAlertListTabActive('realTime');
    await pm.alertsPage.expectAlertNameCellVisible(realtime.name);
    await pm.alertsPage.expectCompositeBadgeHidden(composite.id);

    testLogger.info('Test completed');
  });

  test('should exclude Composite from Scheduled and show only real-time rows on Realtime', {
    tag: ['@alerts-ui-refactor', '@alerts', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Seeding scheduled, realtime and composite alerts');
    await seedAlertFixtures(page);

    const scheduledName = uniq('sched_tab');
    const realtimeName = uniq('rt_tab');
    const childAName = uniq('comp_child_a');
    const childBName = uniq('comp_child_b');
    const compositeName = uniq('comp_parent');

    const scheduled = await seedAlert(page, simpleAlert(scheduledName), scheduledName);
    const realtime = await seedAlert(page, realtimeAlert(realtimeName), realtimeName);
    const childA = await seedAlert(page, simpleAlert(childAName), childAName);
    const childB = await seedAlert(page, simpleAlert(childBName), childBName);
    const composite = await seedAlert(
      page,
      compositeAlert(compositeName, [childA.id, childB.id]),
      compositeName,
    );
    createdIds.push(scheduled.id, realtime.id, childA.id, childB.id, composite.id);

    await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
    await pm.alertsPage.waitForAlertListPageReady();

    testLogger.info('Scheduled tab excludes composite and realtime rows');
    await pm.alertsPage.clickAlertListTab('scheduled');
    await pm.alertsPage.expectAlertListTabActive('scheduled');
    await pm.alertsPage.expectAlertNameCellVisible(scheduled.name);
    await pm.alertsPage.expectCompositeBadgeHidden(composite.id);
    await pm.alertsPage.expectAlertNameCellHidden(realtime.name);

    testLogger.info('Realtime tab shows only is_real_time === true rows');
    await pm.alertsPage.clickAlertListTab('realTime');
    await pm.alertsPage.expectAlertListTabActive('realTime');
    await pm.alertsPage.expectAlertNameCellVisible(realtime.name);
    await pm.alertsPage.expectAlertNameCellHidden(scheduled.name);
    await pm.alertsPage.expectCompositeBadgeHidden(composite.id);

    testLogger.info('Test completed');
  });

  test('should render the header subtitle and navigate the four section tabs', {
    tag: ['@alerts-ui-refactor', '@alerts', '@all', '@P1'],
  }, async () => {
    testLogger.info('Verifying the page header subtitle and section switcher');

    await pm.alertsPage.expectHeaderTitleVisible();
    await pm.alertsPage.expectHeaderSubtitleVisible();
    await pm.alertsPage.expectSectionTabsVisible();
    await pm.alertsPage.expectSectionTabActive('alertList');

    testLogger.info('Navigating each sibling section and asserting the route + shared header');
    await pm.alertsPage.clickSectionTab('alertDestinations');
    await pm.alertsPage.expectCurrentUrlContains('/web/alert-destinations/');
    await pm.alertsPage.expectHeaderSubtitleVisible();

    await pm.alertsPage.clickSectionTab('alertTemplates');
    await pm.alertsPage.expectCurrentUrlContains('/web/alert-templates/');
    await pm.alertsPage.expectHeaderSubtitleVisible();

    await pm.alertsPage.clickSectionTab('alertLibrary');
    await pm.alertsPage.expectCurrentUrlContains('/web/alert-library/');
    await pm.alertsPage.expectHeaderSubtitleVisible();

    await pm.alertsPage.clickSectionTab('alertList');
    await pm.alertsPage.expectCurrentUrlContains('/web/alerts/');
    await pm.alertsPage.expectHeaderSubtitleVisible();

    testLogger.info('Test completed');
  });

  test('should toggle the search scope between This folder and All folders', {
    tag: ['@alerts-ui-refactor', '@alerts', '@all', '@P1'],
  }, async () => {
    testLogger.info('Verifying the search scope toggle kept in the toolbar');

    await pm.alertsPage.expectSearchScopeCurrentActive();

    await pm.alertsPage.clickSearchScopeAcrossFolders();
    await pm.alertsPage.expectSearchScopeAcrossFoldersActive();

    await pm.alertsPage.clickSearchScopeCurrent();
    await pm.alertsPage.expectSearchScopeCurrentActive();

    testLogger.info('Test completed');
  });

  test('should show the OTable empty state when switching tabs on an empty folder', {
    tag: ['@alerts-ui-refactor', '@alerts', '@all', '@P2'],
  }, async () => {
    testLogger.info('Creating an empty folder and asserting the empty state per tab');

    const suffix = pm.alertsPage.generateRandomString();
    const folderName = 'auto_empty_' + suffix;
    await pm.alertsPage.createFolder(folderName, 'Empty folder for tab empty-state test');
    await pm.alertsPage.verifyFolderCreated(folderName);
    await pm.alertsPage.navigateToFolder(folderName);

    await pm.alertsPage.clickAlertListTab('scheduled');
    await pm.alertsPage.expectAlertListTabActive('scheduled');
    await pm.alertsPage.verifyNoDataAvailable();

    await pm.alertsPage.clickAlertListTab('realTime');
    await pm.alertsPage.expectAlertListTabActive('realTime');
    await pm.alertsPage.verifyNoDataAvailable();

    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.deleteFolder(folderName);

    testLogger.info('Test completed');
  });
});
