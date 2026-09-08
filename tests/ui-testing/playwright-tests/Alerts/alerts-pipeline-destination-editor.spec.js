const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * Pipeline Destination Editor E2E Tests (area: Alerts).
 *
 * Covers the pipeline destination list + two-step create/edit wizard
 * (PipelinesDestinationList.vue → PipelineDestinationEditor.vue →
 * CreateDestinationForm.vue), scoped to module=pipeline destinations.
 *
 * Headline coverage is the editor open/close behavior via the ?action=add /
 * ?action=update&name=X routes (the stale-getDestinations() race regression)
 * plus the add/edit/delete/bulk-delete CRUD flows.
 *
 * Enterprise/Cloud build required: the pipelineDestinations route + settings tab
 * are registered only when config.isEnterprise === "true". The beforeEach probes
 * for the tab and skips on a pure OSS bundle.
 */

function uniqueName(prefix) {
  return `${prefix}${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`;
}

test.describe("Pipeline Destination Editor testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Enterprise probe: the pipeline destinations tab is only rendered on
    // enterprise/cloud builds. Skip the whole spec on a pure OSS bundle.
    const isEnterprise = await pm.homePage.navigateToPipelineDestinations();
    if (!isEnterprise) {
      test.skip(true, 'Pipeline destinations route/tab not available — requires enterprise/cloud build');
      return;
    }
    testLogger.info('Test setup completed');
  });

  // ============================================================================
  // P0 — Critical path (regression): editor open/close via ?action routes
  // ============================================================================

  test("Add via URL ?action=add opens the editor and stays open after the list resolves (regression)", {
    tag: ['@pipeline-destination-editor', '@enterprise', '@all']
  }, async ({ page }) => {
    testLogger.info('Navigating to pipeline destinations with ?action=add');
    await pm.pipelineDestinations.navigateToAddDestination();
    await pm.pipelineDestinations.expectEditorOpen('New Destination');
    await pm.pipelineDestinations.expectNameFieldVisible();
    // The late getDestinations() response must NOT re-toggle the editor closed.
    await pm.pipelineDestinations.expectEditorOpen('New Destination');
    testLogger.info('Editor stayed open after the list response resolved');
  });

  test("Edit via URL ?action=update&name=X opens prefilled with a locked name (regression)", {
    tag: ['@pipeline-destination-editor', '@enterprise', '@all']
  }, async ({ page }) => {
    const name = uniqueName('destE2Eupd');
    const seeded = await pm.apiCleanup.createPipelineDestination(name);
    expect(seeded.ok).toBeTruthy();
    testLogger.info('Seeded destination for the update-route test', { name });

    await pm.pipelineDestinations.navigateToUpdateDestination(name);
    await pm.pipelineDestinations.expectEditorOpen(name);
    await pm.pipelineDestinations.expectNameFieldDisabled();

    await pm.apiCleanup.deletePipelineDestination(name);
  });

  // ============================================================================
  // P0 — Create / edit workflows
  // ============================================================================

  test("Create destination via the Add button", {
    tag: ['@pipeline-destination-editor', '@enterprise', '@all']
  }, async ({ page }) => {
    const name = uniqueName('destE2E');
    await pm.pipelineDestinations.navigateToPipelineDestinationsByUrl();
    await pm.pipelineDestinations.addDestination(name, 'https://example.com');
    await pm.pipelineDestinations.expectToast(name);
    await pm.pipelineDestinations.expectRowInList(name);

    await pm.apiCleanup.deletePipelineDestination(name);
  });

  test("Edit via row button keeps the name locked and persists a URL update", {
    tag: ['@pipeline-destination-editor', '@enterprise', '@all']
  }, async ({ page }) => {
    const name = uniqueName('destE2Eedit');
    const seeded = await pm.apiCleanup.createPipelineDestination(name, { url: 'https://example.com' });
    expect(seeded.ok).toBeTruthy();

    await pm.pipelineDestinations.navigateToPipelineDestinationsByUrl();
    await pm.pipelineDestinations.expectRowInList(name);
    await pm.pipelineDestinations.clickRowEdit(name);
    await pm.pipelineDestinations.expectNameFieldDisabled();
    await pm.pipelineDestinations.fillUrl('https://example.com/v2');
    await pm.pipelineDestinations.clickSubmit();
    await pm.pipelineDestinations.expectToast(name);
    await pm.pipelineDestinations.expectRowInList(name);

    // Re-open to confirm the URL change persisted and the name is still locked.
    await pm.pipelineDestinations.clickRowEdit(name);
    await pm.pipelineDestinations.expectNameFieldDisabled();
    await pm.pipelineDestinations.expectUrlFieldValue('https://example.com/v2');

    await pm.apiCleanup.deletePipelineDestination(name);
  });

  // ============================================================================
  // P1 — Cancel / delete / bulk delete
  // ============================================================================

  test("Cancel from the add editor returns to the list and clears the action", {
    tag: ['@pipeline-destination-editor', '@enterprise', '@all']
  }, async ({ page }) => {
    await pm.pipelineDestinations.navigateToAddDestination();
    await pm.pipelineDestinations.expectEditorOpen('New Destination');
    await pm.pipelineDestinations.clickStep1Cancel();
    // Editor closed → list restored; add button visible, editor title hidden.
    await pm.pipelineDestinations.expectAddBtnVisible();
    await pm.pipelineDestinations.expectEditorTitleHidden();
  });

  test("Delete a single destination via the row button and confirm dialog", {
    tag: ['@pipeline-destination-editor', '@enterprise', '@all']
  }, async ({ page }) => {
    const name = uniqueName('destE2Edel');
    const seeded = await pm.apiCleanup.createPipelineDestination(name);
    expect(seeded.ok).toBeTruthy();

    await pm.pipelineDestinations.navigateToPipelineDestinationsByUrl();
    await pm.pipelineDestinations.expectRowInList(name);
    await pm.pipelineDestinations.clickRowDelete(name);
    await pm.pipelineDestinations.confirmDialog();
    await pm.pipelineDestinations.expectToast(name);
    await pm.pipelineDestinations.expectRowNotInList(name);
  });

  test("Bulk delete multiple destinations via multi-select", {
    tag: ['@pipeline-destination-editor', '@enterprise', '@all']
  }, async ({ page }) => {
    const name1 = uniqueName('destE2Ebulk1');
    const name2 = uniqueName('destE2Ebulk2');
    const s1 = await pm.apiCleanup.createPipelineDestination(name1);
    const s2 = await pm.apiCleanup.createPipelineDestination(name2);
    expect(s1.ok).toBeTruthy();
    expect(s2.ok).toBeTruthy();

    await pm.pipelineDestinations.navigateToPipelineDestinationsByUrl();
    await pm.pipelineDestinations.expectRowInList(name1);
    await pm.pipelineDestinations.expectRowInList(name2);
    await pm.pipelineDestinations.selectRowCheckbox(name1);
    await pm.pipelineDestinations.selectRowCheckbox(name2);
    await pm.pipelineDestinations.expectBulkDeleteBtnVisible();
    await pm.pipelineDestinations.clickBulkDelete();
    await pm.pipelineDestinations.confirmDialog();
    await pm.pipelineDestinations.expectToast('deleted successfully');
    await pm.pipelineDestinations.expectRowNotInList(name1);
    await pm.pipelineDestinations.expectRowNotInList(name2);
  });

  // ============================================================================
  // P1 — Form validation
  // ============================================================================

  test("Form validation blocks submit on required fields and a trailing-slash URL", {
    tag: ['@pipeline-destination-editor', '@enterprise', '@all']
  }, async ({ page }) => {
    await pm.pipelineDestinations.navigateToAddDestination();
    await pm.pipelineDestinations.selectDestinationType('openobserve');
    await pm.pipelineDestinations.clickStep1Continue();

    // Submit with empty name/url → field errors render, editor stays open.
    await pm.pipelineDestinations.clickSubmit();
    await pm.pipelineDestinations.expectNameErrorVisible();
    await pm.pipelineDestinations.expectUrlErrorVisible();
    await pm.pipelineDestinations.expectNameFieldVisible();

    // Fill name + trailing-slash URL → the url trailing-slash rule fires.
    await pm.pipelineDestinations.fillName(uniqueName('destE2Efv'));
    await pm.pipelineDestinations.fillUrl('https://example.com/');
    await pm.pipelineDestinations.clickSubmit();
    await pm.pipelineDestinations.expectUrlErrorContaining('trailing slash');
  });

  // ============================================================================
  // P2 — Conditional fields
  // ============================================================================

  test("Custom type shows the HTTP method select and enables the endpoint input", {
    tag: ['@pipeline-destination-editor', '@enterprise', '@all']
  }, async ({ page }) => {
    await pm.pipelineDestinations.navigateToAddDestination();
    await pm.pipelineDestinations.selectDestinationType('custom');
    await pm.pipelineDestinations.clickStep1Continue();
    await pm.pipelineDestinations.expectMethodSelectVisible();
    await pm.pipelineDestinations.expectEndpointFieldEnabled();
  });
});
