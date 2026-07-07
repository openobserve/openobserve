// userPage.js
import { expect } from '@playwright/test';


export class UserPage {
    constructor(page) {
        this.page = page;

        // ===========================================================
        // IAM navigation
        // ===========================================================
        this.iamPageMenu = page.locator('[data-test="menu-link-\\/iam-item"]');
        this.iamUsersTab = page.locator('[data-test="iam-users-tab"]');
        this.iamPage = page.locator('[data-test="iam-page"]');
        // Empty-state rendered inside the OTable empty slot.
        this.noDataMessage = page.locator('[data-test="o2-empty-state"]');

        // ===========================================================
        // Add / edit user form (drawer rendered by AddUser.vue)
        // ===========================================================
        this.addUserButton = page.locator('[data-test="add-basic-user"]');
        // OInput wrappers expose `<name>` on the wrapper and `<name>-field` on the
        // native input — always fill the `-field` variant per the OInput convention.
        this.userEmailFieldInput = page.locator('[data-test="user-email-field-field"]');
        this.userPasswordFieldInput = page.locator('[data-test="user-password-field-field"]');
        this.userFirstNameFieldInput = page.locator('[data-test="user-first-name-field-field"]');
        this.userLastNameFieldInput = page.locator('[data-test="user-last-name-field-field"]');
        this.userNewPasswordFieldInput = page.locator('[data-test="user-new-password-field-field"]');
        // OSelect role trigger + popover option (data-test-value keys to the role value)
        this.userRoleField = page.locator('[data-test="user-role-field"]');
        // Add/Edit user dialog footer uses ODialog's built-in primary/secondary
        // buttons; scope to the dialog so they don't collide with other dialogs' btns.
        this.saveUserButton = page.locator('[data-test="add-user-dialog"] [data-test="o-dialog-primary-btn"]');
        this.cancelUserButton = page.locator('[data-test="add-user-dialog"] [data-test="o-dialog-secondary-btn"]');
        // Change-password toggle in edit mode
        this.userChangePasswordToggle = page.locator('[data-test="user-change-password-field"]');

        // ===========================================================
        // Delete confirmation dialog (ODialog with primary/secondary btns)
        // ===========================================================
        this.userDeleteDialogConfirm = page.locator('[data-test="user-delete-dialog"] [data-test="o-dialog-primary-btn"]');
        this.userDeleteDialogCancel = page.locator('[data-test="user-delete-dialog"] [data-test="o-dialog-secondary-btn"]');

        // ===========================================================
        // List view — search input (OInput wrapper / inner field)
        // ===========================================================
        this.iamUsersSearchInput = page.locator('[data-test="user-list-search-input-field"]');

        // ===========================================================
        // Feedback surfaces — OToast and OInput inline error
        // ===========================================================
        this.toastMessage = page.locator('[data-test="o-toast-message"]');
        this.userEmailFieldError = page.locator('[data-test="user-email-field-error"]');
        // OSelect inline error rendered inside the role field wrapper when
        // AddUser onSubmit detects an empty `formData.role` and sets
        // `roleError = "Field is required"` (see AddUser.vue).
        this.userRoleFieldError = page.locator('[data-test="user-role-field-error"]');
        // OInput inline error rendered inside the AddUpdateOrganization drawer
        // when "Save" is clicked with an empty name.
        this.orgNameFieldError = page.locator('[data-test="org-name-error"]');
        // Save (primary) button inside the Add/Update Organization drawer —
        // scoped under the dialog wrapper data-test for uniqueness. The
        // ux-revamp ODrawer disables the primary button while the form is
        // invalid (see AddUpdateOrganization.vue :primaryButtonDisabled),
        // so a blank org-name keeps Save in a disabled state instead of
        // surfacing an inline error from onSubmit.
        this.addOrgDrawerSaveButton = page.locator(
            '[data-test="add-update-organization-dialog"] [data-test="o-dialog-primary-btn"]'
        );

        // OTable rows — used by searchUser / verifyUserExists poll loops.
        this.tableRows = page.locator('[data-test^="o2-table-row-"]');
    }

    // -------- Factory helpers (runtime-dynamic locators) ----------
    getDeleteUserButton(email) {
        // data-test on the button literally includes the email (with `@`); CSS
        // requires the `@` to be escaped to match.
        const escapedEmail = email.replace('@', '\\@');
        return this.page.locator(`[data-test="delete-basic-user-${escapedEmail}"]`);
    }

    getEditUserButton(email) {
        const escapedEmail = email.replace('@', '\\@');
        return this.page.locator(`[data-test="edit-basic-user-${escapedEmail}"]`);
    }

    getRoleOption(role) {
        // OSelect option items expose data-test="<parent>-option" with a
        // data-test-value="<value>" attribute keying to the option's value.
        return this.page.locator(`[data-test="user-role-field-option"][data-test-value="${role.toLowerCase()}"]`);
    }

    async gotoIamPage() {
        await this.iamPageMenu.click();
        await this.iamUsersTab.waitFor({ state: 'visible' });
        await this.iamUsersTab.click();
    }


    async addUser(email) {
        await this.addUserButton.click();
        await this.userEmailFieldInput.waitFor({ state: 'visible' });
        await this.userEmailFieldInput.fill(email);

    }


    async selectUserRole(role) {
        // Wait for the OSelect role trigger to be visible and in viewport
        await this.userRoleField.waitFor({ state: 'visible', timeout: 10000 });
        await this.userRoleField.scrollIntoViewIfNeeded();

        // Open the OSelect popover by clicking the trigger; then pick the
        // option keyed by data-test-value="<value>". OSelect option values
        // are lowercase ("admin", "member", etc.) while the test passes the
        // human label ("Admin") — normalise via getRoleOption().
        await this.userRoleField.click();
        const roleOption = this.getRoleOption(role);
        await roleOption.waitFor({ state: 'visible', timeout: 10000 });
        await roleOption.click();
      }

    async userCreate() {

        await this.saveUserButton.click();
    }

    async editUser(email) {
        // Click the edit button on the row, then navigate directly to the edit
        // URL so the drawer rehydrates with the user's data; finally wait for
        // the first-name field to attach so subsequent fills are reliable.
        await this.getEditUserButton(email).click();
        await this.page.goto(process.env["ZO_BASE_URL"] + "/web/iam/users?action=update&org_identifier=default&email=" + email);
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Wait for edit form elements to be available
        await this.userFirstNameFieldInput.waitFor({ state: 'visible', timeout: 15000 });
    }


    async deleteUser(email) {
        await this.getDeleteUserButton(email).click();
        // User delete confirmation is rendered by ODialog — use its built-in
        // primary button rather than matching by visible text, which is
        // ambiguous when other "OK" buttons exist on the page.
        await this.userDeleteDialogConfirm.click();
    }

    async deleteUserCancel(email) {
        // Logic to simulate unauthorized deletion
        await this.getDeleteUserButton(email).click();
        await this.userDeleteDialogCancel.click();
    }

    async cancelUserDrawer() {
        await this.cancelUserButton.click();
    }

    async verifyOrgNameRequiredError(expectedMessage) {
        // Zod migration (R3): Save is always ENABLED; the AddUpdateOrganization
        // schema gates the submit, and the inline `${parent}-error` is revealed on
        // SUBMIT (revalidateLogic: submit-then-change). So click Save with a blank
        // name and assert the inline required error appears with its message.
        await expect(this.addOrgDrawerSaveButton).toBeEnabled({ timeout: 15000 });
        await this.addOrgDrawerSaveButton.click();
        await expect(this.orgNameFieldError).toBeVisible({ timeout: 15000 });
        await expect(this.orgNameFieldError).toContainText(expectedMessage);
    }

    async verifySuccessMessage(expectedMessage) {
        // The message can surface from one of three places:
        // 1. OToast (`data-test="o-toast-message"`) — global notifications
        //    fired via the toast() helper.
        // 2. OInput inline error (`data-test="<parent>-error"`) — e.g. the
        //    AddUser email validator sets `emailError = "Please enter a valid
        //    email address."` which renders inside the email field wrapper.
        // 3. OSelect inline error (`data-test="<parent>-error"`) — e.g. the
        //    AddUser role validator sets `roleError = "Field is required"`
        //    which renders inside the role field wrapper.
        // Poll across all surfaces until one of them carries the expected
        // text; keeps the assertion deterministic without text-based locators.
        await expect.poll(async () => {
            const sources = [this.toastMessage, this.userEmailFieldError, this.userRoleFieldError];
            for (const src of sources) {
                const count = await src.count();
                for (let i = 0; i < count; i++) {
                    const visible = await src.nth(i).isVisible().catch(() => false);
                    if (!visible) continue;
                    const text = (await src.nth(i).textContent().catch(() => '')) ?? '';
                    if (text.includes(expectedMessage)) return true;
                }
            }
            return false;
        }, { timeout: 15000, intervals: [250, 500, 1000] }).toBe(true);
    }

    async addUserFirstLast(firstName, lastName) {

        await this.userFirstNameFieldInput.click();
        await this.userFirstNameFieldInput.fill(firstName);
        await this.userLastNameFieldInput.click();
        await this.userLastNameFieldInput.fill(lastName);

    }

    async addUserPassword(password) {


        await this.userPasswordFieldInput.click();
        await this.userPasswordFieldInput.fill(password);

    }


    async addNewPassword(password) {
        // Ensure the "Change Password" toggle is checked.
        // AddUser.vue initialises `change_password = false` whenever the drawer
        // opens (lines 252 + 352), so we know the switch is OFF on entry.
        // Click once to enable; the new-password OInput is mounted under
        // `v-if="formData.change_password"` and only appears post-click.
        await this.userChangePasswordToggle.waitFor({ state: 'visible', timeout: 10000 });
        await this.userChangePasswordToggle.click();

        // Fill in the new password
        await this.userNewPasswordFieldInput.waitFor({ state: 'visible' });
        await this.userNewPasswordFieldInput.fill(password);
    }

    async searchUser(email) {
        await this.iamUsersSearchInput.click();
        await this.iamUsersSearchInput.fill(email);
        // Wait for the filtered table to converge: either the row containing
        // the email becomes visible, or the NoData message renders. Avoid a
        // blind sleep so the test is deterministic against fast filters.
        await expect.poll(async () => {
            const noData = await this.noDataMessage.isVisible().catch(() => false);
            if (noData) return 'no-data';
            const rowCount = await this.tableRows.count().catch(() => 0);
            for (let i = 0; i < rowCount; i++) {
                const text = (await this.tableRows.nth(i).textContent().catch(() => '')) ?? '';
                if (text.includes(email)) return 'match';
            }
            return false;
        }, { timeout: 15000, intervals: [250, 500, 1000] }).not.toBe(false);

    }

    async verifyUserNotExists() {
        await expect(this.page.locator('[data-test="o2-empty-state"]')).toBeVisible();
    }

    async verifyUserExists(email) {

        await expect.poll(async () => {
            const rowCount = await this.tableRows.count().catch(() => 0);
            for (let i = 0; i < rowCount; i++) {
                const text = (await this.tableRows.nth(i).textContent().catch(() => '')) ?? '';
                if (text.includes(email)) return true;
            }
            return false;
        }, { timeout: 15000, intervals: [250, 500, 1000] }).toBe(true);


    }

}
