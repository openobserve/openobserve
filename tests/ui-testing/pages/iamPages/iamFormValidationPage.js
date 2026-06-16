// Copyright 2026 OpenObserve Inc.

export class IamFormValidationPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── Navigation ───────────────────────────────────────────────────────
        this.iamMenuLink           = '[data-test="menu-link-\\/iam-item"]';
        this.iamOrganizationsTab   = '[data-test="iam-organizations-tab"]';
        this.iamGroupsTab          = '[data-test="iam-groups-tab"]';
        this.iamRolesTab           = '[data-test="iam-roles-tab"]';
        this.iamServiceAccountsTab = '[data-test="iam-service-accounts-tab"]';

        // ── Organization form ─────────────────────────────────────────────────
        // Add org button uses the literal label from ListOrganizations.vue
        this.addOrgButton          = '[data-test="Add Organization"]';
        // ODialog wrapper
        this.orgDialog             = '[data-test="add-update-organization-dialog"]';
        // OInput — OInput auto-generates -field (native <input>) and -error (message span)
        this.orgNameInput          = '[data-test="org-name-field"]';
        this.orgNameError          = '[data-test="org-name-error"]';
        // ODialog built-in primary / secondary buttons scoped to dialog
        this.orgSubmitBtn          = '[data-test="add-update-organization-dialog"] [data-test="o-dialog-primary-btn"]';
        this.orgCancelBtn          = '[data-test="add-update-organization-dialog"] [data-test="o-dialog-secondary-btn"]';

        // ── Group form ────────────────────────────────────────────────────────
        this.addGroupButton        = '[data-test="iam-groups-add-group-btn"]';
        this.groupDialog           = '[data-test="add-group-dialog"]';
        // OInput data-test="add-group-groupname-input-btn" → -field / -error
        this.groupNameInput        = '[data-test="add-group-groupname-input-btn-field"]';
        this.groupNameError        = '[data-test="add-group-groupname-input-btn-error"]';
        this.groupSubmitBtn        = '[data-test="add-group-dialog"] [data-test="o-dialog-primary-btn"]';
        this.groupCancelBtn        = '[data-test="add-group-dialog"] [data-test="o-dialog-secondary-btn"]';

        // ── Role form ─────────────────────────────────────────────────────────
        // Add role button in AppRoles.vue currently uses this data-test value
        this.addRoleButton         = '[data-test="alert-list-add-alert-btn"]';
        this.roleDialog            = '[data-test="add-role-dialog"]';
        // OInput data-test="add-role-rolename-input-btn" → -field / -error
        this.roleNameInput         = '[data-test="add-role-rolename-input-btn-field"]';
        this.roleNameError         = '[data-test="add-role-rolename-input-btn-error"]';
        this.roleSubmitBtn         = '[data-test="add-role-dialog"] [data-test="o-dialog-primary-btn"]';
        this.roleCancelBtn         = '[data-test="add-role-dialog"] [data-test="o-dialog-secondary-btn"]';

        // ── Service Account form ──────────────────────────────────────────────
        this.addServiceAccountBtn  = '[data-test="service-accounts-add-btn"]';
        this.saDialog              = '[data-test="add-service-account-dialog"]';
        // OInput data-test="iam-add-service-account-email-input" → -field / -error
        this.saEmailInput          = '[data-test="iam-add-service-account-email-input-field"]';
        this.saEmailError          = '[data-test="iam-add-service-account-email-input-error"]';
        this.saSubmitBtn           = '[data-test="add-service-account-dialog"] [data-test="o-dialog-primary-btn"]';
        this.saCancelBtn           = '[data-test="add-service-account-dialog"] [data-test="o-dialog-secondary-btn"]';

        // ── Add User form ─────────────────────────────────────────────────────
        this.iamUsersTab           = '[data-test="iam-users-tab"]';
        this.addBasicUserBtn       = '[data-test="add-basic-user"]';
        this.addUserDialog         = '[data-test="add-user-dialog"]';
        // AddUser.vue uses data-test="user-email-field", "user-password-field", "user-role-field"
        // OInput auto-generates -field / -error suffixes
        // OInput data-test="user-email-field" → error span: data-test="user-email-field-error"
        this.userEmailInput        = '[data-test="user-email-field"]';
        this.userEmailError        = '[data-test="user-email-field-error"]';
        // OInput data-test="user-password-field" → error span: data-test="user-password-field-error"
        this.userPasswordInput     = '[data-test="user-password-field"]';
        this.userPasswordError     = '[data-test="user-password-field-error"]';
        // OSelect data-test="user-role-field" → error span: data-test="user-role-field-error"
        this.userRoleError         = '[data-test="user-role-field-error"]';
        this.addUserSubmitBtn      = '[data-test="add-user-dialog"] [data-test="o-dialog-primary-btn"]';
        this.addUserCancelBtn      = '[data-test="add-user-dialog"] [data-test="o-dialog-secondary-btn"]';

        // ── UpdateRole dialog ─────────────────────────────────────────────────
        // Trigger: row action button data-test="edit-basic-user-${email}"
        this.updateRoleDialog      = '[data-test="update-role-dialog"]';
        // OSelect data-test="iam-update-role-select" → -error (manual error from roleError ref)
        this.updateRoleSelect      = '[data-test="iam-update-role-select-popover"]';
        this.updateRoleError       = '[data-test="iam-update-role-select-error"]';
        this.updateRoleSaveBtn     = '[data-test="iam-update-role-save-btn"]';
        this.updateRoleCancelBtn   = '[data-test="iam-update-role-cancel-btn"]';

        // ── Toast / success messages ──────────────────────────────────────────
        this.toastSuccess          = '[data-test-variant="success"]';
        this.toastMessage          = '[data-test="o-toast-message"]';
    }

    // ── Navigation helpers ────────────────────────────────────────────────────

    async navigateToIam() {
        await this.page.locator(this.iamMenuLink).click();
        await this.page.locator('[data-test="iam-page"]').waitFor({ state: 'visible', timeout: 10000 });
    }

    async navigateToOrganizationsTab() {
        await this.navigateToIam();
        await this.page.locator(this.iamOrganizationsTab).click();
    }

    async navigateToGroupsTab() {
        await this.navigateToIam();
        await this.page.locator(this.iamGroupsTab).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.iamGroupsTab).click();
        await this.page.locator(this.addGroupButton).waitFor({ state: 'visible', timeout: 10000 });
    }

    async navigateToRolesTab() {
        await this.navigateToIam();
        await this.page.locator(this.iamRolesTab).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.iamRolesTab).click();
        await this.page.locator(this.addRoleButton).waitFor({ state: 'visible', timeout: 10000 });
    }

    async navigateToServiceAccountsTab() {
        await this.navigateToIam();
        await this.page.locator(this.iamServiceAccountsTab).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.iamServiceAccountsTab).click();
    }

    // ── Organization form actions ─────────────────────────────────────────────

    async openOrganizationForm() {
        await this.page.locator(this.addOrgButton).click();
        await this.page.locator(this.orgDialog).waitFor({ state: 'visible', timeout: 8000 });
    }

    async fillOrgName(name) {
        await this.page.locator(this.orgNameInput).fill(name);
    }

    async clearOrgName() {
        await this.page.locator(this.orgNameInput).clear();
    }

    async submitOrgForm() {
        await this.page.locator(this.orgSubmitBtn).click();
    }

    async cancelOrgForm() {
        await this.page.locator(this.orgCancelBtn).click();
    }

    // ── Group form actions ────────────────────────────────────────────────────

    async openGroupForm() {
        await this.page.locator(this.addGroupButton).click();
        await this.page.locator(this.groupDialog).waitFor({ state: 'visible', timeout: 8000 });
    }

    async fillGroupName(name) {
        await this.page.locator(this.groupNameInput).fill(name);
    }

    async submitGroupForm() {
        await this.page.locator(this.groupSubmitBtn).click();
    }

    async cancelGroupForm() {
        await this.page.locator(this.groupCancelBtn).click();
    }

    // ── Role form actions ─────────────────────────────────────────────────────

    async openRoleForm() {
        await this.page.locator(this.addRoleButton).click();
        await this.page.locator(this.roleDialog).waitFor({ state: 'visible', timeout: 8000 });
    }

    async fillRoleName(name) {
        await this.page.locator(this.roleNameInput).fill(name);
    }

    async submitRoleForm() {
        await this.page.locator(this.roleSubmitBtn).click();
    }

    async cancelRoleForm() {
        await this.page.locator(this.roleCancelBtn).click();
    }

    // ── Service Account form actions ──────────────────────────────────────────

    async openServiceAccountForm() {
        await this.page.locator(this.addServiceAccountBtn).click();
        await this.page.locator(this.saDialog).waitFor({ state: 'visible', timeout: 8000 });
    }

    async fillSaEmail(email) {
        await this.page.locator(this.saEmailInput).fill(email);
    }

    async submitSaForm() {
        await this.page.locator(this.saSubmitBtn).click();
    }

    async cancelSaForm() {
        await this.page.locator(this.saCancelBtn).click();
    }

    // ── Add User form actions ─────────────────────────────────────────────────

    async navigateToUsersTab() {
        await this.navigateToIam();
        await this.page.locator(this.iamUsersTab).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.iamUsersTab).click();
        await this.page.locator(this.addBasicUserBtn).waitFor({ state: 'visible', timeout: 10000 });
    }

    async openAddUserForm() {
        await this.page.locator(this.addBasicUserBtn).click();
        await this.page.locator(this.addUserDialog).waitFor({ state: 'visible', timeout: 8000 });
    }

    async fillUserEmail(email) {
        await this.page.locator(this.userEmailInput).fill(email);
    }

    async fillUserPassword(password) {
        await this.page.locator(this.userPasswordInput).fill(password);
    }

    async submitAddUserForm() {
        await this.page.locator(this.addUserSubmitBtn).click();
    }

    async cancelAddUserForm() {
        await this.page.locator(this.addUserCancelBtn).click();
    }

    // ── Assertion-ready locator getters ──────────────────────────────────────

    getOrgNameErrorLocator()      { return this.page.locator(this.orgNameError); }
    getOrgSubmitBtnLocator()      { return this.page.locator(this.orgSubmitBtn); }
    getGroupNameErrorLocator()    { return this.page.locator(this.groupNameError); }
    getGroupSubmitBtnLocator()    { return this.page.locator(this.groupSubmitBtn); }
    getRoleNameErrorLocator()     { return this.page.locator(this.roleNameError); }
    getRoleSubmitBtnLocator()     { return this.page.locator(this.roleSubmitBtn); }
    getSaEmailErrorLocator()      { return this.page.locator(this.saEmailError); }
    getToastMessageLocator()      { return this.page.locator(this.toastMessage); }
    getOrgDialogLocator()         { return this.page.locator(this.orgDialog); }
    getGroupDialogLocator()       { return this.page.locator(this.groupDialog); }
    getRoleDialogLocator()        { return this.page.locator(this.roleDialog); }
    getSaDialogLocator()          { return this.page.locator(this.saDialog); }
    getAddUserDialogLocator()     { return this.page.locator(this.addUserDialog); }
    getUserEmailErrorLocator()    { return this.page.locator(this.userEmailError); }
    getUserPasswordErrorLocator() { return this.page.locator(this.userPasswordError); }
    getUserRoleErrorLocator()     { return this.page.locator(this.userRoleError); }

    // ── UpdateRole locator getters ────────────────────────────────────────────
    getUpdateRoleDialogLocator()   { return this.page.locator(this.updateRoleDialog); }
    getUpdateRoleSelectLocator()   { return this.page.locator(this.updateRoleSelect); }
    getUpdateRoleErrorLocator()    { return this.page.locator(this.updateRoleError); }
    getUpdateRoleSaveBtnLocator()  { return this.page.locator(this.updateRoleSaveBtn); }
    getUpdateRoleCancelBtnLocator(){ return this.page.locator(this.updateRoleCancelBtn); }

    // Open the UpdateRole dialog for the first user visible in the Users list
    async openUpdateRoleDialogForFirstUser() {
        const editBtn = this.page.locator('[data-test^="edit-basic-user-"]').first();
        await editBtn.waitFor({ state: 'visible', timeout: 10000 });
        await editBtn.click();
        await this.page.locator(this.updateRoleDialog).waitFor({ state: 'visible', timeout: 10000 });
    }

    async navigateToUsersTab() {
        await this.navigateToIam();
        const tab = this.page.locator(this.iamUsersTab);
        await tab.waitFor({ state: 'visible', timeout: 10000 });
        await tab.click();
        await this.page.locator('[data-test^="edit-basic-user-"]').first()
            .waitFor({ state: 'visible', timeout: 15000 });
    }
}
