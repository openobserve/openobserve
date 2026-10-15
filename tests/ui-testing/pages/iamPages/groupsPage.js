// groupsPage.js
//
// IAM → User Groups. Covers the list (AppGroups.vue), the create dialog
// (AddGroup.vue) and the editor's three selection tabs (GroupRoles.vue,
// GroupUsers.vue, GroupServiceAccounts.vue).
//
// Groups are RBAC-gated (rbac_enabled, see IdentityAccessManagement.vue), so
// every caller must skip on a build where the tab is absent — isGroupsAvailable()
// is the check.
import { expect } from '@playwright/test';

export class GroupsPage {
    constructor(page) {
        this.page = page;

        // ============================================================
        // IAM navigation
        // ============================================================
        this.groupsTab = page.locator('[data-test="iam-groups-tab"]');
        this.rolesTab = page.locator('[data-test="iam-roles-tab"]');

        // ============================================================
        // Group list (AppGroups.vue)
        // ============================================================
        this.tableSection = page.locator('[data-test="iam-groups-table-section"]');
        this.addGroupButton = page.locator('[data-test="iam-groups-add-group-btn"]');
        // Scope to the wrapper and take the inner <input>: these slugs sit on wrapper
        // divs, and the inner field's own slug is not reliable here — GroupRoles.vue
        // and GroupUsers.vue BOTH label their search box "alert-list-search-input"
        // (copy-paste), and both tabs stay mounted under v-show, so that slug is
        // ambiguous by construction.
        this.searchInput = page.locator('[data-test="iam-groups-search-input"] input');
        this.refreshButton = page.locator('[data-test="iam-groups-refresh-btn"]');
        this.bulkDeleteButton = page.locator('[data-test="iam-groups-bulk-delete-btn"]');

        // ============================================================
        // Create dialog (AddGroup.vue)
        // ============================================================
        this.addGroupDialog = page.locator('[data-test="add-group-dialog"]');
        // OInput forwards the consumer's data-test onto the wrapper and stamps the
        // real <input> as `<parent>-field` (see OInput.vue) — the same convention as
        // iam-add-service-account-name-input-field. Filling the wrapper div throws.
        this.groupNameInput = page.locator('[data-test="add-group-groupname-input-btn-field"]');
        this.groupNameError = page.locator('[data-test="add-group-groupname-input-btn-error"]');
        // AddGroup sits in an ODialog, whose footer buttons carry the generic
        // o-dialog-* slugs; scope to the dialog so they cannot collide.
        this.addGroupSaveButton = page.locator('[data-test="add-group-dialog"] [data-test="o-dialog-primary-btn"]');
        this.addGroupCancelButton = page.locator('[data-test="add-group-dialog"] [data-test="o-dialog-secondary-btn"]');

        // ============================================================
        // Editor (EditGroup.vue)
        // ============================================================
        this.editSection = page.locator('[data-test="edit-group-section"]');
        // EditGroup passes the group name to OPageLayout's `title`, which OPageHeader
        // renders as an <h1>. It passes no titleDataTest, so the heading carries no slug
        // of its own — and `edit-group-section-title` is the TABS strip, not the name.
        this.editTitle = page.locator('[data-test="edit-group-section"] h1');
        this.editTabs = page.locator('[data-test="edit-group-tabs"]');
        this.saveButton = page.locator('[data-test="edit-group-submit-btn"]');
        this.cancelButton = page.locator('[data-test="edit-group-cancel-btn"]');
        // OTabs renders one `tab-<value>` per entry; values come from EditGroup's
        // baseTabs (roles, users, and serviceAccounts when service accounts are on).
        this.tabRoles = page.locator('[data-test="tab-roles"]');
        this.tabUsers = page.locator('[data-test="tab-users"]');
        this.tabServiceAccounts = page.locator('[data-test="tab-serviceAccounts"]');

        // ============================================================
        // Selection tables — the three tabs share one shape, keyed by prefix
        // ============================================================
        this.rolesTable = page.locator('[data-test="iam-roles-selection-table"]');
        this.usersTable = page.locator('[data-test="iam-users-selection-table"]');
        this.serviceAccountsTable = page.locator('[data-test="iam-service-accounts-selection-table"]');

        this.toastMessages = page.locator('[data-test="o-toast-message"]');
    }

    // ---------- prefix helpers ----------
    // The three tabs are the same component shape with a different slug prefix,
    // so every selection helper takes the prefix rather than being written thrice.
    selectionTable(prefix) {
        return this.page.locator(`[data-test="iam-${prefix}-selection-table"]`);
    }
    selectionSearch(prefix) {
        return this.page.locator(`[data-test="iam-${prefix}-selection-search-input"] input`);
    }
    showAllButton(prefix) {
        return this.page.locator(`[data-test="iam-${prefix}-selection-show-all-btn"]`);
    }
    showSelectedButton(prefix) {
        return this.page.locator(`[data-test="iam-${prefix}-selection-show-selected-btn"]`);
    }
    /**
     * The row slug sits on a <label>, but the control inside is a
     * <button role="checkbox">, not a native <input> — so label-click forwarding
     * does NOT apply and clicking the label is a no-op. Always drive the button.
     */
    rowCheckbox(prefix, id) {
        return this.page.locator(
            `[data-test="iam-${prefix}-selection-table-body-row-${id}-checkbox"] [role="checkbox"]`,
        );
    }

    /** aria-checked, because a button-based checkbox has no .checked for isChecked(). */
    async isRowChecked(prefix, id) {
        return (await this.rowCheckbox(prefix, id).getAttribute('aria-checked')) === 'true';
    }
    rowsIn(prefix) {
        return this.selectionTable(prefix).locator('tbody tr');
    }

    // ---------- navigation ----------
    async isGroupsAvailable() {
        // RBAC off (OSS build) hides the whole Permissions section rather than
        // disabling it, so presence of the tab is the capability probe.
        return await this.groupsTab.isVisible().catch(() => false);
    }

    async gotoGroups() {
        await this.page.locator('[data-test="menu-link-\\/iam-item"]').click();
        await this.groupsTab.waitFor({ state: 'visible', timeout: 15000 });
        await this.groupsTab.click();
        await expect(this.tableSection).toBeVisible({ timeout: 15000 });
    }

    async openGroup(name) {
        // The list pages at 20 rows, so a freshly created group is often not on
        // page 1. Search first rather than assuming the row is rendered.
        await this.searchGroups(name);
        await this.groupRow(name).waitFor({ state: 'visible', timeout: 15000 });
        await this.page.locator(`[data-test="iam-groups-edit-${name}-role-icon"]`).click();
        await expect(this.editSection).toBeVisible({ timeout: 15000 });
        await expect(this.editTitle).toContainText(name);
    }

    /**
     * Cancel out of the editor. EditGroup has a route-leave guard, so with staged
     * changes a confirm dialog stands between here and the list; `discard` answers
     * it. Without staged changes no dialog appears and this is a plain navigation.
     */
    async backToList({ discard = true } = {}) {
        await this.cancelButton.click();
        const confirm = this.page.locator('[data-test="confirm-dialog"]');
        if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
            const btn = discard ? 'o-dialog-primary-btn' : 'o-dialog-secondary-btn';
            await confirm.locator(`[data-test="${btn}"]`).click();
        }
        await expect(this.tableSection).toBeVisible({ timeout: 15000 });
    }

    /** True when the leave guard challenges a cancel — i.e. changes really are staged. */
    async cancelRaisesLeaveGuard() {
        await this.cancelButton.click();
        const confirm = this.page.locator('[data-test="confirm-dialog"]');
        return await confirm.isVisible({ timeout: 5000 }).catch(() => false);
    }

    // ---------- list ----------
    /**
     * Creates a group and lands on its EDITOR, not back on the list: AppGroups'
     * onGroupAdded router.push()es straight to `editGroup` (AppGroups.vue:284).
     * Callers that want the list must backToList() afterwards.
     */
    async createGroup(name) {
        await this.addGroupButton.click();
        await expect(this.addGroupDialog).toBeVisible();
        await this.groupNameInput.fill(name);
        await this.addGroupSaveButton.click();
        await expect(this.addGroupDialog).toBeHidden({ timeout: 15000 });
        await expect(this.editSection).toBeVisible({ timeout: 15000 });
        await expect(this.editTitle).toContainText(name);
    }

    async searchGroups(term) {
        await this.searchInput.fill(term);
    }

    groupRow(name) {
        return this.page.locator(`[data-test="iam-groups-edit-${name}-role-icon"]`);
    }

    async expectGroupListed(name) {
        await this.searchGroups(name);
        await expect(this.groupRow(name)).toBeVisible({ timeout: 15000 });
    }

    async expectGroupAbsent(name) {
        await this.searchGroups(name);
        await expect(this.groupRow(name)).toHaveCount(0, { timeout: 15000 });
    }

    async deleteGroup(name) {
        await this.searchGroups(name);
        await this.page
            .locator(`[data-test="iam-groups-delete-${name}-role-icon"]`)
            .waitFor({ state: 'visible', timeout: 15000 });
        await this.page.locator(`[data-test="iam-groups-delete-${name}-role-icon"]`).click();
        await this.page.locator('[data-test="o-dialog-primary-btn"]').click();
        await this.expectGroupAbsent(name);
    }

    // ---------- editor ----------
    async switchTab(tab) {
        const map = { roles: this.tabRoles, users: this.tabUsers, serviceAccounts: this.tabServiceAccounts };
        await map[tab].click();
    }

    /**
     * Tick a row in one of the selection tables. The `Selected` filter is on by
     * default and hides unselected rows, so assigning always goes through `All`.
     */
    async assign(prefix, id) {
        await this.showAllButton(prefix).click();
        await this.toggle(prefix, id, true);
    }

    async unassign(prefix, id) {
        await this.toggle(prefix, id, false);
    }

    /**
     * Toggles a row via the KEYBOARD, deliberately.
     *
     * The row's <label> and its <button role="checkbox"> occupy the identical
     * 16x16 box, and <button> is a labelable element — so one pointer click
     * activates the control twice and cancels itself out. Measured on pentest:
     * a real mouse click at the control's centre ticks an unticked row but will
     * NOT untick a ticked one, while Space and a programmatic el.click() both
     * toggle correctly in either direction (o2-enterprise#2699).
     *
     * Space is a first-class user interaction, so driving it here tests the real
     * selection logic instead of being blocked by the pointer defect. Asserting
     * the resulting state (not just firing the key) keeps this honest: if the
     * keyboard path ever breaks too, these tests fail rather than silently pass.
     */
    async toggle(prefix, id, want) {
        const box = this.rowCheckbox(prefix, id);
        await box.waitFor({ state: 'visible', timeout: 15000 });
        if ((await this.isRowChecked(prefix, id)) === want) return;
        await box.focus();
        await this.page.keyboard.press('Space');
        await expect(box).toHaveAttribute('aria-checked', String(want), { timeout: 10000 });
    }

    async save() {
        await this.saveButton.click();
    }

    async verifySuccessMessage(expected) {
        await expect
            .poll(
                async () => (await this.toastMessages.allTextContents()).some((t) => t.includes(expected)),
                { timeout: 15000, message: `toast "${expected}" never appeared` },
            )
            .toBe(true);
    }
}
