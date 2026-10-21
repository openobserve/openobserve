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

// Dashboard variables apply on change with Auto Run (openobserve#15216).
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
  NAMESPACES,
  NAMESPACE_FIELD,
  CONTAINER_FIELD,
  CONTAINER_OF,
  namespaceTablePanel,
  deleteCreatedDashboards,
} = require('../utils/dashboard-auto-run-fixtures.js');
import PageManager from '../../pages/page-manager.js';
import { ingestion } from './utils/dashIngestion.js';

const BY_NS = `${NAMESPACE_FIELD} = '$ns'`;

test.describe('Dashboard variables Auto Run', { tag: ['@dashboards', '@dashboardVariables', '@dashboardVariablesAutoRun', '@all'] }, () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
  });

  test.afterAll(async () => {
    await deleteCreatedDashboards();
  });

  test('flag off keeps manual apply: no toggle, amber Refresh, panel runs only on Refresh', { tag: ['@P1'] }, async ({ page }) => {
    const autoRun = new PageManager(page).dashboardAutoRun;
    await autoRun.pinAutoQuery(false);
    await autoRun.setStoredAutoRun('true');
    const { initial, first, second } = await autoRun.setupDashboard({
      name: 'autorun_flag_off',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS)],
      variable: 'ns',
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial] });
    const base = await autoRun.settledRunCount('var');

    await autoRun.openRefreshOptions();
    await autoRun.expectNoAutoRunToggle();
    await autoRun.closeMenu();

    await autoRun.selectVariableValue('ns', first);
    await autoRun.expectRefreshVariant('warning');
    await autoRun.expectNoNewRun('var', base);
    await autoRun.expectPanelRows('p_var', { shows: [initial], hides: [first] });

    await autoRun.clickRefresh();
    await autoRun.waitForRuns('var', base + 1);
    expect(autoRun.runsOf('var')[base]).toContain(`'${first}'`);
    await autoRun.expectPanelRows('p_var', { shows: [first], hides: [initial] });
    await autoRun.expectRefreshVariant('primary');
  });

  test('Auto Run on: a variable change re-runs only the panels that use it, once each', { tag: ['@P0'] }, async ({ page }) => {
    const autoRun = new PageManager(page).dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun(null);
    const { initial, first, second } = await autoRun.setupDashboard({
      name: 'autorun_on',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS), namespaceTablePanel('p_plain', 'plain')],
      variable: 'ns',
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial], hides: [first] });
    const base = await autoRun.settledRunCount('var');
    const plainBase = await autoRun.settledRunCount('plain');
    expect(autoRun.runsOf('var')[base - 1]).toContain(`'${initial}'`);

    await autoRun.expectRefreshTooltip('Runs queries on open and on filter/time changes');
    await autoRun.openRefreshOptions();
    await autoRun.expectAutoRunToggleLabel('Turn off Auto Run');
    await autoRun.closeMenu();

    await autoRun.selectVariableValue('ns', first);
    await autoRun.waitForRuns('var', base + 1);
    expect(autoRun.runsOf('var')[base]).toContain(`'${first}'`);
    await autoRun.expectNoNewRun('var', base + 1);
    expect(autoRun.runsOf('plain')).toHaveLength(plainBase);
    await autoRun.expectPanelRows('p_var', { shows: [first], hides: [initial] });
    await autoRun.expectPanelRows('p_plain', { shows: NAMESPACES });
    await autoRun.expectRefreshNotPending();
    await autoRun.expectUrlVariable('ns', first);
  });

  test('turning Auto Run off restores manual apply, persists across reloads, and turning it on auto-applies again', { tag: ['@P1'] }, async ({ page }) => {
    const autoRun = new PageManager(page).dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun(null);
    const { initial, first, second } = await autoRun.setupDashboard({
      name: 'autorun_toggle',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS)],
      variable: 'ns',
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial] });
    const base = await autoRun.settledRunCount('var');

    await autoRun.toggleAutoRun();
    expect(await autoRun.getStoredAutoRun()).toBe('false');
    await autoRun.openRefreshOptions();
    await autoRun.expectAutoRunToggleLabel('Turn on Auto Run');
    await autoRun.closeMenu();

    await autoRun.selectVariableValue('ns', first);
    await autoRun.expectRefreshVariant('warning');
    await autoRun.expectNoNewRun('var', base);
    await autoRun.clickRefresh();
    await autoRun.waitForRuns('var', base + 1);
    expect(autoRun.runsOf('var')[base]).toContain(`'${first}'`);
    await autoRun.expectPanelRows('p_var', { shows: [first], hides: [initial] });

    await autoRun.reloadDashboard('p_var');
    await autoRun.openRefreshOptions();
    await autoRun.expectAutoRunToggleLabel('Turn on Auto Run');
    await autoRun.closeMenu();

    await autoRun.toggleAutoRun();
    expect(await autoRun.getStoredAutoRun()).toBe('true');
    const before = await autoRun.settledRunCount('var');
    await autoRun.selectVariableValue('ns', second);
    await autoRun.waitForRuns('var', before + 1);
    expect(autoRun.runsOf('var')[before]).toContain(`'${second}'`);
    await autoRun.expectPanelRows('p_var', { shows: [second], hides: [first] });
    await autoRun.expectRefreshNotPending();
  });

  test('Auto Run on: a multi-select applies once when the dropdown closes, not on each toggle', { tag: ['@P0'] }, async ({ page }) => {
    const autoRun = new PageManager(page).dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun(null);
    const { initial, first, second } = await autoRun.setupDashboard({
      name: 'autorun_multi',
      panels: [namespaceTablePanel('p_multi', 'multi', `${NAMESPACE_FIELD} IN ($nsm)`)],
      variable: 'nsm',
      multiSelect: true,
    });
    await autoRun.expectPanelRows('p_multi', { shows: [initial], hides: [first, second] });
    const base = await autoRun.settledRunCount('multi');

    await autoRun.openVariableDropdown('nsm');
    await autoRun.toggleVariableOptions('nsm', [first, second]);
    await autoRun.expectVariablePopoverOpen('nsm');
    await autoRun.expectNoNewRun('multi', base);

    await autoRun.closeVariableDropdownWithEscape('nsm');
    await autoRun.waitForRuns('multi', base + 1);
    const sql = autoRun.runsOf('multi')[base];
    expect(sql).toContain(`'${first}'`);
    expect(sql).toContain(`'${second}'`);
    await autoRun.expectNoNewRun('multi', base + 1);
    await autoRun.expectPanelRows('p_multi', { shows: [initial, first, second] });
    await autoRun.expectRefreshNotPending();
  });

  test('Auto Run on: the full-screen panel view applies a variable change once and Escape in its dropdown keeps the view open', { tag: ['@P1'] }, async ({ page }) => {
    const autoRun = new PageManager(page).dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun(null);
    const { initial, first, second } = await autoRun.setupDashboard({
      name: 'autorun_viewpanel',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS)],
      variable: 'ns',
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial] });

    await autoRun.openPanelFullscreen('p_var');
    await autoRun.expectViewPanelRows({ shows: [initial] });

    await autoRun.openVariableDropdown('ns', { inView: true });
    await autoRun.closeVariableDropdownWithEscape('ns');
    await autoRun.expectViewPanelOpen();

    const before = await autoRun.settledRunCount('var');
    await autoRun.selectVariableValue('ns', second, { inView: true });
    await autoRun.waitForRuns('var', before + 1);
    expect(autoRun.runsOf('var')[before]).toContain(`'${second}'`);
    await autoRun.expectNoNewRun('var', before + 1);
    await autoRun.expectViewPanelRows({ shows: [second], hides: [initial] });
    await autoRun.expectViewRefreshNotPending();
    await autoRun.closeViewPanel();
  });

  test('Auto Run off: the full-screen panel view waits for Refresh to apply a variable change', { tag: ['@P1'] }, async ({ page }) => {
    const autoRun = new PageManager(page).dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun('false');
    const { initial, first, second } = await autoRun.setupDashboard({
      name: 'autorun_viewpanel_off',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS)],
      variable: 'ns',
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial] });

    await autoRun.openPanelFullscreen('p_var');
    await autoRun.expectViewPanelRows({ shows: [initial] });

    const before = await autoRun.settledRunCount('var');
    await autoRun.selectVariableValue('ns', first, { inView: true });
    await autoRun.expectViewRefreshVariant('warning');
    await autoRun.expectNoNewRun('var', before);
    await autoRun.expectViewPanelRows({ shows: [initial], hides: [first] });

    await autoRun.clickViewRefresh();
    await autoRun.waitForRuns('var', before + 1);
    expect(autoRun.runsOf('var')[before]).toContain(`'${first}'`);
    await autoRun.expectViewPanelRows({ shows: [first], hides: [initial] });
    await autoRun.expectViewRefreshNotPending();
    await autoRun.closeViewPanel();
  });

  test('Auto Run on: changing a parent variable waits for its dependent to reload, then runs the panel once', { tag: ['@P0'] }, async ({ page }) => {
    const autoRun = new PageManager(page).dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun(null);
    const { initial, first } = await autoRun.setupDashboard({
      name: 'autorun_chain',
      panels: [namespaceTablePanel('p_chain', 'chain', `${BY_NS} AND ${CONTAINER_FIELD} = '$ctr'`)],
      variable: 'ns',
      dependents: [{ name: 'ctr', field: CONTAINER_FIELD, options: { dependsOn: 'ns', dependsOnField: NAMESPACE_FIELD } }],
    });
    await autoRun.expectSelectedVariableValue('ctr', CONTAINER_OF[initial]);
    await autoRun.expectPanelRows('p_chain', { shows: [initial] });
    const base = await autoRun.settledRunCount('chain');

    await autoRun.selectVariableValue('ns', first);
    await autoRun.expectSelectedVariableValue('ctr', CONTAINER_OF[first]);
    await autoRun.waitForRuns('chain', base + 1);
    // A run fired before the child reloaded would pair the new namespace with the old container.
    const sql = autoRun.runsOf('chain')[base];
    expect(sql).toContain(`'${first}'`);
    expect(sql).toContain(`'${CONTAINER_OF[first]}'`);
    await autoRun.expectNoNewRun('chain', base + 1);
    await autoRun.expectPanelRows('p_chain', { shows: [first], hides: [initial] });
    await autoRun.expectRefreshNotPending();
  });

  test('Auto Run on: a tab-level variable change re-runs its panel once', { tag: ['@P1'] }, async ({ page }) => {
    const autoRun = new PageManager(page).dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun(null);
    const { initial, first } = await autoRun.setupDashboard({
      name: 'autorun_tab_scope',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS)],
      variable: 'ns',
      variableOptions: { scope: 'tabs', assignedTabs: ['default'] },
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial] });
    const base = await autoRun.settledRunCount('var');

    await autoRun.selectVariableValue('ns', first);
    await autoRun.waitForRuns('var', base + 1);
    expect(autoRun.runsOf('var')[base]).toContain(`'${first}'`);
    await autoRun.expectNoNewRun('var', base + 1);
    await autoRun.expectPanelRows('p_var', { shows: [first], hides: [initial] });
    await autoRun.expectRefreshNotPending();
  });

  test('Auto Run on: a panel-level variable change re-runs only its own panel, once', { tag: ['@P1'] }, async ({ page }) => {
    const autoRun = new PageManager(page).dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun(null);
    const { initial, first } = await autoRun.setupDashboard({
      name: 'autorun_panel_scope',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS), namespaceTablePanel('p_plain', 'plain')],
      variable: 'ns',
      variableOptions: { scope: 'panels', assignedPanels: ['p_var'] },
      // A panel-level variable added from Settings loads no values until the dashboard reloads, with or without Auto Run.
      reloadAfterCreate: true,
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial] });
    const base = await autoRun.settledRunCount('var');
    const plainBase = await autoRun.settledRunCount('plain');

    await autoRun.selectVariableValue('ns', first);
    await autoRun.waitForRuns('var', base + 1);
    expect(autoRun.runsOf('var')[base]).toContain(`'${first}'`);
    await autoRun.expectNoNewRun('var', base + 1);
    expect(autoRun.runsOf('plain')).toHaveLength(plainBase);
    await autoRun.expectPanelRows('p_var', { shows: [first], hides: [initial] });
    await autoRun.expectRefreshNotPending();
  });

  test('Auto Run on: Select all on a multi-select applies once when the dropdown closes', { tag: ['@P1'] }, async ({ page }) => {
    const autoRun = new PageManager(page).dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun(null);
    const { initial, first, second } = await autoRun.setupDashboard({
      name: 'autorun_select_all',
      panels: [namespaceTablePanel('p_multi', 'multi', `${NAMESPACE_FIELD} IN ($nsm)`)],
      variable: 'nsm',
      multiSelect: true,
    });
    await autoRun.expectPanelRows('p_multi', { shows: [initial], hides: [first, second] });
    const base = await autoRun.settledRunCount('multi');

    await autoRun.openVariableDropdown('nsm');
    await autoRun.clickSelectAll('nsm');
    await autoRun.expectVariablePopoverOpen('nsm');
    await autoRun.expectNoNewRun('multi', base);

    await autoRun.closeVariableDropdownWithTrigger('nsm');
    await autoRun.waitForRuns('multi', base + 1);
    expect(autoRun.runsOf('multi')[base]).not.toContain(`IN ('${initial}')`);
    await autoRun.expectNoNewRun('multi', base + 1);
    await autoRun.expectPanelRows('p_multi', { shows: [initial, first, second] });
    await autoRun.expectRefreshNotPending();
  });
});
