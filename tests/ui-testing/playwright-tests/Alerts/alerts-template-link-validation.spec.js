const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

// ---------------------------------------------------------------------------
// E2E: Alert Template Link URL Validation
//
// Validates that the alert template editor's "Links" section (content mode)
// enforces URL scheme allowlisting (http, https, mailto), rejects dangerous
// schemes (javascript:, file:, data:), accepts template variables and relative
// paths, and blocks save when any link URL is invalid. Covers both inline
// (per-field) validation and save-time toast-level blocking.
//
// Prerequisites:
//   - Authenticated user (handled by global-setup / navigateToBase)
//   - No streams, data, or destinations required (validation is client-side)
// ---------------------------------------------------------------------------

test.describe('Alert Template Link URL Validation', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate directly to alert templates (fastest, most reliable per setup contract)
    const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
    const org = process.env.ORGNAME || 'default';
    await page.goto(`${baseUrl}/web/alert-templates?org_identifier=${org}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Open the Add Template form
    await pm.alertsPage.getTemplateListAddBtn().click();

    // Wait for the add-template mode tabs to render
    const modeTabs = pm.alertsPage.getAddTemplateModeTabs();
    await expect(modeTabs).toBeVisible({ timeout: 10000 });

    // Open the "Add to this template" disclosable (starts CLOSED for new templates)
    const optionalDisclosure = pm.alertsPage.getContentTemplateOptionalCollapsible();
    if ((await optionalDisclosure.getAttribute('data-state')) !== 'open') {
      await optionalDisclosure.click();
      await page.waitForTimeout(300);
    }

    testLogger.info('Test setup completed — add-template form ready');
  });

  test.afterEach(async ({ page }, testInfo) => {
    // Clean up any template created during this test (if name was stored)
    if (pm._createdTemplateName) {
      await pm.alertTemplatesPage.deleteTemplateViaApi(pm._createdTemplateName).catch(() => {});
      testLogger.info('Cleaned up template', { name: pm._createdTemplateName });
    }
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // =========================================================================
  // P0 — Critical Path Scenarios
  // =========================================================================

  test('Valid URL — no inline error, save proceeds', {
    tag: ['@alerts-template-link-validation', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 1: Valid URL — expect no error and successful save');

    const tplName = `auto_tpl_linkval_${pm.alertsPage.generateRandomString()}`;
    pm._createdTemplateName = tplName;

    // Click "Add Link" to create the first link row
    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    // Fill label
    await pm.alertsPage.getContentTemplateLinkRow0LabelInputField().fill('Runbook');

    // Fill URL: valid https://
    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('https://example.com/runbook');

    // Assert: no inline error on the URL field
    const errorText = pm.alertsPage.getElementByText(/Unsupported URL scheme/i);
    await expect(errorText).not.toBeVisible({ timeout: 2000 });

    // Fill template name
    await pm.alertsPage.getAddTemplateNameInputField().fill(tplName);

    // Fill template title
    await pm.alertsPage.getContentTemplateTitleInputField().fill('Valid URL Test');

    // Enter minimal body text
    const bodyEditorLines = pm.alertsPage.getContentTemplateBodyEditorLines();
    await bodyEditorLines.waitFor({ state: 'visible', timeout: 10000 });
    await bodyEditorLines.click();
    const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await page.keyboard.press(selectAllKey);
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('Test body.');
    await page.waitForTimeout(500);

    // Click Save
    await pm.alertsPage.getAddTemplateSubmitBtn().click();
    await page.waitForTimeout(1000);

    // Assert: save success toast
    const successToast = pm.alertsPage.getElementByText('Template Saved Successfully.');
    await expect(successToast.first()).toBeVisible({ timeout: 10000 });

    testLogger.info('Scenario 1 completed — valid URL saved successfully');
  });

  test('Disallowed scheme — inline error + save block', {
    tag: ['@alerts-template-link-validation', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 2: Disallowed scheme — expect inline error and save toast block');

    const tplName = `auto_tpl_linkval_${pm.alertsPage.generateRandomString()}`;

    // Add a link row
    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    // Fill label
    await pm.alertsPage.getContentTemplateLinkRow0LabelInputField().fill('Bad Link');

    // Fill URL: javascript:alert(1)
    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('javascript:alert(1)');

    // Assert: inline error appears containing "Unsupported URL scheme"
    const inlineError = pm.alertsPage.getElementByText(/Unsupported URL scheme/i);
    await expect(inlineError.first()).toBeVisible({ timeout: 5000 });

    // Fill template name, title, body so save can be attempted
    await pm.alertsPage.getAddTemplateNameInputField().fill(tplName);
    await pm.alertsPage.getContentTemplateTitleInputField().fill('Bad Scheme Test');
    const bodyEditorLines = pm.alertsPage.getContentTemplateBodyEditorLines();
    await bodyEditorLines.waitFor({ state: 'visible', timeout: 10000 });
    await bodyEditorLines.click();
    const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await page.keyboard.press(selectAllKey);
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('Test body.');
    await page.waitForTimeout(500);

    // Click Save
    await pm.alertsPage.getAddTemplateSubmitBtn().click();
    await page.waitForTimeout(1000);

    // Assert: save-time toast error blocks the save
    const toastError = pm.alertsPage.getElementByText(/Unsupported URL scheme/i);
    // The toast should appear; the inline error may still be visible as well.
    // The key assertion: a toast-level block appeared (we don't need to distinguish
    // toast vs. inline — the presence of the error message after clicking save is enough,
    // and the template was NOT created because we didn't get a success toast).
    await expect(toastError.first()).toBeVisible({ timeout: 5000 });

    // Confirm NO success toast
    const successToast = pm.alertsPage.getElementByText('Template Saved Successfully.');
    await expect(successToast).not.toBeVisible({ timeout: 2000 });

    testLogger.info('Scenario 2 completed — bad scheme rejected inline and at save');
  });

  test('Template variable accepted — no error, save succeeds', {
    tag: ['@alerts-template-link-validation', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 3: Template variable — expect no error and successful save');

    const tplName = `auto_tpl_linkval_${pm.alertsPage.generateRandomString()}`;
    pm._createdTemplateName = tplName;

    // Add a link row
    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    // Fill label
    await pm.alertsPage.getContentTemplateLinkRow0LabelInputField().fill('Alert URL');

    // Fill URL: {alert_url} — a template variable
    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('{alert_url}');

    // Assert: no inline error
    const errorText = pm.alertsPage.getElementByText(/Unsupported URL scheme|Enter a valid URL/i);
    await expect(errorText.first()).not.toBeVisible({ timeout: 3000 });

    // Fill template name, title, body
    await pm.alertsPage.getAddTemplateNameInputField().fill(tplName);
    await pm.alertsPage.getContentTemplateTitleInputField().fill('Template Var Test');
    const bodyEditorLines = pm.alertsPage.getContentTemplateBodyEditorLines();
    await bodyEditorLines.waitFor({ state: 'visible', timeout: 10000 });
    await bodyEditorLines.click();
    const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await page.keyboard.press(selectAllKey);
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('Test body.');
    await page.waitForTimeout(500);

    // Click Save
    await pm.alertsPage.getAddTemplateSubmitBtn().click();
    await page.waitForTimeout(1000);

    // Assert: save success
    const successToast = pm.alertsPage.getElementByText('Template Saved Successfully.');
    await expect(successToast.first()).toBeVisible({ timeout: 10000 });

    testLogger.info('Scenario 3 completed — template variable accepted');
  });

  // =========================================================================
  // P1 — Important Variations
  // =========================================================================

  test('"Not a URL" rejected — inline error + save block', {
    tag: ['@alerts-template-link-validation', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 4: NOT_A_URL rejected');

    const tplName = `auto_tpl_linkval_${pm.alertsPage.generateRandomString()}`;

    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    await pm.alertsPage.getContentTemplateLinkRow0LabelInputField().fill('Malformed');

    // Fill URL: bare words "not a url"
    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('not a url');

    // Assert: inline error appears containing "Enter a valid URL"
    const inlineError = pm.alertsPage.getElementByText(/Enter a valid URL/i);
    await expect(inlineError.first()).toBeVisible({ timeout: 5000 });

    // Fill name/title/body and save
    await pm.alertsPage.getAddTemplateNameInputField().fill(tplName);
    await pm.alertsPage.getContentTemplateTitleInputField().fill('Bad URL Test');
    const bodyEditorLines = pm.alertsPage.getContentTemplateBodyEditorLines();
    await bodyEditorLines.waitFor({ state: 'visible', timeout: 10000 });
    await bodyEditorLines.click();
    const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await page.keyboard.press(selectAllKey);
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('Test body.');
    await page.waitForTimeout(500);

    await pm.alertsPage.getAddTemplateSubmitBtn().click();
    await page.waitForTimeout(1000);

    // Assert: save-time toast blocks
    const toastError = pm.alertsPage.getElementByText(/Enter a valid URL/i);
    await expect(toastError.first()).toBeVisible({ timeout: 5000 });

    const successToast = pm.alertsPage.getElementByText('Template Saved Successfully.');
    await expect(successToast).not.toBeVisible({ timeout: 2000 });

    testLogger.info('Scenario 4 completed — NOT_A_URL rejected');
  });

  test('Relative path accepted — no error, save succeeds', {
    tag: ['@alerts-template-link-validation', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 5: Relative path accepted');

    const tplName = `auto_tpl_linkval_${pm.alertsPage.generateRandomString()}`;
    pm._createdTemplateName = tplName;

    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    await pm.alertsPage.getContentTemplateLinkRow0LabelInputField().fill('Logs');

    // Fill URL: relative path
    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('/web/logs?stream=app');

    // Assert: no inline error
    const errorText = pm.alertsPage.getElementByText(/Unsupported URL scheme|Enter a valid URL/i);
    await expect(errorText.first()).not.toBeVisible({ timeout: 2000 });

    // Fill and save
    await pm.alertsPage.getAddTemplateNameInputField().fill(tplName);
    await pm.alertsPage.getContentTemplateTitleInputField().fill('Relative Path Test');
    const bodyEditorLines = pm.alertsPage.getContentTemplateBodyEditorLines();
    await bodyEditorLines.waitFor({ state: 'visible', timeout: 10000 });
    await bodyEditorLines.click();
    const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await page.keyboard.press(selectAllKey);
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('Test body.');
    await page.waitForTimeout(500);

    await pm.alertsPage.getAddTemplateSubmitBtn().click();
    await page.waitForTimeout(1000);

    const successToast = pm.alertsPage.getElementByText('Template Saved Successfully.');
    await expect(successToast.first()).toBeVisible({ timeout: 10000 });

    testLogger.info('Scenario 5 completed — relative path accepted');
  });

  test('Empty URL — no error (incomplete, not invalid)', {
    tag: ['@alerts-template-link-validation', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 6: Empty URL shows no error');

    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    // Leave both label and URL empty

    // Assert: NO inline error on the URL field
    const errorText = pm.alertsPage.getElementByText(/Unsupported URL scheme|Enter a valid URL/i);
    await expect(errorText.first()).not.toBeVisible({ timeout: 2000 });

    // Now fill a valid URL
    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('https://ok.example.com');
    await page.waitForTimeout(300);

    // Assert: still no error (the valid URL passes validation)
    await expect(errorText.first()).not.toBeVisible({ timeout: 2000 });

    testLogger.info('Scenario 6 completed — empty URL no error, valid URL after no error');
  });

  test('mailto: with valid email accepted', {
    tag: ['@alerts-template-link-validation', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 7: mailto: with valid email accepted');

    const tplName = `auto_tpl_linkval_${pm.alertsPage.generateRandomString()}`;
    pm._createdTemplateName = tplName;

    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    await pm.alertsPage.getContentTemplateLinkRow0LabelInputField().fill('Contact');

    // Fill URL: mailto: with valid email
    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('mailto:ops@example.com');

    // Assert: no inline error
    const errorText = pm.alertsPage.getElementByText(/Unsupported URL scheme|Enter a valid URL/i);
    await expect(errorText.first()).not.toBeVisible({ timeout: 2000 });

    // Fill and save
    await pm.alertsPage.getAddTemplateNameInputField().fill(tplName);
    await pm.alertsPage.getContentTemplateTitleInputField().fill('Mailto Test');
    const bodyEditorLines = pm.alertsPage.getContentTemplateBodyEditorLines();
    await bodyEditorLines.waitFor({ state: 'visible', timeout: 10000 });
    await bodyEditorLines.click();
    const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await page.keyboard.press(selectAllKey);
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('Test body.');
    await page.waitForTimeout(500);

    await pm.alertsPage.getAddTemplateSubmitBtn().click();
    await page.waitForTimeout(1000);

    const successToast = pm.alertsPage.getElementByText('Template Saved Successfully.');
    await expect(successToast.first()).toBeVisible({ timeout: 10000 });

    testLogger.info('Scenario 7 completed — mailto: with valid email accepted');
  });

  test('mailto: without valid address rejected', {
    tag: ['@alerts-template-link-validation', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 8: mailto: without valid address rejected');

    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    // Fill URL: mailto: (no address)
    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('mailto:');

    // Assert: inline error appears (NOT_A_URL)
    const inlineError = pm.alertsPage.getElementByText(/Enter a valid URL/i);
    await expect(inlineError.first()).toBeVisible({ timeout: 5000 });

    testLogger.info('Scenario 8 completed — mailto: without valid address rejected');
  });

  test('Control-character bypass rejected (whitespace smuggling)', {
    tag: ['@alerts-template-link-validation', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 9: Control-character bypass rejected');

    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    // Fill URL with a literal tab character in the scheme
    const smuggledUrl = `java\t${'script:'}alert(1)`;
    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill(smuggledUrl);

    // Assert: error appears (rejected as bad scheme or NOT_A_URL)
    const errorText = pm.alertsPage.getElementByText(/Unsupported URL scheme|Enter a valid URL/i);
    await expect(errorText.first()).toBeVisible({ timeout: 5000 });

    testLogger.info('Scenario 9 completed — control-character bypass rejected');
  });

  test('`{x}javascript:alert(1)` — partial template var with hostile tail rejected', {
    tag: ['@alerts-template-link-validation', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 10: Partial template var + hostile tail rejected');

    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    // Fill URL: {x}javascript:alert(1)
    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('{x}javascript:alert(1)');

    // Assert: error appears (not treated as a valid template variable)
    const errorText = pm.alertsPage.getElementByText(/Unsupported URL scheme|Enter a valid URL/i);
    await expect(errorText.first()).toBeVisible({ timeout: 5000 });

    testLogger.info('Scenario 10 completed — partial template var + hostile tail rejected');
  });

  test('`http:` / `https://` (empty host) rejected', {
    tag: ['@alerts-template-link-validation', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 11: http: empty host rejected');

    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    // Fill URL: http: (no host)
    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('http:');

    // Assert: inline error appears (NOT_A_URL)
    const inlineError = pm.alertsPage.getElementByText(/Enter a valid URL/i);
    await expect(inlineError.first()).toBeVisible({ timeout: 5000 });

    testLogger.info('Scenario 11 completed — http: empty host rejected');
  });

  // =========================================================================
  // P2 — Edge Cases & Nice-to-Have
  // =========================================================================

  test('Multiple link rows — each validated independently', {
    tag: ['@alerts-template-link-validation', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 12: Multiple link rows independently validated');

    const tplName = `auto_tpl_linkval_${pm.alertsPage.generateRandomString()}`;

    // Add first link: valid URL
    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });
    await pm.alertsPage.getContentTemplateLinkRow0LabelInputField().fill('Good');
    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('https://ok.com');

    // Assert: Row 0 has no error
    const errorText = pm.alertsPage.getElementByText(/Unsupported URL scheme/i);
    await expect(errorText.first()).not.toBeVisible({ timeout: 2000 });

    // Add second link: bad scheme
    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow1LabelInput().waitFor({ state: 'visible', timeout: 5000 });
    await pm.alertsPage.getContentTemplateLinkRow1LabelInputField().fill('Bad');
    await pm.alertsPage.getContentTemplateLinkRow1ValueInputField().fill('file:///etc/shadow');

    // Assert: Row 1 has "Unsupported URL scheme" error
    await expect(errorText.first()).toBeVisible({ timeout: 5000 });

    // Fill and save
    await pm.alertsPage.getAddTemplateNameInputField().fill(tplName);
    await pm.alertsPage.getContentTemplateTitleInputField().fill('Multi Row Test');
    const bodyEditorLines = pm.alertsPage.getContentTemplateBodyEditorLines();
    await bodyEditorLines.waitFor({ state: 'visible', timeout: 10000 });
    await bodyEditorLines.click();
    const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await page.keyboard.press(selectAllKey);
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('Test body.');
    await page.waitForTimeout(500);

    await pm.alertsPage.getAddTemplateSubmitBtn().click();
    await page.waitForTimeout(1000);

    // Assert: save toast blocks on the bad link
    const toastError = pm.alertsPage.getElementByText(/Unsupported URL scheme/i);
    await expect(toastError.first()).toBeVisible({ timeout: 5000 });

    // Confirm no success
    const successToast = pm.alertsPage.getElementByText('Template Saved Successfully.');
    await expect(successToast).not.toBeVisible({ timeout: 2000 });

    testLogger.info('Scenario 12 completed — multi-row independent validation');
  });

  test('`data:text/html,...` scheme rejected', {
    tag: ['@alerts-template-link-validation', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 13: data: scheme rejected');

    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('data:text/html,<script>alert(1)</script>');

    // Assert: inline error (unsupported scheme)
    const inlineError = pm.alertsPage.getElementByText(/Unsupported URL scheme/i);
    await expect(inlineError.first()).toBeVisible({ timeout: 5000 });

    testLogger.info('Scenario 13 completed — data: scheme rejected');
  });

  test('`JavaScript:` (mixed case) rejected', {
    tag: ['@alerts-template-link-validation', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 14: JavaScript: (mixed case) rejected');

    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('JavaScript:alert(1)');

    // Assert: inline error (unsupported scheme, case-insensitive comparison)
    const inlineError = pm.alertsPage.getElementByText(/Unsupported URL scheme/i);
    await expect(inlineError.first()).toBeVisible({ timeout: 5000 });

    testLogger.info('Scenario 14 completed — JavaScript: mixed case rejected');
  });

  test('`java%73cript:` (URL-encoded scheme) rejected', {
    tag: ['@alerts-template-link-validation', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 15: URL-encoded hostile scheme rejected');

    await pm.alertsPage.getContentTemplateLinksAddBtn().click();
    await pm.alertsPage.getContentTemplateLinkRow0LabelInput().waitFor({ state: 'visible', timeout: 5000 });

    await pm.alertsPage.getContentTemplateLinkRow0ValueInputField().fill('java%73cript:alert(1)');

    // Assert: error appears
    const errorText = pm.alertsPage.getElementByText(/Unsupported URL scheme|Enter a valid URL/i);
    await expect(errorText.first()).toBeVisible({ timeout: 5000 });

    testLogger.info('Scenario 15 completed — URL-encoded hostile scheme rejected');
  });

  test('Custom mode bypasses link validation', {
    tag: ['@alerts-template-link-validation', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Scenario 16: Custom mode bypasses link validation');

    // The mode tabs are already visible. Click the "Custom" tab.
    const customTab = pm.alertsPage.getAddTemplateModeCustomTab();
    await customTab.click();
    await page.waitForTimeout(500);

    // Assert: the links container is NOT visible (ContentTemplateForm is hidden)
    const linksContainer = pm.alertsPage.getContentTemplateLinksContainer();
    await expect(linksContainer).not.toBeVisible({ timeout: 5000 });

    testLogger.info('Scenario 16 completed — custom mode bypasses link validation');
  });
});
