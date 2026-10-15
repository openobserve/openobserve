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

// Live chart preview in the dashboard panel editor (openobserve#15214).
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
  STREAM,
  NAMESPACE_FIELD,
  deleteCreatedDashboards,
} = require('../utils/dashboard-auto-run-fixtures.js');
import PageManager from '../../pages/page-manager.js';
import { ingestion } from './utils/dashIngestion.js';

// A second fixed stream, so a saved panel's stream differs from the one every test starts on.
const OTHER_STREAM = 'e2e_live_preview';
const TOOLTIP = {
  refresh: 'Run the query again',
  pending: 'Changes not run yet',
  typed: 'Run the edited query',
  incomplete: 'Finish the builder fields',
};

// Same aliases as the builder's default chart, so the typed query keeps the panel's axes valid.
const TYPED_SQL = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "${STREAM}" WHERE ${NAMESPACE_FIELD} IS NOT NULL GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

test.describe('Dashboard panel editor live preview', { tag: ['@dashboards', '@panelLivePreview', '@all'] }, () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
  });

  test.afterAll(async () => {
    await deleteCreatedDashboards();
  });

  // Every new panel opens on STREAM, so run counts are attributable to the panel under test.
  async function openNewPanel(page, { flag = true, autoRun = 'true' } = {}) {
    const pm = new PageManager(page);
    const lp = pm.dashboardLivePreview;
    await lp.pinAutoQuery(flag);
    await lp.setStoredAutoRun(autoRun);
    await lp.rememberPanelStream(STREAM);
    const dashboardId = await lp.createEmptyDashboard('live_preview');
    await lp.openNewPanel(dashboardId);
    await lp.expectSelectedStream(STREAM);
    return { pm, lp, dashboardId };
  }

  test('Auto Run on: a new panel opens on the remembered stream and renders without Apply', { tag: ['@smoke', '@P0'] }, async ({ page }) => {
    const { lp } = await openNewPanel(page);

    await lp.settledRunCount(STREAM, { atLeast: 1 });
    await lp.expectChartRendered();
    await lp.expectApplyVariant('primary');
    await lp.expectApplyTooltip(TOOLTIP.refresh);
  });

  test('Auto Run on: a builder edit re-runs the chart once and Apply never turns amber', { tag: ['@P0'] }, async ({ page }) => {
    const { pm, lp } = await openNewPanel(page);
    const base = await lp.settledRunCount(STREAM, { atLeast: 1 });
    testLogger.info('Initial runs settled', { base });

    await pm.chartTypeSelector.searchAndAddField(NAMESPACE_FIELD, 'b');
    await lp.expectApplyNotPending();

    await lp.waitForRuns(STREAM, base + 1);
    await lp.expectLastRunContains(STREAM, NAMESPACE_FIELD);
    await lp.expectNoNewRun(STREAM, base + 1);
    await lp.expectApplyVariant('primary');
  });

  test('Auto Run off: the new panel and every builder edit wait for Apply', { tag: ['@P0'] }, async ({ page }) => {
    const { pm, lp } = await openNewPanel(page, { autoRun: 'false' });

    await lp.expectNoNewRun(STREAM, 0);
    await lp.expectApplyVariant('warning');
    await lp.expectApplyTooltip(TOOLTIP.pending);

    await lp.clickApply();
    await lp.waitForRuns(STREAM, 1);
    await lp.expectApplyIdle();
    await lp.expectApplyVariant('primary');

    await pm.chartTypeSelector.searchAndAddField(NAMESPACE_FIELD, 'b');
    await lp.expectApplyVariant('warning');
    await lp.expectNoNewRun(STREAM, 1);

    await lp.clickApply();
    await lp.waitForRuns(STREAM, 2);
    await lp.expectLastRunContains(STREAM, NAMESPACE_FIELD);
    await lp.expectApplyIdle();
    await lp.expectApplyVariant('primary');
  });

  test('typed custom SQL never runs on its own and runs on Apply', { tag: ['@P1'] }, async ({ page }) => {
    const { pm, lp } = await openNewPanel(page);
    const base = await lp.settledRunCount(STREAM, { atLeast: 1 });

    await pm.chartTypeSelector.setCustomSQL(TYPED_SQL);
    await lp.expectNoNewRun(STREAM, base);
    await lp.expectApplyVariant('warning');
    await lp.expectApplyTooltip(TOOLTIP.typed);

    await lp.clickApply();
    await lp.waitForRuns(STREAM, base + 1);
    await lp.expectLastRunContains(STREAM, 'IS NOT NULL');
    await lp.expectApplyIdle();
    await lp.expectApplyVariant('primary');
  });

  test('a half-built filter holds the live run until it is removed', { tag: ['@P1'] }, async ({ page }) => {
    const { pm, lp } = await openNewPanel(page);
    const base = await lp.settledRunCount(STREAM, { atLeast: 1 });

    await pm.chartTypeSelector.searchAndAddField(NAMESPACE_FIELD, 'filter');
    await lp.expectNoNewRun(STREAM, base);
    await lp.expectApplyVariant('warning');
    await lp.expectApplyTooltip(TOOLTIP.incomplete);

    await pm.dashboardFilter.clickRemoveCondition();
    await lp.expectApplyVariant('primary');
    await lp.expectNoNewRun(STREAM, base);
  });

  test('the Apply menu toggles Auto Run, and turning it back on runs the pending edit', { tag: ['@P1'] }, async ({ page }) => {
    const { pm, lp } = await openNewPanel(page);
    const base = await lp.settledRunCount(STREAM, { atLeast: 1 });

    await lp.expectAutoRunToggleLabel('Turn off Auto Run');
    await lp.toggleAutoRun();
    expect(await lp.getStoredAutoRun()).toBe('false');
    await lp.expectAutoRunToggleLabel('Turn on Auto Run');

    await pm.chartTypeSelector.searchAndAddField(NAMESPACE_FIELD, 'b');
    await lp.expectApplyVariant('warning');
    await lp.expectNoNewRun(STREAM, base);

    await lp.toggleAutoRun();
    expect(await lp.getStoredAutoRun()).toBe('true');
    await lp.waitForRuns(STREAM, base + 1);
    await lp.expectLastRunContains(STREAM, NAMESPACE_FIELD);
    await lp.expectApplyIdle();
    await lp.expectApplyVariant('primary');
  });

  test('with ZO_AUTO_QUERY_ENABLED off there is no Auto Run toggle and edits wait for Apply', { tag: ['@P1'] }, async ({ page }) => {
    const { pm, lp } = await openNewPanel(page, { flag: false, autoRun: 'true' });

    await lp.expectNoNewRun(STREAM, 0);
    await lp.expectApplyVariant('warning');
    await lp.expectNoAutoRunToggle();

    await lp.clickApply();
    await lp.waitForRuns(STREAM, 1);
    await lp.expectApplyIdle();

    await pm.chartTypeSelector.searchAndAddField(NAMESPACE_FIELD, 'b');
    await lp.expectApplyVariant('warning');
    await lp.expectNoNewRun(STREAM, 1);
  });

  test('saving a panel remembers its stream for the next new panel', { tag: ['@P1'] }, async ({ page }) => {
    await ingestion(page, OTHER_STREAM);
    const { pm, lp, dashboardId } = await openNewPanel(page);
    await lp.settledRunCount(STREAM, { atLeast: 1 });

    await pm.chartTypeSelector.selectStream(OTHER_STREAM);
    await lp.expectSelectedStream(OTHER_STREAM);
    await lp.settledRunCount(OTHER_STREAM, { atLeast: 1 });

    await pm.dashboardPanelActions.addPanelName(`live_preview_${Date.now()}`);
    await pm.dashboardPanelActions.savePanel();
    await expect(page).not.toHaveURL(/add_panel/, { timeout: 30000 });
    expect(await lp.getRememberedPanelStream()).toBe(OTHER_STREAM);

    const before = lp.runsFrom(OTHER_STREAM).length;
    await lp.openNewPanel(dashboardId);
    await lp.expectSelectedStream(OTHER_STREAM);
    await expect.poll(() => lp.runsFrom(OTHER_STREAM).length, { timeout: 30000 }).toBeGreaterThan(before);
  });

  test('Auto Run off: the time picker has no Apply of its own and a new range waits for the panel Apply', { tag: ['@P2'] }, async ({ page }) => {
    const { lp } = await openNewPanel(page, { autoRun: 'false' });
    await lp.clickApply();
    await lp.waitForRuns(STREAM, 1);
    await lp.expectApplyIdle();
    await lp.expectApplyVariant('primary');

    await lp.pickRelativeTime(30, 'm');
    await lp.expectNoPickerApply();
    await lp.closeTimePicker();
    await lp.expectApplyVariant('warning');
    await lp.expectNoNewRun(STREAM, 1);

    await lp.clickApply();
    await lp.waitForRuns(STREAM, 2);
    await lp.expectApplyIdle();
    await lp.expectApplyVariant('primary');
  });
});
