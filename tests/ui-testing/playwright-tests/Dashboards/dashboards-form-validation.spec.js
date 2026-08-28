// Copyright 2026 OpenObserve Inc.
// Dashboards domain — form validation E2E tests.
//
// Covers AddDashboard / AddFolder / AddTab plus the panel-editor forms
// (Drilldown, Variables, Conditions, Annotations, Layout, ConfigPanel,
// AddPanel name, BuildFieldPopUp).
//
// Fixtures: every test creates its own dashboard under a unique name and
// deletes it in afterEach. Fixed names with an "already exists?" probe were
// unreliable — the list is paginated so existing fixtures read as missing, and
// duplicate names are not rejected, so each run leaked another copy.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { setupTestDashboard, deleteDashboard } = require('./utils/dashCreation.js');
const { ingestion } = require('./utils/dashIngestion.js');

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** Unique name per run, so no two runs (or workers) can collide. */
const uniqueName = (prefix) =>
    `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;

/**
 * Create a dashboard owned by the current test, leaving the browser on its view
 * page. Uses setupTestDashboard() for its re-open-on-wedged-load recovery.
 */
async function createOwnedDashboard(page, pm, prefix) {
    // Ingest first: the annotation button is gated on the panel being a time
    // series, which needs actual rows (an empty chart never qualifies).
    await ingestion(page);
    const dashName = uniqueName(prefix);
    await setupTestDashboard(page, pm, dashName);
    return dashName;
}

/**
 * Add and save a simple bar panel to the currently open dashboard.
 * Ends on the dashboard view with the panel rendered.
 */
async function addBarPanel(pm, panelName) {
    await pm.dashboardCreate.addPanel();
    await pm.chartTypeSelector.selectChartType('bar');
    await pm.chartTypeSelector.selectStreamType('logs');
    await pm.chartTypeSelector.selectStream('e2e_automate');
    await pm.chartTypeSelector.removeField('y_axis_1', 'y');
    await pm.chartTypeSelector.searchAndAddField('kubernetes_pod_name', 'y');
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.dashboardPanelActions.savePanel();
}

/**
 * Delete the dashboard this test created. Failures are logged, not thrown, so
 * cleanup can never turn a passing test red.
 */
async function cleanupOwnedDashboard(page, pm, dashName) {
    const candidates = (Array.isArray(dashName) ? dashName : [dashName]).filter(Boolean);
    if (!candidates.length) return;

    // Go to the list by URL, not by clicking Back: a test can end with a modal
    // open that swallows back clicks. Accept the unsaved-changes confirm, since
    // Playwright auto-dismisses dialogs and that would cancel the navigation.
    page.once('dialog', (d) => d.accept());
    await page.keyboard.press('Escape').catch(() => {});

    const org = (process.env.ORGNAME || '').trim();
    await page
        .goto(`${process.env.ZO_BASE_URL}/web/dashboards?org_identifier=${org}`)
        .catch(() => {});
    await page
        .locator('[data-test="dashboard-search"]')
        .waitFor({ state: 'visible', timeout: 20000 })
        .catch(() => {});

    for (const name of candidates) {
        try {
            await deleteDashboard(page, name);
            return;
        } catch (e) {
            testLogger.warn('Cleanup attempt failed for test dashboard', {
                dashName: name,
                error: e.message,
            });
        }
    }
}

// ── AddDashboard form validation ──────────────────────────────────────────────

test.describe("Dashboard AddDashboard form validation", () => {
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
        // Unique per run: the old fixed 'e2e_dash_fv_001' was never deleted and
        // nothing rejects a duplicate name, so every run added another copy.
        const dashName = uniqueName('e2e_dash_fv');
        testLogger.info(`Creating dashboard: ${dashName}`);

        await pm.dashboardsFormValidation.openAddDashboardForm();
        await pm.dashboardsFormValidation.fillDashboardName(dashName);
        await expect(pm.dashboardsFormValidation.getDashboardNameErrorLocator()).not.toBeVisible();

        await pm.dashboardsFormValidation.submitDashboardForm();

        // Dialog should close after successful creation
        await expect(pm.dashboardsFormValidation.getDashboardDialogLocator()).not.toBeVisible();

        testLogger.info(`Dashboard ${dashName} created successfully`);

        // Creating navigates into the new dashboard's view — go back to the list
        // before deleting it.
        await cleanupOwnedDashboard(page, pm, dashName);
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
        // Unique per run — see the AddDashboard equivalent. Folder names are not
        // unique either: the folders table indexes (org, folder_id), not name.
        const folderName = uniqueName('e2e_fold_fv');
        testLogger.info(`Creating folder: ${folderName}`);

        await pm.dashboardsFormValidation.openAddFolderForm();
        await pm.dashboardsFormValidation.fillFolderName(folderName);
        await expect(pm.dashboardsFormValidation.getFolderNameErrorLocator()).not.toBeVisible();

        await pm.dashboardsFormValidation.submitFolderForm();

        // Dialog should close after successful creation
        await expect(pm.dashboardsFormValidation.getFolderDialogLocator()).not.toBeVisible();

        testLogger.info(`Folder ${folderName} created successfully`);

        await pm.dashboardFolder.deleteFolder(folderName).catch((e) => {
            testLogger.warn('Cleanup failed for test folder', { folderName, error: e.message });
        });
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
    let pm;
    let dashName;

    // Each test builds its own dashboard and lands on its view page.
    // (The old version called openDashboardByName() even on the create path,
    // which hunts for a list row that creation has already navigated away from.)
    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        dashName = await createOwnedDashboard(page, pm, 'e2e_dash_fv_tab');
        // Wait for the tab bar to be present (TabList renders the add-tab button)
        await pm.dashboardsFormValidation.waitForTabListContainer(15000);
        testLogger.info(`Opened dashboard ${dashName}`);
    });

    test.afterEach(async ({ page }) => {
        await cleanupOwnedDashboard(page, pm, dashName);
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
        const tabName = uniqueName('e2e_tab_fv');
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
    let pm;

    const panelName = 'e2e_fv_drilldown_panel';
    let dashName;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        dashName = await createOwnedDashboard(page, pm, 'e2e_fv_drilldown');
        await addBarPanel(pm, panelName);

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

    test.afterEach(async ({ page }) => {
        await cleanupOwnedDashboard(page, pm, dashName);
    });

    test("should show name error or keep save disabled when drilldown name is empty", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing drilldown name required error on empty submit');

        // The name field is an OFormInput inside OForm, so its `-error` node is
        // only rendered once validation has actually run. Asserting on it against
        // a freshly-opened popup — as this did — waits for an element the form
        // has had no reason to create. Attempt the submit first, then accept
        // either outcome the test name allows.
        const nameError = pm.dashboardsFormValidation.getDrilldownNameErrorLocator();
        const saveBtn = pm.dashboardsFormValidation.getDrilldownSaveBtnLocator();

        await saveBtn.click().catch(() => {});

        // Wait for the error rather than sampling immediately: isVisible() does
        // not retry, and the message is rendered a tick after the submit.
        const errorVisible = await nameError
            .waitFor({ state: 'visible', timeout: 10000 })
            .then(() => true)
            .catch(() => false);
        const btnDisabled = await saveBtn.isDisabled().catch(() => false);
        expect(errorVisible || btnDisabled).toBe(true);
        if (errorVisible) {
            // The form renders "Name is required" — not the "A value is required"
            // this test used to assert (verified against alpha).
            await expect(nameError).toContainText('Name is required');
        }

        testLogger.info('Drilldown empty-name validation passed', { errorVisible, btnDisabled });
    });

    test("should show URL format error when URL type is selected and invalid URL is entered", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing drilldown URL format error for invalid URL input');

        // Select URL type, enter invalid URL, then verify error
        await pm.dashboardsFormValidation.clickDrilldownByUrlBtn();
        await expect(pm.dashboardsFormValidation.getDrilldownUrlTextareaLocator()).toBeVisible();

        await pm.dashboardsFormValidation.fillDrilldownUrl('not-a-valid-url');

        // The URL check is a Zod superRefine on the FORM (DrilldownPopUp.schema.ts),
        // not a per-keystroke field rule, so it only runs on submit. Asserting
        // straight after typing — as this did — waits for an error the form has
        // not been asked to compute yet.
        await pm.dashboardsFormValidation.getDrilldownSaveBtnLocator().click().catch(() => {});

        await expect(pm.dashboardsFormValidation.getDrilldownUrlErrorLocator()).toBeVisible({ timeout: 10000 });
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
    let pm;
    let dashName;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        dashName = await createOwnedDashboard(page, pm, 'e2e_fv_variable_settings');
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

    test.afterEach(async ({ page }) => {
        await cleanupOwnedDashboard(page, pm, dashName);
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

    test("should treat variable type as optional (defaults) when only a name is given", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        // This previously asserted a "type is required" error, which the form can
        // never produce: AddSettingVariable.schema.ts declares
        //   type: z.string().optional().default("query_values")
        // so type is optional AND pre-filled. The assertion was waiting on a
        // validation error the schema makes impossible.
        //
        // Assert the real contract instead: with a name supplied, type does not
        // block submission and no type error is raised.
        testLogger.info('Testing variable type is optional with a schema default');
        await pm.dashboardsFormValidation.fillVariableName(uniqueName('test_fv_var'));
        await pm.dashboardsFormValidation.clickVariableSave();
        await expect(
            pm.dashboardsFormValidation.getVariableTypeErrorLocator()
        ).not.toBeVisible({ timeout: 5000 });
        testLogger.info('Variable type correctly optional — no type error raised');
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
    let pm;

    const panelName = 'e2e_fv_condition_panel';
    let dashName;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        dashName = await createOwnedDashboard(page, pm, 'e2e_fv_condition');
        await addBarPanel(pm, panelName);

        // Enter panel edit mode
        await pm.dashboardPanelActions.selectPanelAction(panelName, 'Edit');

        // Add a condition row. The "+" is an ODropdown trigger, so this picks
        // "Add Condition" from the menu it opens and waits for the row.
        await pm.dashboardsFormValidation.addConditionRow();

        testLogger.info('Condition row added in panel editor');
    });

    test.afterEach(async ({ page }) => {
        await cleanupOwnedDashboard(page, pm, dashName);
    });

    test("should render condition row with column, operator, and value elements", {
        tag: ['@domainFormValidation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Verifying condition row elements are rendered');

        await expect(pm.dashboardsFormValidation.getConditionColumn0Locator()).toBeVisible();
        await expect(pm.dashboardsFormValidation.getConditionCondition0Locator()).toBeVisible();

        // The value control lives in the Condition tab panel; the popup opens on
        // the List tab, where it is not rendered at all. Switch tabs first.
        await pm.dashboardsFormValidation.openConditionTab(0);
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

    let pm;
    let dashName;
    // A test here may rename the dashboard, so cleanup can have more than one
    // name to try. Reset per test; the rename test appends its new name.
    let cleanupCandidates;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        dashName = await createOwnedDashboard(page, pm, 'e2e_fv_general_settings');
        cleanupCandidates = [dashName];
        await pm.dashboardsFormValidation.getDashboardSettingsBtnLocator().waitFor({ state: 'visible', timeout: 15000 });
        testLogger.info('Dashboard opened for GeneralSettings tests');
    });

    test.afterEach(async ({ page }) => {
        await cleanupOwnedDashboard(page, pm, cleanupCandidates);
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

        // Cleanup deletes BY NAME, so register the new name before saving and
        // keep the old one as a fallback — a slow-closing panel must not leave
        // cleanup hunting a name the dashboard no longer has.
        const renamed = uniqueName('e2e_fv_general_settings_renamed');
        cleanupCandidates = [renamed, dashName];
        await nameField.fill(renamed);
        await pm.dashboardsFormValidation.getGeneralSettingSaveBtnLocator().click();

        // Saving does NOT close the panel — GeneralSettings emits "save", which
        // DashboardSettings wires to refreshRequired, not close. The success
        // toast is what marks the save.
        await expect(
            pm.dashboardsFormValidation.getSuccessToastLocator()
        ).toBeVisible({ timeout: 15000 });
        testLogger.info('GeneralSettings saved successfully');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// AddAnnotation dialog form validation (early block)
// Uses a saved panel — enters annotation mode then clicks the panel canvas.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Dashboard AddAnnotation live form validation", () => {

    const panelName = 'e2e_fv_annotation_live_panel';
    let pm;
    let dashName;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        dashName = await createOwnedDashboard(page, pm, 'e2e_fv_annotation_live');
        await addBarPanel(pm, panelName);

        // Enter annotation mode (hovers the panel first — the button is
        // hover-revealed, so waiting for it directly could only time out).
        await pm.dashboardsFormValidation.enterAnnotationMode();

        // Brush across the chart to open the AddAnnotation dialog (a click cannot
        // do it — creation is routed through ECharts' dataZoom event).
        await pm.dashboardsFormValidation.openAnnotationDialogByBrush();

        testLogger.info('AddAnnotation dialog opened');
    });

    test.afterEach(async ({ page }) => {
        await cleanupOwnedDashboard(page, pm, dashName);
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

    const panelName = 'e2e_fv_layout_panel';
    let pm;
    let dashName;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        dashName = await createOwnedDashboard(page, pm, 'e2e_fv_layout_settings');
        await addBarPanel(pm, panelName);

        // Open Layout settings from panel actions dropdown
        await pm.dashboardPanelActions.selectPanelAction(panelName, 'Layout');
        testLogger.info('PanelLayoutSettings drawer opened');
    });

    test.afterEach(async ({ page }) => {
        await cleanupOwnedDashboard(page, pm, dashName);
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

    let pm;
    let dashName;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        dashName = await createOwnedDashboard(page, pm, 'e2e_fv_condition_filters');

        // Open Add Panel → panel editor with Filters section visible.
        // The dashboard is new and empty, so this is the empty-state button.
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType('bar');
        await pm.chartTypeSelector.selectStreamType('logs');
        await pm.chartTypeSelector.selectStream('e2e_automate');
        testLogger.info('Panel editor open — Filters section should be visible');
    });

    // These tests end inside the panel editor, so cleanup starts from add_panel.
    // backToDashboardList() handles that (two back hops, and it accepts the
    // unsaved-changes confirm that would otherwise cancel the navigation).
    test.afterEach(async ({ page }) => {
        await cleanupOwnedDashboard(page, pm, dashName);
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

        await pm.dashboardsFormValidation.addConditionRow();

        // After adding, a condition row with column and condition selectors appears
        const conditionColumn    = pm.dashboardsFormValidation.getConditionColumnLocator();
        const conditionCondition = pm.dashboardsFormValidation.getConditionConditionLocator();

        await expect(conditionColumn).toBeVisible({ timeout: 5000 });
        await expect(conditionCondition).toBeVisible({ timeout: 5000 });
        testLogger.info('Condition row rendered with column and condition selectors');
    });

    test("should clear the selected column but keep the row when remove-column is clicked", {
        tag: ['@domainFormValidation', '@P1']
    }, async ({ page }) => {
        // This used to assert the ROW disappeared. It does not: the handler is
        //   const removeColumnName = () => { conditionModel.value.column = {}; };
        // which clears the chosen COLUMN and leaves the row in place. Deleting the
        // row is `dashboard-add-condition-remove`, covered by the sibling test.
        testLogger.info('TC-AC-003: Remove-column clears the column, row survives');

        await pm.dashboardsFormValidation.addConditionRow();

        const conditionColumn = pm.dashboardsFormValidation.getConditionColumnLocator();
        await expect(conditionColumn).toBeVisible({ timeout: 5000 });

        await pm.dashboardsFormValidation.getConditionRemoveColumnLocator().click();

        // Row still present, and its label chip carries no column name (the
        // data-test is `dashboard-add-condition-label-<i>-<computedLabel>`, so an
        // empty selection leaves the trailing segment blank).
        await expect(conditionColumn).toBeVisible({ timeout: 5000 });
        // Match the label chip by PREFIX. Its data-test embeds computedLabel(),
        // which falls back to `condition.column.field` — and that is `undefined`
        // for a cleared column, so the attribute ends up "…-label-0-undefined",
        // never a bare "…-label-0-".
        await expect(
            page.locator('[data-test^="dashboard-add-condition-label-0-"]').first()
        ).toBeVisible({ timeout: 5000 });
        testLogger.info('Column cleared, condition row retained');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// AddAnnotation dialog form validation
// Uses a saved panel — enters annotation mode then clicks the panel canvas.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Dashboard AddAnnotation form validation", () => {

    const panelName = 'e2e_fv_annotation_panel';
    let pm;
    let dashName;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        dashName = await createOwnedDashboard(page, pm, 'e2e_fv_annotation');
        await addBarPanel(pm, panelName);

        // Enter annotation mode (hovers the panel first — see enterAnnotationMode).
        await pm.dashboardsFormValidation.enterAnnotationMode();
        testLogger.info('Annotation mode activated');

        // Brush across the chart to open the AddAnnotation dialog — see
        // openAnnotationDialogByBrush for why a click cannot work.
        await pm.dashboardsFormValidation.openAnnotationDialogByBrush();

        testLogger.info('Brushed chart to open AddAnnotation dialog');
    });

    test.afterEach(async ({ page }) => {
        await cleanupOwnedDashboard(page, pm, dashName);
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

    const panelName = 'e2e_fv_cfg_panel';
    let pm;
    let dashName;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        dashName = await createOwnedDashboard(page, pm, 'e2e_fv_config_panel');

        // Stay in the panel editor — ConfigPanel is the editor's right sidebar.
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType('bar');
        await pm.chartTypeSelector.selectStreamType('logs');
        await pm.chartTypeSelector.selectStream('e2e_automate');
        await pm.chartTypeSelector.removeField('y_axis_1', 'y');
        await pm.chartTypeSelector.searchAndAddField('kubernetes_pod_name', 'y');
        await pm.dashboardPanelActions.addPanelName(panelName);

        // Open ConfigPanel via the panel configs helper
        await pm.dashboardPanelConfigs.openConfigPanel();

        // Wait for the description field to confirm ConfigPanel is visible
        await pm.dashboardsFormValidation.getConfigPanelDescriptionLocator().waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('ConfigPanel opened');
    });

    test.afterEach(async ({ page }) => {
        await cleanupOwnedDashboard(page, pm, dashName);
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

    let pm;
    let dashName;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        dashName = await createOwnedDashboard(page, pm, 'e2e_fv_add_panel');
        await pm.dashboardCreate.addPanel();

        // Confirm we are in the panel editor. The name is an inline-edited title:
        // its display trigger is always visible, whereas the `-input` only mounts
        // once the trigger is clicked — so the trigger is the correct anchor.
        await pm.dashboardsFormValidation.getPanelNameTriggerLocator().waitFor({ state: 'visible', timeout: 15000 });
        testLogger.info('Panel editor opened');
    });

    test.afterEach(async ({ page }) => {
        await cleanupOwnedDashboard(page, pm, dashName);
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

        // Leaving the panel editor with unsaved edits fires AddPanel.vue's
        // onBeforeRouteLeave window.confirm. Playwright auto-DISMISSES dialogs,
        // and a dismissed confirm means next(false) — the route change is
        // cancelled, so the click appears to do nothing and the URL wait below
        // burns its full timeout. Accept it for the duration of the discard.
        page.once('dialog', (dialog) => dialog.accept());

        await pm.dashboardsFormValidation.getPanelDiscardBtnLocator().waitFor({ state: 'visible', timeout: 5000 });
        await pm.dashboardsFormValidation.getPanelDiscardBtnLocator().click();

        // After discard we should leave the /add_panel URL
        await page.waitForURL(url => !url.pathname.includes('add_panel'), { timeout: 15000 });
        testLogger.info('Navigated away from panel editor after Discard');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BuildFieldPopUp form validation
// Opens when a user clicks a y-axis field chip (data-test="dashboard-y-item-y_axis_1")
// in the panel editor. Requires e2e_automate stream with kubernetes_pod_name field.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Dashboard BuildFieldPopUp form validation", () => {

    let pm;
    let dashName;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        dashName = await createOwnedDashboard(page, pm, 'e2e_fv_build_field');

        // Open panel editor and add a y-axis field so the chip is rendered
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType('bar');
        await pm.chartTypeSelector.selectStreamType('logs');
        await pm.chartTypeSelector.selectStream('e2e_automate');
        await pm.chartTypeSelector.searchAndAddField('kubernetes_pod_name', 'y');

        // Confirm the y-axis chip is rendered before each test
        await pm.dashboardsFormValidation.getYAxisFieldChipFirstLocator()
            .waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Panel editor open with y-axis field chip rendered');
    });

    test.afterEach(async ({ page }) => {
        await cleanupOwnedDashboard(page, pm, dashName);
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
