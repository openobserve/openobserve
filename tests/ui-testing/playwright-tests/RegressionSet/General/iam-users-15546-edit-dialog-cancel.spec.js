const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

test.describe("IAM Users edit dialog cancel Regression", () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.iamFormValidation.navigateToUsersTab();
  });

  test("cancelled edit dialog stays closed and leaves no action in the URL @bug-15546 @P3 @regression @iamUsers", async ({ page }) => {
    const iam = pm.iamFormValidation;

    await iam.openUpdateRoleDialogForFirstUser();
    await expect(page).toHaveURL(/action=update/);

    await iam.getUpdateRoleCancelBtnLocator().click();
    await expect(iam.getUpdateRoleDialogLocator()).toBeHidden();
    await expect(page).not.toHaveURL(iam.getUrlWithUserActionPattern());

    // The reopen used to land about a second after Cancel.
    await page.waitForTimeout(2000);
    await expect(iam.getUpdateRoleDialogLocator()).toBeHidden();
    testLogger.info('Edit dialog stayed closed and URL is clean after Cancel');
  });

  test("edit dialog cancelled during a slow roles load does not reopen @bug-15546 @P3 @regression @iamUsers", async ({ page }) => {
    const iam = pm.iamFormValidation;
    await page.route(/\/api\/[^/]+\/roles(\?.*)?$/, async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });

    await page.reload();
    await iam.clickFirstEditUserButton();
    await expect(iam.getUpdateRoleDialogLocator()).toBeVisible();
    await iam.getUpdateRoleCancelBtnLocator().click();
    await expect(iam.getUpdateRoleDialogLocator()).toBeHidden();

    await page.waitForTimeout(4500);
    await expect(iam.getUpdateRoleDialogLocator()).toBeHidden();
    await expect(page).not.toHaveURL(iam.getUrlWithUserActionPattern());
  });
});
