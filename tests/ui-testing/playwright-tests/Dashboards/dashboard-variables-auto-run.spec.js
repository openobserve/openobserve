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
  ORG,
  STREAM,
  NAMESPACES,
  NAMESPACE_FIELD,
  CONTAINER_FIELD,
  CONTAINER_OF,
  namespaceTablePanel,
  createDashboard,
  deleteDashboard,
  pinAutoQuery,
  trackPanelRuns,
} = require('../utils/dashboard-auto-run-fixtures.js');
import PageManager from '../../pages/page-manager.js';
import { ingestion } from './utils/dashIngestion.js';

const BY_NS = `${NAMESPACE_FIELD} = '$ns'`;
// Longer than the 300ms Auto Run debounce plus a panel request round trip.
const QUIET_MS = 2500;

async function waitForRuns(runs, key, count) {
  await expect.poll(() => runs.of(key).length, { timeout: 30_000 }).toBe(count);
}

async function expectNoNewRun(page, runs, key, count) {
  // Absence has no event to wait on: a run, if any, starts after the debounce.
  await page.waitForTimeout(QUIET_MS);
  expect(runs.of(key)).toHaveLength(count);
}

// Saving a variable re-runs the panels, so counts are measured from the point the dashboard stops querying.
async function settledRunCount(runs, key) {
  let last = -1;
  await expect.poll(() => {
    const now = runs.of(key).length;
    const stable = now === last && now > 0;
    last = now;
    return stable;
  }, { timeout: 30_000, intervals: [1500] }).toBe(true);
  return last;
}

async function addVariablesFromSettings(pm, variables) {
  await pm.dashboardSetting.openSetting();
  for (const { name, field = NAMESPACE_FIELD, options = {} } of variables) {
    await pm.dashboardVariablesScoped.addScopedVariable(name, 'logs', STREAM, field, { scope: 'global', ...options });
  }
  await pm.dashboardSetting.closeSettingWindow();
  for (const { name } of variables) {
    await pm.dashboardVariablesScoped.waitForVariableIdle(name);
  }
}

test.describe('Dashboard variables Auto Run', { tag: ['@dashboards', '@dashboardVariables', '@dashboardVariablesAutoRun', '@all'] }, () => {
  test.describe.configure({ mode: 'parallel' });

  const created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
  });

  test.afterAll(async () => {
    for (const id of created) await deleteDashboard(id);
  });

  async function makeDashboard(name, panels) {
    const id = await createDashboard(`${name}_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, { panels });
    created.push(id);
    return id;
  }

  // Dashboard and panels come from the API; the variable under test is created through the Settings UI.
  async function setupDashboard(page, { name, panels, variable, multiSelect = false, variableOptions = {}, dependents = [], reloadAfterCreate = false }) {
    const pm = new PageManager(page);
    const id = await makeDashboard(name, panels);
    const runs = trackPanelRuns(page);
    await pm.dashboardAutoRun.openDashboard(ORG(), id, panels.map((p) => p.id));
    await addVariablesFromSettings(pm, [
      { name: variable, options: { showMultipleValues: multiSelect, ...variableOptions } },
      ...dependents,
    ]);
    if (reloadAfterCreate) await pm.dashboardAutoRun.reloadDashboard(panels[0].id);
    // A query values variable defaults to the stream's first value, so the change targets are the other namespaces.
    const [initial] = await pm.dashboardAutoRun.getSelectedVariableValues(variable);
    const [first, second] = NAMESPACES.filter((ns) => ns !== initial);
    testLogger.info('Variable created from the UI', { variable, initial, first, second });
    return { pm, autoRun: pm.dashboardAutoRun, runs, initial, first, second };
  }

  test('flag off keeps manual apply: no toggle, amber Refresh, panel runs only on Refresh', { tag: ['@P1'] }, async ({ page }) => {
    await pinAutoQuery(page, false);
    await new PageManager(page).dashboardAutoRun.setStoredAutoRun('true');
    const { autoRun, runs, initial, first, second } = await setupDashboard(page, {
      name: 'autorun_flag_off',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS)],
      variable: 'ns',
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial] });
    const base = await settledRunCount(runs, 'var');

    await autoRun.openRefreshOptions();
    await autoRun.expectNoAutoRunToggle();
    await autoRun.closeMenu();

    await autoRun.selectVariableValue('ns', first);
    await autoRun.expectRefreshVariant('warning');
    await expectNoNewRun(page, runs, 'var', base);
    await autoRun.expectPanelRows('p_var', { shows: [initial], hides: [first] });

    await autoRun.clickRefresh();
    await waitForRuns(runs, 'var', base + 1);
    expect(runs.of('var')[base]).toContain(`'${first}'`);
    await autoRun.expectPanelRows('p_var', { shows: [first], hides: [initial] });
    await autoRun.expectRefreshVariant('outline');
  });

  test('Auto Run on: a variable change re-runs only the panels that use it, once each', { tag: ['@P0'] }, async ({ page }) => {
    await pinAutoQuery(page, true);
    await new PageManager(page).dashboardAutoRun.setStoredAutoRun(null);
    const { autoRun, runs, initial, first, second } = await setupDashboard(page, {
      name: 'autorun_on',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS), namespaceTablePanel('p_plain', 'plain')],
      variable: 'ns',
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial], hides: [first] });
    const base = await settledRunCount(runs, 'var');
    const plainBase = await settledRunCount(runs, 'plain');
    expect(runs.of('var')[base - 1]).toContain(`'${initial}'`);

    await autoRun.expectRefreshTooltip('Auto run enabled');
    await autoRun.openRefreshOptions();
    await autoRun.expectAutoRunToggleLabel('Turn off Auto Run');
    await autoRun.closeMenu();

    await autoRun.selectVariableValue('ns', first);
    await waitForRuns(runs, 'var', base + 1);
    expect(runs.of('var')[base]).toContain(`'${first}'`);
    await expectNoNewRun(page, runs, 'var', base + 1);
    expect(runs.of('plain')).toHaveLength(plainBase);
    await autoRun.expectPanelRows('p_var', { shows: [first], hides: [initial] });
    await autoRun.expectPanelRows('p_plain', { shows: NAMESPACES });
    await autoRun.expectRefreshNotPending();
    await autoRun.expectUrlVariable('ns', first);
  });

  test('turning Auto Run off restores manual apply, persists across reloads, and turning it on auto-applies again', { tag: ['@P1'] }, async ({ page }) => {
    await pinAutoQuery(page, true);
    await new PageManager(page).dashboardAutoRun.setStoredAutoRun(null);
    const { autoRun, runs, initial, first, second } = await setupDashboard(page, {
      name: 'autorun_toggle',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS)],
      variable: 'ns',
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial] });
    const base = await settledRunCount(runs, 'var');

    await autoRun.toggleAutoRun();
    expect(await autoRun.getStoredAutoRun()).toBe('false');
    await autoRun.openRefreshOptions();
    await autoRun.expectAutoRunToggleLabel('Turn on Auto Run');
    await autoRun.closeMenu();

    await autoRun.selectVariableValue('ns', first);
    await autoRun.expectRefreshVariant('warning');
    await expectNoNewRun(page, runs, 'var', base);
    await autoRun.clickRefresh();
    await waitForRuns(runs, 'var', base + 1);
    expect(runs.of('var')[base]).toContain(`'${first}'`);
    await autoRun.expectPanelRows('p_var', { shows: [first], hides: [initial] });

    await autoRun.reloadDashboard('p_var');
    await autoRun.openRefreshOptions();
    await autoRun.expectAutoRunToggleLabel('Turn on Auto Run');
    await autoRun.closeMenu();

    await autoRun.toggleAutoRun();
    expect(await autoRun.getStoredAutoRun()).toBe('true');
    const before = await settledRunCount(runs, 'var');
    await autoRun.selectVariableValue('ns', second);
    await waitForRuns(runs, 'var', before + 1);
    expect(runs.of('var')[before]).toContain(`'${second}'`);
    await autoRun.expectPanelRows('p_var', { shows: [second], hides: [first] });
    await autoRun.expectRefreshNotPending();
  });

  test('Auto Run on: a multi-select applies once when the dropdown closes, not on each toggle', { tag: ['@P0'] }, async ({ page }) => {
    await pinAutoQuery(page, true);
    await new PageManager(page).dashboardAutoRun.setStoredAutoRun(null);
    const { autoRun, runs, initial, first, second } = await setupDashboard(page, {
      name: 'autorun_multi',
      panels: [namespaceTablePanel('p_multi', 'multi', `${NAMESPACE_FIELD} IN ($nsm)`)],
      variable: 'nsm',
      multiSelect: true,
    });
    await autoRun.expectPanelRows('p_multi', { shows: [initial], hides: [first, second] });
    const base = await settledRunCount(runs, 'multi');

    await autoRun.openVariableDropdown('nsm');
    await autoRun.toggleVariableOptions('nsm', [first, second]);
    await autoRun.expectVariablePopoverOpen('nsm');
    await expectNoNewRun(page, runs, 'multi', base);

    await autoRun.closeVariableDropdownWithEscape('nsm');
    await waitForRuns(runs, 'multi', base + 1);
    const sql = runs.of('multi')[base];
    expect(sql).toContain(`'${first}'`);
    expect(sql).toContain(`'${second}'`);
    await expectNoNewRun(page, runs, 'multi', base + 1);
    await autoRun.expectPanelRows('p_multi', { shows: [initial, first, second] });
    await autoRun.expectRefreshNotPending();
  });

  test('Auto Run on: the full-screen panel view applies a variable change once and Escape in its dropdown keeps the view open', { tag: ['@P1'] }, async ({ page }) => {
    await pinAutoQuery(page, true);
    await new PageManager(page).dashboardAutoRun.setStoredAutoRun(null);
    const { autoRun, runs, initial, first, second } = await setupDashboard(page, {
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

    const before = await settledRunCount(runs, 'var');
    await autoRun.selectVariableValue('ns', second, { inView: true });
    await waitForRuns(runs, 'var', before + 1);
    expect(runs.of('var')[before]).toContain(`'${second}'`);
    await expectNoNewRun(page, runs, 'var', before + 1);
    await autoRun.expectViewPanelRows({ shows: [second], hides: [initial] });
    await autoRun.expectViewRefreshNotPending();
    await autoRun.closeViewPanel();
  });

  test('Auto Run off: the full-screen panel view waits for Refresh to apply a variable change', { tag: ['@P1'] }, async ({ page }) => {
    await pinAutoQuery(page, true);
    await new PageManager(page).dashboardAutoRun.setStoredAutoRun('false');
    const { autoRun, runs, initial, first, second } = await setupDashboard(page, {
      name: 'autorun_viewpanel_off',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS)],
      variable: 'ns',
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial] });

    await autoRun.openPanelFullscreen('p_var');
    await autoRun.expectViewPanelRows({ shows: [initial] });

    const before = await settledRunCount(runs, 'var');
    await autoRun.selectVariableValue('ns', first, { inView: true });
    await autoRun.expectViewRefreshVariant('warning');
    await expectNoNewRun(page, runs, 'var', before);
    await autoRun.expectViewPanelRows({ shows: [initial], hides: [first] });

    await autoRun.clickViewRefresh();
    await waitForRuns(runs, 'var', before + 1);
    expect(runs.of('var')[before]).toContain(`'${first}'`);
    await autoRun.expectViewPanelRows({ shows: [first], hides: [initial] });
    await autoRun.expectViewRefreshNotPending();
    await autoRun.closeViewPanel();
  });

  test('Auto Run on: changing a parent variable waits for its dependent to reload, then runs the panel once', { tag: ['@P0'] }, async ({ page }) => {
    await pinAutoQuery(page, true);
    await new PageManager(page).dashboardAutoRun.setStoredAutoRun(null);
    const { autoRun, runs, initial, first } = await setupDashboard(page, {
      name: 'autorun_chain',
      panels: [namespaceTablePanel('p_chain', 'chain', `${BY_NS} AND ${CONTAINER_FIELD} = '$ctr'`)],
      variable: 'ns',
      dependents: [{ name: 'ctr', field: CONTAINER_FIELD, options: { dependsOn: 'ns', dependsOnField: NAMESPACE_FIELD } }],
    });
    await autoRun.expectSelectedVariableValue('ctr', CONTAINER_OF[initial]);
    await autoRun.expectPanelRows('p_chain', { shows: [initial] });
    const base = await settledRunCount(runs, 'chain');

    await autoRun.selectVariableValue('ns', first);
    await autoRun.expectSelectedVariableValue('ctr', CONTAINER_OF[first]);
    await waitForRuns(runs, 'chain', base + 1);
    // A run fired before the child reloaded would pair the new namespace with the old container.
    const sql = runs.of('chain')[base];
    expect(sql).toContain(`'${first}'`);
    expect(sql).toContain(`'${CONTAINER_OF[first]}'`);
    await expectNoNewRun(page, runs, 'chain', base + 1);
    await autoRun.expectPanelRows('p_chain', { shows: [first], hides: [initial] });
    await autoRun.expectRefreshNotPending();
  });

  test('Auto Run on: a tab-level variable change re-runs its panel once', { tag: ['@P1'] }, async ({ page }) => {
    await pinAutoQuery(page, true);
    await new PageManager(page).dashboardAutoRun.setStoredAutoRun(null);
    const { autoRun, runs, initial, first } = await setupDashboard(page, {
      name: 'autorun_tab_scope',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS)],
      variable: 'ns',
      variableOptions: { scope: 'tabs', assignedTabs: ['default'] },
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial] });
    const base = await settledRunCount(runs, 'var');

    await autoRun.selectVariableValue('ns', first);
    await waitForRuns(runs, 'var', base + 1);
    expect(runs.of('var')[base]).toContain(`'${first}'`);
    await expectNoNewRun(page, runs, 'var', base + 1);
    await autoRun.expectPanelRows('p_var', { shows: [first], hides: [initial] });
    await autoRun.expectRefreshNotPending();
  });

  test('Auto Run on: a panel-level variable change re-runs only its own panel, once', { tag: ['@P1'] }, async ({ page }) => {
    await pinAutoQuery(page, true);
    await new PageManager(page).dashboardAutoRun.setStoredAutoRun(null);
    const { autoRun, runs, initial, first } = await setupDashboard(page, {
      name: 'autorun_panel_scope',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS), namespaceTablePanel('p_plain', 'plain')],
      variable: 'ns',
      variableOptions: { scope: 'panels', assignedPanels: ['p_var'] },
      // A panel-level variable added from Settings loads no values until the dashboard reloads, with or without Auto Run.
      reloadAfterCreate: true,
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial] });
    const base = await settledRunCount(runs, 'var');
    const plainBase = await settledRunCount(runs, 'plain');

    await autoRun.selectVariableValue('ns', first);
    await waitForRuns(runs, 'var', base + 1);
    expect(runs.of('var')[base]).toContain(`'${first}'`);
    await expectNoNewRun(page, runs, 'var', base + 1);
    expect(runs.of('plain')).toHaveLength(plainBase);
    await autoRun.expectPanelRows('p_var', { shows: [first], hides: [initial] });
    await autoRun.expectRefreshNotPending();
  });

  test('Auto Run on: Select all on a multi-select applies once when the dropdown closes', { tag: ['@P1'] }, async ({ page }) => {
    await pinAutoQuery(page, true);
    await new PageManager(page).dashboardAutoRun.setStoredAutoRun(null);
    const { autoRun, runs, initial, first, second } = await setupDashboard(page, {
      name: 'autorun_select_all',
      panels: [namespaceTablePanel('p_multi', 'multi', `${NAMESPACE_FIELD} IN ($nsm)`)],
      variable: 'nsm',
      multiSelect: true,
    });
    await autoRun.expectPanelRows('p_multi', { shows: [initial], hides: [first, second] });
    const base = await settledRunCount(runs, 'multi');

    await autoRun.openVariableDropdown('nsm');
    await autoRun.clickSelectAll('nsm');
    await autoRun.expectVariablePopoverOpen('nsm');
    await expectNoNewRun(page, runs, 'multi', base);

    await autoRun.closeVariableDropdownWithTrigger('nsm');
    await waitForRuns(runs, 'multi', base + 1);
    expect(runs.of('multi')[base]).not.toContain(`IN ('${initial}')`);
    await expectNoNewRun(page, runs, 'multi', base + 1);
    await autoRun.expectPanelRows('p_multi', { shows: [initial, first, second] });
    await autoRun.expectRefreshNotPending();
  });
});
