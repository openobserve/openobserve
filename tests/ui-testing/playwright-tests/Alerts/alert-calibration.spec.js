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

// Enterprise-gated: OSS only exercises the route-guard redirect; the feature views render only when alert_calibration_enabled is on.

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('Alert Calibration testcases', {
  tag: ['@alert-calibration', '@all'],
}, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;
  let gate = { buildType: null, enabled: false };

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    const probe = new PageManager(page);
    gate = await probe.alertCalibrationPage.detectGate();
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test('the alert calibration route redirects to the alert list on an OSS build', {
    tag: ['@oss', '@P0'],
  }, async () => {
    test.skip(gate.buildType !== 'opensource', `Runs only on OSS build (detected: ${gate.buildType})`);
    await pm.alertCalibrationPage.gotoDigests();
    await pm.alertCalibrationPage.expectRedirectedToAlertList();
  });

  test('the digests list renders its page shell with the feature enabled', {
    tag: ['@enterprise', '@P0'],
  }, async () => {
    test.skip(!gate.enabled, 'Alert Calibration is disabled (requires enterprise + alert_calibration_enabled)');
    await pm.alertCalibrationPage.gotoDigests();
    await pm.alertCalibrationPage.expectDigestsPageVisible();
  });

  test('the dashboard opens from the digests tab', {
    tag: ['@enterprise', '@P1'],
  }, async () => {
    test.skip(!gate.enabled, 'Alert Calibration is disabled (requires enterprise + alert_calibration_enabled)');
    await pm.alertCalibrationPage.gotoDigests();
    await pm.alertCalibrationPage.expectDigestsPageVisible();
    await pm.alertCalibrationPage.clickDashboardTab();
    await pm.alertCalibrationPage.expectDashboardPageVisible();
  });

  test('the settings page renders the configuration form', {
    tag: ['@enterprise', '@P1'],
  }, async () => {
    test.skip(!gate.enabled, 'Alert Calibration is disabled (requires enterprise + alert_calibration_enabled)');
    await pm.alertCalibrationPage.gotoSettings();
    await pm.alertCalibrationPage.expectSettingsVisible();
    await pm.alertCalibrationPage.expectSettingsFormVisible();
  });
});
