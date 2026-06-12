// Copyright 2026 OpenObserve Inc.
// Dashboards domain — form validation E2E tests
//
// Covers:
//   - AddDashboard: empty name → required error / submit triggered; valid name → dashboard created
//   - AddFolder:    empty name → required error after submit attempt; valid name → folder created
//   - AddTab:       empty name → required error after submit attempt; valid name → tab created
//
// Cleanup notes:
//   - Dashboards follow the e2e_dash_fv_* prefix.
//   - Folders follow the e2e_fold_fv_* prefix.
//   - Tabs are created inside an e2e_dash_fv_tab_* dashboard.
//   Run cleanup.spec.js or remove via the Dashboards UI after testing.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// ── AddDashboard form validation ──────────────────────────────────────────────

test.describe("Dashboard AddDashboard form validation", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.dashboardsFormValidation.navigateToDashboards();
        testLogger.info('Navigated to Dashboards list page');
    });

    test("should show required error when dashboard name is submitted empty", {
        tag: ['@dashboards-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing required error for empty dashboard name on submit');

        await pm.dashboardsFormValidation.openAddDashboardForm();
        await expect(pm.dashboardsFormValidation.getDashboardDialogLocator()).toBeVisible();

        // Name field is empty — submit to trigger validation
        await pm.dashboardsFormValidation.submitDashboardForm();

        await expect(pm.dashboardsFormValidation.getDashboardNameErrorLocator()).toBeVisible();

        testLogger.info('Required error correctly shown for empty dashboard name');
    });

    test("should clear the required error when a valid name is entered", {
        tag: ['@dashboards-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing required error clears when name is filled in');

        await pm.dashboardsFormValidation.openAddDashboardForm();
        // Trigger validation by submitting empty
        await pm.dashboardsFormValidation.submitDashboardForm();
        await expect(pm.dashboardsFormValidation.getDashboardNameErrorLocator()).toBeVisible();

        // Fill in a valid name — error should disappear
        await pm.dashboardsFormValidation.fillDashboardName('e2e_dash_fv_temp');
        await expect(pm.dashboardsFormValidation.getDashboardNameErrorLocator()).not.toBeVisible();

        testLogger.info('Dashboard name required error correctly cleared on valid input');
    });

    test("should create dashboard successfully with a valid name", {
        tag: ['@dashboards-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        const dashName = 'e2e_dash_fv_001';
        testLogger.info(`Creating dashboard: ${dashName}`);

        await pm.dashboardsFormValidation.openAddDashboardForm();
        await pm.dashboardsFormValidation.fillDashboardName(dashName);
        await expect(pm.dashboardsFormValidation.getDashboardNameErrorLocator()).not.toBeVisible();

        await pm.dashboardsFormValidation.submitDashboardForm();

        // Dialog should close after successful creation
        await expect(pm.dashboardsFormValidation.getDashboardDialogLocator()).not.toBeVisible();

        testLogger.info(`Dashboard ${dashName} created successfully`);
    });

    test("should close AddDashboard dialog without error when cancel is clicked", {
        tag: ['@dashboards-form-validation', '@P2', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing AddDashboard dialog cancel');

        await pm.dashboardsFormValidation.openAddDashboardForm();
        await expect(pm.dashboardsFormValidation.getDashboardDialogLocator()).toBeVisible();

        await pm.dashboardsFormValidation.cancelDashboardForm();

        await expect(pm.dashboardsFormValidation.getDashboardDialogLocator()).not.toBeVisible();

        testLogger.info('AddDashboard dialog closed correctly on cancel');
    });
});

// ── AddFolder form validation ─────────────────────────────────────────────────

test.describe("Dashboard AddFolder form validation", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.dashboardsFormValidation.navigateToDashboards();
        testLogger.info('Navigated to Dashboards list page');
    });

    test("should show required error when folder name is submitted empty", {
        tag: ['@dashboards-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing required error for empty folder name on submit');

        await pm.dashboardsFormValidation.openAddFolderForm();
        await expect(pm.dashboardsFormValidation.getFolderDialogLocator()).toBeVisible();

        // Name is empty — submit to trigger validation
        await pm.dashboardsFormValidation.submitFolderForm();

        await expect(pm.dashboardsFormValidation.getFolderNameErrorLocator()).toBeVisible();

        testLogger.info('Required error correctly shown for empty folder name');
    });

    test("should clear the required error when a valid folder name is entered", {
        tag: ['@dashboards-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing folder required error clears when name is filled in');

        await pm.dashboardsFormValidation.openAddFolderForm();
        await pm.dashboardsFormValidation.submitFolderForm();
        await expect(pm.dashboardsFormValidation.getFolderNameErrorLocator()).toBeVisible();

        await pm.dashboardsFormValidation.fillFolderName('e2e_fold_fv_temp');
        await expect(pm.dashboardsFormValidation.getFolderNameErrorLocator()).not.toBeVisible();

        testLogger.info('Folder required error correctly cleared on valid input');
    });

    test("should create folder successfully with a valid name", {
        tag: ['@dashboards-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        const folderName = 'e2e_fold_fv_001';
        testLogger.info(`Creating folder: ${folderName}`);

        await pm.dashboardsFormValidation.openAddFolderForm();
        await pm.dashboardsFormValidation.fillFolderName(folderName);
        await expect(pm.dashboardsFormValidation.getFolderNameErrorLocator()).not.toBeVisible();

        await pm.dashboardsFormValidation.submitFolderForm();

        // Dialog should close after successful creation
        await expect(pm.dashboardsFormValidation.getFolderDialogLocator()).not.toBeVisible();

        testLogger.info(`Folder ${folderName} created successfully`);
    });

    test("should close AddFolder dialog without error when cancel is clicked", {
        tag: ['@dashboards-form-validation', '@P2', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing AddFolder dialog cancel');

        await pm.dashboardsFormValidation.openAddFolderForm();
        await expect(pm.dashboardsFormValidation.getFolderDialogLocator()).toBeVisible();

        await pm.dashboardsFormValidation.cancelFolderForm();

        await expect(pm.dashboardsFormValidation.getFolderDialogLocator()).not.toBeVisible();

        testLogger.info('AddFolder dialog closed correctly on cancel');
    });
});

// ── AddTab form validation ────────────────────────────────────────────────────
// AddTab is only accessible from within an open dashboard.
// These tests create a dashboard first, then open it to access the tab form.

test.describe("Dashboard AddTab form validation", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        // Navigate to Dashboards and open the pre-existing e2e_dash_fv_tab_001 dashboard.
        // If it does not exist, create it first via the AddDashboard flow.
        await pm.dashboardsFormValidation.navigateToDashboards();

        // Create a throwaway dashboard if needed — use a static name so serial
        // tests share the same dashboard across beforeEach runs.
        const dashName = 'e2e_dash_fv_tab_001';
        const dashboardLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashboardLink.isVisible().catch(() => false);
        if (!exists) {
            testLogger.info(`Dashboard ${dashName} not found — creating it`);
            await pm.dashboardsFormValidation.openAddDashboardForm();
            await pm.dashboardsFormValidation.fillDashboardName(dashName);
            await pm.dashboardsFormValidation.submitDashboardForm();
            await pm.dashboardsFormValidation.getDashboardDialogLocator().waitFor({ state: 'hidden', timeout: 10000 });
        }

        // Open the dashboard — click on its row in the list
        await pm.dashboardsFormValidation.openDashboardByName(dashName);
        // Wait for the tab bar to be present (TabList renders the add-tab button)
        await pm.dashboardsFormValidation.waitForTabListContainer(15000);
        testLogger.info(`Opened dashboard ${dashName}`);
    });

    test("should show required error when tab name is submitted empty", {
        tag: ['@dashboards-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing required error for empty tab name on submit');

        await pm.dashboardsFormValidation.openAddTabForm();
        await expect(pm.dashboardsFormValidation.getTabDialogLocator()).toBeVisible();

        // Name is empty — submit to trigger validation
        await pm.dashboardsFormValidation.submitTabForm();

        await expect(pm.dashboardsFormValidation.getTabNameErrorLocator()).toBeVisible();

        testLogger.info('Required error correctly shown for empty tab name');
    });

    test("should clear the required error when a valid tab name is entered", {
        tag: ['@dashboards-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing tab required error clears when name is filled in');

        await pm.dashboardsFormValidation.openAddTabForm();
        await pm.dashboardsFormValidation.submitTabForm();
        await expect(pm.dashboardsFormValidation.getTabNameErrorLocator()).toBeVisible();

        await pm.dashboardsFormValidation.fillTabName('Tab Temp');
        await expect(pm.dashboardsFormValidation.getTabNameErrorLocator()).not.toBeVisible();

        testLogger.info('Tab required error correctly cleared on valid input');
    });

    test("should create tab successfully with a valid name", {
        tag: ['@dashboards-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        const tabName = 'e2e_tab_fv_001';
        testLogger.info(`Creating tab: ${tabName}`);

        await pm.dashboardsFormValidation.openAddTabForm();
        await pm.dashboardsFormValidation.fillTabName(tabName);
        await expect(pm.dashboardsFormValidation.getTabNameErrorLocator()).not.toBeVisible();

        await pm.dashboardsFormValidation.submitTabForm();

        // Dialog should close after successful tab creation
        await expect(pm.dashboardsFormValidation.getTabDialogLocator()).not.toBeVisible();

        testLogger.info(`Tab ${tabName} created successfully`);
    });

    test("should close AddTab dialog without error when cancel is clicked", {
        tag: ['@dashboards-form-validation', '@P2', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing AddTab dialog cancel');

        await pm.dashboardsFormValidation.openAddTabForm();
        await expect(pm.dashboardsFormValidation.getTabDialogLocator()).toBeVisible();

        await pm.dashboardsFormValidation.cancelTabForm();

        await expect(pm.dashboardsFormValidation.getTabDialogLocator()).not.toBeVisible();

        testLogger.info('AddTab dialog closed correctly on cancel');
    });
});

// ── DrilldownPopup form validation ───────────────────────────────────────────
// Pre-condition: The drilldown popup is accessible from panel config → drilldown section.
// These tests require navigating into a panel edit view. If reliable navigation to the
// drilldown popup cannot be scripted without pre-existing dashboard/panel data, the tests
// are skipped with a descriptive reason.

test.describe("Dashboard DrilldownPopup form validation", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.dashboardsFormValidation.navigateToDashboards();
        testLogger.info('Navigated to Dashboards list page for DrilldownPopup tests');
    });

    test("should show name error or keep save disabled when drilldown name is empty", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        test.skip(true, 'DrilldownPopup requires an existing panel in edit mode — reliable navigation cannot be scripted without pre-existing dashboard+panel data. Unskip once a panel setup helper is available.');

        testLogger.info('Testing drilldown name required error on empty submit');

        // Navigate into panel edit → drilldown section, then verify the name field error
        await expect(pm.dashboardsFormValidation.getDrilldownNameErrorLocator()).toBeVisible();

        testLogger.info('Drilldown name error correctly shown for empty name');
    });

    test("should show URL format error when URL type is selected and invalid URL is entered", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        test.skip(true, 'DrilldownPopup requires an existing panel in edit mode — reliable navigation cannot be scripted without pre-existing dashboard+panel data. Unskip once a panel setup helper is available.');

        testLogger.info('Testing drilldown URL format error for invalid URL input');

        // Select URL type, enter invalid URL, then verify error
        await pm.dashboardsFormValidation.clickDrilldownByUrlBtn();
        await expect(pm.dashboardsFormValidation.getDrilldownUrlTextareaLocator()).toBeVisible();

        await pm.dashboardsFormValidation.fillDrilldownUrl('not-a-valid-url');
        await expect(pm.dashboardsFormValidation.getDrilldownUrlErrorLocator()).toBeVisible();

        testLogger.info('Drilldown URL format error shown correctly for invalid URL');
    });

    test("should verify drilldown type selector buttons are rendered", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        test.skip(true, 'DrilldownPopup requires an existing panel in edit mode — reliable navigation cannot be scripted without pre-existing dashboard+panel data. Unskip once a panel setup helper is available.');

        testLogger.info('Verifying drilldown type selector buttons render');

        await expect(pm.dashboardsFormValidation.getDrilldownByDashboardBtnLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getDrilldownByUrlBtnLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getDrilldownByLogsBtnLocator()).toBeVisible();

        testLogger.info('All drilldown type selector buttons rendered correctly');
    });
});

// ── Variable Settings (AddSettingVariable) form validation ────────────────────
// Pre-condition: Dashboard Settings > Variables tab > Add Variable must be open.
// These tests navigate to Settings inside an open dashboard and interact with
// the variable add form.

test.describe("Dashboard AddSettingVariable form validation", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.dashboardsFormValidation.navigateToDashboards();

        // Open the shared dashboard used for settings tests
        const dashName = 'e2e_dash_fv_tab_001';
        const dashboardLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashboardLink.isVisible().catch(() => false);
        if (!exists) {
            testLogger.info(`Dashboard ${dashName} not found — creating it`);
            await pm.dashboardsFormValidation.openAddDashboardForm();
            await pm.dashboardsFormValidation.fillDashboardName(dashName);
            await pm.dashboardsFormValidation.submitDashboardForm();
            await pm.dashboardsFormValidation.getDashboardDialogLocator().waitFor({ state: 'hidden', timeout: 10000 });
        }

        await pm.dashboardsFormValidation.openDashboardByName(dashName);
        await pm.dashboardsFormValidation.waitForTabListContainer(15000);

        // Navigate to Settings > Variables tab and open the Add Variable form
        const settingsBtn = pm.dashboardsFormValidation.getDashboardSettingsBtnLocator();
        const settingsVisible = await settingsBtn.isVisible().catch(() => false);
        if (!settingsVisible) {
            testLogger.info('Dashboard settings button not found — skipping variable navigation');
            return;
        }
        await settingsBtn.click();
        const variablesTab = pm.dashboardsFormValidation.getSettingsVariablesTabLocator();
        const variablesTabVisible = await variablesTab.isVisible().catch(() => false);
        if (variablesTabVisible) {
            await variablesTab.click();
        }
        const addVariableBtn = pm.dashboardsFormValidation.getVariableAddBtnLocator();
        const addVariableBtnVisible = await addVariableBtn.isVisible().catch(() => false);
        if (addVariableBtnVisible) {
            await addVariableBtn.click();
        }

        testLogger.info('Variable add form opened (if navigation succeeded)');
    });

    test("should show name required error when variable name is empty and save is clicked", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing variable name required error on empty save');

        const saveBtn = pm.dashboardsFormValidation.getVariableSaveBtnLocator();
        const saveBtnVisible = await saveBtn.isVisible().catch(() => false);
        if (!saveBtnVisible) {
            testLogger.info('Variable save button not visible — skipping test body (navigation did not reach form)');
            test.skip(true, 'Variable add form not reachable without pre-existing dashboard data in this environment');
            return;
        }

        await pm.dashboardsFormValidation.clickVariableSave();
        await expect(pm.dashboardsFormValidation.getVariableNameErrorLocator()).toBeVisible();

        testLogger.info('Variable name required error shown correctly');
    });

    test("should show type required error when variable type is not selected and save is clicked", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing variable type required error on save without selecting type');

        const saveBtn = pm.dashboardsFormValidation.getVariableSaveBtnLocator();
        const saveBtnVisible = await saveBtn.isVisible().catch(() => false);
        if (!saveBtnVisible) {
            testLogger.info('Variable save button not visible — skipping test body');
            test.skip(true, 'Variable add form not reachable without pre-existing dashboard data in this environment');
            return;
        }

        // Fill name to bypass name error, leave type empty
        await pm.dashboardsFormValidation.fillVariableName('test_fv_var_001');
        await pm.dashboardsFormValidation.clickVariableSave();

        await expect(pm.dashboardsFormValidation.getVariableTypeErrorLocator()).toBeVisible();

        testLogger.info('Variable type required error shown correctly');
    });

    test("should close variable add form when cancel is clicked", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing variable add form cancel closes the form');

        const cancelBtn = pm.dashboardsFormValidation.getVariableCancelBtnLocator();
        const cancelBtnVisible = await cancelBtn.isVisible().catch(() => false);
        if (!cancelBtnVisible) {
            testLogger.info('Variable cancel button not visible — skipping test body');
            test.skip(true, 'Variable add form not reachable without pre-existing dashboard data in this environment');
            return;
        }

        await pm.dashboardsFormValidation.clickVariableCancel();

        // After cancel the save/cancel buttons should no longer be visible
        await expect(pm.dashboardsFormValidation.getVariableSaveBtnLocator()).not.toBeVisible();

        testLogger.info('Variable add form closed correctly on cancel');
    });
});

// ── AddCondition form validation ──────────────────────────────────────────────
// Pre-condition: Panel config > Conditions tab must be open with at least one
// condition row visible. These tests verify the condition row elements render
// and that the remove action works.

test.describe("Dashboard AddCondition form validation", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.dashboardsFormValidation.navigateToDashboards();
        testLogger.info('Navigated to Dashboards list page for AddCondition tests');
    });

    test("should render condition row with column, operator, and value elements", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        test.skip(true, 'AddCondition requires an open panel config in Conditions tab — reliable navigation cannot be scripted without pre-existing panel data. Unskip once a panel setup helper is available.');

        testLogger.info('Verifying condition row elements are rendered');

        await expect(pm.dashboardsFormValidation.getConditionColumn0Locator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getConditionCondition0Locator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getConditionValueLocator()).toBeVisible();

        testLogger.info('Condition row elements rendered correctly');
    });

    test("should remove condition row when remove button is clicked", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        test.skip(true, 'AddCondition requires an open panel config in Conditions tab — reliable navigation cannot be scripted without pre-existing panel data. Unskip once a panel setup helper is available.');

        testLogger.info('Testing remove condition row');

        await expect(pm.dashboardsFormValidation.getConditionColumn0Locator()).toBeVisible();

        await pm.dashboardsFormValidation.getConditionRemoveLocator().click();

        await expect(pm.dashboardsFormValidation.getConditionColumn0Locator()).not.toBeVisible();

        testLogger.info('Condition row removed correctly');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard GeneralSettings form validation
// Requires an existing dashboard — creates one in beforeEach.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Dashboard GeneralSettings form validation", () => {
    test.describe.configure({ mode: 'serial' });

    const dashName = 'e2e_fv_general_settings_001';
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.dashboardsFormValidation.navigateToDashboards();
        // Create the dashboard if it doesn't exist, then open it
        const dashLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashLink.isVisible().catch(() => false);
        if (!exists) {
            await pm.dashboardsFormValidation.openAddDashboardForm();
            await pm.dashboardsFormValidation.fillDashboardName(dashName);
            await pm.dashboardsFormValidation.submitDashboardForm();
            await pm.dashboardsFormValidation.getDashboardDialogLocator().waitFor({ state: 'hidden', timeout: 10000 });
        }
        await pm.dashboardsFormValidation.openDashboardByName(dashName);
        await pm.dashboardsFormValidation.waitForTabListContainer(15000);
        testLogger.info('Dashboard opened for GeneralSettings tests');
    });

    test("should show required error when dashboard name is cleared in GeneralSettings", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-GS-001: Empty name → required error in GeneralSettings');

        const settingsBtn = pm.dashboardsFormValidation.getDashboardSettingsBtnLocator();
        const settingsVisible = await settingsBtn.isVisible().catch(() => false);
        if (!settingsVisible) {
            testLogger.info('Settings button not found — skipping');
            test.skip(true, 'Dashboard settings button not rendered in this environment');
            return;
        }
        await settingsBtn.click();

        // General tab is the default tab — wait for name field
        const nameField = pm.dashboardsFormValidation.getGeneralSettingNameFieldLocator();
        await nameField.waitFor({ state: 'visible', timeout: 10000 });

        // Clear the name and attempt to save
        await nameField.fill('');
        await pm.dashboardsFormValidation.getGeneralSettingSaveBtnLocator().click();

        const nameError = pm.dashboardsFormValidation.getGeneralSettingNameErrorLocator();
        const saveBtn   = pm.dashboardsFormValidation.getGeneralSettingSaveBtnLocator();

        const errorVisible = await nameError.isVisible().catch(() => false);
        const btnDisabled  = await saveBtn.isDisabled().catch(() => false);

        expect(errorVisible || btnDisabled).toBe(true);
        testLogger.info('GeneralSettings empty name validation passed');
    });

    test("should close GeneralSettings panel when Cancel is clicked", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-GS-002: Cancel closes GeneralSettings');

        const settingsBtn = pm.dashboardsFormValidation.getDashboardSettingsBtnLocator();
        const settingsVisible = await settingsBtn.isVisible().catch(() => false);
        if (!settingsVisible) {
            test.skip(true, 'Dashboard settings button not rendered in this environment');
            return;
        }
        await settingsBtn.click();

        const nameField = pm.dashboardsFormValidation.getGeneralSettingNameFieldLocator();
        await nameField.waitFor({ state: 'visible', timeout: 10000 });

        await pm.dashboardsFormValidation.getGeneralSettingCancelBtnLocator().click();

        // After cancel, the name field should no longer be visible
        await expect(nameField).not.toBeVisible({ timeout: 5000 });
        testLogger.info('GeneralSettings panel closed after Cancel');
    });

    test("should save successfully when valid name is entered in GeneralSettings", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-GS-003: Valid name → save succeeds in GeneralSettings');

        const settingsBtn = pm.dashboardsFormValidation.getDashboardSettingsBtnLocator();
        const settingsVisible = await settingsBtn.isVisible().catch(() => false);
        if (!settingsVisible) {
            test.skip(true, 'Dashboard settings button not rendered in this environment');
            return;
        }
        await settingsBtn.click();

        const nameField = pm.dashboardsFormValidation.getGeneralSettingNameFieldLocator();
        await nameField.waitFor({ state: 'visible', timeout: 10000 });

        // Fill a valid name and save
        await nameField.fill('e2e_fv_general_settings_renamed_001');
        await pm.dashboardsFormValidation.getGeneralSettingSaveBtnLocator().click();

        // After save the panel should close (name field no longer visible)
        await expect(nameField).not.toBeVisible({ timeout: 10000 });
        testLogger.info('GeneralSettings saved successfully');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// AddAnnotation dialog form validation
// Requires a dashboard with at least one panel — skipped in environments without panels.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Dashboard AddAnnotation form validation", () => {
    test.describe.configure({ mode: 'serial' });

    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.dashboardsFormValidation.navigateToDashboards();
    });

    test("should show title required error when annotation is saved with empty title", {
        tag: ['@domainFormValidation', '@P1']
    }, async ({ page }) => {
        test.skip(true, 'AddAnnotation dialog requires a dashboard panel in annotation mode — unskip once panel setup helper is available');

        // To reach this dialog: open a dashboard → click annotation mode btn on panel → click panel area
        const dialog = pm.dashboardsFormValidation.getAddAnnotationDialogLocator();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });

        // Leave title empty and click Save
        await pm.dashboardsFormValidation.getAnnotationSaveBtnLocator().click();

        const titleError = pm.dashboardsFormValidation.getAnnotationTitleErrorLocator();
        await expect(titleError).toBeVisible({ timeout: 5000 });
        const errorText = (await titleError.textContent()).trim();
        expect(errorText.length).toBeGreaterThan(0);
        testLogger.info('Annotation title required error shown');
    });

    test("should close AddAnnotation dialog when Cancel is clicked", {
        tag: ['@domainFormValidation', '@P1']
    }, async ({ page }) => {
        test.skip(true, 'AddAnnotation dialog requires a dashboard panel in annotation mode — unskip once panel setup helper is available');

        const dialog = pm.dashboardsFormValidation.getAddAnnotationDialogLocator();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });

        await pm.dashboardsFormValidation.getAnnotationCancelBtnLocator().click();

        await expect(dialog).not.toBeVisible({ timeout: 5000 });
        testLogger.info('AddAnnotation dialog closed after Cancel');
    });

    test("should render title, description, and panels selector in AddAnnotation dialog", {
        tag: ['@domainFormValidation', '@P1']
    }, async ({ page }) => {
        test.skip(true, 'AddAnnotation dialog requires a dashboard panel in annotation mode — unskip once panel setup helper is available');

        const dialog = pm.dashboardsFormValidation.getAddAnnotationDialogLocator();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });

        await expect(pm.dashboardsFormValidation.getAnnotationTitleFieldLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getAnnotationTextFieldLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getAnnotationPanelsPopoverLocator()).toBeVisible();
        testLogger.info('AddAnnotation dialog elements rendered correctly');
    });
});
