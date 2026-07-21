/**
 * Alerts Regression Bugs — Batch 1
 *
 * Covers: #10110
 *
 * Tests run in PARALLEL.
 *
 * Note: The v3 alert creation UI is a single-page layout with two tabs
 * (Alert Rules, Advanced), NOT a multi-step wizard. Template Override
 * is in the Advanced tab; the preview chart appears automatically in
 * the right panel when stream type + name are selected.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

let DESTINATION_NAME;
let TEMPLATE_NAME;

test.describe("Alerts Regression Bugs — Batch 1", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  // ============================================================================
  // Setup: Create unique-named template + destination via API so that:
  //   1) The Add Alert button is enabled (requires at least one destination)
  //   2) Templates are available in the override template select
  //   3) Date.now() + Math.random() avoids parallel-worker collisions
  // ============================================================================
  test.beforeAll(async ({ browser }) => {
    const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    DESTINATION_NAME = `e2e_tpl_override_dest_${RUN_ID}`;
    TEMPLATE_NAME = `e2e_tpl_override_tpl_${RUN_ID}`;

    testLogger.info('Setting up prerequisites for template override test (beforeAll)');

    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();

    try {
      await page.goto(
        `${process.env.ZO_BASE_URL || 'http://localhost:5080'}?org_identifier=${getOrgIdentifier() || 'default'}`,
      );
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
      const org = getOrgIdentifier() || 'default';
      const authToken = Buffer.from(
        `${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`
      ).toString('base64');

      // Create template via API
      const templatePayload = {
        name: TEMPLATE_NAME,
        body: JSON.stringify({ text: 'Alert: {alert_name}' }),
        isDefault: false,
      };

      const tplResp = await page.evaluate(
        async ({ baseUrl, org, authToken, templatePayload }) => {
          const r = await fetch(`${baseUrl}/api/${org}/alerts/templates`, {
            method: 'POST',
            headers: {
              Authorization: `Basic ${authToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(templatePayload),
          });
          return { status: r.status };
        },
        { baseUrl, org, authToken, templatePayload },
      );
      expect(tplResp.status, `Template creation should succeed (got ${tplResp.status})`).toBeLessThan(400);
      testLogger.info('Template created', { templateName: TEMPLATE_NAME, status: tplResp.status });

      // Create destination via API (references the template)
      const destPayload = {
        name: DESTINATION_NAME,
        url: 'https://httpbin.org/post',
        method: 'post',
        skip_tls_verify: false,
        template: TEMPLATE_NAME,
        headers: {},
      };

      const destResp = await page.evaluate(
        async ({ baseUrl, org, authToken, destPayload }) => {
          const r = await fetch(`${baseUrl}/api/${org}/alerts/destinations`, {
            method: 'POST',
            headers: {
              Authorization: `Basic ${authToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(destPayload),
          });
          return { status: r.status };
        },
        { baseUrl, org, authToken, destPayload },
      );
      expect(destResp.status, `Destination creation should succeed (got ${destResp.status})`).toBeLessThan(400);
      testLogger.info('Destination created', { destinationName: DESTINATION_NAME, status: destResp.status });

      testLogger.info('Prerequisites setup completed');
    } finally {
      await page.close();
      await context.close();
    }
  });

  // ============================================================================
  // Cleanup: Delete destination + template via API (avoids UI navigation and
  // stale state leaking across runs). Delete destination first to handle any
  // reference cascade, then the template.
  // ============================================================================
  test.afterAll(async ({ browser }) => {
    testLogger.info('Cleaning up test prerequisites (afterAll)');

    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();

    try {
      // Navigate to base URL first so page.evaluate fetch calls have auth/CORS context
      await page.goto(
        `${process.env.ZO_BASE_URL || 'http://localhost:5080'}?org_identifier=${getOrgIdentifier() || 'default'}`,
      );
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
      const org = getOrgIdentifier() || 'default';
      const authToken = Buffer.from(
        `${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`
      ).toString('base64');

      // Delete destination via API
      const delDestResp = await page.evaluate(
        async ({ url, authToken }) => {
          const r = await fetch(url, { method: 'DELETE', headers: { Authorization: `Basic ${authToken}` } });
          return { status: r.status, body: await r.text().catch(() => '') };
        },
        { url: `${baseUrl}/api/${org}/alerts/destinations/${DESTINATION_NAME}`, authToken },
      );
      testLogger.info('Destination cleanup', { destinationName: DESTINATION_NAME, status: delDestResp.status });

      // Delete template via API
      const delTplResp = await page.evaluate(
        async ({ url, authToken }) => {
          const r = await fetch(url, { method: 'DELETE', headers: { Authorization: `Basic ${authToken}` } });
          return { status: r.status, body: await r.text().catch(() => '') };
        },
        { url: `${baseUrl}/api/${org}/alerts/templates/${TEMPLATE_NAME}`, authToken },
      );
      testLogger.info('Template cleanup', { templateName: TEMPLATE_NAME, status: delTplResp.status });
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Alerts regression batch-1 setup completed');
  });

  // ==========================================================================
  // Bug #10110: On adding a template in the override template option on
  //             alerts UI, it is shown twice in the input field
  // https://github.com/openobserve/openobserve/issues/10110
  // ==========================================================================
  test("Template should not appear twice in override template input", {
    tag: ['@bug-10110', '@P1', '@regression', '@alertsRegression', '@alertsRegressionTemplateOverride']
  }, async ({ page }) => {
    testLogger.info('Test: Verify template not duplicated in override input (Bug #10110)');

    // Navigate to alerts page
    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('✓ Navigated to alerts page');

    // Click "Add Alert" button (should be enabled now that beforeAll created a destination)
    await expect(page.locator(pm.alertsPage.addAlertButton), 'Add Alert button should be visible').toBeVisible({ timeout: 5000 });
    await pm.alertsPage.clickAddAlertButton();
    testLogger.info('✓ Clicked Add Alert button');

    // Fill alert name
    const uniqueId = Date.now();
    const alertName = `test_alert_override_${uniqueId}`;
    await pm.alertsPage.fillAlertName(alertName);

    // Select stream type first (enables stream name dropdown)
    await pm.alertsPage.selectStreamType('logs');
    testLogger.info('✓ Selected stream type: Logs');

    // Select stream name using page object (handles dropdown click, keyboard filter, selection)
    await pm.alertsPage.selectStreamByName('e2e_automate');
    testLogger.info('✓ Selected stream: e2e_automate');

    // Add a condition
    const addConditionBtn = page.locator(pm.alertsPage.addConditionButton);
    if (await addConditionBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addConditionBtn.click();
      testLogger.info('✓ Added condition');
    }

    // Switch to the Advanced tab
    await expect(page.locator(pm.alertsPage.advancedTabBtn).first(), 'Advanced tab should be visible').toBeVisible({ timeout: 3000 });
    await pm.alertsPage.clickAdvancedTab();
    testLogger.info('✓ Switched to Advanced tab');

    // Template Override in Advanced tab
    const templateOverrideSelect = pm.alertsPage.getAdvancedTemplateOverrideSelect();
    await expect(templateOverrideSelect, 'Template override select should be visible').toBeVisible({ timeout: 3000 });
    testLogger.info('✓ Template override field found');

    // Open the select dropdown and pick a template (page object clicks the OSelect trigger).
    await pm.alertsPage.openAdvancedTemplateOverrideSelect();
    await page.waitForTimeout(500);

    const templateOption = pm.alertsPage.getFirstMenuItem();
    await expect(templateOption, 'Template option should be available').toBeVisible({ timeout: 3000 });
    const templateText = await templateOption.textContent();
    await templateOption.click();
    testLogger.info(`✓ Selected template: ${templateText?.trim()}`);

    // Get the displayed value from the select
    const selectedText = await templateOverrideSelect.textContent().catch(() => '');
    testLogger.info(`Template override display text: "${selectedText?.trim()}"`);

    // Check for duplication — the same template name appearing twice
    const displayValue = selectedText?.trim();
    expect(displayValue,
      'Bug #10110: Template override must show a selected value'
    ).toBeTruthy();

    // Split and verify no repeats
    const parts = displayValue.split(/[,;\s]+/).filter(Boolean);
    const uniqueParts = [...new Set(parts)];

    testLogger.info(`Template parts: ${JSON.stringify(parts)}, unique: ${JSON.stringify(uniqueParts)}`);

    expect(parts.length,
      'Bug #10110: Template should not appear twice in override input'
    ).toBe(uniqueParts.length);

    testLogger.info('✓ PASSED: Template not duplicated in override input');
  });

  // ==========================================================================
  // Bug #11315: Bulk alert import failing saying alert already exists
  // https://github.com/openobserve/openobserve/issues/11315
  // ==========================================================================
  test("Alert import dialog should open without premature duplicate errors", {
    tag: ['@bug-11315', '@P1', '@regression', '@alertsRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Verify bulk alert import does not falsely report duplicates (Bug #11315)');

    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Navigated to alerts page');

    // Open the import dialog via POM locator
    const importButton = page.locator(pm.alertsPage.alertImportButton);
    await expect(importButton, 'Alert import button should be visible').toBeVisible({ timeout: 5000 });
    await importButton.click();
    await page.waitForTimeout(2000);
    testLogger.info('Clicked import button');

    // Verify import dialog opened: the "Import JSON file" tab should be visible
    const importFileTab = page.locator(pm.alertsPage.alertImportFileTab);
    await expect(importFileTab, 'Import dialog should open with file tab visible').toBeVisible({ timeout: 5000 });

    // Verify the file upload input is present
    const fileInput = page.locator(pm.alertsPage.alertImportJsonFileInputField);
    await expect(fileInput, 'Import dialog should have file upload input').toBeVisible({ timeout: 3000 });

    testLogger.info('Import dialog opened with upload functionality');

    // Bug verification: no premature "already exists" error before import
    const errorMessages = page.locator('[class*="error"], [class*="negative"]')
      .filter({ hasText: /already exists|duplicate/i });
    const hasPrematureError = await errorMessages.first().isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasPrematureError,
      'Bug #11315: Import dialog should not show "already exists" error before import'
    ).toBeFalsy();

    testLogger.info('PASSED: Bulk alert import dialog opens without premature errors');
  });

  // ==========================================================================
  // Bug #4342: Alert name with #, %, : special chars fails with unauthorized
  // https://github.com/openobserve/openobserve/issues/4342
  // ==========================================================================
  test("Alert name with special characters should be accepted", {
    tag: ['@bug-4342', '@P2', '@regression', '@alertsRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Verify alert name with special chars works (Bug #4342)');

    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Navigated to alerts page');

    await expect(page.locator(pm.alertsPage.addAlertButton), 'Add Alert button should be visible').toBeVisible({ timeout: 5000 });
    await pm.alertsPage.clickAddAlertButton();
    testLogger.info('Clicked Add Alert button');

    // Enter alert name with characters that triggered bug #4342: #, %, :
    const specialName = 'test#special%alert:chars';
    await pm.alertsPage.fillAlertName(specialName);
    await page.waitForTimeout(500);

    // Read back the value from the inner OInput field
    const nameInput = page.locator(pm.alertsPage.alertNameInputField);
    const enteredValue = await nameInput.inputValue().catch(() => '');
    testLogger.info(`Alert name entered: "${enteredValue}"`);

    expect(enteredValue, 'Bug #4342: name input should accept #').toContain('#');
    expect(enteredValue, 'Bug #4342: name input should accept %').toContain('%');
    expect(enteredValue, 'Bug #4342: name input should accept :').toContain(':');

    testLogger.info('PASSED: Alert name with special chars accepted');
  });

  // ==========================================================================
  // Bug #4288: Alert SQL — "default" keyword without quotes causes issues
  // https://github.com/openobserve/openobserve/issues/4288
  // ==========================================================================
  test("Alert SQL editor should accept 'default' keyword without quotes", {
    tag: ['@bug-4288', '@P2', '@regression', '@alertsRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Verify default keyword in alert SQL works (Bug #4288)');

    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Navigated to alerts page');

    await expect(page.locator(pm.alertsPage.addAlertButton), 'Add Alert button should be visible').toBeVisible({ timeout: 5000 });
    await pm.alertsPage.clickAddAlertButton();
    await pm.alertsPage.fillAlertName(`test_sql_default_${Date.now()}`);

    // Select stream type and name
    await pm.alertsPage.selectStreamType('logs');
    await pm.alertsPage.selectStreamByName('e2e_automate');
    testLogger.info('Selected stream: logs / e2e_automate');

    // Add a condition so the inline query editor renders
    const addConditionBtn = page.locator(pm.alertsPage.addConditionButton);
    await expect(addConditionBtn, 'Add Condition button should be visible').toBeVisible({ timeout: 5000 });
    await addConditionBtn.click();
    testLogger.info('Added condition');

    // Switch to SQL tab using POM selectors
    const sqlTab = page.locator(pm.alertsPage.queryTabsContainer).locator(pm.alertsPage.tabSql);
    await expect(sqlTab, 'SQL tab should be visible').toBeVisible({ timeout: 5000 });
    await sqlTab.click();
    await page.waitForTimeout(1000);
    testLogger.info('Switched to SQL tab');

    // Click into the inline Monaco editor (use .last() per alert creation wizard pattern)
    // then type via keyboard — same approach used by the POM wizard methods
    const sqlEditor = page.locator('.monaco-editor').last();
    await expect(sqlEditor, 'SQL editor should be visible').toBeVisible({ timeout: 5000 });
    await sqlEditor.click({ force: true });
    await page.waitForTimeout(500);

    // Use Monaco API to set editor content reliably.
    // Keyboard shortcuts (Cmd/Ctrl+A + type) are unreliable
    // with Monaco because the virtualised viewport, focus management,
    // and IME handling can swallow synthesized keystrokes.
    // Retry until Monaco editors are fully initialized (parallel test runs
    // may delay Monaco boot).
    await expect(async () => {
      const content = await page.evaluate(() => {
        const editors = window.monaco?.editor?.getEditors?.();
        if (editors && editors.length > 0) {
          const editor = editors[editors.length - 1];
          editor.setValue('SELECT * FROM default');
          return editor.getValue();
        }
        return null;
      });
      expect(content).toContain('default');
    }).toPass({ timeout: 10000, intervals: [1000] });
    await page.waitForTimeout(500);

    // Verify the rendered .view-lines contain "default"
    const linesText = await sqlEditor.locator('.view-lines').first().textContent().catch(() => '');
    testLogger.info(`Monaco view-lines content: "${linesText.substring(0, 100)}"`);

    expect(linesText,
      'Bug #4288: "default" keyword should be accepted in the SQL editor'
    ).toContain('default');

    // Verify no app-level error (check OToast error variant + ARIA alerts —
    // the app's actual error notification mechanisms, not Monaco syntax squiggles)
    const errorToastVisible = await page.locator(
      '[data-test-variant="error"], [role="alert"]'
    ).first().isVisible({ timeout: 2000 }).catch(() => false);

    expect(errorToastVisible,
      'Bug #4288: "default" keyword without quotes should not cause a UI error'
    ).toBeFalsy();

    testLogger.info('PASSED: Alert SQL default keyword verified');
  });

  test.afterEach(async () => {
    testLogger.info('Alerts regression batch-1 test completed');
  });
});
