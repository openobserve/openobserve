// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('Functions Form Validation', { tag: ['@functions-form-validation', '@P0', '@smoke'] }, () => {
  test.describe.configure({ mode: 'serial' });

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // AddFunction validation
  // ─────────────────────────────────────────────────────────────────────────────
  test.describe('AddFunction form validation', () => {
    test.describe.configure({ mode: 'serial' });

    test('should show error when function name is empty on save', async ({ page }) => {
      testLogger.info('Test: empty function name → error on save');
      const fv = pm.functionsFormValidation;

      await fv.openAddFunctionForm();

      // Do not fill name — click Save immediately
      await fv.clickSave();

      // Expect name error message
      await fv.expectFunctionNameErrorVisible();
    });

    test('should show error when function name is invalid on save', async ({ page }) => {
      testLogger.info('Test: invalid function name → error on save');
      const fv = pm.functionsFormValidation;

      await fv.openAddFunctionForm();

      // Fill a name that starts with a digit — invalid per the regex
      await fv.fillFunctionName('1invalid_name');
      await fv.clickSave();

      await fv.expectFunctionNameError('Invalid');
    });

    test('should show name error when name is cleared after focus', async ({ page }) => {
      testLogger.info('Test: name field cleared after focus → error visible');
      const fv = pm.functionsFormValidation;

      await fv.openAddFunctionForm();

      // Type then clear — triggers blur validation
      await fv.fillFunctionName('test_fv_fn_001');
      await fv.functionNameField.fill('');
      await fv.functionNameField.blur();

      await fv.expectFunctionNameErrorVisible();
    });

    test('should create function successfully with valid VRL code', async ({ page }) => {
      testLogger.info('Test: valid VRL function → created successfully');
      const fv = pm.functionsFormValidation;
      const functionName = 'test_fv_vrl_001';

      // Delete the function if it already exists from a previous run (idempotent)
      await pm.functionsPage.deleteFunctionByName(functionName, '_meta').catch(() => {});

      await fv.openAddFunctionForm();
      await fv.fillFunctionName(functionName);

      // Type minimal valid VRL code into the editor
      await fv.typeInVrlEditor('. = parse_json!(string!(.message)) ?? .');

      await fv.clickSave();

      // Expect success toast
      await fv.expectSuccessToast();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // FunctionsToolbar — transform type radio
  // ─────────────────────────────────────────────────────────────────────────────
  test.describe('FunctionsToolbar transform type selection', () => {
    test.describe.configure({ mode: 'serial' });

    test('should show VRL radio selected by default when Add Function form opens', async ({ page }) => {
      testLogger.info('Test: VRL radio is selected by default');
      const fv = pm.functionsFormValidation;

      await fv.openAddFunctionForm();

      await fv.assertVrlRadioSelected();
    });

    test('should enable Save button when valid name is entered', async ({ page }) => {
      testLogger.info('Test: Save button enabled after valid name entry');
      const fv = pm.functionsFormValidation;

      await fv.openAddFunctionForm();

      await fv.fillFunctionName('test_fv_tb_001');

      const saveBtn = fv.saveButton;
      const saveVisible = await saveBtn.isVisible().catch(() => false);
      expect(saveVisible).toBe(true);
    });

    test('should show error when function name has invalid format', async ({ page }) => {
      testLogger.info('Test: FunctionsToolbar — invalid name format shows error');
      const fv = pm.functionsFormValidation;

      await fv.openAddFunctionForm();
      await fv.fillFunctionName('invalid-name-with-dashes');
      await fv.clickSave();

      await fv.expectFunctionNameError('Invalid');
    });

    test('should navigate back when Cancel is clicked', async ({ page }) => {
      testLogger.info('Test: FunctionsToolbar — Cancel navigates back');
      const fv = pm.functionsFormValidation;

      await fv.openAddFunctionForm();

      await fv.cancelButton.waitFor({ state: 'visible' });
      await fv.cancelButton.click();

      // After cancel, the add function form should not be visible
      const nameFieldVisible = await fv.functionNameField.isVisible().catch(() => false);
      expect(nameFieldVisible).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // StreamRouting — form validation
  // ─────────────────────────────────────────────────────────────────────────────
  test.describe('StreamRouting form validation', () => {
    test.describe.configure({ mode: 'serial' });

    test('should show name error when Save is clicked with empty destination name', async ({ page }) => {
      testLogger.info('Test: StreamRouting — empty destination name error on save');
      const fv = pm.functionsFormValidation;

      await fv.openStreamRoutingForm();

      await fv.clickStreamRoutingSave();

      await fv.assertStreamRoutingNameErrorVisible();
    });

    test('should close routing panel when cancel icon is clicked', async ({ page }) => {
      testLogger.info('Test: StreamRouting — cancel icon closes the panel');
      const fv = pm.functionsFormValidation;

      await fv.openStreamRoutingForm();

      await fv.clickStreamRoutingClose();

      const section = fv.streamRoutingSection;
      const sectionVisible = await section.isVisible().catch(() => false);
      expect(sectionVisible).toBe(false);
    });

    test('should show stream type error when Save is clicked without selecting stream type', async ({ page }) => {
      testLogger.info('Test: StreamRouting — stream type required error on save');
      const fv = pm.functionsFormValidation;

      await fv.openStreamRoutingForm();

      await fv.fillStreamRoutingDestName('test_fv_sr_001');
      await fv.clickStreamRoutingSave();

      await fv.assertStreamRoutingStreamTypeErrorVisible();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // AddEnrichmentTable validation
  // ─────────────────────────────────────────────────────────────────────────────
  test.describe('AddEnrichmentTable form validation', () => {
    test.describe.configure({ mode: 'serial' });

    test('should show error when enrichment table name is empty on save', async ({ page }) => {
      testLogger.info('Test: empty enrichment table name → error on save');
      const fv = pm.functionsFormValidation;

      await fv.openAddEnrichmentTableForm();

      // Submit without filling name
      await fv.clickEnrichmentSave();

      await fv.expectEnrichmentNameError('required');
    });

    test('should show error when no file is selected on save', async ({ page }) => {
      testLogger.info('Test: enrichment table — name filled but no file → error on save');
      const fv = pm.functionsFormValidation;

      await fv.openAddEnrichmentTableForm();

      // Fill name but leave file empty
      await fv.fillEnrichmentName('test_fv_et_001');
      await fv.clickEnrichmentSave();

      await fv.expectEnrichmentFileError('required');
    });

    test('should show format error when wrong file type is provided via URL source', async ({ page }) => {
      testLogger.info('Test: enrichment table URL source — invalid URL format → error visible');
      const fv = pm.functionsFormValidation;

      await fv.openAddEnrichmentTableForm();

      // Fill name
      await fv.fillEnrichmentName('test_fv_et_002');

      // Switch to URL source
      await fv.selectUrlSource();

      // Type an invalid URL (no http:// prefix) to trigger format validation
      await fv.enrichmentUrlField.waitFor({ state: 'visible', timeout: 10000 });
      await fv.enrichmentUrlField.fill('example.com/data.csv');

      await fv.clickEnrichmentSave();

      // Expect URL format error
      await fv.enrichmentUrlError.waitFor({ state: 'visible', timeout: 5000 });
      await expect(fv.enrichmentUrlError).toBeVisible();
      await expect(fv.enrichmentUrlError).toContainText('http');
    });
  });
});
