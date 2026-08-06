const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * Alert Template Mode Tab Roundtrip
 *
 * Covers the mode-tab switching behavior in the AddTemplate editor:
 *  - Custom→Content→Custom roundtrip preserves raw body (no data loss)
 *  - Legacy banner migration path
 *  - Clone-mode kind preservation
 *  - Seeded-template starter payload edge case
 *  - Type toggle (HTTP/Email) in custom mode
 *  - Content→Custom serialization (starter vs user-modified)
 *  - Cancel discards, name readonly in edit
 *
 * Naming Convention: Uses 'auto_' prefix for cleanup compatibility.
 * Cleanup: Handled by cleanup.spec.js via 'auto_' prefix patterns.
 */
test.describe("Alert Template Mode Tab Roundtrip testcases", () => {
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
  // P0 — Critical Path: core roundtrip guarantee
  // ============================================================================

  test("P0.1: Custom→Content→Custom Roundtrip Preserves Body", {
    tag: ['@alertTemplateRoundtrip', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P0.1: Verify custom→content→custom roundtrip preserves raw body ===');

    const suffix = Date.now().toString().slice(-6);
    const templateName = `auto_roundtrip_custom_${suffix}`;
    const originalBody = `{"text": "Roundtrip test: {alert_name} fired on {stream_name}. URL: {alert_url}"}`;

    // Create a custom-kind template via API with a known body
    const created = await pm.alertTemplatesPage.createTemplateViaApi(templateName, originalBody);
    expect(created).toBe(true);
    testLogger.info('Custom template created via API', { templateName });

    // Navigate to templates list and edit the template
    await pm.alertTemplatesPage.navigateToTemplatesPage();
    await pm.alertTemplatesPage.clickEditButton(templateName);
    testLogger.info('Opened custom template in edit mode');

    // Assert editor opens in Custom mode
    await pm.alertTemplatesPage.expectCustomEditorVisible();
    await pm.alertTemplatesPage.expectContentFormNotVisible();

    // Read the original body text from the Monaco editor
    const bodyBeforeRoundtrip = await pm.alertTemplatesPage.getCustomModeBodyText();
    testLogger.info('Read body before roundtrip', { length: bodyBeforeRoundtrip.length });

    // Switch to Content mode tab
    await pm.alertTemplatesPage.switchToContentModeTab();

    // Assert Content form is now visible and Monaco is hidden
    await pm.alertTemplatesPage.expectContentFormVisible();
    await pm.alertTemplatesPage.expectCustomEditorNotVisible();

    // Switch back to Custom mode tab
    await pm.alertTemplatesPage.switchToCustomModeTab();

    // Assert Monaco editor is visible again
    await pm.alertTemplatesPage.expectCustomEditorVisible();

    // Read the body again — must match original exactly (no data loss)
    const bodyAfterRoundtrip = await pm.alertTemplatesPage.getCustomModeBodyText();
    testLogger.info('Read body after roundtrip', { length: bodyAfterRoundtrip.length });

    expect(bodyAfterRoundtrip).toBe(bodyBeforeRoundtrip);
    testLogger.info('✓ Custom→Content→Custom roundtrip preserved body text exactly');

    // Cleanup
    await pm.alertTemplatesPage.clickTemplateCancelBtn();
    await pm.alertTemplatesPage.deleteTemplateViaApi(templateName);
  });

  test("P0.2: Edit Custom Template → Save in Custom Mode → Kind = 'custom'", {
    tag: ['@alertTemplateRoundtrip', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info("=== P0.2: Verify save in custom mode preserves kind='custom' ===");

    const suffix = Date.now().toString().slice(-6);
    const templateName = `auto_roundtrip_save_${suffix}`;
    const originalBody = `{"text": "Pre-save body for {alert_name} — suffix ${suffix}"}`;

    // Create a custom-kind template via API
    const created = await pm.alertTemplatesPage.createTemplateViaApi(templateName, originalBody);
    expect(created).toBe(true);
    testLogger.info('Custom template created via API', { templateName });

    // Edit the template
    await pm.alertTemplatesPage.navigateToTemplatesPage();
    await pm.alertTemplatesPage.clickEditButton(templateName);
    testLogger.info('Opened custom template in edit mode');

    // Assert editor opens in Custom mode
    await pm.alertTemplatesPage.expectCustomEditorVisible();

    // Modify the body slightly
    const modifiedBody = `{"text": "Modified body for {alert_name} — suffix ${suffix}", "priority": "high"}`;
    await pm.alertTemplatesPage.fillTemplateBody(modifiedBody);
    testLogger.info('Modified template body');

    // Save
    await pm.alertTemplatesPage.clickTemplateSubmitBtn();
    await pm.alertTemplatesPage.expectTemplateSaveSuccessToast();
    testLogger.info('Template saved successfully');

    // Verify via API that kind is "custom"
    const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
    const org = process.env.ORGNAME || 'default';
    const response = await page.request.get(`${baseUrl}/api/${org}/alerts/templates`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    const list = Array.isArray(data) ? data : (data.list || []);
    const saved = list.find((t) => t.name === templateName);
    expect(saved).toBeTruthy();
    expect(saved.kind).toBe('custom');
    testLogger.info('✓ Verified template kind is custom after save', { kind: saved.kind });

    // Cleanup
    await pm.alertTemplatesPage.deleteTemplateViaApi(templateName);
  });

  // ============================================================================
  // P1 — Important Variations
  // ============================================================================

  test("P1.1: Legacy Banner + 'Start Content Version' Converts Custom → Content", {
    tag: ['@alertTemplateRoundtrip', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info("=== P1.1: Verify legacy banner migration path ===");

    const suffix = Date.now().toString().slice(-6);
    const templateName = `auto_roundtrip_legacy_${suffix}`;
    const originalBody = `{"text": "{alert_name} triggered at {timestamp} with value {alert_agg_value}"}`;

    // Create a custom-kind template via API
    const created = await pm.alertTemplatesPage.createTemplateViaApi(templateName, originalBody);
    expect(created).toBe(true);
    testLogger.info('Custom template created via API', { templateName });

    // Edit the template
    await pm.alertTemplatesPage.navigateToTemplatesPage();
    await pm.alertTemplatesPage.clickEditButton(templateName);
    testLogger.info('Opened custom template in edit mode');

    // Assert editor opens in Custom mode
    await pm.alertTemplatesPage.expectCustomEditorVisible();

    // Assert legacy banner is visible (editing existing custom template)
    await pm.alertTemplatesPage.expectLegacyBannerVisible();
    testLogger.info('Legacy banner is visible');

    // Read original body for later comparison
    const bodyBeforeMigration = await pm.alertTemplatesPage.getCustomModeBodyText();

    // Click "Start content version" button
    await pm.alertTemplatesPage.clickStartContentVersionBtn();
    testLogger.info('Clicked Start Content Version');

    // Assert editor switches to Content mode
    await pm.alertTemplatesPage.expectContentFormVisible();
    await pm.alertTemplatesPage.expectCustomEditorNotVisible();

    // Assert legacy banner is now hidden (only for custom mode)
    await pm.alertTemplatesPage.expectLegacyBannerNotVisible();
    testLogger.info('Legacy banner hidden after migration');

    // Switch back to Custom mode — verify original body is restored from stash
    await pm.alertTemplatesPage.switchToCustomModeTab();
    await pm.alertTemplatesPage.expectCustomEditorVisible();

    const bodyAfterMigration = await pm.alertTemplatesPage.getCustomModeBodyText();
    expect(bodyAfterMigration).toBe(bodyBeforeMigration);
    testLogger.info('✓ Legacy migration preserved original body in stash');

    // Cleanup
    await pm.alertTemplatesPage.clickTemplateCancelBtn();
    await pm.alertTemplatesPage.deleteTemplateViaApi(templateName);
  });

  test("P1.2: Clone Custom Template Preserves Kind → Opens in Custom Mode", {
    tag: ['@alertTemplateRoundtrip', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P1.2: Verify clone preserves kind and opens in custom mode ===');

    const suffix = Date.now().toString().slice(-6);
    const srcName = `auto_roundtrip_clone_src_${suffix}`;
    const sourceBody = `{"text": "Source template for clone test — {alert_name}"}`;

    // Create a custom-kind template via API
    const created = await pm.alertTemplatesPage.createTemplateViaApi(srcName, sourceBody);
    expect(created).toBe(true);
    testLogger.info('Source template created via API', { srcName });

    // Clone the template
    await pm.alertTemplatesPage.navigateToTemplatesPage();
    await pm.alertTemplatesPage.clickCloneButton(srcName);
    testLogger.info('Clicked clone button for', { srcName });

    // Assert title contains "Clone template"
    await pm.alertTemplatesPage.expectAddTemplateTitleContains('Clone template');
    testLogger.info('Title shows Clone template');

    // Assert editor opens in Custom mode (kind preserved from custom source)
    await pm.alertTemplatesPage.expectCustomEditorVisible();
    await pm.alertTemplatesPage.expectContentFormNotVisible();
    testLogger.info('Clone opened in Custom mode (kind preserved)');

    // Assert name input is editable and pre-filled with Copy_of_<original>
    const expectedCloneName = `Copy_of_${srcName}`;
    await pm.alertTemplatesPage.expectTemplateNameInputValue(expectedCloneName);
    testLogger.info('Clone name pre-filled correctly', { expectedCloneName });

    // Assert the body text matches the source template's body
    const cloneBody = await pm.alertTemplatesPage.getCustomModeBodyText();
    expect(cloneBody).toBe(sourceBody);
    testLogger.info('✓ Clone body matches source template body');

    // Save the clone to create the new template
    await pm.alertTemplatesPage.clickTemplateSubmitBtn();
    await pm.alertTemplatesPage.expectTemplateSaveSuccessToast();
    testLogger.info('Clone saved successfully');

    // Verify both templates exist via API
    const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
    const org = process.env.ORGNAME || 'default';
    const response = await page.request.get(`${baseUrl}/api/${org}/alerts/templates`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    const list = Array.isArray(data) ? data : (data.list || []);
    const srcExists = list.some((t) => t.name === srcName);
    const cloneExists = list.some((t) => t.name === expectedCloneName);
    expect(srcExists).toBe(true);
    expect(cloneExists).toBe(true);
    testLogger.info('✓ Both source and clone templates exist');

    // Cleanup both
    await pm.alertTemplatesPage.deleteTemplateViaApi(srcName);
    await pm.alertTemplatesPage.deleteTemplateViaApi(expectedCloneName);
  });

  test("P1.3: New Template Content→Custom Gets RAW_PAYLOAD_STARTER (Slack Example)", {
    tag: ['@alertTemplateRoundtrip', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P1.3: Verify new template gets RAW_PAYLOAD_STARTER on switch to Custom ===');

    // Click "Add Template" → opens in Content mode by default
    await pm.alertTemplatesPage.clickAddTemplateBtn();
    testLogger.info('Clicked Add Template button');

    // Assert editor is in Content mode
    await pm.alertTemplatesPage.expectContentFormVisible();
    testLogger.info('Editor opened in Content mode (default)');

    // Switch to Custom mode (no prior content modification — it's still the seeded starter)
    await pm.alertTemplatesPage.switchToCustomModeTab();
    await pm.alertTemplatesPage.expectCustomEditorVisible();

    // Read the body text — should be the Slack RAW_PAYLOAD_STARTER, not serialized ContentSpec
    const bodyText = await pm.alertTemplatesPage.getCustomModeBodyText();
    testLogger.info('Read body after switching to Custom from seeded template', { length: bodyText.length });

    // RAW_PAYLOAD_STARTER is a Slack example JSON containing "blocks" and Slack-specific fields
    const parsed = JSON.parse(bodyText);
    // The starter should contain Slack blocks array
    expect(parsed).toBeTruthy();
    // Verify it's a Slack-compatible payload (blocks or text field)
    const hasSlackStructure = parsed.blocks !== undefined || (parsed.text && typeof parsed.text === 'string');
    expect(hasSlackStructure).toBe(true);
    testLogger.info('✓ Body is RAW_PAYLOAD_STARTER (Slack example), not serialized ContentSpec');

    // Dismiss the form
    await pm.alertTemplatesPage.clickTemplateCancelBtn();
  });

  test("P1.4: Type Toggle (HTTP ↔ Email) in Custom Mode Shows/Hides Email Title Input", {
    tag: ['@alertTemplateRoundtrip', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P1.4: Verify type toggle shows/hides email title input ===');

    // Start fresh: Add Template then switch to Custom mode
    await pm.alertTemplatesPage.clickAddTemplateBtn();
    await pm.alertTemplatesPage.switchToCustomModeTab();
    testLogger.info('Editor in Custom mode');

    // Default type is "http" — email title input should NOT be visible
    await pm.alertTemplatesPage.expectEmailTitleInputNotVisible();
    testLogger.info('Email title input is hidden for HTTP type');

    // Switch to Email type
    await pm.alertTemplatesPage.switchToEmailTypeTab();
    testLogger.info('Switched to Email type');

    // Assert email title input IS visible
    await pm.alertTemplatesPage.expectEmailTitleInputVisible();
    testLogger.info('Email title input appeared for Email type');

    // Switch back to HTTP type
    await pm.alertTemplatesPage.switchToHttpTypeTab();
    testLogger.info('Switched back to HTTP type');

    // Assert email title input is hidden again
    await pm.alertTemplatesPage.expectEmailTitleInputNotVisible();
    testLogger.info('✓ Email title input hidden again for HTTP type');

    // Dismiss the form
    await pm.alertTemplatesPage.clickTemplateCancelBtn();
  });

  // ============================================================================
  // P2 — Edge Cases
  // ============================================================================

  test("P2.1: Content Mode Body Modified → Custom Gets Serialized Spec (Not Starter)", {
    tag: ['@alertTemplateRoundtrip', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P2.1: Verify modified content spec serializes, not starter ===');

    // Click "Add Template" → opens in Content mode with seeded starter
    await pm.alertTemplatesPage.clickAddTemplateBtn();
    await pm.alertTemplatesPage.expectContentFormVisible();
    testLogger.info('Editor in Content mode');

    // Modify the content title field
    await pm.alertTemplatesPage.fillContentTitleInput('Custom Title P2.1');
    testLogger.info('Modified content title');

    // Modify the content body markdown editor
    await pm.alertTemplatesPage.fillContentBodyEditor('Hello World from P2.1 test');
    testLogger.info('Modified content body');

    // Switch to Custom mode
    await pm.alertTemplatesPage.switchToCustomModeTab();
    await pm.alertTemplatesPage.expectCustomEditorVisible();

    // Read the body text — should be serialized ContentSpec JSON, NOT RAW_PAYLOAD_STARTER
    const bodyText = await pm.alertTemplatesPage.getCustomModeBodyText();
    testLogger.info('Read body after switch to Custom from modified content', { length: bodyText.length });

    // Parse as JSON and verify it contains our modifications
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch (e) {
      // The body might not be valid JSON (e.g., if it's a markdown body in email mode)
      // In that case, assert it contains our text
      testLogger.info('Body is not valid JSON — checking for text content');
      expect(bodyText).toContain('Custom Title P2.1');
      expect(bodyText).toContain('Hello World from P2.1 test');
      testLogger.info('✓ Body contains modified title and body text');
      await pm.alertTemplatesPage.clickTemplateCancelBtn();
      return;
    }

    // If it's valid JSON, verify it contains our content
    const bodyStr = JSON.stringify(parsed);
    expect(bodyStr).toContain('Custom Title P2.1');
    expect(bodyStr).toContain('Hello World from P2.1 test');
    testLogger.info('✓ Body is serialized ContentSpec containing modified content, not starter');

    // Dismiss the form
    await pm.alertTemplatesPage.clickTemplateCancelBtn();
  });

  test("P2.2: Cancel Button Discards Unsaved Changes and Returns to List", {
    tag: ['@alertTemplateRoundtrip', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P2.2: Verify cancel discards unsaved changes ===');

    const suffix = Date.now().toString().slice(-6);
    const templateName = `auto_roundtrip_cancel_${suffix}`;
    const originalBody = `{"text": "Original body for cancel test — {alert_name}"}`;

    // Create a custom template
    const created = await pm.alertTemplatesPage.createTemplateViaApi(templateName, originalBody);
    expect(created).toBe(true);
    testLogger.info('Template created via API', { templateName });

    // Edit the template
    await pm.alertTemplatesPage.navigateToTemplatesPage();
    await pm.alertTemplatesPage.clickEditButton(templateName);
    testLogger.info('Opened template in edit mode');

    // Modify the body
    const modifiedBody = `{"text": "This change should be DISCARDED — {alert_name}"}`;
    await pm.alertTemplatesPage.fillTemplateBody(modifiedBody);
    testLogger.info('Modified template body');

    // Click Cancel — should dismiss editor without saving
    await pm.alertTemplatesPage.clickTemplateCancelBtn();
    testLogger.info('Clicked Cancel button');

    // Assert we're back at the templates list page
    await pm.alertTemplatesPage.expectAddTemplateBtnVisible();
    testLogger.info('Template list page is visible (editor dismissed)');

    // Verify via API that the body was NOT changed (cancel discarded edits)
    const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
    const org = process.env.ORGNAME || 'default';
    const response = await page.request.get(`${baseUrl}/api/${org}/alerts/templates`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    const list = Array.isArray(data) ? data : (data.list || []);
    const tmpl = list.find((t) => t.name === templateName);
    expect(tmpl).toBeTruthy();
    // The body should still be the original (cancel discarded the modification)
    expect(tmpl.body).toBe(originalBody);
    testLogger.info('✓ Cancel discarded unsaved changes — original body preserved');

    // Cleanup
    await pm.alertTemplatesPage.deleteTemplateViaApi(templateName);
  });

  test("P2.3: Name Readonly in Edit Mode", {
    tag: ['@alertTemplateRoundtrip', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('=== P2.3: Verify name input is readonly in edit mode ===');

    const suffix = Date.now().toString().slice(-6);
    const templateName = `auto_roundtrip_readonly_${suffix}`;
    const templateBody = `{"text": "Readonly test template — {alert_name}"}`;

    // Create a template via API
    const created = await pm.alertTemplatesPage.createTemplateViaApi(templateName, templateBody);
    expect(created).toBe(true);
    testLogger.info('Template created via API', { templateName });

    // Edit the template
    await pm.alertTemplatesPage.navigateToTemplatesPage();
    await pm.alertTemplatesPage.clickEditButton(templateName);
    testLogger.info('Opened template in edit mode');

    // Assert the name input has the readonly attribute
    await pm.alertTemplatesPage.expectTemplateNameInputReadonly();
    testLogger.info('Name input has readonly attribute');

    // Assert the name input contains the template name
    await pm.alertTemplatesPage.expectTemplateNameInputValue(templateName);
    testLogger.info('Name input contains correct template name');

    // Assert the title says "Update template"
    await pm.alertTemplatesPage.expectAddTemplateTitleContains('Update template');
    testLogger.info('✓ Title says Update template, name is readonly');

    // Cleanup
    await pm.alertTemplatesPage.clickTemplateCancelBtn();
    await pm.alertTemplatesPage.deleteTemplateViaApi(templateName);
  });
});
