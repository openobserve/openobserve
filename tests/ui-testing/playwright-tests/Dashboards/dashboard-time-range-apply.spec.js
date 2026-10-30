// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Dashboard time range apply + Auto Run (view mode): the picker has no Apply button;
// a pick applies at once with Auto Run on, or defers to a yellow/ghost-warning Refresh off.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { namespaceTablePanel, deleteCreatedDashboards, trackDashboard } = require('../utils/dashboard-auto-run-fixtures.js');
import PageManager from '../../pages/page-manager.js';
import { ingestion } from './utils/dashIngestion.js';
import { createDashboardWithPanelTime, getDashboardIdFromURL } from './utils/panelTimeSetup.js';
import { assertPanelTimePickerVisible, assertPanelTimeInURL } from './utils/panelTimeAssertions.js';

test.describe('Dashboard time range apply and Auto Run', { tag: ['@dashboards', '@dashboardTimeRangeApply', '@all'] }, () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    pm = new PageManager(page);
  });

  test.afterAll(async () => {
    await deleteCreatedDashboards();
  });

  test('global time range applies immediately with Auto Run on and the picker has no Apply button', { tag: ['@P0'] }, async ({ page }) => {
    testLogger.info('Verifying global time range applies immediately with Auto Run on');
    const autoRun = pm.dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun(null);
    await autoRun.setupTimeRangeDashboard({
      name: 'tr_apply_on',
      panels: [namespaceTablePanel('p_time', 'time')],
    });
    const base = await autoRun.settledRunCount('time');

    await pm.dashboardPanelTime.clickGlobalTimePicker();
    await pm.dashboardPanelTime.waitForDateTimeMenuVisible();
    await pm.dashboardTimeRange.expectNoApplyButton();

    await pm.dashboardPanelTime.clickDateTimeRelative('6-d');
    await autoRun.waitForRuns('time', base + 1);
    await pm.dashboardTimeRange.expectUrlPeriod('6d');
    await autoRun.expectRefreshNotPending();
    testLogger.info('Test completed');
  });

  test('with Auto Run off a relative pick defers to a yellow Refresh which commits it', { tag: ['@P0'] }, async ({ page }) => {
    testLogger.info('Verifying deferred apply with Auto Run off');
    const autoRun = pm.dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun('false');
    await autoRun.setupTimeRangeDashboard({
      name: 'tr_refresh_to_apply',
      panels: [namespaceTablePanel('p_time', 'time')],
    });
    const base = await autoRun.settledRunCount('time');

    await pm.dashboardPanelTime.selectGlobalTimeWithoutApply('1-w');
    await pm.dashboardPanelTime.dismissDateTimePicker();

    await autoRun.expectRefreshVariant('pending');
    await autoRun.expectRefreshTooltip('Refresh to apply the time range');
    await autoRun.expectNoNewRun('time', base);
    await pm.dashboardTimeRange.expectUrlPeriod('1h');

    await autoRun.clickRefresh();
    await autoRun.waitForRuns('time', base + 1);
    await pm.dashboardTimeRange.expectUrlPeriod('1w');
    await autoRun.expectRefreshNotPending();
    testLogger.info('Test completed');
  });

  test('turning Auto Run on auto-applies a waiting time range', { tag: ['@P1'] }, async ({ page }) => {
    testLogger.info('Verifying toggling Auto Run on applies a waiting range');
    const autoRun = pm.dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun('false');
    await autoRun.setupTimeRangeDashboard({
      name: 'tr_toggle_on_apply',
      panels: [namespaceTablePanel('p_time', 'time')],
    });
    const base = await autoRun.settledRunCount('time');

    await pm.dashboardPanelTime.selectGlobalTimeWithoutApply('6-d');
    await pm.dashboardPanelTime.dismissDateTimePicker();
    await autoRun.expectRefreshVariant('pending');
    await autoRun.expectNoNewRun('time', base);

    await autoRun.toggleAutoRun();
    await autoRun.waitForRuns('time', base + 1);
    await pm.dashboardTimeRange.expectUrlPeriod('6d');
    await autoRun.expectRefreshNotPending();
    expect(await autoRun.getStoredAutoRun()).toBe('true');
    testLogger.info('Test completed');
  });

  test('panel-level picker applies in view mode with Auto Run on and defers with Auto Run off', { tag: ['@P1'] }, async ({ page }) => {
    testLogger.info('Verifying panel-level picker gate in view mode');
    const autoRun = pm.dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun(null);
    // The full config is cached from base load; reload so the pinned auto_query_enabled is fetched before the SPA-only dashboard creation.
    await page.reload();
    const timestamp = Date.now();
    const dashboardName = `Dashboard_TimeRange_Panel_${timestamp}`;
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName: `Panel_TimeRange_${timestamp}`,
      panelTimeEnabled: true,
      panelTimeRange: '1-h',
    });
    trackDashboard(getDashboardIdFromURL(page));

    await assertPanelTimePickerVisible(page, panelId);
    await assertPanelTimeInURL(page, panelId, '1h');

    // Auto Run on → applies at once; the panel refresh button stays non-pending.
    await pm.dashboardPanelTime.changePanelTimeInView(panelId, '6-d');
    await assertPanelTimeInURL(page, panelId, '6d');
    await pm.dashboardTimeRange.expectPanelRefreshNotPending();

    // Auto Run off → defers; the panel refresh button turns ghost-warning and the URL is unchanged.
    await autoRun.toggleAutoRun();
    expect(await autoRun.getStoredAutoRun()).toBe('false');
    await pm.dashboardPanelTime.changePanelTimeInView(panelId, '1-w', false);
    await pm.dashboardTimeRange.expectPanelRefreshVariant('ghost-warning');
    await assertPanelTimeInURL(page, panelId, '6d');

    testLogger.info('Test completed');
  });

  test('the full-screen view panel applies with the same time gate', { tag: ['@P1'] }, async ({ page }) => {
    testLogger.info('Verifying full-screen view panel time gate');
    const autoRun = pm.dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun(null);
    // The full config is cached from base load; reload so the pinned auto_query_enabled is fetched before the SPA-only dashboard creation.
    await page.reload();
    const timestamp = Date.now();
    const dashboardName = `Dashboard_TimeRange_View_${timestamp}`;
    const { panelId } = await createDashboardWithPanelTime(page, pm, {
      dashboardName,
      panelName: `Panel_TimeRange_View_${timestamp}`,
      panelTimeEnabled: true,
      panelTimeRange: '1-h',
    });
    trackDashboard(getDashboardIdFromURL(page));

    await pm.dashboardPanelTime.openViewPanelModal(panelId);
    await pm.dashboardPanelTime.expectViewPanelDateTimePickerVisible();

    // Auto Run on → applies at once; the view refresh button is never warning.
    await pm.dashboardPanelTime.changeViewPanelDateTime('6-d');
    await autoRun.expectViewRefreshNotPending();
    await pm.dashboardPanelTime.closeViewPanelModal();

    // Auto Run off → defers; the view refresh button turns warning until clicked.
    await autoRun.toggleAutoRun();
    expect(await autoRun.getStoredAutoRun()).toBe('false');
    await pm.dashboardPanelTime.openViewPanelModal(panelId);
    await pm.dashboardPanelTime.selectViewPanelTimeWithoutApply('1-w');
    await autoRun.expectViewRefreshVariant('pending');
    await autoRun.clickViewRefresh();
    await autoRun.expectViewRefreshNotPending();
    await pm.dashboardPanelTime.closeViewPanelModal();

    testLogger.info('Test completed');
  });

  test('fresh-on-open re-queries relative panels exactly once', { tag: ['@P1'] }, async ({ page }) => {
    testLogger.info('Verifying fresh-on-open re-query exactly once');
    const autoRun = pm.dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun(null);
    await autoRun.setupTimeRangeDashboard({
      name: 'tr_fresh_on_open',
      panels: [namespaceTablePanel('p_time', 'time')],
    });
    const base = await autoRun.settledRunCount('time');

    await autoRun.reloadDashboard('p_time');
    await autoRun.waitForRuns('time', base + 1);
    await autoRun.expectNoNewRun('time', base + 1);
    testLogger.info('Test completed');
  });

  test('Auto Run unavailable degrades to deferred apply', { tag: ['@P1'] }, async ({ page }) => {
    testLogger.info('Verifying Auto Run unavailable degrades to deferred apply');
    const autoRun = pm.dashboardAutoRun;
    await autoRun.pinAutoQuery(false);
    await autoRun.setStoredAutoRun('true');
    await autoRun.setupTimeRangeDashboard({
      name: 'tr_no_autorun',
      panels: [namespaceTablePanel('p_time', 'time')],
    });

    await autoRun.openRefreshOptions();
    await autoRun.expectNoAutoRunToggle();
    await autoRun.closeMenu();

    const base = await autoRun.settledRunCount('time');
    await pm.dashboardPanelTime.selectGlobalTimeWithoutApply('6-d');
    await pm.dashboardPanelTime.dismissDateTimePicker();
    await autoRun.expectRefreshVariant('pending');
    await autoRun.expectNoNewRun('time', base);

    await autoRun.clickRefresh();
    await autoRun.waitForRuns('time', base + 1);
    testLogger.info('Test completed');
  });
});
