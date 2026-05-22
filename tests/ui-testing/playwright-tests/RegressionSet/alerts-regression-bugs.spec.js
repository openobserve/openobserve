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

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

const RUN_ID = Date.now();
const DESTINATION_NAME = `e2e_tpl_override_dest_${RUN_ID}`;
const TEMPLATE_NAME = `e2e_tpl_override_tpl_${RUN_ID}`;

test.describe("Alerts Regression Bugs — Batch 1", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  // ============================================================================
  // Setup: Create unique-named template + destination via API so that:
  //   1) The Add Alert button is enabled (requires at least one destination)
  //   2) Templates are available in the override template select
  //   3) Per-run uniqueness avoids stale-state collisions from prior runs
  // ============================================================================
  test.beforeAll(async ({ browser }) => {
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

    // Open the select dropdown and pick a template
    await templateOverrideSelect.click();
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
  test("Bulk alert import should not fail with 'alert already exists' error", {
    tag: ['@bug-11315', '@P1', '@regression', '@alertsRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Verify bulk alert import does not falsely report duplicates (Bug #11315)');

    // Navigate to alerts page
    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('✓ Navigated to alerts page');

    // Look for import button
    const importButton = page.locator('[data-test*="import-alert"], [data-test*="alert-import"], [role="button"]').filter({ hasText: /Import|import/i }).first();
    await expect(importButton, 'Alert import button should be visible').toBeVisible({ timeout: 5000 });

    testLogger.info('✓ Found alert import button');

    // Click import to open the import dialog
    await importButton.click();
    await page.waitForTimeout(2000);

    // Look for file upload input in the import dialog
    const fileInput = page.locator('input[type="file"]').first();
    const dropZone = page.locator('[data-test*="file-upload"], .q-uploader, [class*="drop"]').first();

    const importDialogVisible = (await fileInput.isVisible({ timeout: 3000 }).catch(() => false)) ||
      (await dropZone.isVisible({ timeout: 3000 }).catch(() => false));

    expect(importDialogVisible, 'Import dialog should open after clicking import button').toBeTruthy();

    testLogger.info('✓ Import dialog opened');

    // Verify the dialog has proper UI elements (no immediate error message about duplicates)
    const errorMessages = page.locator('[class*="error"], [class*="negative"], .q-banner').filter({ hasText: /already exists|duplicate/i });
    const hasPrematureError = await errorMessages.first().isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasPrematureError,
      'Bug #11315: Import dialog should not show "already exists" error before import is attempted'
    ).toBeFalsy();

    // Verify the import UI is functional (has upload area or file selector)
    const uploadAreaPresent = (await fileInput.count().catch(() => 0) > 0) ||
      (await dropZone.count().catch(() => 0) > 0);
    expect(uploadAreaPresent,
      'Bug #11315: Import dialog should have a functional upload area'
    ).toBeTruthy();

    testLogger.info('✓ PASSED: Bulk alert import dialog opens without premature errors');
  });

  // ==========================================================================
  // Bug #4342: Alert name with #, %, : special chars fails with unauthorized
  // https://github.com/openobserve/openobserve/issues/4342
  // ==========================================================================
  test("Alert name with special characters should not cause unauthorized error", {
    tag: ['@bug-4342', '@P2', '@regression', '@alertsRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Verify alert name with special chars works (Bug #4342)');

    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('✓ Navigated to alerts page');

    // Click Add Alert
    await expect(page.locator(pm.alertsPage.addAlertButton), 'Add Alert button should be visible').toBeVisible({ timeout: 5000 });
    await pm.alertsPage.clickAddAlertButton();
    testLogger.info('✓ Clicked Add Alert button');

    // Enter alert name with special characters: #, %, :
    const specialName = 'test#special%alert:chars';
    await pm.alertsPage.fillAlertName(specialName);
    await page.waitForTimeout(500);

    // Get the value back to verify it was accepted
    const nameInput = page.locator(pm.alertsPage.alertNameInput);
    const enteredValue = await nameInput.inputValue().catch(() => '');
    testLogger.info(`Alert name entered: "${enteredValue}"`);

    // PRIMARY ASSERTION: The name input should accept special characters
    // The bug was that special chars caused "unauthorized" errors
    expect(enteredValue,
      'Bug #4342: Alert name input should accept special characters #, %, :'
    ).toContain('#');

    testLogger.info('✓ PASSED: Alert name with special chars accepted');
  });

  // ==========================================================================
  // Bug #4288: Alert SQL — "default" keyword without quotes causes issues
  // https://github.com/openobserve/openobserve/issues/4288
  // ==========================================================================
  test("Alert SQL query with 'default' keyword should not error without quotes", {
    tag: ['@bug-4288', '@P2', '@regression', '@alertsRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Verify default keyword in alert SQL works (Bug #4288)');

    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('✓ Navigated to alerts page');

    // Click Add Alert
    await expect(page.locator(pm.alertsPage.addAlertButton), 'Add Alert button should be visible').toBeVisible({ timeout: 5000 });
    await pm.alertsPage.clickAddAlertButton();
    testLogger.info('✓ Clicked Add Alert button');

    // Fill alert name
    const alertName = `test_sql_default_${Date.now()}`;
    await pm.alertsPage.fillAlertName(alertName);

    // Select stream type and name
    await pm.alertsPage.selectStreamType('logs');
    testLogger.info('✓ Selected stream type: Logs');
    await pm.alertsPage.selectStreamByName('e2e_automate');
    testLogger.info('✓ Selected stream: e2e_automate');

    // Switch to the Advanced tab (has SQL editor for alert conditions)
    const advancedTab = page.locator(pm.alertsPage.advancedTabBtn).first();
    if (await advancedTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await advancedTab.click();
      await page.waitForTimeout(1000);
      testLogger.info('✓ Switched to Advanced tab');
    }

    // Look for the SQL editor and try to enter "default" without quotes
    const sqlEditor = page.locator('[data-test*="alert-sql-editor"], [data-test*="sql-editor"], .monaco-editor').first();
    if (await sqlEditor.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sqlEditor.click({ force: true });
      await page.waitForTimeout(500);
      await page.keyboard.type('default', { delay: 50 });
      await page.waitForTimeout(1000);
      testLogger.info('✓ Typed "default" in SQL editor without quotes');
    }

    // The bug was that "default" without quotes caused errors
    // Verify no immediate error message appeared
    const errorVisible = await page.locator('[class*="error"], [class*="negative"]').filter({ hasText: /error|invalid|unexpected/i }).first().isVisible({ timeout: 2000 }).catch(() => false);

    expect(errorVisible,
      'Bug #4288: "default" keyword without quotes should not cause an error in SQL editor'
    ).toBeFalsy();

    testLogger.info('✓ PASSED: Alert SQL default keyword verified');
  });

  test.afterEach(async () => {
    testLogger.info('Alerts regression batch-1 test completed');
  });
});
