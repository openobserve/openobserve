const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Billing Group Remove Member & Leave Group testcases", () => {
  test.describe.configure({ mode: 'parallel' });

  // The billing_group frontend route renders on any enterprise build
  // (web/src/enterprise/composables/router.ts, gated by config.isEnterprise), but the
  // backend membership/remove/leave endpoints are #[cfg(feature = "cloud")] only, so the
  // render smoke test still runs here while the action tests stay fixme'd below.

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test("should render the billing group page with exactly one role view", {
    tag: ['@billingGroupRemoveLeave', '@billing', '@cloud', '@all'],
  }, async ({ page }) => {
    testLogger.info('Navigating to the billing group page');
    await pm.billingGroupPage.gotoBillingGroupPage();
    await pm.billingGroupPage.expectPageVisible();
    await pm.billingGroupPage.expectExactlyOneRoleViewVisible();
    testLogger.info('Test completed');
  });

  test.fixme(
    "should remove a member after confirming the removal dialog — data precondition not established: requires a pre-seeded payer org with an Active member (billing-group membership needs cloud customer_billings seeding, no setup contract)",
    { tag: ['@billingGroupRemoveLeave', '@billing', '@cloud', '@all'] },
    async ({ page }) => {
      testLogger.info('Navigating to the billing group page');
      await pm.billingGroupPage.gotoBillingGroupPage();
      await pm.billingGroupPage.expectSuperViewVisible();

      testLogger.info('Opening the remove dialog for the first active member');
      await pm.billingGroupPage.clickFirstRemoveMember();
      await pm.billingGroupPage.expectRemoveDialogVisible();

      testLogger.info('Confirming the removal');
      await pm.billingGroupPage.clickDialogPrimary();

      await pm.billingGroupPage.expectSuccessToast('removed from billing group');
      testLogger.info('Test completed');
    }
  );

  test.fixme(
    "should leave the billing group after confirming the leave dialog — data precondition not established: requires a pre-seeded member org (billing-group membership needs cloud customer_billings seeding, no setup contract)",
    { tag: ['@billingGroupRemoveLeave', '@billing', '@cloud', '@all'] },
    async ({ page }) => {
      testLogger.info('Navigating to the billing group page');
      await pm.billingGroupPage.gotoBillingGroupPage();
      await pm.billingGroupPage.expectChildViewVisible();

      testLogger.info('Opening the leave dialog');
      await pm.billingGroupPage.clickLeaveButton();
      await pm.billingGroupPage.expectLeaveDialogVisible();

      testLogger.info('Confirming leaving the group');
      await pm.billingGroupPage.clickDialogPrimary();

      await pm.billingGroupPage.expectSuccessToast('Left billing group');
      await pm.billingGroupPage.expectChildViewHidden();
      testLogger.info('Test completed');
    }
  );
});
