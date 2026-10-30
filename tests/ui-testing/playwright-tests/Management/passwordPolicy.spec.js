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

// Enterprise + meta-org gated Password Policy page; skips on OSS, asserts client-side only (no writes).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('Password Policy testcases', { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    const available = await pm.passwordPolicyPage.navigateToPasswordPolicy();
    if (!available) {
      test.skip(true, 'Password Policy is an enterprise + meta-org only feature — absent in this build');
      return;
    }
    testLogger.info('Navigated to Settings > Password Policy');
  });

  test('should render the password policy form with all sections', {
    tag: ['@password-policy', '@all'],
  }, async ({ page }) => {
    testLogger.info('Verifying the password policy form renders all sections');

    await expect(pm.passwordPolicyPage.getFormLocator()).toBeVisible({ timeout: 10000 });
    await expect(pm.passwordPolicyPage.getMinLengthLocator()).toBeVisible();
    await expect(pm.passwordPolicyPage.getMaxLengthLocator()).toBeVisible();
    await expect(pm.passwordPolicyPage.getRequireUppercaseLocator()).toBeVisible();
    await expect(pm.passwordPolicyPage.getRequireSpecialLocator()).toBeVisible();
    await expect(pm.passwordPolicyPage.getRotationDaysLocator()).toBeVisible();
    await expect(pm.passwordPolicyPage.getHistoryCountLocator()).toBeVisible();
    await expect(pm.passwordPolicyPage.getLockoutThresholdLocator()).toBeVisible();
    await expect(pm.passwordPolicyPage.getCookieMaxAgeLocator()).toBeVisible();
    await expect(pm.passwordPolicyPage.getApplyToRootLocator()).toBeVisible();

    testLogger.info('Password policy form rendered all sections');
  });

  test('should show a validation error when max length is below min length', {
    tag: ['@password-policy', '@all'],
  }, async ({ page }) => {
    testLogger.info('Testing max length below min length cross-field error');

    await pm.passwordPolicyPage.fillMinLength(12);
    await pm.passwordPolicyPage.fillMaxLength(8);
    // submit-then-change timing: the cross-field rule surfaces on the first submit.
    await pm.passwordPolicyPage.clickSave();

    await expect(pm.passwordPolicyPage.getMaxLengthErrorLocator()).toBeVisible({ timeout: 5000 });

    testLogger.info('Max length below min length error correctly shown');
  });

  test('should show a validation error when rotation warning days exceed rotation days', {
    tag: ['@password-policy', '@all'],
  }, async ({ page }) => {
    testLogger.info('Testing rotation warning days exceeding rotation days cross-field error');

    await pm.passwordPolicyPage.fillRotationDays(30);
    await pm.passwordPolicyPage.fillRotationWarningDays(45);
    await pm.passwordPolicyPage.clickSave();

    await expect(pm.passwordPolicyPage.getRotationWarningDaysErrorLocator()).toBeVisible({ timeout: 5000 });

    testLogger.info('Rotation warning days error correctly shown');
  });

  test('should reveal the special character set input only when require special is enabled', {
    tag: ['@password-policy', '@all'],
  }, async ({ page }) => {
    testLogger.info('Testing conditional reveal of the special character set input');

    // Off first: the special-char-set input must not be rendered.
    await pm.passwordPolicyPage.setRequireSpecial(false);
    await expect(pm.passwordPolicyPage.getSpecialCharSetLocator()).toHaveCount(0);

    // On: the input appears.
    await pm.passwordPolicyPage.setRequireSpecial(true);
    await expect(pm.passwordPolicyPage.getSpecialCharSetLocator()).toBeVisible({ timeout: 5000 });

    testLogger.info('Special character set input reveals with require-special');
  });

  test('should reveal the lockout preview and enable duration controls when threshold is set', {
    tag: ['@password-policy', '@all'],
  }, async ({ page }) => {
    testLogger.info('Testing lockout preview and duration controls on threshold');

    await pm.passwordPolicyPage.fillLockoutThreshold(5);

    await expect(pm.passwordPolicyPage.getLockoutPreviewLocator()).toBeVisible({ timeout: 5000 });
    await expect(pm.passwordPolicyPage.getLockoutStartSecsInputLocator()).toBeEnabled({ timeout: 5000 });

    testLogger.info('Lockout preview and duration controls enabled on threshold');
  });
});
