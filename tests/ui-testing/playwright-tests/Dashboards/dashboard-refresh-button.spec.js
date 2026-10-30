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

// Dashboard Refresh button: primary variant, visible label, and options-trigger mirroring (OSS).
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
  ORG,
  NAMESPACE_FIELD,
  namespaceTablePanel,
  createDashboard,
  deleteCreatedDashboards,
} = require('../utils/dashboard-auto-run-fixtures.js');
import PageManager from '../../pages/page-manager.js';
import { ingestion } from './utils/dashIngestion.js';

const BY_NS = `${NAMESPACE_FIELD} = '$ns'`;

test.describe('Dashboard Refresh Button (primary variant & label)', { tag: ['@dashboard-refresh-button', '@dashboards', '@all'] }, () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ page }) => {
    // pinAutoQuery leaves a /config route in flight; unroute before fixture teardown races it closed.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test.afterAll(async () => {
    await deleteCreatedDashboards();
  });

  test('TC-RB-001: Refresh renders primary with a visible "Refresh" label and the options trigger mirrors primary', { tag: ['@P0'] }, async () => {
    const autoRun = pm.dashboardAutoRun;
    await autoRun.pinAutoQuery(false);
    await autoRun.setStoredAutoRun(null);
    const id = await createDashboard(`refreshbtn_primary_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, {
      panels: [namespaceTablePanel('p1', 'rb', '')],
    });
    await autoRun.openDashboard(ORG(), id, ['p1'], '1h');
    await autoRun.waitForRefreshIdle();

    await autoRun.expectRefreshVariant('primary');
    await autoRun.expectRefreshLabel('Refresh');
    await autoRun.expectRefreshOptionsVariant('primary');
    await autoRun.expectRefreshTooltip('Refresh');

    testLogger.info('TC-RB-001 completed');
  });

  test('TC-RB-002: Refresh demotes to outline in layout edit mode while Save is primary, then restores primary on exit', { tag: ['@P0'] }, async () => {
    const autoRun = pm.dashboardAutoRun;
    const actions = pm.dashboardPanelActions;
    const id = await createDashboard(`refreshbtn_edit_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, {
      panels: [namespaceTablePanel('p1', 'rb', '')],
    });
    await autoRun.openDashboard(ORG(), id, ['p1'], '1h');
    await autoRun.waitForRefreshIdle();

    await autoRun.expectRefreshVariant('primary');

    await actions.enterLayoutEdit();
    await expect(actions.layoutEditBadge).toBeVisible();
    await autoRun.expectRefreshVariant('outline');
    await expect(actions.layoutEditSaveBtn).toHaveAttribute('data-o2-variant', 'primary');

    await actions.discardLayoutEdit();
    await expect(actions.layoutEditBadge).toHaveCount(0);
    await autoRun.expectRefreshVariant('primary');

    testLogger.info('TC-RB-002 completed');
  });

  test('TC-RB-003: a pending refresh turns both the Refresh button and its options trigger pending, then primary after Refresh', { tag: ['@P1'] }, async () => {
    const autoRun = pm.dashboardAutoRun;
    await autoRun.pinAutoQuery(false);
    await autoRun.setStoredAutoRun('false');
    const { initial, first } = await autoRun.setupDashboard({
      name: 'refreshbtn_pending',
      panels: [namespaceTablePanel('p_var', 'var', BY_NS)],
      variable: 'ns',
    });
    await autoRun.expectPanelRows('p_var', { shows: [initial] });
    const base = await autoRun.settledRunCount('var');

    await autoRun.selectVariableValue('ns', first);
    await autoRun.expectRefreshVariant('pending');
    await autoRun.expectRefreshOptionsVariant('pending');

    await autoRun.clickRefresh();
    await autoRun.waitForRuns('var', base + 1);
    expect(autoRun.runsOf('var')[base]).toContain(`'${first}'`);
    await autoRun.expectPanelRows('p_var', { shows: [first], hides: [initial] });
    await autoRun.expectRefreshVariant('primary');
    await autoRun.expectRefreshOptionsVariant('primary');

    testLogger.info('TC-RB-003 completed');
  });

  test('TC-RB-004: Auto Run keeps Refresh primary and labelled', { tag: ['@P2'] }, async () => {
    const autoRun = pm.dashboardAutoRun;
    await autoRun.pinAutoQuery(true);
    await autoRun.setStoredAutoRun(null);
    const id = await createDashboard(`refreshbtn_autorun_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, {
      panels: [namespaceTablePanel('p1', 'rb', '')],
    });
    await autoRun.openDashboard(ORG(), id, ['p1'], '1h');
    await autoRun.waitForRefreshIdle();

    await autoRun.expectRefreshVariant('primary');
    await autoRun.expectRefreshLabel('Refresh');
    await autoRun.expectRefreshOptionsVariant('primary');

    testLogger.info('TC-RB-004 completed');
  });
});
