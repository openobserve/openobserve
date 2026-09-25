// rolesPage.js
//
// IAM → Roles, including the Edit Role redesign from openobserve#14682
// (module rail + one paged table, replacing the recursive permission tree).
//
// Roles are RBAC-gated (rbac_enabled, IdentityAccessManagement.vue), and the
// editor only has a module rail on a build that carries #14682 — so callers
// probe with isRolesAvailable() / hasModuleRail() and skip rather than fail on
// a build that predates it.
import { expect } from '@playwright/test';

// ModulePane.vue ACTIONS, in render order. These are the API permission names;
// the UI labels them List / Get / Create / Update / Delete / All.
export const ACTIONS = ['AllowAll', 'AllowList', 'AllowGet', 'AllowPost', 'AllowPut', 'AllowDelete'];

export class RolesPage {
    constructor(page) {
        this.page = page;

        // ---------- IAM nav ----------
        this.rolesTab = page.locator('[data-test="iam-roles-tab"]');
        this.groupsTab = page.locator('[data-test="iam-groups-tab"]');

        // ---------- roles list ----------
        this.addRoleButton = page.locator('[data-test="iam-roles-add-role-btn"]');
        // The slug is registered via focusSearchInput("iam-roles-search-input") on a
        // shared list control, so it may sit on the input or on a wrapper. Accept both.
        this.listSearch = page
            .locator('input[data-test="iam-roles-search-input"], [data-test="iam-roles-search-input"] input')
            .first();
        this.addRoleDialog = page.locator('[data-test="add-role-dialog"]');
        this.roleNameInput = page.locator('[data-test="add-role-rolename-input-btn-field"]');
        this.addRoleSave = page.locator('[data-test="add-role-dialog"] [data-test="o-dialog-primary-btn"]');
        this.addRoleCancel = page.locator('[data-test="add-role-dialog"] [data-test="o-dialog-secondary-btn"]');
        // AddRole offers a "start from" preset at creation: custom | readonly | dbm | k8s.
        // Each seeds once the user lands on EditRole.
        this.startFromSection = page.locator('[data-test="add-role-start-from-section"]');

        // ---------- editor shell ----------
        this.page_ = page.locator('[data-test="edit-role-page"]');
        this.title = page.locator('[data-test="edit-role-title"]');
        this.saveButton = page.locator('[data-test="edit-role-save-btn"]');
        this.cancelButton = page.locator('[data-test="edit-role-cancel-btn"]');
        this.reviewChangesButton = page.locator('[data-test="edit-role-review-changes-btn"]');
        this.unsavedCount = page.locator('[data-test="edit-role-unsaved-count"]');
        this.permissionsSection = page.locator('[data-test="edit-role-permissions-section"]');
        this.usersSection = page.locator('[data-test="edit-role-users-section"]');

        // ---------- view switch ----------
        this.permissionsCount = page.locator('[data-test="edit-role-permissions-count"]');
        this.showJsonButton = page.locator('[data-test="edit-role-permissions-show-json-btn"]');
        this.showTableButton = page.locator('[data-test="edit-role-permissions-show-table-btn"]');

        // ---------- module rail ----------
        this.rail = page.locator('[data-test="edit-role-module-rail"]');
        this.railSearch = page.locator('[data-test="edit-role-module-rail-search"] input');
        this.railScopeAll = page.locator('[data-test="edit-role-module-rail-scope-all"]');
        this.railScopeGranted = page.locator('[data-test="edit-role-module-rail-scope-granted"]');
        this.railTabs = page.locator('[data-test="edit-role-module-rail-tabs"]');
        // The rail is rendered twice (desktop + responsive copy), so every rail slug
        // matches two elements. Pin the visible one rather than relaxing strict mode.
        this.railSummaryItem = page
            .locator('[data-test="edit-role-module-rail-item-summary"]:visible')
            .first();
        this.railNoMatch = page.locator('[data-test="edit-role-module-rail-no-match"]');

        // ---------- module pane ----------
        this.pane = page.locator('[data-test="edit-role-module-pane"]');
        this.paneTitle = page.locator('[data-test="edit-role-module-pane-title"]');
        this.paneSearch = page.locator('[data-test="edit-role-module-pane-search"] input');
        this.paneFilterAll = page.locator('[data-test="edit-role-module-pane-filter-all"]');
        this.paneFilterGranted = page.locator('[data-test="edit-role-module-pane-filter-granted"]');
        this.paneClearFilter = page.locator('[data-test="edit-role-module-pane-clear-filter"]');
        this.paneResources = page.locator('[data-test="edit-role-module-pane-resources"]');
        this.paneNoMatch = page.locator('[data-test="edit-role-module-pane-no-match"]');
        this.paneNoResources = page.locator('[data-test="edit-role-module-pane-no-resources"]');
        this.paneAdded = page.locator('[data-test="edit-role-module-pane-added"]');
        this.paneRemoved = page.locator('[data-test="edit-role-module-pane-removed"]');
        this.paneBack = page.locator('[data-test="edit-role-module-pane-back"]');

        // ---------- summary ----------
        this.summary = page.locator('[data-test="edit-role-summary"]');
        this.summaryTitle = page.locator('[data-test="edit-role-summary-title"]');
        this.summaryEmpty = page.locator('[data-test="edit-role-summary-empty"]');
        this.summaryLoading = page.locator('[data-test="edit-role-summary-loading"]');

        // ---------- unsaved drawer ----------
        this.drawer = page.locator('[data-test="edit-role-unsaved-drawer"]');
        this.drawerEmpty = page.locator('[data-test="edit-role-unsaved-empty"]');

        this.toastMessages = page.locator('[data-test="o-toast-message"]');
    }

    // ================= locator factories =================

    startFrom(option) {
        return this.page.locator(`[data-test="add-role-start-from-${option}-radio"]`);
    }

    /** Creates a role and lands on its editor (AppRoles pushes straight in, like groups). */
    async createRole(name, { startFrom } = {}) {
        await this.addRoleButton.click();
        await expect(this.addRoleDialog).toBeVisible();
        await this.roleNameInput.fill(name);
        if (startFrom) await this.startFrom(startFrom).click();
        await this.addRoleSave.click();
        await expect(this.addRoleDialog).toBeHidden({ timeout: 15000 });
    }

    railItem(moduleKey) {
        return this.page
            .locator(`[data-test="edit-role-module-rail-item-${moduleKey}"]:visible`)
            .first();
    }
    railGroup(groupId) {
        return this.page.locator(`[data-test="edit-role-module-rail-group-${groupId}"]`);
    }
    railGroupToggle(groupId) {
        return this.page
            .locator(`[data-test="edit-role-module-rail-group-toggle-${groupId}"]:visible`)
            .first();
    }
    railUnsaved(moduleKey) {
        return this.page.locator(`[data-test="edit-role-module-rail-unsaved-${moduleKey}"]`);
    }
    railItems() {
        return this.page.locator('[data-test^="edit-role-module-rail-item-"]:visible');
    }

    /** Distinct module keys in the rail, immune to the duplicate desktop/mobile render. */
    /**
     * Distinct module keys in the rail.
     *
     * `summary` is filtered because the rail's "Role Overview" nav item and the real
     * `summary` permission module BOTH render as `edit-role-module-rail-item-summary`
     * — two elements, one slug — and without the filter Role Overview counts as a
     * module. The cost is that a published module is dropped too, so THIS LIST IS ONE
     * SHORT of what the rail actually offers. Do not compare its length against a
     * resource total: that reads as a missing module when nothing is missing, which
     * is exactly how o2-enterprise#2717 came to be filed and closed as invalid.
     * Test membership, or give Role Overview its own slug and drop the filter.
     */
    async railModuleKeys() {
        const slugs = await this.page
            .locator('[data-test^="edit-role-module-rail-item-"]')
            .evaluateAll((els) => els.map((e) => e.getAttribute('data-test')));
        return [...new Set(slugs.map((s) => s.replace('edit-role-module-rail-item-', '')))]
            .filter((k) => k !== 'summary');
    }

    scopeRow(key) {
        return this.page.locator(`[data-test="edit-role-module-pane-scope-row-${key}"]`);
    }
    /** Checkbox on a pinned scope row: `edit-role-module-pane-scope-<key>-<Action>`. */
    scopeCheckbox(key, action) {
        return this.page.locator(
            `[data-test="edit-role-module-pane-scope-${key}-${action}"] [role="checkbox"]`,
        );
    }
    /** Checkbox on a resource row: `edit-role-permissions-table-body-row-<name>-col-<Action>-checkbox`. */
    entityCheckbox(name, action) {
        return this.page.locator(
            `[data-test="edit-role-permissions-table-body-row-${name}-col-${action}-checkbox"] [role="checkbox"]`,
        );
    }
    /** The em-dash rendered where an action does not apply, on a pinned scope row. */
    scopeNotApplicable(key, action) {
        return this.page.locator(`[data-test="edit-role-module-pane-scope-${key}-${action}-na"]`);
    }

    /**
     * The em-dash on a RESOURCE row. A module whose resource has `has_entities:false`
     * (settings, kv, passcode, license …) has no pinned scope row at all — it lists
     * itself as a single resource row, so its checkboxes carry the entity slug, not
     * the scope slug. Verified on pentest: settings renders
     * `...row-settings-col-AllowGet-checkbox` plus `-AllowList/-AllowPost/-AllowDelete-checkbox-na`.
     */
    entityNotApplicable(name, action) {
        return this.page.locator(
            `[data-test="edit-role-permissions-table-body-row-${name}-col-${action}-checkbox-na"]`,
        );
    }

    /** Every resource row's checkbox for one action, across the open module. */
    entityCheckboxes(action) {
        return this.page.locator(
            `[data-test^="edit-role-permissions-table-body-row-"][data-test$="-col-${action}-checkbox"] [role="checkbox"]`,
        );
    }
    openEntity(nodeName) {
        return this.page.locator(`[data-test="edit-role-module-pane-open-${nodeName}"]`);
    }

    summaryModule(moduleKey) {
        return this.page.locator(`[data-test="edit-role-summary-module-${moduleKey}"]`);
    }
    summaryGranted(moduleKey) {
        return this.page.locator(`[data-test="edit-role-summary-granted-${moduleKey}"]`);
    }
    summaryModules() {
        return this.page.locator('[data-test^="edit-role-summary-module-"]');
    }

    drawerChange(changeId) {
        return this.page.locator(`[data-test="edit-role-unsaved-${changeId}"]`);
    }
    drawerUndo(changeId) {
        return this.page.locator(`[data-test="edit-role-unsaved-undo-${changeId}"]`);
    }
    drawerUndoButtons() {
        return this.page.locator('[data-test^="edit-role-unsaved-undo-"]');
    }

    /** Preset cards in the empty state carry no slug of their own; match their label. */
    presetCard(label) {
        return this.summaryEmpty.getByText(label, { exact: true });
    }

    // ================= capability probes =================

    async isRolesAvailable() {
        return await this.rolesTab.isVisible().catch(() => false);
    }

    /** False on a build that predates openobserve#14682 (the old recursive tree). */
    async hasModuleRail() {
        return await this.rail.isVisible({ timeout: 10000 }).catch(() => false);
    }

    // ================= navigation =================

    async gotoRoles() {
        // Navigate to the list URL rather than clicking IAM -> Roles.
        //
        // The tab click returned BEFORE the route transition finished — traced on a
        // live build, gotoRoles() came back with the page still on /web/iam/users —
        // so callers raced it. Worse, the roles list renders from state populated
        // when the IAM section mounts, which the specs do in beforeEach; a role
        // created through the API after that mount is absent from the list, and
        // openRole() then waits out its full timeout on a row that never arrives.
        // That is what failed every test in the staging and grants specs.
        //
        // A real page load refetches the list, so the row is there.
        const base = (process.env.ZO_BASE_URL || "").replace(/\/$/, "");
        const orgId = process.env.ORGNAME || "default";
        await this.page.goto(`${base}/web/iam/roles?org_identifier=${orgId}`, {
            waitUntil: "domcontentloaded",
        });
        await this.addRoleButton.waitFor({ state: "visible", timeout: 30000 });
    }

    roleRow(name) {
        return this.page.locator(`[data-test="iam-roles-edit-${name}-role-icon"]`);
    }

    async openRole(name) {
        // The list pages at 20 rows; search first rather than assume the row rendered.
        await this.listSearch.fill(name);
        await this.roleRow(name).waitFor({ state: 'visible', timeout: 15000 });
        await this.roleRow(name).click();
        await expect(this.permissionsSection).toBeVisible({ timeout: 15000 });
    }

    /**
     * Waits for the grant load to settle. The page renders before permissions
     * arrive and briefly shows a real "0 Permissions" (o2-enterprise#2697), so
     * asserting straight after navigation reads the wrong number.
     */
    async waitForGrantsSettled(expectedCount) {
        await this.summaryLoading.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
        if (expectedCount !== undefined) {
            await expect(this.permissionsCount).toContainText(String(expectedCount), {
                timeout: 30000,
            });
        } else {
            await expect(this.permissionsCount).toBeVisible({ timeout: 30000 });
        }
    }

    async openModule(moduleKey) {
        await this.railItem(moduleKey).click();
        await expect(this.pane).toBeVisible({ timeout: 15000 });
    }

    async openSummary() {
        await this.railSummaryItem.click();
        await expect(this.summary).toBeVisible({ timeout: 15000 });
    }

    // ================= grants =================

    async isChecked(locator) {
        return (await locator.getAttribute('aria-checked')) === 'true';
    }

    /**
     * Toggles a permission checkbox via the KEYBOARD.
     *
     * O2 checkboxes render as <button role="checkbox"> inside a <label> that
     * shares its exact box. <button> is labelable, so a pointer click can
     * activate the control twice and cancel itself out — measured on the group
     * editor, where a mouse click will tick an unticked row but not untick a
     * ticked one (o2-enterprise#2699). Space activates exactly once in both
     * directions. Asserting the resulting aria-checked keeps this honest: if the
     * keyboard path regresses too, callers fail instead of silently passing.
     */
    async setCheckbox(locator, want) {
        await locator.waitFor({ state: 'visible', timeout: 15000 });
        if (await locator.isDisabled().catch(() => false)) {
            throw new Error('checkbox is locked (inherited from a wider scope)');
        }
        if ((await this.isChecked(locator)) === want) return;
        await locator.focus();
        await this.page.keyboard.press('Space');
        await expect(locator).toHaveAttribute('aria-checked', String(want), { timeout: 10000 });
    }

    grantScope(key, action) {
        return this.setCheckbox(this.scopeCheckbox(key, action), true);
    }
    revokeScope(key, action) {
        return this.setCheckbox(this.scopeCheckbox(key, action), false);
    }
    grantEntity(name, action) {
        return this.setCheckbox(this.entityCheckbox(name, action), true);
    }

    // ================= save =================

    /** Resolves with the PUT body the save sent, or null when no request fired. */
    async saveAndCapture({ expectRequest = true } = {}) {
        let captured = null;
        const onRequest = (req) => {
            if (req.method() === 'PUT' && /\/roles\/[^/]+$/.test(new URL(req.url()).pathname)) {
                captured = JSON.parse(req.postData() || '{}');
            }
        };
        this.page.on('request', onRequest);
        await this.saveButton.click();
        // A save that legitimately sends nothing must not be papered over by a wait.
        await this.page.waitForTimeout(expectRequest ? 3000 : 2500);
        this.page.off('request', onRequest);
        return captured;
    }

    async save() {
        await this.saveButton.click();
        await this.page.waitForTimeout(2500);
    }

    async openDrawer() {
        await this.reviewChangesButton.click();
        await expect(this.drawer).toBeVisible({ timeout: 10000 });
    }
}
