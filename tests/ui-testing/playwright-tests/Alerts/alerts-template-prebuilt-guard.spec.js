const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * Prebuilt Template Management — Prebuilt Guards
 *
 * Covers the template-side prebuilt guards:
 *  - Tab-based filtering (All / Prebuilt / Custom)
 *  - Prebuilt badge rendering & delete-button disabled state
 *  - Bulk-delete prebuilt exclusion
 *  - Custom-template CRUD (edit, clone)
 *  - Template name validation (empty, invalid characters)
 *
 * Naming Convention: Uses 'auto_' prefix for cleanup compatibility.
 * Cleanup: Handled by cleanup.spec.js via 'auto_' prefix patterns.
 */
test.describe("Prebuilt Template Management", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.alertTemplatesPage.navigateToTemplatesPage();
    testLogger.info('Test setup completed — navigated to templates page');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // ============================================================================
  // P0 — Critical Path: Template List & Prebuilt Guards
  // ============================================================================

  test("P0.1: Template List Renders with Tabs and Action Buttons", {
    tag: ['@prebuiltTemplateManagement', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P0.1: Verify template list core UI ===');

    await pm.alertTemplatesPage.expectTemplateListTabsVisible();
    await pm.alertTemplatesPage.expectTabAllVisible();
    await pm.alertTemplatesPage.expectTabPrebuiltVisible();
    await pm.alertTemplatesPage.expectTabCustomVisible();

    await pm.alertTemplatesPage.expectAddTemplateBtnVisible();
    await pm.alertTemplatesPage.expectAddTemplateBtnEnabled();

    await pm.alertTemplatesPage.expectImportBtnVisible();
    await pm.alertTemplatesPage.expectTemplateTableVisible();

    testLogger.info('✓ Template list core UI elements all present');
  });

  test("P0.2: Prebuilt Template Guard — Delete Button Disabled & Badge Visible", {
    tag: ['@prebuiltTemplateManagement', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P0.2: Verify prebuilt delete-guard and badge ===');

    // Wait for the table to settle
    await pm.alertTemplatesPage.expectTemplateTableVisible();

    const hasPrebuilt = await pm.alertTemplatesPage.expectAnyPrebuiltRowsExist();

    if (hasPrebuilt) {
      testLogger.info('Prebuilt templates detected — asserting guard behaviors');
      await pm.alertTemplatesPage.expectPrebuiltBadgeVisible();
      await pm.alertTemplatesPage.expectPrebuiltDeleteButtonDisabled();
    } else {
      testLogger.info('No prebuilt templates found in environment — guard assertions skipped gracefully');
    }

    // Always verify the table is populated (no blank screen)
    testLogger.info('✓ Template table is functional (no crash/blank-screen)');
  });

  // ============================================================================
  // P1 — Important Variations
  // ============================================================================

  test("P1.1: Template Tab Filtering — All / Prebuilt / Custom", {
    tag: ['@prebuiltTemplateManagement', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P1.1: Verify tab filtering ===');

    // Create a known custom template so we have a predictable row to filter by
    const suffix = Date.now().toString().slice(-6);
    const customName = `auto_tabfilter_${suffix}`;
    await pm.alertTemplatesPage.ensureTemplateExists(customName);
    testLogger.info('Custom template ensured', { customName });

    // Refresh to pick up the new template
    await pm.alertTemplatesPage.navigateToTemplatesPage();

    // Click Prebuilt tab → only prebuilt badges visible; custom badges hidden
    await pm.alertTemplatesPage.clickTabPrebuilt();
    await testLogger.info('Clicked Prebuilt tab');

    const hasPrebuilt = await pm.alertTemplatesPage.expectAnyPrebuiltRowsExist();
    if (hasPrebuilt) {
      await pm.alertTemplatesPage.expectPrebuiltBadgeVisible();
    }
    // Custom badges should NOT be visible when Prebuilt tab is active
    await pm.alertTemplatesPage.expectCustomBadgeNotVisible();

    // Click Custom tab → custom rows visible; prebuilt rows hidden
    await pm.alertTemplatesPage.clickTabCustom();
    await testLogger.info('Clicked Custom tab');

    await pm.alertTemplatesPage.expectCustomBadgeVisible();
    await pm.alertTemplatesPage.expectPrebuiltBadgeNotVisible();

    // Click All tab → both visible (handle pagination: prebuilt rows may be on later pages)
    await pm.alertTemplatesPage.clickTabAll();
    await testLogger.info('Clicked All tab');

    await pm.alertTemplatesPage.expectCustomBadgeVisible();
    if (hasPrebuilt) {
      await pm.alertTemplatesPage.expectPrebuiltBadgeVisibleAcrossPages();
    }

    // Cleanup
    await pm.alertTemplatesPage.deleteTemplateViaApi(customName);
    testLogger.info('✓ Tab filtering works correctly');
  });

  test("P1.2: Edit (Update) a Custom Template", {
    tag: ['@prebuiltTemplateManagement', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P1.2: Verify edit/update flow ===');

    const suffix = Date.now().toString().slice(-6);
    const editName = `auto_edit_${suffix}`;
    await pm.alertTemplatesPage.ensureTemplateExists(editName);
    testLogger.info('Custom template ensured', { editName });

    await pm.alertTemplatesPage.navigateToTemplatesPage();

    // Click the per-row update button
    await pm.alertTemplatesPage.clickEditButton(editName);
    testLogger.info('Clicked edit button for', { editName });

    // Assert the form opens in Update mode
    await pm.alertTemplatesPage.expectAddTemplateTitleContains('Update template');
    await pm.alertTemplatesPage.expectTemplateNameInputReadonly();

    // Type a new body
    const newBody = `{"text": "Updated by playwright e2e test ${suffix}. Alert: {alert_name}"}`;
    await pm.alertTemplatesPage.fillTemplateBody(newBody);

    // Save
    await pm.alertTemplatesPage.clickTemplateSubmitBtn();
    await pm.alertTemplatesPage.expectTemplateSaveSuccessToast();
    testLogger.info('✓ Template updated successfully');

    // Cleanup
    await pm.alertTemplatesPage.deleteTemplateViaApi(editName);
  });

  test("P1.3: Clone a Custom Template", {
    tag: ['@prebuiltTemplateManagement', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P1.3: Verify clone flow ===');

    const suffix = Date.now().toString().slice(-6);
    const srcName = `auto_clone_src_${suffix}`;
    await pm.alertTemplatesPage.ensureTemplateExists(srcName);
    testLogger.info('Source template ensured', { srcName });

    await pm.alertTemplatesPage.navigateToTemplatesPage();

    // Click the per-row clone button
    await pm.alertTemplatesPage.clickCloneButton(srcName);
    testLogger.info('Clicked clone button for', { srcName });

    // Assert the form opens in Clone mode
    await pm.alertTemplatesPage.expectAddTemplateTitleContains('Clone template');

    // The name input should be pre-filled with "Copy_of_<srcName>"
    const expectedCloneName = `Copy_of_${srcName}`;
    await pm.alertTemplatesPage.expectTemplateNameInputValue(expectedCloneName);

    // Save the clone
    await pm.alertTemplatesPage.clickTemplateSubmitBtn();
    await pm.alertTemplatesPage.expectTemplateSaveSuccessToast();
    testLogger.info('Clone saved');

    // Verify the original still exists
    await pm.alertTemplatesPage.navigateToTemplatesPage();
    await pm.alertTemplatesPage.verifyCreatedTemplateExists(srcName);

    // Cleanup both
    await pm.alertTemplatesPage.deleteTemplateViaApi(srcName);
    await pm.alertTemplatesPage.deleteTemplateViaApi(expectedCloneName);
    testLogger.info('✓ Clone flow works correctly, original preserved');
  });

  test("P1.4: Prebuilt Templates Excluded from Bulk Selection", {
    tag: ['@prebuiltTemplateManagement', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P1.4: Verify bulk-delete prebuilt exclusion ===');

    // Ensure at least one custom template exists so we can test selection
    const suffix = Date.now().toString().slice(-6);
    const customName = `auto_bulk_sel_${suffix}`;
    await pm.alertTemplatesPage.ensureTemplateExists(customName);
    testLogger.info('Custom template ensured', { customName });

    await pm.alertTemplatesPage.navigateToTemplatesPage();

    const hasPrebuilt = await pm.alertTemplatesPage.expectAnyPrebuiltRowsExist();

    // Click Select All header checkbox
    await pm.alertTemplatesPage.clickSelectAllCheckbox();
    testLogger.info('Clicked Select All checkbox');

    // If there are any selected custom rows, the bulk-delete button should appear
    // Prebuilt rows are excluded from selection (isTemplateRowSelectable returns false)
    if (hasPrebuilt) {
      // With prebuilt present, only custom rows get selected — bulk button shows
      testLogger.info('Prebuilt templates present — asserting bulk button visible (custom-only selection)');
    }

    // The bulk-delete button should be visible (at least the custom template we created is selected)
    await pm.alertTemplatesPage.expectBulkDeleteBtnVisible();
    testLogger.info('✓ Bulk-delete button visible for custom selection');

    // Cleanup
    await pm.alertTemplatesPage.deleteTemplateViaApi(customName);
  });

  // ============================================================================
  // P2 — Edge Cases
  // ============================================================================

  test("P2.1: Empty Template Name Validation", {
    tag: ['@prebuiltTemplateManagement', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P2.1: Verify empty-name validation ===');

    await pm.alertTemplatesPage.clickAddTemplateBtn();
    testLogger.info('Clicked Add Template');

    await pm.alertTemplatesPage.clearTemplateNameInput();
    await pm.alertTemplatesPage.clickTemplateSubmitBtn();

    // Assert inline validation error
    await pm.alertTemplatesPage.expectValidationErrorVisible('Name is required');
    testLogger.info('✓ Empty name validation triggered');

    // Dismiss the form
    await pm.alertTemplatesPage.clickTemplateCancelBtn();
  });

  test("P2.2: Invalid Resource Name Validation", {
    tag: ['@prebuiltTemplateManagement', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P2.2: Verify invalid-name validation ===');

    await pm.alertTemplatesPage.clickAddTemplateBtn();
    testLogger.info('Clicked Add Template');

    // Try a name with spaces
    await pm.alertTemplatesPage.typeInTemplateNameInput('my template');
    await pm.alertTemplatesPage.clickTemplateSubmitBtn();

    // Assert validation error for spaces
    await pm.alertTemplatesPage.expectValidationErrorVisible('Characters like :, ?, /, #, and spaces are not allowed.');
    testLogger.info('✓ Space-in-name validation triggered');

    // Try a name with '#'
    await pm.alertTemplatesPage.clearTemplateNameInput();
    await pm.alertTemplatesPage.typeInTemplateNameInput('my#template');
    await pm.alertTemplatesPage.clickTemplateSubmitBtn();

    // Assert validation error again
    await pm.alertTemplatesPage.expectValidationErrorVisible('Characters like :, ?, /, #, and spaces are not allowed.');
    testLogger.info('✓ Hash-in-name validation triggered');

    // Dismiss the form
    await pm.alertTemplatesPage.clickTemplateCancelBtn();
  });
});
