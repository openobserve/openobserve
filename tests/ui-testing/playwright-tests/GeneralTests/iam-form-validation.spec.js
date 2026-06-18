// Copyright 2026 OpenObserve Inc.
// IAM domain — form validation E2E tests
//
// Covers: AddUpdateOrganization, AddGroup (@enterprise), AddRole (@enterprise),
//         AddServiceAccount (format validation only — full CRUD in serviceAccount.spec.js)
//
// Cleanup notes:
//   - Organisations created in happy-path tests follow the e2e_iam_org_* prefix.
//     Delete them manually via IAM > Organizations if cleanup.spec.js does not yet
//     support org deletion via API.
//   - Groups/Roles follow e2e_iam_group_* / e2e_iam_role_* prefix.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
// IAM Groups/Roles (RBAC) are enterprise-only — their tabs are absent on the OSS
// binary. Cache availability so only the first test of each describe pays the
// probe cost; the rest skip immediately on OSS while running fully on enterprise.
const featureAvailable = {};

// ── Organization form ─────────────────────────────────────────────────────────

test.describe("IAM Organization form validation", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.iamFormValidation.navigateToOrganizationsTab();
        testLogger.info('Navigated to IAM Organizations tab');
    });

    test("should disable submit button when organization name is empty", {
        tag: ['@iamFormValidation', '@smoke', '@P0']
    }, async ({ page }) => {
        testLogger.info('Testing submit button disabled state for empty org name');

        await pm.iamFormValidation.openOrganizationForm();
        await expect(pm.iamFormValidation.getOrgDialogLocator()).toBeVisible();
        // Submit is disabled: :primaryButtonDisabled="(!organizationData.name || !isValidOrgName)"
        await expect(pm.iamFormValidation.getOrgSubmitBtnLocator()).toBeDisabled();

        testLogger.info('Submit button correctly disabled for empty name');
    });

    test("should show error when organization name contains invalid characters", {
        tag: ['@iamFormValidation', '@functional', '@P1']
    }, async ({ page }) => {
        testLogger.info('Testing org name invalid character error');

        await pm.iamFormValidation.openOrganizationForm();
        // Type an invalid name — error appears on input change (not on submit)
        await pm.iamFormValidation.fillOrgName('org@name!');
        await expect(pm.iamFormValidation.getOrgNameErrorLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getOrgNameErrorLocator()).toContainText(
            'Use alphanumeric characters, space and underscore only.'
        );
        // Submit button still disabled
        await expect(pm.iamFormValidation.getOrgSubmitBtnLocator()).toBeDisabled();

        testLogger.info('Invalid org name error correctly shown');
    });

    test("should clear format error when organization name is corrected", {
        tag: ['@iamFormValidation', '@functional', '@P1']
    }, async ({ page }) => {
        testLogger.info('Testing org name error clears on correction');

        await pm.iamFormValidation.openOrganizationForm();
        await pm.iamFormValidation.fillOrgName('bad@name!');
        await expect(pm.iamFormValidation.getOrgNameErrorLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getOrgNameErrorLocator()).toContainText('Use alphanumeric characters, space and underscore only.');

        await pm.iamFormValidation.fillOrgName('valid_name');
        await expect(pm.iamFormValidation.getOrgNameErrorLocator()).not.toBeVisible();
        // Submit should now be enabled
        await expect(pm.iamFormValidation.getOrgSubmitBtnLocator()).toBeEnabled();

        testLogger.info('Org name error correctly cleared on fix');
    });

    test("should create organization successfully with valid name", {
        tag: ['@iamFormValidation', '@smoke', '@P0']
    }, async ({ page }) => {
        const orgName = `e2e_iam_org_${Date.now()}`;
        testLogger.info(`Creating org: ${orgName}`);

        await pm.iamFormValidation.openOrganizationForm();
        await pm.iamFormValidation.fillOrgName(orgName);
        await expect(pm.iamFormValidation.getOrgSubmitBtnLocator()).toBeEnabled();
        await pm.iamFormValidation.submitOrgForm();

        // Dialog should close and a success toast should appear
        await expect(pm.iamFormValidation.getOrgDialogLocator()).not.toBeVisible();

        testLogger.info('Org created successfully');
    });

    test("should close dialog without error when cancel is clicked", {
        tag: ['@iamFormValidation', '@functional', '@P2']
    }, async ({ page }) => {
        testLogger.info('Testing org form cancel');

        await pm.iamFormValidation.openOrganizationForm();
        await pm.iamFormValidation.fillOrgName('bad@name!');
        await expect(pm.iamFormValidation.getOrgNameErrorLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getOrgNameErrorLocator()).toContainText('Use alphanumeric characters, space and underscore only.');

        await pm.iamFormValidation.cancelOrgForm();
        await expect(pm.iamFormValidation.getOrgDialogLocator()).not.toBeVisible();

        testLogger.info('Org form cancelled correctly');
    });
});

// ── Group form (@enterprise — Groups tab requires isEnterprise && rbac_enabled) ──

test.describe("IAM Group form validation", { tag: '@enterprise' }, () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        if (featureAvailable['iam-groups'] === false) {
            test.skip(true, 'IAM Groups (RBAC) is an enterprise-only feature — absent in the OSS build');
            return;
        }
        featureAvailable['iam-groups'] = await pm.iamFormValidation.navigateToGroupsTab();
        if (!featureAvailable['iam-groups']) {
            test.skip(true, 'IAM Groups (RBAC) is an enterprise-only feature — absent in the OSS build');
            return;
        }
        testLogger.info('Navigated to IAM Groups tab');
    });

    test("should disable submit button when group name is empty", {
        tag: ['@iamFormValidation', '@smoke', '@P0']
    }, async ({ page }) => {
        testLogger.info('Testing submit button disabled for empty group name');

        await pm.iamFormValidation.openGroupForm();
        await expect(pm.iamFormValidation.getGroupDialogLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getGroupSubmitBtnLocator()).toBeDisabled();

        testLogger.info('Group submit button correctly disabled for empty name');
    });

    test("should show error when group name contains invalid characters", {
        tag: ['@iamFormValidation', '@functional', '@P1']
    }, async ({ page }) => {
        testLogger.info('Testing group name with spaces (invalid)');

        await pm.iamFormValidation.openGroupForm();
        await pm.iamFormValidation.fillGroupName('group with spaces');
        await expect(pm.iamFormValidation.getGroupNameErrorLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getGroupNameErrorLocator()).toContainText(
            "Use alphanumeric and '_' characters only, without spaces."
        );
        await expect(pm.iamFormValidation.getGroupSubmitBtnLocator()).toBeDisabled();

        testLogger.info('Group invalid name error correctly shown');
    });

    test("should show error for group name with special characters", {
        tag: ['@iamFormValidation', '@functional', '@P1']
    }, async ({ page }) => {
        testLogger.info('Testing group name with special chars');

        await pm.iamFormValidation.openGroupForm();
        await pm.iamFormValidation.fillGroupName('group@name!');
        await expect(pm.iamFormValidation.getGroupNameErrorLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getGroupNameErrorLocator()).toContainText("Use alphanumeric and '_' characters only, without spaces.");
        await expect(pm.iamFormValidation.getGroupSubmitBtnLocator()).toBeDisabled();

        testLogger.info('Group special-char error correctly shown');
    });

    test("should create group successfully with valid name", {
        tag: ['@iamFormValidation', '@smoke', '@P0']
    }, async ({ page }) => {
        const groupName = `e2e_iam_group_${Date.now()}`;
        testLogger.info(`Creating group: ${groupName}`);

        await pm.iamFormValidation.openGroupForm();
        await pm.iamFormValidation.fillGroupName(groupName);
        await expect(pm.iamFormValidation.getGroupSubmitBtnLocator()).toBeEnabled();
        await pm.iamFormValidation.submitGroupForm();

        await expect(pm.iamFormValidation.getGroupDialogLocator()).not.toBeVisible();

        testLogger.info('Group created successfully');
    });
});

// ── Role form (@enterprise — Roles tab requires isEnterprise && rbac_enabled) ──

test.describe("IAM Role form validation", { tag: '@enterprise' }, () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        if (featureAvailable['iam-roles'] === false) {
            test.skip(true, 'IAM Roles (RBAC) is an enterprise-only feature — absent in the OSS build');
            return;
        }
        featureAvailable['iam-roles'] = await pm.iamFormValidation.navigateToRolesTab();
        if (!featureAvailable['iam-roles']) {
            test.skip(true, 'IAM Roles (RBAC) is an enterprise-only feature — absent in the OSS build');
            return;
        }
        testLogger.info('Navigated to IAM Roles tab');
    });

    test("should disable submit button when role name is empty", {
        tag: ['@iamFormValidation', '@smoke', '@P0']
    }, async ({ page }) => {
        testLogger.info('Testing submit button disabled for empty role name');

        await pm.iamFormValidation.openRoleForm();
        await expect(pm.iamFormValidation.getRoleDialogLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getRoleSubmitBtnLocator()).toBeDisabled();

        testLogger.info('Role submit button correctly disabled for empty name');
    });

    test("should show error when role name contains invalid characters", {
        tag: ['@iamFormValidation', '@functional', '@P1']
    }, async ({ page }) => {
        testLogger.info('Testing role name with invalid chars');

        await pm.iamFormValidation.openRoleForm();
        await pm.iamFormValidation.fillRoleName('role with spaces');
        await expect(pm.iamFormValidation.getRoleNameErrorLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getRoleNameErrorLocator()).toContainText(
            "Use alphanumeric and '_' characters only, without spaces."
        );
        await expect(pm.iamFormValidation.getRoleSubmitBtnLocator()).toBeDisabled();

        testLogger.info('Role invalid name error correctly shown');
    });

    test("should clear role name error when corrected to valid value", {
        tag: ['@iamFormValidation', '@functional', '@P1']
    }, async ({ page }) => {
        testLogger.info('Testing role name error clears on correction');

        await pm.iamFormValidation.openRoleForm();
        await pm.iamFormValidation.fillRoleName('bad role name!');
        await expect(pm.iamFormValidation.getRoleNameErrorLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getRoleNameErrorLocator()).toContainText("Use alphanumeric and '_' characters only, without spaces.");

        await pm.iamFormValidation.fillRoleName('valid_role_name');
        await expect(pm.iamFormValidation.getRoleNameErrorLocator()).not.toBeVisible();
        await expect(pm.iamFormValidation.getRoleSubmitBtnLocator()).toBeEnabled();

        testLogger.info('Role name error correctly cleared on fix');
    });

    test("should create role successfully with valid name", {
        tag: ['@iamFormValidation', '@smoke', '@P0']
    }, async ({ page }) => {
        const roleName = `e2e_iam_role_${Date.now()}`;
        testLogger.info(`Creating role: ${roleName}`);

        await pm.iamFormValidation.openRoleForm();
        await pm.iamFormValidation.fillRoleName(roleName);
        await expect(pm.iamFormValidation.getRoleSubmitBtnLocator()).toBeEnabled();
        await pm.iamFormValidation.submitRoleForm();

        await expect(pm.iamFormValidation.getRoleDialogLocator()).not.toBeVisible();

        testLogger.info('Role created successfully');
    });
});

// ── Service Account email format validation ───────────────────────────────────
// Note: empty email, valid creation, and duplicate email cases are already
// covered in serviceAccount.spec.js. This suite covers only the format
// validation case (invalid email string).

test.describe("IAM Service Account email format validation", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.iamFormValidation.navigateToServiceAccountsTab();
        testLogger.info('Navigated to IAM Service Accounts tab');
    });

    test("should show error when email format is invalid", {
        tag: ['@iamFormValidation', '@functional', '@P1']
    }, async ({ page }) => {
        testLogger.info('Testing invalid email format for service account');

        await pm.iamFormValidation.openServiceAccountForm();
        await expect(pm.iamFormValidation.getSaDialogLocator()).toBeVisible();

        await pm.iamFormValidation.fillSaEmail('notanemail');
        await pm.iamFormValidation.submitSaForm();

        await expect(pm.iamFormValidation.getSaEmailErrorLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getSaEmailErrorLocator()).toContainText(
            'Please enter a valid email address'
        );

        testLogger.info('Invalid email format error correctly shown');
    });

    test("should show error when email is missing @ symbol", {
        tag: ['@iamFormValidation', '@functional', '@P1']
    }, async ({ page }) => {
        testLogger.info('Testing email missing @ for service account');

        await pm.iamFormValidation.openServiceAccountForm();
        await pm.iamFormValidation.fillSaEmail('missingatgmail.com');
        await pm.iamFormValidation.submitSaForm();

        await expect(pm.iamFormValidation.getSaEmailErrorLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getSaEmailErrorLocator()).toContainText(
            'Please enter a valid email address'
        );

        testLogger.info('Missing @ email error correctly shown');
    });

    test("should clear email error when a valid email is entered and re-submitted", {
        tag: ['@iamFormValidation', '@functional', '@P2']
    }, async ({ page }) => {
        testLogger.info('Testing email error clears on valid re-entry');

        await pm.iamFormValidation.openServiceAccountForm();
        await pm.iamFormValidation.fillSaEmail('bademail');
        await pm.iamFormValidation.submitSaForm();
        await expect(pm.iamFormValidation.getSaEmailErrorLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getSaEmailErrorLocator()).toContainText('Please enter a valid email address');

        // Correct the email — error should clear on input change (@update:model-value="emailError = ''")
        await pm.iamFormValidation.fillSaEmail(`e2e_sa_${Date.now()}@example.com`);
        await expect(pm.iamFormValidation.getSaEmailErrorLocator()).not.toBeVisible();

        testLogger.info('Service account email error correctly cleared');
    });
});

// ── AddUser form validation ───────────────────────────────────────────────────
//
// When the "Add User" button is clicked with no existing user selected,
// AddUser renders the email field (existingUser=true, beingUpdated=false).
// Submitting with an empty or malformed email shows "Please enter a valid
// email address." via emailError ref in AddUser.vue.

test.describe("IAM Add User form validation", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.iamFormValidation.navigateToUsersTab();
        await pm.iamFormValidation.openAddUserForm();
        testLogger.info('Add User dialog opened');
    });

    test('should show email error when submitted with empty email', {
        tag: ['@iamFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing empty email required error on Add User submit');

        await pm.iamFormValidation.submitAddUserForm();

        await expect(pm.iamFormValidation.getUserEmailErrorLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getUserEmailErrorLocator()).toContainText('Please enter a valid email address.');

        testLogger.info('Empty email error correctly shown');
    });

    test('should show email error when submitted with invalid email format', {
        tag: ['@iamFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing invalid email format error on Add User submit');

        await pm.iamFormValidation.fillUserEmail('notavalidemail');
        await pm.iamFormValidation.submitAddUserForm();

        await expect(pm.iamFormValidation.getUserEmailErrorLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getUserEmailErrorLocator()).toContainText('Please enter a valid email address.');

        testLogger.info('Invalid email format error correctly shown');
    });

    test('should clear email error when a valid email is entered', {
        tag: ['@iamFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing email error clears on valid input');

        await pm.iamFormValidation.submitAddUserForm();
        await expect(pm.iamFormValidation.getUserEmailErrorLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getUserEmailErrorLocator()).toContainText('Please enter a valid email address.');

        // @update:model-value="emailError = ''" clears the error on input change
        await pm.iamFormValidation.fillUserEmail('valid@example.com');
        await expect(pm.iamFormValidation.getUserEmailErrorLocator()).not.toBeVisible();

        testLogger.info('Email error correctly cleared after valid input');
    });

    test('should close dialog without saving when cancel is clicked', {
        tag: ['@iamFormValidation', '@P2', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing Add User dialog closes on cancel');

        await pm.iamFormValidation.fillUserEmail('cancel@example.com');
        await pm.iamFormValidation.cancelAddUserForm();

        await expect(pm.iamFormValidation.getAddUserDialogLocator()).not.toBeVisible({ timeout: 5000 });

        testLogger.info('Add User dialog correctly closed on cancel');
    });
});

// ── UpdateRole form validation ────────────────────────────────────────────────
// UpdateRole.vue is only rendered in non-cloud OSS mode (v-if="config.isCloud == 'false'").
// Trigger: [data-test="edit-basic-user-${email}"] row action button in Users list.

test.describe('IAM UpdateRole form validation', { tag: ['@iamFormValidation', '@P1'] }, () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.iamFormValidation.navigateToUsersTab();
        testLogger.info('Navigated to IAM Users tab');
    });

    test('should open UpdateRole dialog when edit button is clicked', {
        tag: ['@iamFormValidation', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC-UR-001: UpdateRole dialog opens on edit click');

        await pm.iamFormValidation.openUpdateRoleDialogForFirstUser();

        await expect(pm.iamFormValidation.getUpdateRoleDialogLocator()).toBeVisible();
        await expect(pm.iamFormValidation.getUpdateRoleSaveBtnLocator()).toBeVisible();
        testLogger.info('UpdateRole dialog opened successfully');
    });

    test('should not show a role-required error when the pre-populated role is saved unchanged', {
        tag: ['@iamFormValidation', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC-UR-002: Pre-populated role passes validation with no spurious required error');

        await pm.iamFormValidation.openUpdateRoleDialogForFirstUser();

        // The edit dialog opens with the user's existing role already selected, and
        // the role OSelect is not clearable — so the "Role is required" path is not
        // reachable through the UI here (and the role field is hidden entirely for
        // the current user). The reachable, deterministic property is that saving
        // the unchanged, pre-populated role does NOT surface a role-required error.
        await pm.iamFormValidation.getUpdateRoleSaveBtnLocator().click();

        const roleError = pm.iamFormValidation.getUpdateRoleErrorLocator();
        await expect(roleError).toHaveCount(0);
        testLogger.info('No spurious role-required error on a pre-populated role');
    });

    test('should save successfully when role is selected and save is clicked', {
        tag: ['@iamFormValidation', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC-UR-003: Successful role update saves and closes dialog');

        await pm.iamFormValidation.openUpdateRoleDialogForFirstUser();

        // Role is pre-populated from existing user — click save directly
        await pm.iamFormValidation.getUpdateRoleSaveBtnLocator().click();

        // Either a success toast appears or the dialog closes
        const dialogGone = pm.iamFormValidation.getUpdateRoleDialogLocator()
            .waitFor({ state: 'hidden', timeout: 10000 });
        const successToast = page.locator('[data-test-variant="success"]')
            .waitFor({ state: 'visible', timeout: 10000 });

        await Promise.race([dialogGone, successToast]);
        testLogger.info('Role updated successfully — dialog closed or success toast shown');
    });

    test('should close dialog without saving when cancel is clicked', {
        tag: ['@iamFormValidation', '@P2']
    }, async ({ page }) => {
        testLogger.info('TC-UR-004: Cancel closes UpdateRole dialog without saving');

        const editBtnCount = await page.locator('[data-test^="edit-basic-user-"]').count();
        test.skip(editBtnCount === 0, 'UpdateRole not rendered in cloud mode or no users visible');

        await pm.iamFormValidation.openUpdateRoleDialogForFirstUser();

        await pm.iamFormValidation.getUpdateRoleCancelBtnLocator().click();

        await expect(pm.iamFormValidation.getUpdateRoleDialogLocator())
            .not.toBeVisible({ timeout: 5000 });
        testLogger.info('UpdateRole dialog closed on Cancel');
    });
});
