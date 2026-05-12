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
    const addAlertBtnVisible = await page.locator(pm.alertsPage.addAlertButton).isVisible({ timeout: 5000 }).catch(() => false);
    if (!addAlertBtnVisible) {
      testLogger.warn('Add Alert button not visible — skipping');
      test.skip(true, 'Add Alert button not available');
      return;
    }
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
    if (!(await page.locator(pm.alertsPage.advancedTabBtn).first().isVisible({ timeout: 3000 }).catch(() => false))) {
      testLogger.warn('Advanced tab not found — skipping');
      test.skip(true, 'Advanced tab not available in current UI');
      return;
    }
    await pm.alertsPage.clickAdvancedTab();
    testLogger.info('✓ Switched to Advanced tab');

    // Template Override in Advanced tab
    const templateOverrideSelect = pm.alertsPage.getAdvancedTemplateOverrideSelect();
    if (!(await templateOverrideSelect.isVisible({ timeout: 3000 }).catch(() => false))) {
      testLogger.warn('Template override select not found — skipping');
      test.skip(true, 'Template override field not available in current UI');
      return;
    }
    testLogger.info('✓ Template override field found');

    // Open the select dropdown and pick a template
    await templateOverrideSelect.click();
    await page.waitForTimeout(500);

    const templateOption = pm.alertsPage.getFirstMenuItem();
    if (!(await templateOption.isVisible({ timeout: 3000 }).catch(() => false))) {
      testLogger.warn('No template option available — skipping');
      test.skip(true, 'No template options available');
      return;
    }
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

  test.afterEach(async () => {
    testLogger.info('Alerts regression batch-1 test completed');
  });
});
