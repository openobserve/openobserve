// Page Object for the Billing Group payer view and its remove action.
// The remove flow mutates real multi-org membership, so tests mock the three reads
// and the DELETE via page.route and navigate directly to /web/billings/billing_group.
import { expect } from '@playwright/test';
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

const baseUrl = () => process.env.ZO_BASE_URL.replace(/\/$/, '');

export class BillingGroupPage {
    constructor(page) {
        this.page = page;

        this.superView = page.locator('[data-test="org-group-super-view"]');
        this.membersTable = page.locator('[data-test="org-group-members-table"]');
        this.moreActions = page.locator('[data-test="org-group-row-more-actions"]');
        this.removeDialog = page.locator('[data-test="org-group-remove-dialog"]');
        this.confirmRemoveBtn = page.locator(
            '[data-test="org-group-remove-dialog"] [data-test="o-dialog-primary-btn"]',
        );
        this.cancelRemoveBtn = page.locator(
            '[data-test="org-group-remove-dialog"] [data-test="o-dialog-secondary-btn"]',
        );
        this.toastMessage = page.locator('[data-test="o-toast-message"]');

        this.deleteCalls = [];
    }

    removeIcon(orgId) {
        return this.page.locator(`[data-test="org-group-remove-member-${orgId}"]`);
    }

    removeMenuItem(orgId) {
        return this.page.locator(`[data-test="org-group-remove-member-${orgId}-menu"]`);
    }

    async openBillingGroup() {
        const orgId = getOrgIdentifier();
        await this.page.goto(`${baseUrl()}/web/billings/billing_group?org_identifier=${orgId}`);
        await this.page.waitForURL(/\/billings\/billing_group/, { timeout: 30000 });
    }

    async mockBillingGroupReads({ members = [], invites = [], membership = null } = {}) {
        await this.page.route(/\/api\/[^/]+\/billing_group\/membership(\?.*)?$/, (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: { membership } }),
            }),
        );
        await this.page.route(/\/api\/[^/]+\/billing_group\/members(\?.*)?$/, (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: members }),
            }),
        );
        await this.page.route(/\/api\/[^/]+\/billing_group\/invites(\?.*)?$/, (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: invites }),
            }),
        );
    }

    async mockDeleteMember({ removeFrom = null, releaseGate = null } = {}) {
        this.deleteCalls = [];
        await this.page.route(/\/api\/[^/]+\/billing_group\/members\/[^/]+(\?.*)?$/, async (route) => {
            if (route.request().method() !== 'DELETE') return route.continue();
            this.deleteCalls.push(route.request().url());
            const memberOrgId = route.request().url().match(/\/members\/([^/?]+)/)?.[1];
            if (removeFrom && memberOrgId) {
                const idx = removeFrom.findIndex((m) => m.member_org_id === memberOrgId);
                if (idx >= 0) removeFrom.splice(idx, 1);
            }
            if (releaseGate && releaseGate.promise) await releaseGate.promise;
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });
    }

    async expectSuperView() {
        await expect(this.superView).toBeVisible({ timeout: 15000 });
    }

    async clickRemoveIcon(orgId) {
        await this.removeIcon(orgId).click();
    }

    async expectRemoveIconVisible(orgId) {
        await expect(this.removeIcon(orgId)).toBeVisible({ timeout: 15000 });
    }

    async expectRemoveIconHidden(orgId) {
        await expect(this.removeIcon(orgId)).toBeHidden({ timeout: 15000 });
    }

    async expectRemoveIconCount(orgId, count) {
        await expect(this.removeIcon(orgId)).toHaveCount(count);
    }

    async expectRemoveIconDisabled(orgId) {
        await expect(this.removeIcon(orgId)).toBeDisabled({ timeout: 15000 });
    }

    async clickMoreActions() {
        await this.moreActions.click();
    }

    async clickRemoveMenuItem(orgId) {
        await this.removeMenuItem(orgId).click();
    }

    async expectRemoveDialogVisible() {
        await expect(this.removeDialog).toBeVisible({ timeout: 15000 });
    }

    async expectRemoveDialogHidden() {
        await expect(this.removeDialog).toBeHidden({ timeout: 15000 });
    }

    async expectRemoveDialogTitleContains(text) {
        await expect(this.removeDialog).toContainText(text);
    }

    async clickConfirmRemove() {
        await this.confirmRemoveBtn.click();
    }

    async clickCancelRemove() {
        await this.cancelRemoveBtn.click();
    }

    async expectRemovedToast() {
        await expect(
            this.toastMessage.filter({ hasText: 'Organization removed from billing group' }).first(),
        ).toBeVisible({ timeout: 15000 });
    }

    async expectPendingStatusVisible() {
        await expect(this.membersTable.getByText('Pending', { exact: true })).toBeVisible();
    }

    async expectDeleteCallCount(count) {
        expect(this.deleteCalls.length).toBe(count);
    }

    async expectDeleteTargeted(memberOrgId) {
        expect(this.deleteCalls.some((u) => u.includes(`/billing_group/members/${memberOrgId}`))).toBe(true);
    }
}
