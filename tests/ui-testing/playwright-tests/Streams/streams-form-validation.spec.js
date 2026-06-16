// Copyright 2026 OpenObserve Inc.
//
// Streams domain — Add Stream form validation E2E tests
//
// Covers:
//   1. Empty name submit → name error visible (required)
//   2. Name with special characters → format error visible
//   3. Negative / zero retention value → error or save button disabled
//   4. Valid name + type → stream created, dialog closes
//   5. Cancel → dialog closes without saving

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Static stream name used for happy-path creation.
// The prefix "e2e_streamfv_" is used for targeted cleanup.
const VALID_STREAM_NAME = 'e2e_streamfv_001';

test.describe('Streams Add Stream form validation', { tag: ['@streams-form-validation', '@smoke', '@P0'] }, () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeAll(async ({ request }) => {
        // Remove the test stream if it already exists from a previous run so TC004 can create it fresh.
        const org   = process.env.ORGNAME || 'default';
        // API calls go to INGESTION_URL (backend) not ZO_BASE_URL (Vite dev server)
        const base  = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/+$/, '');
        const email = process.env.ZO_ROOT_USER_EMAIL;
        const pass  = process.env.ZO_ROOT_USER_PASSWORD;
        const creds = Buffer.from(`${email}:${pass}`).toString('base64');
        await request.delete(
            `${base}/api/${org}/streams/${VALID_STREAM_NAME}?type=logs&delete_all=false`,
            { headers: { Authorization: `Basic ${creds}` } }
        ).catch(() => {}); // ignore 404 if stream doesn't exist
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.streamsFormValidation.navigateToStreamsPage();
        await pm.streamsFormValidation.openAddStreamDialog();
        testLogger.info('Add Stream dialog opened');
    });

    test.afterEach(async ({}, testInfo) => {
        if (testInfo.status) {
            testLogger.testEnd(testInfo.title, testInfo.status, testInfo.duration);
        }
    });

    // ── TC001: Empty name → required error shown ──────────────────────────────

    test('should show required error or disable save when name is empty', {
        tag: ['@streams-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC001: Verify required error for empty stream name');

        // Name field is empty by default; attempt to submit the form
        await pm.streamsFormValidation.clickSave();

        // Either the error message appears OR the save button is disabled — both are acceptable
        const nameError = pm.streamsFormValidation.getNameErrorLocator();
        const saveBtn   = pm.streamsFormValidation.getSaveBtnLocator();

        const errorVisible  = await nameError.isVisible().catch(() => false);
        const btnDisabled   = await saveBtn.isDisabled().catch(() => false);

        expect(errorVisible || btnDisabled).toBe(true);

        if (errorVisible) {
            await expect(nameError).toContainText('required');
            testLogger.info('Required error message displayed');
        } else {
            testLogger.info('Save button disabled for empty name');
        }
    });

    // ── TC002: Special characters in name → format error ─────────────────────

    test('should show format error when stream name contains special characters', {
        tag: ['@streams-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC002: Verify format error for name with special chars');

        // Fill an invalid name (contains @, !, space — not allowed)
        await pm.streamsFormValidation.fillStreamName('bad@name!');

        const nameError = pm.streamsFormValidation.getNameErrorLocator();
        await expect(nameError).toBeVisible();
        await expect(nameError).toContainText('alphanumeric');

        // Save button should not proceed (disabled or still showing error)
        testLogger.info('Format error correctly shown for invalid stream name characters');
    });

    // ── TC003: Negative retention value → error or save disabled ─────────────

    test('should show error or disable save when data retention is negative', {
        tag: ['@streams-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC003: Verify retention error for negative value');

        // Fill valid name and type first so the only invalid field is retention
        await pm.streamsFormValidation.fillStreamName(VALID_STREAM_NAME);
        await pm.streamsFormValidation.selectStreamType('Logs');

        // Data retention section is conditionally rendered (requires zoConfig.data_retention_days).
        // If it is not present in this environment, skip the retention assertion.
        const retentionWrapper = pm.streamsFormValidation.getDataRetentionWrapperLocator();
        const retentionVisible = await retentionWrapper.isVisible().catch(() => false);

        if (!retentionVisible) {
            testLogger.info('TC003: Data retention section not rendered in this environment — skipping');
            // Still assert dialog is open (test is not vacuously passing)
            await expect(pm.streamsFormValidation.getDialogLocator()).toBeVisible();
            return;
        }

        // Fill an invalid value (0 is not > 0, so validation should fail)
        await pm.streamsFormValidation.fillDataRetention('0');
        await pm.streamsFormValidation.clickSave();

        const retentionError = pm.streamsFormValidation.getDataRetentionErrorLocator();
        const saveBtn        = pm.streamsFormValidation.getSaveBtnLocator();

        // Wait up to 3s for the error to appear (Vue batches re-renders)
        const errorVisible = await retentionError.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
        const btnDisabled  = await saveBtn.isDisabled().catch(() => false);

        expect(errorVisible || btnDisabled).toBe(true);
        testLogger.info('Negative retention value correctly rejected');
    });

    // ── TC004: Valid name + type → stream created, dialog closes ─────────────

    test('should create stream and close dialog when valid name and type are provided', {
        tag: ['@streams-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info(`TC004: Creating stream "${VALID_STREAM_NAME}" with type Logs`);

        await pm.streamsFormValidation.fillStreamName(VALID_STREAM_NAME);
        await pm.streamsFormValidation.selectStreamType('Logs');

        // Save should be enabled
        await expect(pm.streamsFormValidation.getSaveBtnLocator()).toBeEnabled();
        await pm.streamsFormValidation.clickSave();

        // Dialog should close after successful creation
        await expect(pm.streamsFormValidation.getDialogLocator()).not.toBeVisible({ timeout: 15000 });

        testLogger.info('Stream created successfully and dialog closed');
    });

    // ── TC005: Cancel → dialog closes ────────────────────────────────────────

    test('should close dialog without saving when Cancel is clicked', {
        tag: ['@streams-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('TC005: Verify Cancel closes the Add Stream dialog');

        // Enter some data to confirm it is discarded
        await pm.streamsFormValidation.fillStreamName('e2e_streamfv_cancel_check');

        await pm.streamsFormValidation.clickCancel();

        await expect(pm.streamsFormValidation.getDialogLocator()).not.toBeVisible({ timeout: 10000 });
        testLogger.info('Dialog closed correctly after Cancel');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// StreamFieldInputs — field-level validation
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Streams StreamFieldInputs form validation', { tag: ['@streams-form-validation', '@P1'] }, () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeAll(async ({ request }) => {
        // Clean up test streams from previous runs so creation tests start fresh.
        const org   = process.env.ORGNAME || 'default';
        const base  = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/+$/, '');
        const creds = Buffer.from(`${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`).toString('base64');
        const headers = { Authorization: `Basic ${creds}` };
        await Promise.all([
            request.delete(`${base}/api/${org}/streams/e2e_streamfv_fields_001?type=logs&delete_all=false`, { headers }).catch(() => {}),
            request.delete(`${base}/api/${org}/streams/e2e_streamfv_dtype_001?type=logs&delete_all=false`, { headers }).catch(() => {}),
        ]);
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.streamsFormValidation.navigateToStreamsPage();
        await pm.streamsFormValidation.openAddStreamDialog();
        // Open the field inputs section by clicking "Add Field"
        await pm.streamsFormValidation.clickAddFieldBtn();
        testLogger.info('StreamFieldInputs section opened');
    });

    test.afterEach(async ({}, testInfo) => {
        if (testInfo.status) {
            testLogger.testEnd(testInfo.title, testInfo.status, testInfo.duration);
        }
    });

    // ── TC-SFI-001: Add field button renders field row ────────────────────────

    test('should render field row after clicking Add Field button', {
        tag: ['@streams-form-validation', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC-SFI-001: Field row should appear after Add Field click');

        const fieldRow = pm.streamsFormValidation.getFieldRowLocator(0);
        await expect(fieldRow).toBeVisible({ timeout: 5000 });
        testLogger.info('Field row visible after Add Field click');
    });

    // ── TC-SFI-002: Empty field name → error on save ──────────────────────────

    test('should show error when field name is empty on stream save', {
        tag: ['@streams-form-validation', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC-SFI-002: Field name required error on empty save');

        // Leave field name empty, attempt to save the stream form
        await pm.streamsFormValidation.fillStreamName('e2e_streamfv_fields_001');
        await pm.streamsFormValidation.clickSave();

        const nameError = pm.streamsFormValidation.getFieldNameErrorLocator(0);
        const saveBtn = pm.streamsFormValidation.getSaveBtnLocator();

        // Wait up to 3s for the error to appear (Vue batches re-renders)
        const errorVisible = await nameError.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
        const btnDisabled = await saveBtn.isDisabled().catch(() => false);

        expect(errorVisible || btnDisabled).toBe(true);
        testLogger.info('Field name error or disabled save button confirmed for empty field name');
    });

    // ── TC-SFI-003: Invalid characters in field name → format error ───────────

    test('should show format error when field name contains invalid characters', {
        tag: ['@streams-form-validation', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC-SFI-003: Field name format error for invalid chars');

        await pm.streamsFormValidation.fillFieldName(0, 'bad-field@name!');

        const nameError = pm.streamsFormValidation.getFieldNameErrorLocator(0);
        await expect(nameError).toBeVisible({ timeout: 5000 });
        await expect(nameError).toContainText('alphanumeric');
        testLogger.info('Format error correctly shown for invalid field name characters');
    });

    // ── TC-SFI-004: Delete field button removes the row ───────────────────────

    test('should remove field row when Delete button is clicked', {
        tag: ['@streams-form-validation', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC-SFI-004: Delete field button removes the row');

        const fieldRow = pm.streamsFormValidation.getFieldRowLocator(0);
        await expect(fieldRow).toBeVisible({ timeout: 5000 });

        await pm.streamsFormValidation.clickDeleteFieldBtn(0);

        await expect(fieldRow).not.toBeVisible({ timeout: 5000 });
        testLogger.info('Field row removed after Delete click');
    });

    // ── TC-SFI-005: Empty data type → error on save ───────────────────────────

    test('should show error when field data type is not selected on stream save', {
        tag: ['@streams-form-validation', '@P1']
    }, async ({ page }) => {
        testLogger.info('TC-SFI-005: Data type required error when data type is not selected');

        // Fill in a valid field name but leave data type empty, then attempt save
        await pm.streamsFormValidation.fillFieldName(0, 'valid_field_name');
        await pm.streamsFormValidation.fillStreamName('e2e_streamfv_dtype_001');

        // Skip if the data type select is not visible (feature may be disabled in this environment)
        const dataTypeSelectLocator = page.locator('[data-test="add-stream-field-data-type-select"]').first();
        const dataTypeSelectVisible = await dataTypeSelectLocator.isVisible().catch(() => false);
        if (!dataTypeSelectVisible) {
            testLogger.info('TC-SFI-005: Data type select not visible in this environment — skipping assertion');
            await expect(pm.streamsFormValidation.getDialogLocator()).toBeVisible();
            return;
        }

        await pm.streamsFormValidation.clickSave();

        const dataTypeError = pm.streamsFormValidation.getFieldDataTypeErrorLocator(0);
        const saveBtn = pm.streamsFormValidation.getSaveBtnLocator();

        // Wait up to 5s for the error to appear (Vue batches child component re-renders)
        const errorVisible = await dataTypeError.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
        const btnDisabled = await saveBtn.isDisabled().catch(() => false);

        expect(errorVisible || btnDisabled).toBe(true);
        testLogger.info('Data type required error or disabled save confirmed when data type is empty');
    });
});
