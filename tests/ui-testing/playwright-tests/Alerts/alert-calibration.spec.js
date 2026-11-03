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

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const BOUNCED = 'Alert calibration route guard sent the runs URL to the alert list (OSS bundle or feature off)';

test.describe('Alert Calibration route and tabs', {
  tag: ['@alert-calibration', '@all'],
}, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test('the alert calibration route redirects to the alert list on an OSS build', {
    tag: ['@oss', '@P0'],
  }, async () => {
    const buildType = await pm.alertCalibrationPage.detectBuildType();
    test.skip(buildType !== 'opensource', `Runs only on an OSS backend (build: ${buildType})`);
    await pm.alertCalibrationPage.openRunsExpectingRedirect();
  });

  test('the runs page renders its stats strip and runs table', {
    tag: ['@enterprise', '@P0'],
  }, async () => {
    test.skip(!(await pm.alertCalibrationPage.openRunsIfReachable()), BOUNCED);
    await pm.alertCalibrationPage.expectRunsPageShell();
  });

  test('the tabs switch between the runs page and the dashboard', {
    tag: ['@enterprise', '@P1'],
  }, async () => {
    test.skip(!(await pm.alertCalibrationPage.openRunsIfReachable()), BOUNCED);
    await pm.alertCalibrationPage.switchToDashboardTab();
    await pm.alertCalibrationPage.switchToRunsTab();
  });
});
