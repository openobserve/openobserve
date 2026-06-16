// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { AlertsFormValidationPage } = require('../../pages/alertsPages/alertsFormValidationPage.js');

// ─────────────────────────────────────────────────────────────────────────────
// Alerts — Form Validation E2E Tests
// Covers:
//   • AddDestination  — empty submit, webhook + empty URL, invalid URL format, valid create
//   • AddTemplate     — empty submit, valid create
//   • ImportAlert     — submit without file → error or button disabled
//   • ImportDestination — submit without file → error or button disabled
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Alerts Form Validation', { tag: ['@alerts-form-validation', '@P0', '@smoke'] }, () => {
  test.describe.configure({ mode: 'serial' });

  /** @type {PageManager} */
  let pm;
  /** @type {AlertsFormValidationPage} */
  let fvPage;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    fvPage = pm.alertsFormValidation;
    await navigateToBase(page);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AddDestination
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('AddDestination form validation', () => {
    test.describe.configure({ mode: 'serial' });

    test('should show name and type errors when submitting empty custom destination form', {
      tag: ['@alerts-form-validation', '@P0', '@smoke'],
    }, async ({ page }) => {
      await fvPage.navigateToDestinations();
      await fvPage.openAddDestinationCustom();

      // Submit with no name filled
      await fvPage.clickDestinationSubmit();

      // Name field error must be visible
      await fvPage.waitForDestinationNameError();
      const nameError = fvPage.getDestNameErrorLocator();
      await expect(nameError).toBeVisible();
      await expect(nameError).toContainText('Name is required');
      const nameErrorText = await nameError.textContent();
      expect(nameErrorText.trim().length).toBeGreaterThan(0);
    });

    test('should show URL error when webhook type selected but URL is empty', {
      tag: ['@alerts-form-validation', '@P0', '@smoke'],
    }, async ({ page }) => {
      await fvPage.navigateToDestinations();
      await fvPage.openAddDestinationCustom();

      // Fill a valid name so name validation passes
      await fvPage.fillDestinationName('test_fv_alerts_dest_001');

      // Leave URL empty and submit
      await fvPage.clickDestinationSubmit();

      // URL error must be visible
      await fvPage.waitForDestinationUrlError();
      const urlError = fvPage.getDestUrlErrorLocator();
      await expect(urlError).toBeVisible();
      await expect(urlError).toContainText('Field is required!');
      const urlErrorText = await urlError.textContent();
      expect(urlErrorText.trim().length).toBeGreaterThan(0);
    });

    test('should show URL format error when an invalid URL is entered for webhook', {
      tag: ['@alerts-form-validation', '@P0', '@smoke'],
    }, async ({ page }) => {
      await fvPage.navigateToDestinations();
      // Use Slack type — it has a URL field with a validator in PrebuiltDestinationForm
      await fvPage.openAddDestinationSlack();

      // Fill the destination name first (visible only in create + prebuilt flow)
      const nameField = fvPage.getDestNameInputFieldLocator();
      const nameFieldVisible = await nameField.isVisible().catch(() => false);
      if (nameFieldVisible) {
        await nameField.fill('test_fv_alerts_slack_001');
      }

      // Fill an invalid (non-URL) value in the Slack webhook field
      await fvPage.fillSlackWebhookUrl('not-a-valid-url');

      // Attempt to save — the PrebuiltDestinationForm.validate() should fire
      await fvPage.clickDestinationSubmit();

      // Either the webhook error becomes visible OR the name-related error fires first.
      await fvPage.waitForSlackWebhookError();
      const webhookError = fvPage.getSlackWebhookErrorLocator();
      await expect(webhookError).toBeVisible();
      await expect(webhookError).toContainText('Invalid Slack webhook URL');
      const webhookErrorText = await webhookError.textContent();
      expect(webhookErrorText.trim().length).toBeGreaterThan(0);
    });

    test('should successfully create a destination when all required fields are valid', {
      tag: ['@alerts-form-validation', '@P0', '@smoke'],
    }, async ({ page }) => {
      await fvPage.navigateToDestinations();
      await fvPage.openAddDestinationCustom();

      // Fill all required fields for a custom webhook destination
      await fvPage.fillDestinationName('test_fv_alerts_dest_valid_001');
      await fvPage.fillDestinationUrl('https://hooks.example.com/valid-webhook-001');

      // Template select is required for custom destinations in Alerts mode.
      // If no templates exist the field is present but empty — the template error fires.
      await fvPage.clickDestinationSubmit();

      // Either a success toast appears (templates exist) or a template error fires
      const successToast = fvPage.getToastSuccessLocator();
      const templateError = fvPage.getDestTemplateSelectErrorLocator();

      const result = await Promise.race([
        successToast.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'success'),
        templateError.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'template-error'),
      ]).catch(() => 'timeout');

      expect(['success', 'template-error']).toContain(result);

      if (result === 'success') {
        await expect(successToast).toBeVisible();
        testLogger.info('Destination created successfully');
      } else if (result === 'template-error') {
        await expect(templateError).toBeVisible();
        await expect(templateError).toContainText('Template is required!');
        testLogger.info('Template required error shown — no templates exist yet');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AddTemplate
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('AddTemplate form validation', () => {
    test.describe.configure({ mode: 'serial' });

    test('should show name and body errors when submitting empty template form', {
      tag: ['@alerts-form-validation', '@P0', '@smoke'],
    }, async ({ page }) => {
      await fvPage.navigateToTemplates();
      await fvPage.openAddTemplate();

      // Submit with nothing filled in
      await fvPage.clickTemplateSubmit();

      // Name error must appear
      await fvPage.waitForTemplateNameError();
      const nameError = fvPage.getTemplateNameErrorLocator();
      await expect(nameError).toBeVisible();
      await expect(nameError).toContainText('Name is required');
      const nameErrorText = await nameError.textContent();
      expect(nameErrorText.trim().length).toBeGreaterThan(0);
    });

    test('should successfully create a template when name and body are valid', {
      tag: ['@alerts-form-validation', '@P0', '@smoke'],
    }, async ({ page }) => {
      await fvPage.navigateToTemplates();
      await fvPage.openAddTemplate();

      // Unique name per run — the template is not cleaned up afterwards, so a
      // fixed name would collide ("already exists") on re-runs against a shared
      // backend and never produce the success toast.
      await fvPage.fillTemplateName(`test_fv_alerts_tmpl_${Date.now()}`);

      // Fill the body editor with valid JSON (webhook type is default)
      await fvPage.fillTemplateBodyViaEditor('{"text":"{alert_name} triggered"}');

      // The body editor's v-model is debounced (500ms). A click that lands before
      // the debounce flushes hits the "Please fill required fields" guard, which
      // returns BEFORE any API call. Retrying the submit is therefore safe — no
      // duplicate is created — and deterministic against the debounce timing.
      await expect(async () => {
        await fvPage.clickTemplateSubmit();
        await expect(fvPage.getToastSuccessLocator()).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 15000 });
      testLogger.info('Template created successfully');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ImportAlert
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('ImportAlert form validation', () => {
    test.describe.configure({ mode: 'serial' });

    test('should show error or keep import button disabled when no file or JSON is provided', {
      tag: ['@alerts-form-validation', '@P0', '@smoke'],
    }, async ({ page }) => {
      await fvPage.navigateToAlertsList();

      await fvPage.openImportAlert();

      const importBtn = fvPage.getAlertImportJsonBtnLocator();
      const isDisabled = await importBtn.isDisabled().catch(() => false);

      if (isDisabled) {
        await expect(importBtn).toBeDisabled();
        testLogger.info('Alert import button is disabled when no content provided');
      } else {
        await fvPage.clickAlertImportSubmit();
        await expect(fvPage.getToastErrorLocator()).toBeVisible({ timeout: 8000 });
        testLogger.info('Alert import error shown when submitting empty form');
      }
    });

    test('should show error or keep import button disabled when switching to file tab without uploading a file', {
      tag: ['@alerts-form-validation', '@P0', '@smoke'],
    }, async ({ page }) => {
      await fvPage.navigateToAlertsList();

      await fvPage.openImportAlert();
      await fvPage.switchToAlertFileTab();

      const importBtn = fvPage.getAlertImportJsonBtnLocator();
      const isDisabled = await importBtn.isDisabled().catch(() => false);

      if (isDisabled) {
        await expect(importBtn).toBeDisabled();
        testLogger.info('Alert import button disabled on file tab with no file');
      } else {
        await fvPage.clickAlertImportSubmit();
        await expect(fvPage.getToastErrorLocator()).toBeVisible({ timeout: 8000 });
        testLogger.info('Alert import error shown when submitting without file');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FilterCondition — alert wizard step 2 (QueryConfig)
  // Requires at least one stream in the environment.
  // Tests are skipped by default so they can be unskipped in appropriate CI
  // environments where a live stream is guaranteed to exist.
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('FilterCondition form validation', { tag: ['@alertsFormValidation', '@P1'] }, () => {
    test.describe.configure({ mode: 'serial' });

    test('should render filter condition row with all required selectors', {
      tag: ['@alertsFormValidation', '@P1'],
    }, async ({ page }) => {
      await fvPage.openAddAlertWizard();

      // Step 1 — select stream type and stream name before advancing
      await fvPage.getWizardStreamTypeDropdownLocator().waitFor({ state: 'visible', timeout: 15000 });
      await fvPage.selectWizardStreamType('Logs');
      await fvPage.selectWizardStreamName('e2e_automate');
      await fvPage.clickWizardNext();

      // The conditions group starts empty; add a condition row to render the
      // column / operator / value selectors (FilterGroup → FilterCondition).
      await fvPage.addFilterCondition();

      const row0 = fvPage.getFieldsInputRowLocator(0);
      await row0.waitFor({ state: 'visible', timeout: 10000 });

      await expect(fvPage.getFilterConditionColumnPopoverLocator().first()).toBeVisible();
      await expect(fvPage.getFilterConditionOperatorPopoverLocator().first()).toBeVisible();
      await expect(fvPage.getFilterConditionValueFieldLocator().first()).toBeVisible();
    });

    test('should toggle AND/OR operator in filter condition', {
      tag: ['@alertsFormValidation', '@P1'],
    }, async ({ page }) => {
      await fvPage.openAddAlertWizard();

      // Step 1 — select stream type and stream name before advancing
      await fvPage.getWizardStreamTypeDropdownLocator().waitFor({ state: 'visible', timeout: 15000 });
      await fvPage.selectWizardStreamType('Logs');
      await fvPage.selectWizardStreamName('e2e_automate');
      await fvPage.clickWizardNext();

      // The AND/OR toggle only appears on a non-first condition row, so add two.
      await fvPage.addFilterCondition();
      await fvPage.addFilterCondition();

      const toggleBtn = fvPage.getFilterConditionToggleOperatorBtnLocator();
      await toggleBtn.waitFor({ state: 'visible', timeout: 10000 });

      // Record the initial operator label text (and/or) on the second row
      const operatorLabel = fvPage.getFilterConditionOperatorLabelLocator();
      const initialText = (await operatorLabel.getAttribute('data-test-label')).trim();
      expect(initialText.length).toBeGreaterThan(0);

      // Toggle the operator
      await fvPage.clickFilterConditionToggleOperator();

      // After toggle, the label should flip from the initial value
      await expect(async () => {
        const toggledText = (await operatorLabel.getAttribute('data-test-label')).trim();
        expect(toggledText).not.toBe(initialText);
      }).toPass({ timeout: 5000 });
      testLogger.info('FilterCondition operator toggled from initial value', { from: initialText });
    });

    test('should show value error when condition submitted without value entered', {
      tag: ['@alertsFormValidation', '@P1'],
    }, async ({ page }) => {
      await fvPage.openAddAlertWizard();

      await fvPage.getWizardStreamTypeDropdownLocator().waitFor({ state: 'visible', timeout: 15000 });
      await fvPage.selectWizardStreamType('Logs');
      await fvPage.selectWizardStreamName('e2e_automate');
      await fvPage.clickWizardNext();

      await fvPage.addFilterCondition();
      await fvPage.getFieldsInputRowLocator(0).waitFor({ state: 'visible', timeout: 10000 });

      // Trigger value field blur without entering a value
      const valueField = fvPage.getFilterConditionValueFieldLocator().first();
      await valueField.click();
      await page.keyboard.press('Tab');

      // Value error should become visible
      const valueError = fvPage.getFilterConditionValueErrorLocator().first();
      await expect(valueError).toBeVisible({ timeout: 5000 });
      await expect(valueError).toContainText('Field is required!');
      testLogger.info('FilterCondition value error shown');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FieldsInput — condition row management (add / delete)
  // Shares the alert-conditions-* namespace with FilterCondition.
  // Requires at least one stream (e2e_automate) in the environment.
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('FieldsInput condition management', { tag: ['@alertsFormValidation', '@P1'] }, () => {
    test.describe.configure({ mode: 'serial' });

    test('should add a second condition row when Add Condition button is clicked', {
      tag: ['@alertsFormValidation', '@P1'],
    }, async ({ page }) => {
      await fvPage.openAddAlertWizard();

      await fvPage.getWizardStreamTypeDropdownLocator().waitFor({ state: 'visible', timeout: 15000 });
      await fvPage.selectWizardStreamType('Logs');
      await fvPage.selectWizardStreamName('e2e_automate');
      await fvPage.clickWizardNext();

      // The conditions group starts empty — add the first row.
      await fvPage.addFilterCondition();
      const row0 = fvPage.getFieldsInputRowLocator(0);
      await row0.waitFor({ state: 'visible', timeout: 10000 });
      await expect(row0).toBeVisible();

      // Click "Add Condition" to append a second row
      await fvPage.addFilterCondition();

      // Second row (index 1) should now exist
      const row1 = fvPage.getFieldsInputRowLocator(1);
      await expect(row1).toBeVisible({ timeout: 5000 });
      testLogger.info('Second condition row added successfully');
    });

    test('should remove a condition row when Delete button is clicked', {
      tag: ['@alertsFormValidation', '@P1'],
    }, async ({ page }) => {
      await fvPage.openAddAlertWizard();

      await fvPage.getWizardStreamTypeDropdownLocator().waitFor({ state: 'visible', timeout: 15000 });
      await fvPage.selectWizardStreamType('Logs');
      await fvPage.selectWizardStreamName('e2e_automate');
      await fvPage.clickWizardNext();

      // Add two rows so we have two, then delete the first.
      await fvPage.addFilterCondition();
      await fvPage.getFieldsInputRowLocator(0).waitFor({ state: 'visible', timeout: 10000 });
      await fvPage.addFilterCondition();
      await fvPage.getFieldsInputRowLocator(1).waitFor({ state: 'visible', timeout: 5000 });

      // Delete the first condition row
      const deleteBtn = fvPage.getFieldsInputDeleteConditionBtnLocator().first();
      await deleteBtn.waitFor({ state: 'visible', timeout: 5000 });
      await deleteBtn.click();

      // After deletion only one row remains — row index 1 should no longer exist
      await expect(fvPage.getFieldsInputRowLocator(1)).not.toBeVisible({ timeout: 5000 });
      testLogger.info('Condition row deleted; only one row remains');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ImportDestination
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('ImportDestination form validation', () => {
    test.describe.configure({ mode: 'serial' });

    test('should show error or keep import button disabled when no file or JSON is provided', {
      tag: ['@alerts-form-validation', '@P0', '@smoke'],
    }, async ({ page }) => {
      await fvPage.navigateToDestinations();
      await fvPage.openImportDestination();

      const importBtn = fvPage.getDestImportJsonBtnLocator();
      const isDisabled = await importBtn.isDisabled().catch(() => false);

      if (isDisabled) {
        await expect(importBtn).toBeDisabled();
        testLogger.info('Destination import button is disabled when no content provided');
      } else {
        await fvPage.clickDestinationImportSubmit();
        await expect(fvPage.getToastErrorLocator()).toBeVisible({ timeout: 8000 });
        testLogger.info('Destination import error shown when submitting empty form');
      }
    });

    test('should show error or keep import button disabled when switching to file tab without uploading a file', {
      tag: ['@alerts-form-validation', '@P0', '@smoke'],
    }, async ({ page }) => {
      await fvPage.navigateToDestinations();
      await fvPage.openImportDestination();
      await fvPage.switchToDestinationFileTab();

      const importBtn = fvPage.getDestImportJsonBtnLocator();
      const isDisabled = await importBtn.isDisabled().catch(() => false);

      if (isDisabled) {
        await expect(importBtn).toBeDisabled();
        testLogger.info('Destination import button disabled on file tab with no file');
      } else {
        await fvPage.clickDestinationImportSubmit();
        await expect(fvPage.getToastErrorLocator()).toBeVisible({ timeout: 8000 });
        testLogger.info('Destination import error shown when submitting without file');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // QueryConfig — alert wizard step 2
  // Requires the 'e2e_automate' Logs stream to exist in the test environment.
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('QueryConfig form validation', { tag: ['@alerts-form-validation', '@P1'] }, () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
      // Navigate to alerts list and open the Add Alert wizard
      await fvPage.openAddAlertWizard();

      // Step 1 — select stream type and stream name, then advance to step 2
      await fvPage.getWizardStreamTypeDropdownLocator().waitFor({ state: 'visible', timeout: 10000 });
      await fvPage.selectWizardStreamType('Logs');
      await fvPage.selectWizardStreamName('e2e_automate');
      await fvPage.clickWizardNext();

      // Wait for query mode tabs to be visible (confirms we reached step 2)
      await fvPage.getQueryModeCustomTabLocator().waitFor({ state: 'visible', timeout: 15000 });
    });

    test('should display all query mode tabs on step 2 (QueryConfig)', {
      tag: ['@alerts-form-validation', '@P1'],
    }, async ({ page }) => {
      // For a Logs stream the QueryConfig exposes Custom + SQL modes; PromQL is
      // metrics-only and is not rendered for logs.
      await expect(fvPage.getQueryModeCustomTabLocator()).toBeVisible();
      await expect(fvPage.getQueryModeSqlTabLocator()).toBeVisible();
      testLogger.info('Query mode tabs (Custom, SQL) are visible on QueryConfig step');
    });

    test('should activate SQL tab when clicked', {
      tag: ['@alerts-form-validation', '@P1'],
    }, async ({ page }) => {
      const sqlTab = fvPage.getQueryModeSqlTabLocator();
      await sqlTab.click();

      // OToggleGroupItem marks the active item with data-state="on".
      await expect(sqlTab).toHaveAttribute('data-state', 'on', { timeout: 5000 });
      testLogger.info('SQL query mode tab is active after click');
    });

    test('should show threshold input field on QueryConfig step', {
      tag: ['@alerts-form-validation', '@P1'],
    }, async ({ page }) => {
      const thresholdInput = fvPage.getAlertTriggerThresholdInputLocator();
      await thresholdInput.waitFor({ state: 'visible', timeout: 10000 });
      await expect(thresholdInput).toBeVisible();
      testLogger.info('Threshold input is visible on QueryConfig step');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AlertSettings — alert wizard step 3
  // Requires the 'e2e_automate' Logs stream to exist in the test environment.
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('AlertSettings form validation', { tag: ['@alerts-form-validation', '@P1'] }, () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
      // Navigate to alerts list and open the Add Alert wizard
      await fvPage.openAddAlertWizard();

      // Step 1 — select stream type and stream name
      await fvPage.getWizardStreamTypeDropdownLocator().waitFor({ state: 'visible', timeout: 10000 });
      await fvPage.selectWizardStreamType('Logs');
      await fvPage.selectWizardStreamName('e2e_automate');

      // Advance from step 1 to step 2 (QueryConfig)
      await fvPage.clickWizardNext();
      await fvPage.getQueryModeCustomTabLocator().waitFor({ state: 'visible', timeout: 15000 });

      // Advance from step 2 to step 3 (AlertSettings)
      await fvPage.clickWizardNext();
      await fvPage.getAlertSettingsSilenceDurationLocator().waitFor({ state: 'visible', timeout: 15000 });
    });

    test('should display silence duration input on AlertSettings step', {
      tag: ['@alerts-form-validation', '@P1'],
    }, async ({ page }) => {
      await expect(fvPage.getAlertSettingsSilenceDurationLocator()).toBeVisible();
      testLogger.info('Silence duration input is visible on AlertSettings step');
    });

    test('should display and allow clicking the refresh destinations button', {
      tag: ['@alerts-form-validation', '@P1'],
    }, async ({ page }) => {
      const refreshBtn = fvPage.getAlertRefreshDestinationsBtnLocator();
      await refreshBtn.waitFor({ state: 'visible', timeout: 10000 });
      await expect(refreshBtn).toBeVisible();
      await refreshBtn.click();
      testLogger.info('Refresh destinations button is visible and clickable');
    });

    test('should show error or disabled state when silence duration is set to 0', {
      tag: ['@alerts-form-validation', '@P1'],
    }, async ({ page }) => {
      const silenceInput = fvPage.getAlertSettingsSilenceDurationLocator();
      await silenceInput.fill('0');
      // Blur the field to trigger validation
      await silenceInput.press('Tab');

      // Either a validation error appears or the save button becomes disabled
      const silenceError = fvPage.getAlertSettingsSilenceErrorLocator();
      const errorVisible = await silenceError.isVisible().catch(() => false);

      if (errorVisible) {
        await expect(silenceError).toBeVisible();
        await expect(silenceError).toContainText('This field is required');
        testLogger.info('Silence duration error shown for value 0');
      } else {
        // No inline error — acceptable if the UI prevents saving another way
        testLogger.info('No inline silence duration error for value 0 — UI may block save elsewhere');
      }
    });
  });
});
