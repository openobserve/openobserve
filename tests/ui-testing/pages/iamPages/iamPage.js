// iamPage.js
import { expect } from '@playwright/test';


export class IamPage {
    constructor(page) {
        this.page = page;

        // ============================================================
        // IAM navigation locators
        // ============================================================
        this.iamPageMenu = page.locator('[data-test="menu-link-\\/iam-item"]');
        this.serviceAccountsTab = page.locator('[data-test="iam-service-accounts-tab"]');

        // Org selector (navbar combobox + popover option matched by data-test-value)
        this.orgSelect = page.locator('[data-test="navbar-organizations-select"]');
        this.orgSelectDefaultOption = page.locator('[data-test="navbar-organizations-select-popover"] [data-test-value="default"]');
        this.orgSelectMultiOption = page.locator('[data-test="navbar-organizations-select-popover"] [data-test-value="defaulttestmulti"]');

        // Add / Update service account ODrawer (carries the dialog title)
        this.addServiceAccountDialog = page.locator('[data-test="add-service-account-dialog"]');

        // ============================================================
        // Service Account list / dialog locators
        // ============================================================
        // After ODialog migration, ServiceAccountsList delete/refresh dialogs
        // use ODialog's built-in primary/secondary buttons. Only one dialog is
        // open at a time, so we target by the common slug rather than the
        // (different) parent slugs of delete vs. refresh dialogs.
        this.addServiceAccountButton = page.locator('[data-test="service-accounts-add-btn"]');
        this.emailInput = page.locator('[data-test="iam-add-service-account-email-input-field"]');
        this.emailInputError = page.locator('[data-test="iam-add-service-account-email-input-error"]');
        this.descriptionInput = page.locator('[data-test="iam-add-service-account-description-input-field"]');
        // Add/Edit service account dialog footer uses ODialog's built-in
        // primary/secondary buttons; scope to the dialog to avoid colliding
        // with other dialogs' generic o-dialog-*-btn slugs.
        this.saveButton = page.locator('[data-test="add-service-account-dialog"] [data-test="o-dialog-primary-btn"]');
        this.cancelButton = page.locator('[data-test="add-service-account-dialog"] [data-test="o-dialog-secondary-btn"]');

        // Token dialog (post-creation popup with Copy / Download / Close)
        this.tokenDialog = page.locator('[data-test="service-accounts-list-token-dialog"]');
        this.tokenCopyButton = page.locator('[data-test="service-accounts-list-token-copy-btn"]');
        this.tokenDownloadButton = page.locator('[data-test="service-accounts-list-token-download-btn"]');
        this.tokenDialogCloseButton = this.tokenDialog.locator('[data-test="o-dialog-close-btn"]');

        // Confirmation dialog (delete + refresh share the same ODialog primary / secondary buttons)
        this.confirmOkButton = page.locator('[data-test="o-dialog-primary-btn"]');
        this.confirmCancelButton = page.locator('[data-test="o-dialog-secondary-btn"]');

        // System SRE Agent row markers (used for SRE Agent System Account Protection test)
        this.systemAccountLabel = page.locator('[data-test="service-accounts-system-account-label"]');
        this.systemManagedBadge = page.locator('[data-test="service-accounts-system-managed-badge"]');

        // Toast notifications (OToast renders [data-test="o-toast-<variant>"] with
        // [data-test="o-toast-message"] inside).
        this.toastMessages = page.locator('[data-test="o-toast-message"]');

        // ============================================================
        // Per-email runtime factories. Walks from the email-cell up to the
        // ancestor row, then drills back down to the action buttons that
        // share the row scope.
        // ============================================================
        this.emailCellByEmail = (emailName) =>
            page.locator(`[data-test="service-accounts-email-${emailName}"]`);
        this.rowByEmail = (emailName) =>
            this.emailCellByEmail(emailName).locator(
                "xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]"
            );
        this.deleteButtonByEmail = (emailName) =>
            this.rowByEmail(emailName).locator('[data-test="service-accounts-delete"]');
        this.refreshButtonByEmail = (emailName) =>
            this.rowByEmail(emailName).locator('[data-test="service-accounts-refresh"]');
        this.updateButtonByEmail = (emailName) =>
            this.rowByEmail(emailName).locator('[data-test="service-accounts-edit"]');

        // System account row (resolved via the static system-account label).
        this.systemAccountRow = this.systemAccountLabel.locator(
            "xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]"
        );
        this.systemRowDeleteButton = this.systemAccountRow.locator('[data-test="service-accounts-delete"]');
        this.systemRowUpdateButton = this.systemAccountRow.locator('[data-test="service-accounts-edit"]');
    }

    async gotoIamPage() {
        await this.iamPageMenu.click();
    }


    async iamPageDefaultOrg() {
        await this.orgSelect.click();
        await this.orgSelectDefaultOption.first().click();
    }

    async iamPageDefaultMultiOrg() {
        await this.orgSelect.click();
        await this.orgSelectMultiOption.first().click();
    }

    async iamPageURLValidation() {
        // TODO: Fix this test
        // await expect(this.page).not.toHaveURL(/default/);
    }

    async iamURLValidation() {

        await expect(this.page).toHaveURL(/iam/);

    }


    async iamPageServiceAccountsTab() {

        await this.serviceAccountsTab.click();

    }

    async iamPageAddServiceAccount() {

        await this.addServiceAccountButton.click();

    }


    async iamPageAddServiceAccountEmailValidation() {

        await this.saveButton.click();

        // OInput error message renders with data-test="<parent>-error" and the
        // expected copy is "Please enter a valid email address".
        await expect(this.emailInputError).toBeVisible({ timeout: 10000 });
        await expect(this.emailInputError).toHaveText('Please enter a valid email address');


    }

    async enterEmailServiceAccount(emailName) {

        await this.emailInput.click();
        await this.emailInput.fill(emailName);

    }

    async enterSameEmailServiceAccount() {

        await this.emailInput.click();
        await this.emailInput.fill(process.env["ZO_ROOT_USER_EMAIL"] || process.env["ALPHA1_USER_EMAIL"]);

    }

    async enterFirstLastNameServiceAccount() {


        await this.descriptionInput.click();
        await this.descriptionInput.fill('Test');

    }

    async clickCancelServiceAccount() {

        await this.cancelButton.click();


    }

    async clickSaveServiceAccount() {
        await this.saveButton.click();
    }


    async verifySuccessMessage(expectedMessage) {
        // OToast renders [data-test="o-toast-<variant>"] with a child
        // [data-test="o-toast-message"]. Multiple toasts can stack briefly;
        // poll for the expected message to appear among the rendered toast
        // messages (data-test selector only, no filter({ hasText })).
        await expect
            .poll(async () => (await this.toastMessages.allTextContents()).some((text) => text.includes(expectedMessage)),
                { timeout: 15000 }
            )
            .toBe(true);
    }

    async validateServiceAccountToken() {

        await expect(this.tokenDialog).toBeVisible();
        await expect(this.tokenDialog).toContainText('Service Account Token');

    }

    async waitResEmailServiceAccount(emailName) {
        const orgName = process.env.ORGNAME || 'default';
        await this.page.waitForResponse(
            (response) =>
                response.url().includes(`/api/${orgName}/service_accounts/${emailName}`) && response.status() === 200
        );

    }

    async clickCopyToken() {

        // ODialog renders via reka-ui's DialogPortal, not a Quasar
        // #q-portal--dialog--N container, so scope by the token dialog's
        // own data-test attribute instead.
        await this.tokenCopyButton.click();

    }



    async clickDownloadToken() {

        const downloadPromise = this.page.waitForEvent('download');

        await this.tokenDownloadButton.click();

    }

    async clickServiceAccountPopUpClosed() {

        // The post-creation token popup is an ODialog. Close it via the
        // built-in × button scoped to the token dialog instance.
        await this.tokenDialogCloseButton.click();

    }

    async reloadServiceAccountPage(emailName) {
        await this.page.reload();
        // Avoid waitForLoadState('networkidle') — deployed envs continuously poll
        // RUM/analytics so the network never idles. Use a known element instead.
        await this.serviceAccountsTab.waitFor({ state: 'visible', timeout: 10000 });
    }

    async deletedServiceAccount(emailName) {
        // First check if this is a system account that shouldn't be deleted
        const isSystemAccount = emailName.includes('o2-sre-agent');
        if (isSystemAccount) {
            throw new Error(`Cannot delete system account: ${emailName}. System accounts are protected.`);
        }

        const deleteButtonLocator = this.deleteButtonByEmail(emailName);

        // Wait for the delete button to be visible and enabled
        await deleteButtonLocator.waitFor({ state: 'visible', timeout: 30000 });

        // Verify the button is not disabled before clicking
        await expect(deleteButtonLocator).toBeEnabled();

        // Click the delete button
        await deleteButtonLocator.click({ force: true });
    }

    async requestServiceAccountOk(emailName) {
        // Wait for the confirmation button to be visible and click it
        await this.confirmOkButton.waitFor({ state: 'visible', timeout: 10000 });
        await this.confirmOkButton.click({ force: true });
        // Wait for the confirm dialog primary button to detach (dialog closed)
        // rather than a fixed timeout buffer.
        await this.confirmOkButton.waitFor({ state: 'hidden', timeout: 10000 });
    }



    async requestServiceAccountCancel() {
        // Wait for the cancel confirmation button to be visible and click it
        await this.confirmCancelButton.waitFor({ state: 'visible', timeout: 10000 });
        await this.confirmCancelButton.click({ force: true });

        // Wait for the confirm dialog secondary button to detach (dialog closed)
        // rather than a fixed timeout buffer.
        await this.confirmCancelButton.waitFor({ state: 'hidden', timeout: 10000 });


    }

    async updatedServiceAccount(emailName) {
        // First check if this is a system account that shouldn't be updated
        const isSystemAccount = emailName.includes('o2-sre-agent');
        if (isSystemAccount) {
            throw new Error(`Cannot update system account: ${emailName}. System accounts are protected.`);
        }

        const updateButtonLocator = this.updateButtonByEmail(emailName);

        // Wait for the update button to be visible and enabled
        await updateButtonLocator.waitFor({ state: 'visible', timeout: 30000 });

        // Verify the button is not disabled before clicking
        await expect(updateButtonLocator).toBeEnabled();

        // Click the update button
        await updateButtonLocator.click({ force: true });
        // The edit ODrawer for service accounts has data-test="add-service-account-dialog"
        // and its title switches to the update copy when editing an existing account.
        await expect(this.addServiceAccountDialog).toContainText('Update Service Account');
    }

    async refreshServiceAccount(emailName) {
        const refreshButtonLocator = this.refreshButtonByEmail(emailName);
        // Wait for the refresh button to be visible
        await refreshButtonLocator.waitFor({ state: 'visible', timeout: 30000 });
        // Click the refresh button
        await refreshButtonLocator.click({ force: true });
    }

    async enterDescriptionSA() {
        await this.descriptionInput.click();
        await this.descriptionInput.fill('Description Details for Service Account');
    }

    // ============================================================
    // SRE Agent system account protection helpers
    // ============================================================

    /**
     * Returns true when the SRE Agent system-account row is present in the
     * service accounts table. The SRE Agent row is identified by the
     * static `service-accounts-system-account-label` data-test (added on the
     * "AI SRE Agent" label inside the email cell when row.is_system is true).
     */
    async sreAgentSystemAccountExists() {
        return (await this.systemAccountLabel.count()) > 0;
    }

    /**
     * Asserts that the SRE Agent system-account row is visible and marked as
     * system managed. The row itself does not render delete / update buttons
     * (see the v-if="row.is_system" branch in ServiceAccountsList.vue), but
     * if the UI ever regresses to render them, this helper asserts they would
     * be disabled.
     */
    async verifySreAgentSystemAccountProtection() {
        await expect(this.systemAccountRow).toBeVisible();
        await expect(this.systemManagedBadge).toBeVisible();

        if (await this.systemRowDeleteButton.count() > 0) {
            await expect(this.systemRowDeleteButton).toBeDisabled();
        }
        if (await this.systemRowUpdateButton.count() > 0) {
            await expect(this.systemRowUpdateButton).toBeDisabled();
        }
    }


}
