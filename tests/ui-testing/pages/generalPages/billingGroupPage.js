// billingGroupPage.js — Page object for Billing Group (Billing > Billing Group).
// Feature: Enterprise/Cloud only. The billing_group route is registered in
// web/src/enterprise/composables/router.ts and the backend routes are gated
// behind #[cfg(feature = "cloud")], so the page only exists on a cloud build.
// Route: /web/billings/billing_group?org_identifier={org}

import { expect } from '@playwright/test';

export class BillingGroupPage {
    constructor(page) {
        this.page = page;

        // ============================================================
        // Page root
        // ============================================================
        this.pageRoot = page.locator('[data-test="organization-group-page"]');

        // ============================================================
        // Role views — exactly one renders per org role
        // ============================================================
        this.superView = page.locator('[data-test="org-group-super-view"]');
        this.childView = page.locator('[data-test="org-group-child-view"]');
        this.standaloneInvitesView = page.locator('[data-test="org-group-standalone-invites-view"]');
        this.standaloneView = page.locator('[data-test="org-group-standalone-view"]');

        // ============================================================
        // Child (member) view — leave CTA
        // ============================================================
        this.leaveButton = page.locator('[data-test="org-group-leave"]');

        // ============================================================
        // Dialogs (ODialog)
        // ============================================================
        this.removeDialog = page.locator('[data-test="org-group-remove-dialog"]');
        this.leaveDialog = page.locator('[data-test="org-group-leave-dialog"]');
        this.dialogPrimaryBtn = page.locator('[data-test="o-dialog-primary-btn"]');

        // ============================================================
        // Toast
        // ============================================================
        this.toastMessage = page.locator('[data-test="o-toast-message"]');
    }

    // ----------------------------------------------------------------
    // Navigation
    // ----------------------------------------------------------------
    async gotoBillingGroupPage() {
        const org = process.env['ORGNAME'] || 'default';
        await this.page.goto(
            `${process.env['ZO_BASE_URL']}/web/billings/billing_group?org_identifier=${org}`
        );
        await this.pageRoot.waitFor({ state: 'visible', timeout: 30000 });
    }

    // ----------------------------------------------------------------
    // Actions
    // ----------------------------------------------------------------
    async clickFirstRemoveMember() {
        // The Remove button (data-test="org-group-remove-member-<org_id>") sits on
        // each Active row; the mobile dropdown item shares the prefix but ends in
        // "-menu", so exclude it.
        await this.page
            .locator('[data-test^="org-group-remove-member-"]:not([data-test$="-menu"])')
            .first()
            .click();
    }

    async clickLeaveButton() {
        await this.leaveButton.click();
    }

    async clickDialogPrimary() {
        await this.dialogPrimaryBtn.click();
    }

    // ----------------------------------------------------------------
    // Assertion helpers
    // ----------------------------------------------------------------
    async expectPageVisible() {
        await expect(this.pageRoot).toBeVisible({ timeout: 15000 });
    }

    async expectExactlyOneRoleViewVisible() {
        const views = [
            this.superView,
            this.childView,
            this.standaloneInvitesView,
            this.standaloneView,
        ];
        let visible = 0;
        for (const view of views) {
            if (await view.isVisible({ timeout: 3000 }).catch(() => false)) visible += 1;
        }
        expect(visible).toBe(1);
    }

    async expectSuperViewVisible() {
        await expect(this.superView).toBeVisible({ timeout: 15000 });
    }

    async expectChildViewVisible() {
        await expect(this.childView).toBeVisible({ timeout: 15000 });
    }

    async expectChildViewHidden() {
        await expect(this.childView).not.toBeVisible({ timeout: 15000 });
    }

    async expectRemoveDialogVisible() {
        await expect(this.removeDialog).toBeVisible({ timeout: 10000 });
    }

    async expectLeaveDialogVisible() {
        await expect(this.leaveDialog).toBeVisible({ timeout: 10000 });
    }

    async expectSuccessToast(messageFragment) {
        await expect(this.toastMessage.filter({ hasText: messageFragment }))
            .toBeVisible({ timeout: 10000 });
    }
}
