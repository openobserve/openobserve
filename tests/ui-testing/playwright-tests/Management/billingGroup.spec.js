const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');

test.describe('Billing Group remove action icon', () => {
    test.describe.configure({ mode: 'parallel' });

    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(!isCloudEnvironment(), 'Billing groups are Cloud-only: the membership/remove/leave APIs are #[cfg(feature = "cloud")]');
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        testLogger.info('Test setup completed');
    });

    // A pinned route still in flight when the test ends must not fail it after its assertions passed.
    test.afterEach(async ({ page }) => {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
    });

    test('should render the billing group page with exactly one role view', {
        tag: ['@billing-group-remove-icon', '@all', '@management', '@cloud', '@P1'],
    }, async ({ page }) => {
        testLogger.info('Opening the billing group page with real data');
        await pm.billingGroupPage.openBillingGroup();
        await pm.billingGroupPage.expectPageVisible();
        await pm.billingGroupPage.expectExactlyOneRoleView();
        testLogger.info('Test completed');
    });

    test('should remove an Active member: icon, confirm dialog, DELETE, row gone', {
        tag: ['@billing-group-remove-icon', '@all', '@management', '@cloud', '@P0'],
    }, async ({ page }) => {
        testLogger.info('Mocking payer org with one Active member');
        const members = [
            {
                id: 1,
                payer_org_id: getOrgIdentifier(),
                payer_org_name: 'Acme',
                member_org_id: 'member-org-123',
                member_org_name: 'Child Corp',
                created_at: 1720000000,
                created_by: 'a@b.com',
                accepted_by: null,
            },
        ];
        await pm.billingGroupPage.mockBillingGroupReads({ members, invites: [], membership: null });
        await pm.billingGroupPage.mockDeleteMember({ removeFrom: members });
        await pm.billingGroupPage.openBillingGroup();

        await pm.billingGroupPage.expectSuperView();
        await pm.billingGroupPage.expectRemoveIconVisible('member-org-123');
        await pm.billingGroupPage.clickRemoveIcon('member-org-123');
        await pm.billingGroupPage.expectRemoveDialogVisible();
        await pm.billingGroupPage.expectRemoveDialogTitleContains('Child Corp');
        await pm.billingGroupPage.clickConfirmRemove();
        await pm.billingGroupPage.expectRemovedToast();
        await pm.billingGroupPage.expectDeleteTargeted('member-org-123');
        await pm.billingGroupPage.expectRemoveDialogHidden();
        await pm.billingGroupPage.expectRemoveIconCount('member-org-123', 0);
        testLogger.info('Test completed');
    });

    test('should cancel the remove and leave the member untouched (no DELETE)', {
        tag: ['@billing-group-remove-icon', '@all', '@management', '@cloud', '@P1'],
    }, async ({ page }) => {
        testLogger.info('Mocking payer org with one Active member');
        const members = [
            {
                id: 1,
                payer_org_id: getOrgIdentifier(),
                payer_org_name: 'Acme',
                member_org_id: 'member-org-123',
                member_org_name: 'Child Corp',
                created_at: 1720000000,
                created_by: 'a@b.com',
                accepted_by: null,
            },
        ];
        await pm.billingGroupPage.mockBillingGroupReads({ members, invites: [], membership: null });
        await pm.billingGroupPage.mockDeleteMember({ removeFrom: members });
        await pm.billingGroupPage.openBillingGroup();

        await pm.billingGroupPage.expectSuperView();
        await pm.billingGroupPage.clickRemoveIcon('member-org-123');
        await pm.billingGroupPage.expectRemoveDialogVisible();
        await pm.billingGroupPage.clickCancelRemove();
        await pm.billingGroupPage.expectRemoveDialogHidden();
        await pm.billingGroupPage.expectDeleteCallCount(0);
        await pm.billingGroupPage.expectRemoveIconCount('member-org-123', 1);
        testLogger.info('Test completed');
    });

    test('should not render a remove icon on Pending invite rows', {
        tag: ['@billing-group-remove-icon', '@all', '@management', '@cloud', '@P1'],
    }, async ({ page }) => {
        testLogger.info('Mocking payer org with an Active member and a Pending invite');
        const orgId = getOrgIdentifier();
        const members = [
            {
                id: 1,
                payer_org_id: orgId,
                payer_org_name: 'Acme',
                member_org_id: 'member-org-123',
                member_org_name: 'Child Corp',
                created_at: 1720000000,
                created_by: 'a@b.com',
                accepted_by: null,
            },
        ];
        const invites = [
            {
                id: 2,
                inviter_org_id: orgId,
                inviter_org_name: 'Acme',
                invitee_org_id: 'pending-org-9',
                invitee_org_name: 'Pending Co',
                inviter_id: 'me@acme.com',
                created_at: 1720000001,
                expires_at: 1820000001,
                status: 'Pending',
                token: 'tok-1',
            },
        ];
        await pm.billingGroupPage.mockBillingGroupReads({ members, invites, membership: null });
        await pm.billingGroupPage.openBillingGroup();

        await pm.billingGroupPage.expectSuperView();
        await pm.billingGroupPage.expectRemoveIconCount('member-org-123', 1);
        await pm.billingGroupPage.expectRemoveIconCount('pending-org-9', 0);
        await pm.billingGroupPage.expectPendingStatusVisible();
        testLogger.info('Test completed');
    });

    test('should expose the Remove action via the mobile more dropdown', {
        tag: ['@billing-group-remove-icon', '@all', '@management', '@cloud', '@P2'],
    }, async ({ page }) => {
        testLogger.info('Mocking payer org and narrowing the viewport to mobile');
        const members = [
            {
                id: 1,
                payer_org_id: getOrgIdentifier(),
                payer_org_name: 'Acme',
                member_org_id: 'member-org-123',
                member_org_name: 'Child Corp',
                created_at: 1720000000,
                created_by: 'a@b.com',
                accepted_by: null,
            },
        ];
        await page.setViewportSize({ width: 390, height: 844 });
        await pm.billingGroupPage.mockBillingGroupReads({ members, invites: [], membership: null });
        await pm.billingGroupPage.openBillingGroup();

        await pm.billingGroupPage.expectSuperView();
        await pm.billingGroupPage.expectRemoveIconHidden('member-org-123');
        await pm.billingGroupPage.clickMoreActions();
        await pm.billingGroupPage.clickRemoveMenuItem('member-org-123');
        await pm.billingGroupPage.expectRemoveDialogVisible();
        testLogger.info('Test completed');
    });

    test('should fall back to the org id in the dialog title when the member has no name', {
        tag: ['@billing-group-remove-icon', '@all', '@management', '@cloud', '@P2'],
    }, async ({ page }) => {
        testLogger.info('Mocking a member with an empty org name');
        const members = [
            {
                id: 1,
                payer_org_id: getOrgIdentifier(),
                payer_org_name: 'Acme',
                member_org_id: 'member-org-456',
                member_org_name: '',
                created_at: 1720000000,
                created_by: 'a@b.com',
                accepted_by: null,
            },
        ];
        await pm.billingGroupPage.mockBillingGroupReads({ members, invites: [], membership: null });
        await pm.billingGroupPage.openBillingGroup();

        await pm.billingGroupPage.expectSuperView();
        await pm.billingGroupPage.clickRemoveIcon('member-org-456');
        await pm.billingGroupPage.expectRemoveDialogVisible();
        await pm.billingGroupPage.expectRemoveDialogTitleContains('member-org-456');
        testLogger.info('Test completed');
    });

    test('should disable the remove action while the DELETE is in flight', {
        tag: ['@billing-group-remove-icon', '@all', '@management', '@cloud', '@P2'],
    }, async ({ page }) => {
        testLogger.info('Mocking payer org and deferring the DELETE response');
        const members = [
            {
                id: 1,
                payer_org_id: getOrgIdentifier(),
                payer_org_name: 'Acme',
                member_org_id: 'member-org-123',
                member_org_name: 'Child Corp',
                created_at: 1720000000,
                created_by: 'a@b.com',
                accepted_by: null,
            },
        ];
        let releaseDelete;
        const releaseGate = { promise: new Promise((resolve) => { releaseDelete = resolve; }) };
        await pm.billingGroupPage.mockBillingGroupReads({ members, invites: [], membership: null });
        await pm.billingGroupPage.mockDeleteMember({ removeFrom: members, releaseGate });
        await pm.billingGroupPage.openBillingGroup();

        await pm.billingGroupPage.expectSuperView();
        await pm.billingGroupPage.clickRemoveIcon('member-org-123');
        await pm.billingGroupPage.expectRemoveDialogVisible();
        await pm.billingGroupPage.clickConfirmRemove();
        await pm.billingGroupPage.expectRemoveIconDisabled('member-org-123');
        releaseDelete();
        await pm.billingGroupPage.expectRemovedToast();
        await pm.billingGroupPage.expectRemoveIconCount('member-org-123', 0);
        testLogger.info('Test completed');
    });
});
