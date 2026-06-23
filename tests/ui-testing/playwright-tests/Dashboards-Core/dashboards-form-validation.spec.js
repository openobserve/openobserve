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
        await expect(pm.dashboardsFormValidation.getDashboardNameErrorLocator()).toContainText('Name is required');

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
        await expect(pm.dashboardsFormValidation.getDashboardNameErrorLocator()).toContainText('Name is required');

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
        await expect(pm.dashboardsFormValidation.getFolderNameErrorLocator()).toContainText('Name is required');

        testLogger.info('Required error correctly shown for empty folder name');
    });

    test("should clear the required error when a valid folder name is entered", {
        tag: ['@dashboards-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing folder required error clears when name is filled in');

        await pm.dashboardsFormValidation.openAddFolderForm();
        await pm.dashboardsFormValidation.submitFolderForm();
        await expect(pm.dashboardsFormValidation.getFolderNameErrorLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getFolderNameErrorLocator()).toContainText('Name is required');

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
        await expect(pm.dashboardsFormValidation.getTabNameErrorLocator()).toContainText('Name is required');

        testLogger.info('Required error correctly shown for empty tab name');
    });

    test("should clear the required error when a valid tab name is entered", {
        tag: ['@dashboards-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing tab required error clears when name is filled in');

        await pm.dashboardsFormValidation.openAddTabForm();
        await pm.dashboardsFormValidation.submitTabForm();
        await expect(pm.dashboardsFormValidation.getTabNameErrorLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getTabNameErrorLocator()).toContainText('Name is required');

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

    const dashName  = 'e2e_fv_drilldown_001';
    const panelName = 'e2e_fv_drilldown_panel_001';

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.dashboardList.menuItem('dashboards-item');
        await pm.dashboardsFormValidation.getDashboardSearchLocator().waitFor({ state: 'visible', timeout: 20000 });

        const dashLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashLink.isVisible().catch(() => false);
        if (!exists) {
            await pm.dashboardCreate.createDashboard(dashName);
            await pm.dashboardCreate.addPanel();
            await pm.chartTypeSelector.selectChartType('bar');
            await pm.chartTypeSelector.selectStreamType('logs');
            await pm.chartTypeSelector.selectStream('e2e_automate');
            await pm.chartTypeSelector.removeField('y_axis_1', 'y');
            await pm.chartTypeSelector.searchAndAddField('kubernetes_pod_name', 'y');
            await pm.dashboardPanelActions.addPanelName(panelName);
            await pm.dashboardPanelActions.savePanel();
        } else {
            await pm.dashboardsFormValidation.openDashboardByName(dashName);
            await pm.dashboardsFormValidation.waitForTabListContainer(15000);
        }

        // Enter panel edit mode
        await pm.dashboardPanelActions.selectPanelAction(panelName, 'Edit');

        // Open the config panel (right sidebar)
        await pm.dashboardPanelConfigs.openConfigPanel();

        // Wait for drilldown add button and click it to open the DrilldownPopUp
        await pm.dashboardsFormValidation.getDrilldownAddBtnLocator().waitFor({ state: 'visible', timeout: 10000 });
        await pm.dashboardsFormValidation.getDrilldownAddBtnLocator().click();

        // Wait for the DrilldownPopUp dialog to appear
        await pm.dashboardsFormValidation.getDrilldownPopupLocator().waitFor({ state: 'visible', timeout: 10000 });

        testLogger.info('DrilldownPopup opened');
    });

    test("should show name error or keep save disabled when drilldown name is empty", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing drilldown name required error on empty submit');

        // Navigate into panel edit → drilldown section, then verify the name field error
        await expect(pm.dashboardsFormValidation.getDrilldownNameErrorLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getDrilldownNameErrorLocator()).toContainText('A value is required');

        testLogger.info('Drilldown name error correctly shown for empty name');
    });

    test("should show URL format error when URL type is selected and invalid URL is entered", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing drilldown URL format error for invalid URL input');

        // Select URL type, enter invalid URL, then verify error
        await pm.dashboardsFormValidation.clickDrilldownByUrlBtn();
        await expect(pm.dashboardsFormValidation.getDrilldownUrlTextareaLocator()).toBeVisible();

        await pm.dashboardsFormValidation.fillDrilldownUrl('not-a-valid-url');
        await expect(pm.dashboardsFormValidation.getDrilldownUrlErrorLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getDrilldownUrlErrorLocator()).toContainText('Invalid URL');

        testLogger.info('Drilldown URL format error shown correctly for invalid URL');
    });

    test("should verify drilldown type selector buttons are rendered", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
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
        const dashName = 'e2e_fv_variable_settings_001';
        await pm.dashboardList.menuItem('dashboards-item');
        await pm.dashboardsFormValidation.getDashboardSearchLocator().waitFor({ state: 'visible', timeout: 20000 });
        const dashLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashLink.isVisible().catch(() => false);
        if (!exists) {
            await pm.dashboardCreate.createDashboard(dashName);
        } else {
            await pm.dashboardsFormValidation.openDashboardByName(dashName);
            await pm.dashboardsFormValidation.waitForTabListContainer(15000);
        }
        // Navigate to Settings > Variables tab > Add Variable
        await pm.dashboardsFormValidation.getDashboardSettingsBtnLocator().waitFor({ state: 'visible', timeout: 15000 });
        await pm.dashboardsFormValidation.getDashboardSettingsBtnLocator().click();
        await pm.dashboardsFormValidation.getSettingsVariablesTabLocator().waitFor({ state: 'visible', timeout: 10000 });
        await pm.dashboardsFormValidation.getSettingsVariablesTabLocator().click();
        await pm.dashboardsFormValidation.getVariableAddBtnLocator().waitFor({ state: 'visible', timeout: 10000 });
        await pm.dashboardsFormValidation.getVariableAddBtnLocator().click();
        await pm.dashboardsFormValidation.getVariableSaveBtnLocator().waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Variable add form opened');
    });

    test("should show name required error when variable name is empty and save is clicked", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing variable name required error on empty save');
        await pm.dashboardsFormValidation.clickVariableSave();
        await expect(pm.dashboardsFormValidation.getVariableNameErrorLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getVariableNameErrorLocator()).toContainText('Variable name is required.');
        testLogger.info('Variable name required error shown correctly');
    });

    test("should show type required error when variable type is not selected and save is clicked", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing variable type required error on save without selecting type');
        await pm.dashboardsFormValidation.fillVariableName('test_fv_var_001');
        await pm.dashboardsFormValidation.clickVariableSave();
        await expect(pm.dashboardsFormValidation.getVariableTypeErrorLocator()).toBeVisible();
        testLogger.info('Variable type required error shown correctly');
    });

    test("should close variable add form when cancel is clicked", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing variable add form cancel closes the form');
        await pm.dashboardsFormValidation.clickVariableCancel();
        await expect(pm.dashboardsFormValidation.getVariableSaveBtnLocator()).not.toBeVisible();
        testLogger.info('Variable add form closed correctly on cancel');
    });
});

// ── AddCondition form validation ──────────────────────────────────────────────
// Pre-condition: Panel editor open with at least one condition row added.
// These tests verify the condition row elements render and that the remove action works.

test.describe("Dashboard AddCondition form validation", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    const dashName  = 'e2e_fv_condition_001';
    const panelName = 'e2e_fv_condition_panel_001';

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.dashboardList.menuItem('dashboards-item');
        await pm.dashboardsFormValidation.getDashboardSearchLocator().waitFor({ state: 'visible', timeout: 20000 });

        const dashLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashLink.isVisible().catch(() => false);
        if (!exists) {
            await pm.dashboardCreate.createDashboard(dashName);
            await pm.dashboardCreate.addPanel();
            await pm.chartTypeSelector.selectChartType('bar');
            await pm.chartTypeSelector.selectStreamType('logs');
            await pm.chartTypeSelector.selectStream('e2e_automate');
            await pm.chartTypeSelector.removeField('y_axis_1', 'y');
            await pm.chartTypeSelector.searchAndAddField('kubernetes_pod_name', 'y');
            await pm.dashboardPanelActions.addPanelName(panelName);
            await pm.dashboardPanelActions.savePanel();
        } else {
            await pm.dashboardsFormValidation.openDashboardByName(dashName);
            await pm.dashboardsFormValidation.waitForTabListContainer(15000);
        }

        // Enter panel edit mode
        await pm.dashboardPanelActions.selectPanelAction(panelName, 'Edit');

        // Click add condition to create a condition row
        await pm.dashboardsFormValidation.getAddConditionAddBtnLocator().waitFor({ state: 'visible', timeout: 10000 });
        await pm.dashboardsFormValidation.getAddConditionAddBtnLocator().click();

        // Wait for condition row to appear
        await pm.dashboardsFormValidation.getConditionColumn0Locator().waitFor({ state: 'visible', timeout: 5000 });

        testLogger.info('Condition row added in panel editor');
    });

    test("should render condition row with column, operator, and value elements", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Verifying condition row elements are rendered');

        await expect(pm.dashboardsFormValidation.getConditionColumn0Locator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getConditionCondition0Locator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getConditionValueLocator()).toBeVisible();

        testLogger.info('Condition row elements rendered correctly');
    });

    test("should remove condition row when remove button is clicked", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
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
        await pm.dashboardList.menuItem('dashboards-item');
        await pm.dashboardsFormValidation.getDashboardSearchLocator().waitFor({ state: 'visible', timeout: 20000 });
        const dashLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashLink.isVisible().catch(() => false);
        if (!exists) {
            await pm.dashboardCreate.createDashboard(dashName);
        } else {
            await pm.dashboardsFormValidation.openDashboardByName(dashName);
            await pm.dashboardsFormValidation.waitForTabListContainer(15000);
        }
        await pm.dashboardsFormValidation.getDashboardSettingsBtnLocator().waitFor({ state: 'visible', timeout: 15000 });
        testLogger.info('Dashboard opened for GeneralSettings tests');
    });

    test("should show required error when dashboard name is cleared in GeneralSettings", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-GS-001: Empty name → required error in GeneralSettings');

        await pm.dashboardsFormValidation.getDashboardSettingsBtnLocator().click();
        const nameField = pm.dashboardsFormValidation.getGeneralSettingNameFieldLocator();
        await nameField.waitFor({ state: 'visible', timeout: 10000 });

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

        await pm.dashboardsFormValidation.getDashboardSettingsBtnLocator().click();
        const nameField = pm.dashboardsFormValidation.getGeneralSettingNameFieldLocator();
        await nameField.waitFor({ state: 'visible', timeout: 10000 });

        await pm.dashboardsFormValidation.getGeneralSettingCancelBtnLocator().click();
        await expect(nameField).not.toBeVisible({ timeout: 5000 });
        testLogger.info('GeneralSettings panel closed after Cancel');
    });

    test("should save successfully when valid name is entered in GeneralSettings", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-GS-003: Valid name → save succeeds in GeneralSettings');

        await pm.dashboardsFormValidation.getDashboardSettingsBtnLocator().click();
        const nameField = pm.dashboardsFormValidation.getGeneralSettingNameFieldLocator();
        await nameField.waitFor({ state: 'visible', timeout: 10000 });

        await nameField.fill('e2e_fv_general_settings_renamed_001');
        await pm.dashboardsFormValidation.getGeneralSettingSaveBtnLocator().click();
        await expect(nameField).not.toBeVisible({ timeout: 10000 });
        testLogger.info('GeneralSettings saved successfully');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// AddAnnotation dialog form validation (early block)
// Uses a saved panel — enters annotation mode then clicks the panel canvas.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Dashboard AddAnnotation live form validation", () => {
    test.describe.configure({ mode: 'serial' });

    const dashName  = 'e2e_fv_annotation_live_001';
    const panelName = 'e2e_fv_annotation_live_panel_001';
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.dashboardList.menuItem('dashboards-item');
        await pm.dashboardsFormValidation.getDashboardSearchLocator().waitFor({ state: 'visible', timeout: 20000 });

        const dashLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashLink.isVisible().catch(() => false);
        if (!exists) {
            await pm.dashboardCreate.createDashboard(dashName);
            await pm.dashboardCreate.addPanel();
            await pm.chartTypeSelector.selectChartType('bar');
            await pm.chartTypeSelector.selectStreamType('logs');
            await pm.chartTypeSelector.selectStream('e2e_automate');
            await pm.chartTypeSelector.removeField('y_axis_1', 'y');
            await pm.chartTypeSelector.searchAndAddField('kubernetes_pod_name', 'y');
            await pm.dashboardPanelActions.addPanelName(panelName);
            await pm.dashboardPanelActions.savePanel();
        } else {
            await pm.dashboardsFormValidation.openDashboardByName(dashName);
            await pm.dashboardsFormValidation.waitForTabListContainer(15000);
        }

        // Enter annotation mode
        await pm.dashboardsFormValidation.getAnnotationModeButtonLocator().waitFor({ state: 'visible', timeout: 10000 });
        await pm.dashboardsFormValidation.getAnnotationModeButtonLocator().click();

        // Click the panel canvas to open the AddAnnotation dialog
        await pm.dashboardsFormValidation.getPanelCanvasLocator().click({ position: { x: 50, y: 50 }, force: true });

        // Wait for dialog
        await pm.dashboardsFormValidation.getAddAnnotationDialogLocator().waitFor({ state: 'visible', timeout: 10000 });

        testLogger.info('AddAnnotation dialog opened');
    });

    test("should show title required error when annotation is saved with empty title", {
        tag: ['@domainFormValidation', '@P1']
    }, async ({ page }) => {
        // To reach this dialog: open a dashboard → click annotation mode btn on panel → click panel area
        const dialog = pm.dashboardsFormValidation.getAddAnnotationDialogLocator();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });

        // Leave title empty and click Save
        await pm.dashboardsFormValidation.getAnnotationSaveBtnLocator().click();

        const titleError = pm.dashboardsFormValidation.getAnnotationTitleErrorLocator();
        await expect(titleError).toBeVisible({ timeout: 5000 });
        await expect(titleError).toContainText('Title is required.');
        const errorText = (await titleError.textContent()).trim();
        expect(errorText.length).toBeGreaterThan(0);
        testLogger.info('Annotation title required error shown');
    });

    test("should close AddAnnotation dialog when Cancel is clicked", {
        tag: ['@domainFormValidation', '@P1']
    }, async ({ page }) => {
        const dialog = pm.dashboardsFormValidation.getAddAnnotationDialogLocator();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });

        await pm.dashboardsFormValidation.getAnnotationCancelBtnLocator().click();

        await expect(dialog).not.toBeVisible({ timeout: 5000 });
        testLogger.info('AddAnnotation dialog closed after Cancel');
    });

    test("should render title, description, and panels selector in AddAnnotation dialog", {
        tag: ['@domainFormValidation', '@P1']
    }, async ({ page }) => {
        const dialog = pm.dashboardsFormValidation.getAddAnnotationDialogLocator();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });

        await expect(pm.dashboardsFormValidation.getAnnotationTitleFieldLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getAnnotationTextFieldLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getAnnotationPanelsPopoverLocator()).toBeVisible();
        testLogger.info('AddAnnotation dialog elements rendered correctly');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PanelLayoutSettings form validation
// Requires a saved panel — creates dashboard + panel in beforeEach.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Dashboard PanelLayoutSettings form validation", () => {
    test.describe.configure({ mode: 'serial' });

    const dashName  = 'e2e_fv_layout_settings_001';
    const panelName = 'e2e_fv_layout_panel_001';
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Navigate to dashboards list and create (or reuse) the test dashboard
        await pm.dashboardList.menuItem('dashboards-item');
        await pm.dashboardsFormValidation.getDashboardSearchLocator().waitFor({ state: 'visible', timeout: 20000 });

        const dashLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashLink.isVisible().catch(() => false);
        if (!exists) {
            await pm.dashboardCreate.createDashboard(dashName);
            // After create, dashboard is open in view mode — add a panel
            await pm.dashboardCreate.addPanel();
            await pm.chartTypeSelector.selectChartType('bar');
            await pm.chartTypeSelector.selectStreamType('logs');
            await pm.chartTypeSelector.selectStream('e2e_automate');
            await pm.chartTypeSelector.removeField('y_axis_1', 'y');
            await pm.chartTypeSelector.searchAndAddField('kubernetes_pod_name', 'y');
            await pm.dashboardPanelActions.addPanelName(panelName);
            await pm.dashboardPanelActions.savePanel();
        } else {
            await pm.dashboardsFormValidation.openDashboardByName(dashName);
            await pm.dashboardsFormValidation.waitForTabListContainer(15000);
        }

        // Open Layout settings from panel actions dropdown
        await pm.dashboardPanelActions.selectPanelAction(panelName, 'Layout');
        testLogger.info('PanelLayoutSettings drawer opened');
    });

    test("should render PanelLayoutSettings dialog with height input", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-PLS-001: Layout settings dialog renders correctly');

        await expect(pm.dashboardsFormValidation.getPanelLayoutDrawerLocator()).toBeVisible({ timeout: 10000 });
        await expect(pm.dashboardsFormValidation.getPanelLayoutHeightFieldLocator()).toBeVisible();
        testLogger.info('PanelLayoutSettings dialog visible with height input');
    });

    test("should show error or disable save when height is cleared in PanelLayoutSettings", {
        tag: ['@domainFormValidation', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC-PLS-002: Empty height → error or save disabled');

        const heightField = pm.dashboardsFormValidation.getPanelLayoutHeightFieldLocator();
        await heightField.waitFor({ state: 'visible', timeout: 10000 });

        // Clear the height value
        await heightField.fill('');

        const saveBtn    = pm.dashboardsFormValidation.getPanelLayoutSaveBtnLocator();
        const heightError = pm.dashboardsFormValidation.getPanelLayoutHeightErrorLocator();

        // Try to save
        await saveBtn.click();

        const errorVisible = await heightError.isVisible().catch(() => false);
        const btnDisabled  = await saveBtn.isDisabled().catch(() => false);

        expect(errorVisible || btnDisabled).toBe(true);
        testLogger.info('PanelLayoutSettings empty height validation passed');
    });

    test("should close PanelLayoutSettings when Cancel is clicked", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-PLS-003: Cancel closes PanelLayoutSettings dialog');

        const drawer = pm.dashboardsFormValidation.getPanelLayoutDrawerLocator();
        await drawer.waitFor({ state: 'visible', timeout: 10000 });

        await pm.dashboardsFormValidation.getPanelLayoutCancelBtnLocator().click();

        await expect(drawer).not.toBeVisible({ timeout: 5000 });
        testLogger.info('PanelLayoutSettings dialog closed after Cancel');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// AddCondition (panel editor Filters section) form validation
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Dashboard AddCondition form validation", () => {
    test.describe.configure({ mode: 'serial' });

    const dashName = 'e2e_fv_condition_panel_001';
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Navigate to dashboards list and create (or reuse) the test dashboard
        await pm.dashboardList.menuItem('dashboards-item');
        await pm.dashboardsFormValidation.getDashboardSearchLocator().waitFor({ state: 'visible', timeout: 20000 });

        const dashLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashLink.isVisible().catch(() => false);
        if (!exists) {
            await pm.dashboardCreate.createDashboard(dashName);
        } else {
            await pm.dashboardsFormValidation.openDashboardByName(dashName);
            await pm.dashboardsFormValidation.waitForTabListContainer(15000);
        }

        // Open Add Panel → panel editor with Filters section visible
        await pm.dashboardCreate.addPanelSmart();
        await pm.chartTypeSelector.selectChartType('bar');
        await pm.chartTypeSelector.selectStreamType('logs');
        await pm.chartTypeSelector.selectStream('e2e_automate');
        testLogger.info('Panel editor open — Filters section should be visible');
    });

    test("should render Add Condition button in Filters section of panel editor", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-AC-001: Add Condition button is visible in Filters section');

        const addCondBtn = pm.dashboardsFormValidation.getAddConditionAddBtnLocator();
        await expect(addCondBtn).toBeVisible({ timeout: 10000 });
        testLogger.info('Add Condition button rendered correctly');
    });

    test("should add a condition row when Add Condition button is clicked", {
        tag: ['@domainFormValidation', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC-AC-002: Clicking Add Condition renders a condition row');

        const addCondBtn = pm.dashboardsFormValidation.getAddConditionAddBtnLocator();
        await addCondBtn.waitFor({ state: 'visible', timeout: 10000 });
        await addCondBtn.click();

        // After clicking, a condition row with column and condition selectors appears
        const conditionColumn    = pm.dashboardsFormValidation.getConditionColumnLocator();
        const conditionCondition = pm.dashboardsFormValidation.getConditionConditionLocator();

        await expect(conditionColumn).toBeVisible({ timeout: 5000 });
        await expect(conditionCondition).toBeVisible({ timeout: 5000 });
        testLogger.info('Condition row rendered with column and condition selectors');
    });

    test("should remove condition row when remove column button is clicked", {
        tag: ['@domainFormValidation', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC-AC-003: Remove column button removes the condition row');

        const addCondBtn = pm.dashboardsFormValidation.getAddConditionAddBtnLocator();
        await addCondBtn.waitFor({ state: 'visible', timeout: 10000 });
        await addCondBtn.click();

        const conditionColumn = pm.dashboardsFormValidation.getConditionColumnLocator();
        await expect(conditionColumn).toBeVisible({ timeout: 5000 });

        await pm.dashboardsFormValidation.getConditionRemoveColumnLocator().click();

        await expect(conditionColumn).not.toBeVisible({ timeout: 5000 });
        testLogger.info('Condition row removed after clicking remove button');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// AddAnnotation dialog form validation
// Uses a saved panel — enters annotation mode then clicks the panel canvas.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Dashboard AddAnnotation form validation", () => {
    test.describe.configure({ mode: 'serial' });

    const dashName  = 'e2e_fv_annotation_001';
    const panelName = 'e2e_fv_annotation_panel_001';
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Navigate to dashboards list and create (or reuse) the test dashboard
        await pm.dashboardList.menuItem('dashboards-item');
        await pm.dashboardsFormValidation.getDashboardSearchLocator().waitFor({ state: 'visible', timeout: 20000 });

        const dashLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashLink.isVisible().catch(() => false);
        if (!exists) {
            await pm.dashboardCreate.createDashboard(dashName);
            await pm.dashboardCreate.addPanel();
            await pm.chartTypeSelector.selectChartType('bar');
            await pm.chartTypeSelector.selectStreamType('logs');
            await pm.chartTypeSelector.selectStream('e2e_automate');
            await pm.chartTypeSelector.removeField('y_axis_1', 'y');
            await pm.chartTypeSelector.searchAndAddField('kubernetes_pod_name', 'y');
            await pm.dashboardPanelActions.addPanelName(panelName);
            await pm.dashboardPanelActions.savePanel();
        } else {
            await pm.dashboardsFormValidation.openDashboardByName(dashName);
            await pm.dashboardsFormValidation.waitForTabListContainer(15000);
        }

        // Enter annotation mode
        const annotationBtn = pm.dashboardsFormValidation.getAnnotationModeButtonLocator();
        await annotationBtn.waitFor({ state: 'visible', timeout: 15000 });
        await annotationBtn.click();
        testLogger.info('Annotation mode activated');

        // Click the panel canvas to open the AddAnnotation dialog
        const panelCanvas = pm.dashboardsFormValidation.getPanelCanvasLocator();
        const canvasVisible = await panelCanvas.isVisible().catch(() => false);
        if (canvasVisible) {
            const box = await panelCanvas.boundingBox();
            if (box) {
                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            }
        }

        testLogger.info('Clicked panel canvas to open AddAnnotation dialog');
    });

    test("should open AddAnnotation dialog and render required fields", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-ANN-001: AddAnnotation dialog renders title, text, panels fields');

        const dialog = pm.dashboardsFormValidation.getAddAnnotationDialogLocator();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });

        await expect(pm.dashboardsFormValidation.getAnnotationTitleFieldLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getAnnotationTextFieldLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getAnnotationPanelsPopoverLocator()).toBeVisible();
        testLogger.info('AddAnnotation dialog fields rendered correctly');
    });

    test("should show title required error when annotation saved with empty title", {
        tag: ['@domainFormValidation', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC-ANN-002: Empty title → required error in AddAnnotation');

        const dialog = pm.dashboardsFormValidation.getAddAnnotationDialogLocator();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });

        // Leave title empty and click Save
        await pm.dashboardsFormValidation.getAnnotationSaveBtnLocator().click();

        const titleError = pm.dashboardsFormValidation.getAnnotationTitleErrorLocator();
        const saveBtn    = pm.dashboardsFormValidation.getAnnotationSaveBtnLocator();

        const errorVisible = await titleError.isVisible().catch(() => false);
        const btnDisabled  = await saveBtn.isDisabled().catch(() => false);

        expect(errorVisible || btnDisabled).toBe(true);
        testLogger.info('AddAnnotation empty title validation passed');
    });

    test("should close AddAnnotation dialog when Cancel is clicked", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-ANN-003: Cancel closes AddAnnotation dialog');

        const dialog = pm.dashboardsFormValidation.getAddAnnotationDialogLocator();
        await dialog.waitFor({ state: 'visible', timeout: 10000 });

        await pm.dashboardsFormValidation.getAnnotationCancelBtnLocator().click();

        await expect(dialog).not.toBeVisible({ timeout: 5000 });
        testLogger.info('AddAnnotation dialog closed after Cancel');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ConfigPanel (panel editor right sidebar) form validation
// Creates a dashboard + panel in beforeEach, then opens the ConfigPanel.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Dashboard ConfigPanel form validation", () => {
    test.describe.configure({ mode: 'serial' });

    const dashName  = 'e2e_fv_config_panel_001';
    const panelName = 'e2e_fv_cfg_panel_001';
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Navigate to dashboards list
        await pm.dashboardList.menuItem('dashboards-item');
        await pm.dashboardsFormValidation.getDashboardSearchLocator().waitFor({ state: 'visible', timeout: 20000 });

        const dashLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashLink.isVisible().catch(() => false);
        if (!exists) {
            await pm.dashboardCreate.createDashboard(dashName);
            // After create, dashboard is open — add a panel
            await pm.dashboardCreate.addPanel();
            await pm.chartTypeSelector.selectChartType('bar');
            await pm.chartTypeSelector.selectStreamType('logs');
            await pm.chartTypeSelector.selectStream('e2e_automate');
            await pm.chartTypeSelector.removeField('y_axis_1', 'y');
            await pm.chartTypeSelector.searchAndAddField('kubernetes_pod_name', 'y');
            await pm.dashboardPanelActions.addPanelName(panelName);
        } else {
            await pm.dashboardsFormValidation.openDashboardByName(dashName);
            await pm.dashboardsFormValidation.waitForTabListContainer(15000);
            await pm.dashboardCreate.addPanelSmart();
            await pm.chartTypeSelector.selectChartType('bar');
            await pm.chartTypeSelector.selectStreamType('logs');
            await pm.chartTypeSelector.selectStream('e2e_automate');
        }

        // Open ConfigPanel via the panel configs helper
        await pm.dashboardPanelConfigs.openConfigPanel();

        // Wait for the description field to confirm ConfigPanel is visible
        await pm.dashboardsFormValidation.getConfigPanelDescriptionLocator().waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('ConfigPanel opened');
    });

    test("should show error when decimals value exceeds 100", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-CP-001: Decimals value > 100 shows error');

        await pm.dashboardsFormValidation.getConfigPanelDecimalsLocator().waitFor({ state: 'visible', timeout: 10000 });
        const field = pm.dashboardsFormValidation.getConfigPanelDecimalsFieldLocator();
        await field.fill('101');
        await field.blur();
        await expect(pm.dashboardsFormValidation.getConfigPanelDecimalsErrorLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getConfigPanelDecimalsErrorLocator()).toContainText('Decimals must be between 0 and 100');
        testLogger.info('Decimals > 100 error shown correctly');
    });

    test("should show error when decimals value is negative", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-CP-002: Negative decimals value shows error');

        await pm.dashboardsFormValidation.getConfigPanelDecimalsLocator().waitFor({ state: 'visible', timeout: 10000 });
        const field = pm.dashboardsFormValidation.getConfigPanelDecimalsFieldLocator();
        await field.fill('-1');
        await field.blur();
        await expect(pm.dashboardsFormValidation.getConfigPanelDecimalsErrorLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getConfigPanelDecimalsErrorLocator()).toContainText('Decimals must be between 0 and 100');
        testLogger.info('Negative decimals error shown correctly');
    });

    test("should clear decimals error when corrected to valid value", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-CP-003: Decimals error clears on valid value');

        await pm.dashboardsFormValidation.getConfigPanelDecimalsLocator().waitFor({ state: 'visible', timeout: 10000 });
        const field = pm.dashboardsFormValidation.getConfigPanelDecimalsFieldLocator();
        await field.fill('200');
        await field.blur();
        await expect(pm.dashboardsFormValidation.getConfigPanelDecimalsErrorLocator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getConfigPanelDecimalsErrorLocator()).toContainText('Decimals must be between 0 and 100');
        await field.fill('2');
        await field.blur();
        await expect(pm.dashboardsFormValidation.getConfigPanelDecimalsErrorLocator()).not.toBeVisible();
        testLogger.info('Decimals error clears on valid value');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// AddPanel — panel name form validation
// Creates a dashboard in beforeEach (idempotent) then opens the panel editor.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Dashboard AddPanel panel name form validation", () => {
    test.describe.configure({ mode: 'serial' });

    const dashName = 'e2e_fv_add_panel_001';
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        await pm.dashboardList.menuItem('dashboards-item');
        await pm.dashboardsFormValidation.getDashboardSearchLocator().waitFor({ state: 'visible', timeout: 20000 });

        const dashLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashLink.isVisible().catch(() => false);
        if (!exists) {
            await pm.dashboardCreate.createDashboard(dashName);
            await pm.dashboardCreate.addPanel();
        } else {
            await pm.dashboardsFormValidation.openDashboardByName(dashName);
            await pm.dashboardsFormValidation.waitForTabListContainer(15000);
            await pm.dashboardCreate.addPanelSmart();
        }

        // Confirm we are in the panel editor (apply button is the reliable anchor)
        await pm.dashboardsFormValidation.getPanelNameFieldLocator().waitFor({ state: 'visible', timeout: 15000 });
        testLogger.info('Panel editor opened');
    });

    test("should show error or disable save when panel name is empty", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-AP-001: Panel name required error on empty save');

        // Clear any pre-filled name
        await pm.dashboardsFormValidation.clearPanelName();

        // Attempt to save
        await pm.dashboardsFormValidation.getPanelSaveBtnLocator().click();

        const nameError  = pm.dashboardsFormValidation.getPanelNameErrorLocator();
        const saveBtn    = pm.dashboardsFormValidation.getPanelSaveBtnLocator();

        const errorVisible = await nameError.isVisible().catch(() => false);
        const btnDisabled  = await saveBtn.isDisabled().catch(() => false);

        expect(errorVisible || btnDisabled).toBe(true);
        if (errorVisible) {
            await expect(nameError).toContainText(/required/i);
        }
        testLogger.info('Panel name required error or disabled save confirmed');
    });

    test("should enable save when a valid panel name is entered", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-AP-002: Save button enabled with valid panel name');

        await pm.dashboardsFormValidation.fillPanelName('e2e_fv_panel_valid_001');

        const saveBtn = pm.dashboardsFormValidation.getPanelSaveBtnLocator();
        await expect(saveBtn).toBeEnabled({ timeout: 5000 });
        testLogger.info('Save button enabled for valid panel name');
    });

    test("should discard changes and navigate back when Discard is clicked", {
        tag: ['@domainFormValidation', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC-AP-003: Discard button navigates away from panel editor');

        await pm.dashboardsFormValidation.getPanelDiscardBtnLocator().waitFor({ state: 'visible', timeout: 5000 });
        await pm.dashboardsFormValidation.getPanelDiscardBtnLocator().click();

        // After discard we should leave the /add_panel URL
        await page.waitForURL(url => !url.pathname.includes('add_panel'), { timeout: 10000 });
        testLogger.info('Navigated away from panel editor after Discard');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BuildFieldPopUp form validation
// Opens when a user clicks a y-axis field chip (data-test="dashboard-y-item-y_axis_1")
// in the panel editor. Requires e2e_automate stream with kubernetes_pod_name field.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Dashboard BuildFieldPopUp form validation", () => {
    test.describe.configure({ mode: 'serial' });

    const dashName = 'e2e_fv_build_field_001';
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        await pm.dashboardList.menuItem('dashboards-item');
        await pm.dashboardsFormValidation.getDashboardSearchLocator().waitFor({ state: 'visible', timeout: 20000 });

        const dashLink = pm.dashboardsFormValidation.getDashboardByNameLocator(dashName);
        const exists = await dashLink.isVisible().catch(() => false);
        if (!exists) {
            await pm.dashboardCreate.createDashboard(dashName);
        } else {
            await pm.dashboardsFormValidation.openDashboardByName(dashName);
            await pm.dashboardsFormValidation.waitForTabListContainer(15000);
        }

        // Open panel editor and add a y-axis field so the chip is rendered
        await pm.dashboardCreate.addPanelSmart();
        await pm.chartTypeSelector.selectChartType('bar');
        await pm.chartTypeSelector.selectStreamType('logs');
        await pm.chartTypeSelector.selectStream('e2e_automate');
        await pm.chartTypeSelector.searchAndAddField('kubernetes_pod_name', 'y');

        // Confirm the y-axis chip is rendered before each test
        await pm.dashboardsFormValidation.getYAxisFieldChipFirstLocator()
            .waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Panel editor open with y-axis field chip rendered');
    });

    test("should open BuildFieldPopUp container when a y-axis field chip is clicked", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-BF-001: BuildFieldPopUp container opens on y-axis chip click');

        // Click the chip — alias "y_axis_1" is assigned to the first added y-axis field
        await pm.dashboardsFormValidation.getYAxisFieldChipFirstLocator().click();

        await pm.dashboardsFormValidation.getBuildFieldPopupContainerLocator()
            .waitFor({ state: 'visible', timeout: 10000 });
        await expect(pm.dashboardsFormValidation.getBuildFieldPopupContainerLocator()).toBeVisible();
        testLogger.info('BuildFieldPopUp container visible after chip click');
    });

    test("should render label input inside BuildFieldPopUp", {
        tag: ['@domainFormValidation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC-BF-002: BuildFieldPopUp label input is present');

        await pm.dashboardsFormValidation.getYAxisFieldChipFirstLocator().click();

        await pm.dashboardsFormValidation.getBuildFieldPopupContainerLocator()
            .waitFor({ state: 'visible', timeout: 10000 });
        await expect(pm.dashboardsFormValidation.getBuildFieldLabelInputLocator()).toBeVisible();
        testLogger.info('BuildFieldPopUp label input rendered correctly');
    });
});
