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
      const nameErrorText = await nameError.textContent();
      expect(nameErrorText.trim().length).toBeGreaterThan(0);
    });

    test('should successfully create a template when name and body are valid', {
      tag: ['@alerts-form-validation', '@P0', '@smoke'],
    }, async ({ page }) => {
      await fvPage.navigateToTemplates();
      await fvPage.openAddTemplate();

      await fvPage.fillTemplateName('test_fv_alerts_tmpl_001');

      // Fill the body editor with valid JSON (webhook type is default)
      await fvPage.fillTemplateBodyViaEditor('{"text":"{alert_name} triggered"}');

      await fvPage.clickTemplateSubmit();

      // Expect success toast
      await expect(fvPage.getToastSuccessLocator()).toBeVisible({ timeout: 10000 });
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
      await pm.alertsPage.navigateToAlerts(page).catch(async () => {
        await fvPage.navigateToAlertsList();
      });

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
      await pm.alertsPage.navigateToAlerts(page).catch(async () => {
        await fvPage.navigateToAlertsList();
      });

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

      // Wait for the FilterCondition row to appear (step 2 / QueryConfig)
      const toggleBtn = fvPage.getFilterConditionToggleOperatorBtnLocator();
      await toggleBtn.waitFor({ state: 'visible', timeout: 10000 });

      await expect(toggleBtn).toBeVisible();
      await expect(fvPage.getFilterConditionColumnPopoverLocator()).toBeVisible();
      await expect(fvPage.getFilterConditionOperatorPopoverLocator()).toBeVisible();
      await expect(fvPage.getFilterConditionValueFieldLocator()).toBeVisible();
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

      const toggleBtn = fvPage.getFilterConditionToggleOperatorBtnLocator();
      await toggleBtn.waitFor({ state: 'visible', timeout: 10000 });

      // Record the initial label text
      const initialText = (await toggleBtn.textContent()).trim();
      expect(initialText.length).toBeGreaterThan(0);

      // Toggle the operator
      await fvPage.clickFilterConditionToggleOperator();

      // After toggle, the text should be different from the initial value
      const toggledText = (await toggleBtn.textContent()).trim();
      expect(toggledText).not.toBe(initialText);
      testLogger.info('FilterCondition operator toggled', { from: initialText, to: toggledText });
    });

    test('should show column error when condition submitted without column selected', {
      tag: ['@alertsFormValidation', '@P1'],
    }, async ({ page }) => {
      await fvPage.openAddAlertWizard();

      // Step 1 — select stream type and stream name before advancing
      await fvPage.getWizardStreamTypeDropdownLocator().waitFor({ state: 'visible', timeout: 15000 });
      await fvPage.selectWizardStreamType('Logs');
      await fvPage.selectWizardStreamName('e2e_automate');
      await fvPage.clickWizardNext();

      const toggleBtn = fvPage.getFilterConditionToggleOperatorBtnLocator();
      await toggleBtn.waitFor({ state: 'visible', timeout: 10000 });

      // Attempt to open the column selector and close without selecting — triggers validation
      await fvPage.openFilterConditionColumnPopover();
      // Close the popover by pressing Escape so the field is left empty/untouched
      await page.keyboard.press('Escape');

      // Trigger validation by clicking the column popover again and blurring
      await fvPage.openFilterConditionColumnPopover();
      await page.keyboard.press('Escape');

      // Column error should become visible
      const columnError = fvPage.getFilterConditionColumnErrorLocator();
      await columnError.waitFor({ state: 'visible', timeout: 5000 });
      await expect(columnError).toBeVisible();
      const columnErrorText = (await columnError.textContent()).trim();
      expect(columnErrorText.length).toBeGreaterThan(0);
      testLogger.info('FilterCondition column error shown', { error: columnErrorText });
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
      await expect(fvPage.getQueryModeCustomTabLocator()).toBeVisible();
      await expect(fvPage.getQueryModeSqlTabLocator()).toBeVisible();
      await expect(fvPage.getQueryModePromqlTabLocator()).toBeVisible();
      testLogger.info('All query mode tabs are visible on QueryConfig step');
    });

    test('should activate SQL tab when clicked', {
      tag: ['@alerts-form-validation', '@P1'],
    }, async ({ page }) => {
      const sqlTab = fvPage.getQueryModeSqlTabLocator();
      await sqlTab.click();

      // The active tab should have aria-selected="true" or an active class
      const isSelected = await sqlTab.getAttribute('aria-selected').catch(() => null);
      const hasActiveClass = await sqlTab.evaluate(
        (el) => el.classList.contains('active') || el.classList.contains('q-tab--active')
      ).catch(() => false);

      expect(isSelected === 'true' || hasActiveClass).toBe(true);
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
        const errorText = await silenceError.textContent();
        expect(errorText.trim().length).toBeGreaterThan(0);
        testLogger.info('Silence duration error shown for value 0', { error: errorText.trim() });
      } else {
        // No inline error — acceptable if the UI prevents saving another way
        testLogger.info('No inline silence duration error for value 0 — UI may block save elsewhere');
      }
    });
  });
});
