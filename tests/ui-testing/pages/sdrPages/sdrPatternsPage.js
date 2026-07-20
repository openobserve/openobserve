// sdrPatternsPage.js (formerly regexPatternsPage.js)
import { expect } from '@playwright/test';
import testLogger from '../../playwright-tests/utils/test-logger.js';
import { getAuthHeaders, getOrgIdentifier } from '../../playwright-tests/utils/cloud-auth.js';

export class SDRPatternsPage {
  constructor(page) {
    this.page = page;

    // Navigation
    this.settingsMenuItem = page.locator('[data-test="menu-link-/settings-item"]');
    this.regexPatternsTab = page.locator('[data-test="regex-patterns-tab"]');

    // List View
    this.noPatternsMessage = page.getByText('No Patterns in the Library');
    this.addPatternButton = page.locator('[data-test="regex-pattern-list-add-pattern-btn"]');
    this.searchPatternInput = page.getByPlaceholder('Search Pattern');
    this.importButton = page.locator('[data-test="regex-pattern-list-import"]');

    // Add/Edit Pattern Form (ODrawer — AddRegexPattern.vue)
    // The form is now rendered inside an ODrawer; wait for the name input to confirm drawer is open
    // addPatternTitle targets the OInput wrapper div (for visibility/drawer-open checks)
    this.addPatternTitle = page.locator('[data-test="add-regex-pattern-name-input"]');
    // patternNameInput/Description/Input target the inner field elements (OInput/OTextarea use inheritAttrs:false,
    // data-test lands on the wrapper div; the actual interactive element gets data-test="{original}-field")
    this.patternNameInput = page.locator('[data-test="add-regex-pattern-name-input-field"]');
    this.patternDescriptionInput = page.locator('[data-test="add-regex-pattern-description-input-field"]');
    this.patternInput = page.locator('[data-test="add-regex-pattern-input-field"]');
    this.testInputButton = page.getByRole('button', { name: 'Test Input' });
    // ODrawer teleports panel to <body> via DialogPortal; compound selectors across that
    // boundary can be unreliable in Playwright. Use direct selectors — only one drawer
    // is ever open at a time during these tests so there is no ambiguity.
    this.saveButton = page.locator('[data-test="o-drawer-primary-btn"]');
    this.cancelButton = page.locator('[data-test="o-drawer-secondary-btn"]');

    // Import Dialog Elements
    this.importDialogTitle = page.getByText('Import Pattern');
    // OInput wrapper; inner input field gets data-test="built-in-pattern-search-field"
    this.builtInPatternSearch = page.locator('[data-test="built-in-pattern-search-field"]');
    this.importJsonButton = page.locator('[data-test="regex-pattern-import-json-btn"]');

    // Messages
    this.successMessage = (text) => page.getByText(text);
    this.errorMessage = (text) => page.getByText(text);
  }

  async navigateToRegexPatterns() {
    const orgName = process.env.ORGNAME || 'default';
    const baseUrl = process.env.ZO_BASE_URL;
    const targetUrl = `${baseUrl}/web/settings/regex_patterns?org_identifier=${orgName}`;
    testLogger.info(`Navigating to Regex Patterns settings with org: ${orgName}`);
    await this.page.goto(targetUrl);
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async verifyRegexPatternsPageLoaded() {
    testLogger.info('Verifying Regex Patterns page is loaded');
    await expect(this.regexPatternsTab).toBeVisible();
    await expect(this.addPatternButton).toBeVisible();
    await expect(this.searchPatternInput).toBeVisible();
    await expect(this.importButton).toBeVisible();
  }

  async emptySearchInput() {
    testLogger.info('Emptying search input');
    await this.searchPatternInput.clear();
    await this.page.waitForTimeout(500);
  }

  async verifyNoPatternsMessage() {
    testLogger.info('Verifying no patterns message is displayed');
    await expect(this.noPatternsMessage).toBeVisible();
  }

  async clickAddPattern() {
    testLogger.info('Clicking Add Pattern button');
    await this.addPatternButton.click();
    await this.addPatternTitle.waitFor({ state: 'visible' });
  }

  async fillPatternDetails(name, description, pattern) {
    testLogger.info(`Filling pattern details: ${name}`);
    await this.patternNameInput.click();
    await this.patternNameInput.fill(name);
    await this.patternDescriptionInput.click();
    await this.patternDescriptionInput.fill(description);
    await this.patternInput.click();
    await this.patternInput.fill(pattern);
    // Allow Vue's form-validation watcher to fire (isFormEmpty → false) before save
    await this.page.waitForTimeout(300);
  }

  async clickTestInput() {
    testLogger.info('Clicking Test Input button');
    await this.testInputButton.click();
  }

  async clickSavePattern() {
    testLogger.info('Clicking Save Pattern button');
    await this.saveButton.click();
  }

  async createPattern(name, description, pattern) {
    testLogger.info(`Creating pattern: ${name}`);
    await this.clickAddPattern();
    await this.fillPatternDetails(name, description, pattern);
    await this.clickSavePattern();
  }

  async verifyPatternCreatedSuccess() {
    testLogger.info('Verifying pattern created successfully — drawer should close');
    await expect(this.addPatternTitle).not.toBeVisible({ timeout: 10000 });
  }

  async verifyPatternUpdatedSuccess() {
    testLogger.info('Verifying pattern updated successfully — drawer should close');
    await expect(this.addPatternTitle).not.toBeVisible({ timeout: 10000 });
  }

  async verifyPatternDeletedSuccess() {
    testLogger.info('Verifying pattern deleted successfully — confirm dialog should close');
    await expect(this.page.locator('[data-test="confirm-dialog"]')).not.toBeVisible({ timeout: 10000 });
  }

  async verifyPatternCreationFailed() {
    testLogger.info('Verifying pattern creation failed — drawer should remain open');
    await expect(this.addPatternTitle).toBeVisible({ timeout: 5000 });
  }

  async verifyDuplicatePatternError() {
    testLogger.info('Verifying duplicate pattern error — drawer should remain open');
    await expect(this.addPatternTitle).toBeVisible({ timeout: 5000 });
  }

  async searchPattern(patternName) {
    testLogger.info(`Searching for pattern: ${patternName}`);
    await this.searchPatternInput.click();
    await this.searchPatternInput.fill(patternName);
  }

  async getPatternUpdateButton(patternId) {
    return this.page.locator(`[data-test="regex-pattern-list-${patternId}-update-regex-pattern"]`);
  }

  async getPatternDeleteButton(patternId) {
    return this.page.locator(`[data-test="regex-pattern-list-${patternId}-delete-regex-pattern"]`);
  }

  async clickUpdatePattern(patternId) {
    testLogger.info(`Clicking update button for pattern ID: ${patternId}`);
    const updateButton = await this.getPatternUpdateButton(patternId);
    await updateButton.click();
    await this.addPatternTitle.waitFor({ state: 'visible' });
  }

  async clickDeletePattern(patternId) {
    testLogger.info(`Clicking delete button for pattern ID: ${patternId}`);
    const deleteButton = await this.getPatternDeleteButton(patternId);
    await deleteButton.click();
  }

  async confirmDelete() {
    testLogger.info('Confirming pattern deletion');
    const confirmButton = this.page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]');
    // ODialog renders sr-only <h2> + <p> and a visible <span> — all with same text.
    // getByText would match 3 elements (strict mode violation). Check the dialog panel instead.
    await expect(this.page.locator('[data-test="confirm-dialog"]')).toBeVisible();
    await confirmButton.click();
  }

  async verifyCannotDeletePatternInUse(patternName) {
    testLogger.info('Verifying cannot delete pattern in use — pattern should still be visible in list');
    if (patternName) {
      await expect(this.page.getByText(patternName)).toBeVisible({ timeout: 5000 });
    } else {
      // Without a name, just confirm the confirm dialog has closed (delete was attempted but handled)
      await expect(this.page.locator('[data-test="confirm-dialog"]')).not.toBeVisible({ timeout: 5000 });
    }
  }

  async updatePatternField(newPattern) {
    testLogger.info(`Updating pattern field to: ${newPattern}`);
    await this.patternInput.click();
    await this.patternInput.fill(newPattern);
    await this.clickSavePattern();
  }

  async verifyPatternExists(patternName) {
    testLogger.info(`Verifying pattern exists: ${patternName}`);
    await expect(this.page.getByText(patternName)).toBeVisible();
  }

  async isFileInputPresent() {
    return await this.page.locator('input[type="file"]').count() > 0;
  }

  async isFileImportAvailable() {
    testLogger.info('Probing for file-based import UI');
    await this.importButton.click();
    await this.page.waitForTimeout(500);

    const dialogVisible = await this.page.getByText('Import Pattern').isVisible({ timeout: 3000 }).catch(() => false);
    if (!dialogVisible) {
      testLogger.info('Import dialog did not open — file import unavailable');
      return false;
    }

    const fileTab = this.page.locator('[data-test="tab-import_json_file"]');
    if (await fileTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fileTab.click();
      await this.page.waitForTimeout(500);
    }

    const available = await this.page.locator('[data-test="regex-pattern-import-json-file-input-field"]').count() > 0;

    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);

    testLogger.info(`File-based import available: ${available}`);
    return available;
  }

  async clickImport() {
    testLogger.info('Clicking Import button');
    await this.importButton.click();
  }

  async uploadImportFile(filePath) {
    testLogger.info(`Uploading import file: ${filePath}`);
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);
  }

  async waitForPatternListUpdate() {
    testLogger.info('Waiting for pattern list to update');
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async importPatternsFromFile(filePath) {
    testLogger.info(`Importing patterns from file: ${filePath}`);

    // Click Import button
    await this.importButton.click();
    await this.page.waitForTimeout(500);

    // Verify Import Pattern dialog is visible
    await expect(this.page.getByText('Import Pattern')).toBeVisible();

    // Click "File Upload / JSON" tab to reveal the file input
    const fileTab = this.page.locator('[data-test="tab-import_json_file"]');
    await expect(fileTab).toBeVisible();
    await fileTab.click();
    await this.page.waitForTimeout(300);

    // File input is visually hidden (sr-only) — upload directly without visibility check
    const fileInput = this.page.locator('[data-test="regex-pattern-import-json-file-input-field"]');
    await fileInput.waitFor({ state: 'attached', timeout: 5000 });
    await fileInput.setInputFiles(filePath);
    testLogger.info('File selected for import');

    // Click import button
    const importJsonBtn = this.page.locator('[data-test="regex-pattern-import-json-btn"]');
    await importJsonBtn.click();
    testLogger.info('Clicked import JSON button');

    // Wait for import dialog to close (indicates success)
    await this.page.waitForTimeout(2000);
    const dialogClosed = await this.page.getByText('Import Pattern').waitFor({ state: 'hidden', timeout: 5000 }).then(() => true).catch(() => false);

    if (dialogClosed) {
      testLogger.info('✓ Import successful - dialog closed');
    } else {
      testLogger.warn('⚠ Import dialog still visible after import attempt');
    }

    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    return dialogClosed;
  }

  async getTotalPatternsCount() {
    testLogger.info('Getting total patterns count from UI');

    // The count text is in format "Showing 1 - 20 of 37 Pattern(s)"
    const countText = this.page.getByText('Pattern(s)');
    const text = await countText.textContent().catch(() => '');

    // Extract the total number from "Showing X - Y of Z Pattern(s)"
    const match = text.match(/of\s+(\d+)\s+Pattern/);
    if (match && match[1]) {
      const count = parseInt(match[1], 10);
      testLogger.info(`Total patterns count: ${count}`);
      return count;
    }

    testLogger.warn('Could not extract patterns count from text');
    return 0;
  }

  async navigateToNextPage() {
    testLogger.info('Navigating to next page of patterns');
    const nextButton = this.page.getByRole('button').filter({ hasText: 'chevron_right' });
    await nextButton.click();
    await this.page.waitForTimeout(1000);
  }

  async navigateToPreviousPage() {
    testLogger.info('Navigating to previous page of patterns');
    const prevButton = this.page.locator('[data-test="regex-pattern-list-table"]').getByRole('button').filter({ hasText: 'chevron_left' });
    await prevButton.click();
    await this.page.waitForTimeout(1000);
  }

  async verifyPatternExistsInList(patternName) {
    testLogger.info(`Verifying pattern exists in list: ${patternName}`);

    // Search for the pattern
    await this.searchPattern(patternName);
    await this.page.waitForTimeout(1000);

    // Check if it's visible
    const isVisible = await this.page.getByText(patternName).isVisible({ timeout: 3000 }).catch(() => false);

    // Clear search
    await this.searchPatternInput.clear();
    await this.page.waitForTimeout(500);

    return isVisible;
  }

  // ===== Backend API helpers (source of truth for eventual-consistency gating) =====
  //
  // WHY: The regex-pattern UI list is rendered client-side and lags the backend by
  // several seconds under cloud load — create/delete are accepted (drawer/dialog
  // closes) before the change propagates to the list read-replica, and the rendered
  // table lags further still. A UI text-count check therefore RACES the backend and
  // produces false "not found in list" / "Reason: unknown" failures. These helpers
  // gate on GET /api/{org}/re_patterns, the authoritative store, so readiness is a
  // deterministic API signal rather than a blind UI-reload retry.

  _sdrApiBaseUrl() {
    // Mirror the derivation used by playwright-tests/SDR/multipleSDRPatterns.spec.js
    // (INGESTION_URL is the correct gateway for the re_patterns API on cloud).
    return (process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/$/, '');
  }

  // Retry ONLY transient connection/timeout failures on a page.request call. A real
  // HTTP error response is returned to the caller unchanged (never retried here) so
  // genuine failures still surface. Mirrors requestWithRetry in multipleSDRPatterns.spec.js.
  async _requestWithRetry(action, label, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await action();
      } catch (err) {
        const msg = (err && err.message) || String(err);
        const retriable = /Connection timeout|ECONNRESET|ECONNREFUSED|socket hang up|Request timed out|net::|timeout/i.test(msg);
        if (!retriable || attempt === maxRetries) throw err;
        testLogger.warn(`${label} failed (attempt ${attempt}/${maxRetries}): ${msg} — retrying`);
        await this.page.waitForTimeout(attempt * 2000);
      }
    }
  }

  // Authoritative list read. Returns an array of pattern names, or null if the request
  // could not be completed / returned a non-OK status (transient) so callers can keep polling.
  async _listPatternNamesViaApi() {
    const baseUrl = this._sdrApiBaseUrl();
    const org = getOrgIdentifier();
    const headers = getAuthHeaders();
    try {
      const res = await this._requestWithRetry(
        () => this.page.request.get(`${baseUrl}/api/${org}/re_patterns`, { headers }),
        'list re_patterns'
      );
      if (!res.ok()) {
        testLogger.warn(`re_patterns list returned HTTP ${res.status()} — treating as indeterminate`);
        return null;
      }
      const body = await res.json();
      return (body.patterns || []).map((p) => p.name);
    } catch (err) {
      testLogger.warn(`re_patterns list request failed after retries: ${(err && err.message) || err}`);
      return null;
    }
  }

  // API-authoritative existence check. Returns the CURRENT state (fast in BOTH
  // directions — one successful list read is definitive), which is why it is NOT a
  // poll-until-present loop: several callers use it to confirm ABSENCE (post-delete /
  // cleanup with unique run-scoped names), and a poll-until-present here would stall
  // those for the full timeout every run. When you need to WAIT for a create/delete
  // to propagate, use waitForPatternCreated / waitForPatternDeleted instead.
  // Falls back to the UI text-count check only if the API is unreachable (e.g. a
  // misconfigured/self-hosted env), so behaviour never regresses off-cloud.
  async checkPatternExists(patternName, maxRetries = 3) {
    testLogger.info(`Checking if pattern exists (API-authoritative): ${patternName}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const names = await this._listPatternNamesViaApi();
      if (names !== null) {
        const exists = names.includes(patternName);
        testLogger.info(`Pattern ${patternName} exists: ${exists} (via API, attempt ${attempt})`);
        return exists;
      }
      if (attempt < maxRetries) {
        await this.page.waitForTimeout(attempt * 2000);
      }
    }

    // API indeterminate after retries — fall back to the old UI list check so
    // non-cloud / misconfigured environments still function.
    testLogger.warn(`API list unavailable for ${patternName} — falling back to UI list check`);
    await this.searchPattern(patternName);
    await this.page.waitForTimeout(1000);
    const count = await this.page.locator(`text="${patternName}"`).count();
    const exists = count > 0;
    testLogger.info(`Pattern ${patternName} exists (UI fallback): ${exists}`);
    return exists;
  }

  // Readiness gate for pattern CREATION. Poll the authoritative API until the pattern
  // is present (eventual consistency on cloud can lag the accepted create by seconds,
  // worse under load — the reported root cause), then reload the UI list and confirm
  // it renders so downstream stream-association linking (which drives the UI) is
  // stable. Returns true once API (and, best-effort, the UI) agree; false only if the
  // create never propagates within the window — a genuine failure, not swallowed.
  async waitForPatternCreated(patternName, timeoutMs = 45000) {
    testLogger.info(`Waiting for pattern to be created (backend-consistent): ${patternName}`);
    const deadline = Date.now() + timeoutMs;
    let apiConfirmed = false;

    while (Date.now() < deadline) {
      const names = await this._listPatternNamesViaApi();
      if (names !== null && names.includes(patternName)) {
        apiConfirmed = true;
        testLogger.info(`Pattern ${patternName} confirmed present via API`);
        break;
      }
      await this.page.waitForTimeout(2000);
    }

    if (!apiConfirmed) {
      testLogger.warn(`Pattern ${patternName} did not appear in API within ${timeoutMs}ms`);
      return false;
    }

    // API confirms it exists — now make sure the rendered list reflects it (short
    // retry) so the rest of the test, which interacts with the rendered list, is stable.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.navigateToRegexPatterns();
      await this.searchPattern(patternName);
      await this.page.waitForTimeout(1000);
      const count = await this.page.locator(`text="${patternName}"`).count();
      if (count > 0) {
        testLogger.info(`Pattern ${patternName} rendered in UI list (attempt ${attempt})`);
        await this.searchPatternInput.clear().catch(() => {});
        await this.page.waitForTimeout(300);
        return true;
      }
      testLogger.info(`Pattern ${patternName} API-present but UI not yet rendered (attempt ${attempt}) — reloading`);
      await this.page.waitForTimeout(2000);
    }

    // Backend has it; the UI still hasn't rendered it after retries. Treat as ready —
    // the API is the source of truth and downstream association resolves by name.
    testLogger.warn(`Pattern ${patternName} confirmed in API but not rendered in UI after retries — proceeding on API truth`);
    return true;
  }

  // Readiness gate for pattern DELETION. Poll the authoritative API until the pattern
  // is gone. The UI row (and briefly the list replica) can linger after a delete is
  // accepted; a UI text check here previously produced false "Reason: unknown"
  // failures. Tolerates transient request failures (indeterminate → keep polling).
  async waitForPatternDeleted(patternName, timeoutMs = 30000) {
    testLogger.info(`Waiting for pattern to be deleted (backend-consistent): ${patternName}`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const names = await this._listPatternNamesViaApi();
      if (names !== null && !names.includes(patternName)) {
        testLogger.info(`Pattern ${patternName} confirmed absent via API`);
        return true;
      }
      await this.page.waitForTimeout(2000);
    }
    testLogger.warn(`Pattern ${patternName} still present in API after ${timeoutMs}ms`);
    return false;
  }

  async getPatternIdByName(patternName) {
    testLogger.info(`Getting pattern ID for: ${patternName}`);

    const patternId = await this.page.evaluate((name) => {
      const deleteButtons = Array.from(document.querySelectorAll('[data-test*="delete-regex-pattern"]'));
      for (const btn of deleteButtons) {
        const row = btn.closest('tr');
        if (row && row.textContent.includes(name)) {
          const testAttr = btn.getAttribute('data-test');
          return testAttr.match(/regex-pattern-list-(\d+)-delete/)?.[1];
        }
      }
      return null;
    }, patternName);

    return patternId;
  }

  async deletePatternByName(patternName) {
    testLogger.info(`Attempting to delete pattern: ${patternName}`);

    await this.searchPattern(patternName);
    await this.page.waitForTimeout(1000);

    const patternId = await this.getPatternIdByName(patternName);

    if (!patternId) {
      testLogger.info(`Pattern ${patternName} not found, no deletion needed`);
      return { success: true, reason: 'not_found', associations: [] };
    }

    // Click delete button
    await this.clickDeletePattern(patternId);
    await this.page.waitForTimeout(500);

    // Confirm deletion
    await this.confirmDelete();
    await this.page.waitForTimeout(2000);

    // Check for error message first (pattern in use)
    const deleteError = await this.page.getByText('Cannot delete pattern,').isVisible({ timeout: 2000 }).catch(() => false);

    if (deleteError) {
      testLogger.warn(`Pattern ${patternName} is in use and cannot be deleted`);

      // Extract the full error message to get associated streams
      // Format: Cannot delete pattern, associated with ["default/logs/stream_name:field_name", ...]
      const errorElement = this.page.locator('text=/Cannot delete pattern, associated with/');
      const errorText = await errorElement.textContent().catch(() => '');
      testLogger.info(`Full error message text: "${errorText}"`);

      // Parse the error message to extract stream:field associations
      // Example: ["default/logs/sdr_url_drop_test:website_url", "default/logs/another_stream:email"]
      const associations = [];
      const match = errorText.match(/\[(.*?)\]/);
      if (match && match[1]) {
        testLogger.info(`Matched associations text: "${match[1]}"`);
        const associationsText = match[1];
        // Split by comma and extract stream:field pairs
        const parts = associationsText.split(',').map(s => s.trim().replace(/"/g, ''));
        testLogger.info(`Split into ${parts.length} parts: ${JSON.stringify(parts)}`);

        for (const part of parts) {
          // Format: default/logs/stream_name:field_name
          const pathMatch = part.match(/.*\/logs\/([^:]+):(.+)/);
          if (pathMatch) {
            const streamName = pathMatch[1];
            const fieldName = pathMatch[2];
            associations.push({ streamName, fieldName });
            testLogger.info(`✓ Parsed association: stream="${streamName}", field="${fieldName}"`);
          } else {
            testLogger.warn(`✗ Failed to parse part: "${part}"`);
          }
        }
      } else {
        testLogger.warn(`Failed to extract associations array from error message: "${errorText}"`);
      }

      testLogger.info(`Total associations found: ${associations.length}`);
      if (associations.length > 0) {
        testLogger.info(`Associations: ${JSON.stringify(associations)}`);
      }

      // Close the error dialog
      const okButton = this.page.getByRole('button', { name: 'OK' });
      if (await okButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await okButton.click();
        await this.page.waitForTimeout(500);
      }

      return { success: false, reason: 'in_use', associations };
    }

    // No error message - verify deletion against the authoritative API. The UI row
    // (and the list read-replica) can lag the accepted delete under cloud load; the
    // previous UI text check here produced false "Reason: unknown" failures (e.g.
    // "Unable to delete existing pattern PGP Private Key"). Poll the API until the
    // pattern is gone — but do NOT swallow a genuine failure: if it is still present
    // after the bounded wait, report unknown so the caller can react.
    testLogger.info(`No error message detected. Verifying deletion of ${patternName} via API`);
    const gone = await this.waitForPatternDeleted(patternName);

    if (gone) {
      testLogger.info(`✓ Pattern ${patternName} deleted successfully (verified via API)`);
      return { success: true, reason: 'deleted', associations: [] };
    } else {
      testLogger.warn(`✗ Pattern ${patternName} still present in API after deletion attempt`);
      return { success: false, reason: 'unknown', associations: [] };
    }
  }

  async ensurePatternDeleted(patternName) {
    testLogger.info(`Ensuring pattern "${patternName}" is deleted before continuing`);
    const exists = await this.checkPatternExists(patternName);

    if (!exists) {
      testLogger.info(`Pattern ${patternName} already absent`);
      await this.searchPatternInput.clear();
      await this.page.waitForTimeout(500);
      return;
    }

    const deleteResult = await this.deletePatternByName(patternName);
    if (!deleteResult.success) {
      throw new Error(`Unable to delete existing pattern ${patternName}. Reason: ${deleteResult.reason}`);
    }

    await this.page.waitForTimeout(500);
    testLogger.info(`Pattern ${patternName} removed successfully`);
  }

  // ===== Import Dialog Methods =====

  async verifyImportDialogOpen() {
    testLogger.info('Verifying import dialog is open');
    await expect(this.importDialogTitle).toBeVisible();
  }

  async searchBuiltInPatterns(searchTerm) {
    testLogger.info(`Searching for built-in patterns: ${searchTerm}`);
    await this.builtInPatternSearch.click();
    await this.builtInPatternSearch.fill(searchTerm);
    await this.page.waitForTimeout(500);
  }

  async clearBuiltInPatternSearch() {
    testLogger.info('Clearing built-in pattern search');
    await this.builtInPatternSearch.clear();
    await this.page.waitForTimeout(500);
  }

  async selectPatternCheckbox(checkboxIndex) {
    testLogger.info(`Toggling pattern checkbox: ${checkboxIndex}`);
    const btn = this.page.locator(`[data-test="pattern-checkbox-${checkboxIndex}"] button[role="checkbox"]`);

    // Read state before click so we can verify it actually changed
    const stateBefore = await btn.getAttribute('data-state');

    await btn.click();
    await this.page.waitForTimeout(300);

    // If state didn't change, the label's native activation may have double-fired.
    // Dispatch a non-bubbling click directly on the button to bypass the label.
    const stateAfter = await btn.getAttribute('data-state');
    if (stateAfter === stateBefore) {
      testLogger.info(`Checkbox ${checkboxIndex}: state unchanged after regular click (${stateBefore}), retrying with non-bubbling event`);
      await this.page.evaluate((idx) => {
        const b = document.querySelector(`[data-test="pattern-checkbox-${idx}"] button[role="checkbox"]`);
        if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: false, cancelable: true }));
      }, checkboxIndex);
      await this.page.waitForTimeout(300);
    }

  }

  async selectPatternCheckboxes(checkboxIndices) {
    testLogger.info(`Selecting pattern checkboxes: ${checkboxIndices.join(', ')}`);
    for (const index of checkboxIndices) {
      await this.page.locator(`[data-test="pattern-checkbox-${index}"] button[role="checkbox"]`).click();
      await this.page.waitForTimeout(200);
    }
  }

  async isPatternCheckboxChecked(checkboxIndex) {
    // OCheckbox uses a <button role="checkbox" data-state="checked|unchecked"> — not a native input.
    // .isChecked() is unreliable on the wrapper <label>; read data-state on the button instead.
    const btn = this.page.locator(`[data-test="pattern-checkbox-${checkboxIndex}"] button[role="checkbox"]`);
    const dataState = await btn.getAttribute('data-state');
    const isChecked = dataState === 'checked';
    testLogger.info(`Pattern checkbox ${checkboxIndex} checked: ${isChecked} (data-state: ${dataState})`);
    return isChecked;
  }

  async clickImportJsonButton() {
    testLogger.info('Clicking import JSON button');
    await this.importJsonButton.click();
    await this.page.waitForTimeout(1500);
  }

  async verifyImportSuccess() {
    testLogger.info('Verifying import success — dialog should close');
    const dialogClosed = await this.importDialogTitle.isVisible({ timeout: 5000 }).then(() => false).catch(() => true);
    // Also check if dialog is gone after a short wait
    const closed = await this.importDialogTitle.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true).catch(() => false);
    if (closed) {
      testLogger.info('✓ Import dialog closed (success)');
    } else {
      testLogger.warn('⚠ Import dialog still visible after import attempt');
    }
    return closed;
  }

  async verifyImportResult() {
    testLogger.info('Verifying import result — checking if dialog closed');
    const closed = await this.importDialogTitle.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true).catch(() => false);

    if (closed) {
      testLogger.info('✓ Import completed — dialog closed');
      return { success: true, message: 'Import dialog closed' };
    }

    // Dialog still open — check for a confirm/OK button indicating a handled error
    const okButton = this.page.getByRole('button', { name: 'OK' });
    if (await okButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      testLogger.info('⚠ Import dialog has OK button — likely duplicate/error state');
      await okButton.click();
      return { success: false, message: 'Pattern already exists', isDuplicate: true };
    }

    testLogger.warn('⚠ Import dialog still open with no OK button');
    return { success: false, message: 'No response detected', isDuplicate: false };
  }

  async importBuiltInPatterns(checkboxIndices) {
    testLogger.info(`Importing built-in patterns: ${checkboxIndices.join(', ')}`);

    await this.clickImport();
    await this.page.waitForTimeout(500);
    await this.verifyImportDialogOpen();

    await this.selectPatternCheckboxes(checkboxIndices);
    await this.clickImportJsonButton();
    await this.page.waitForTimeout(10000);

    return await this.verifyImportSuccess();
  }

  async searchAndImportBuiltInPatterns(searchTerm, checkboxIndices) {
    testLogger.info(`Searching for '${searchTerm}' and importing patterns: ${checkboxIndices.join(', ')}`);

    await this.clickImport();
    await this.page.waitForTimeout(500);
    await this.verifyImportDialogOpen();

    await this.searchBuiltInPatterns(searchTerm);
    await this.selectPatternCheckboxes(checkboxIndices);
    await this.clickImportJsonButton();

    return await this.verifyImportSuccess();
  }

  async verifyPatternVisibleInList(patternName, exact = true) {
    testLogger.info(`Verifying pattern visible in list: ${patternName}`);
    await this.searchPattern(patternName);
    await this.page.waitForTimeout(1000);
    const isVisible = await this.page.getByText(patternName, { exact }).isVisible({ timeout: 3000 }).catch(() => false);
    await this.emptySearchInput();

    if (isVisible) {
      testLogger.info(`✓ Pattern '${patternName}' is visible`);
    } else {
      testLogger.warn(`⚠ Pattern '${patternName}' is not visible`);
    }

    return isVisible;
  }

  async verifyPatternNotVisibleInList(patternName, exact = true) {
    testLogger.info(`Verifying pattern NOT visible in list: ${patternName}`);
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.searchPattern(patternName);
    await this.page.waitForTimeout(2000);
    const isVisible = await this.page.getByText(patternName, { exact }).isVisible({ timeout: 3000 }).catch(() => false);
    await this.emptySearchInput();

    if (!isVisible) {
      testLogger.info(`✓ Pattern '${patternName}' is not visible (as expected)`);
    } else {
      testLogger.warn(`⚠ Pattern '${patternName}' is still visible`);
    }

    return !isVisible;
  }

  async createPatternWithDeleteIfExists(name, description, pattern, streamAssociationPage = null) {
    testLogger.info(`============ Starting pattern creation flow for: ${name} ============`);

    // Step 1: Check if SDR already exists
    testLogger.info('Step 1: Checking if pattern exists on SDR page');
    await this.navigateToRegexPatterns();
    await this.page.waitForTimeout(1000);

    const exists = await this.checkPatternExists(name);

    if (!exists) {
      testLogger.info(`✓ Pattern ${name} does not exist. Creating new pattern.`);
      await this.searchPatternInput.clear();
      await this.page.waitForTimeout(500);
      await this.createPattern(name, description, pattern);
      testLogger.info(`============ Pattern ${name} created successfully ============`);
      return;
    }

    testLogger.info(`Pattern ${name} already exists. Attempting deletion.`);

    // Step 2: Attempt deletion
    testLogger.info('Step 2: Attempting to delete existing pattern');
    const deleteResult = await this.deletePatternByName(name);

    // Step 3: If deletion worked - create new pattern
    if (deleteResult.success) {
      testLogger.info(`✓ Deletion successful. Creating new pattern ${name}.`);
      await this.searchPatternInput.clear();
      await this.page.waitForTimeout(500);
      await this.createPattern(name, description, pattern);
      testLogger.info(`============ Pattern ${name} created successfully ============`);
      return;
    }

    // Step 4: If deletion failed - check which stream it's linked to and unlink
    if (deleteResult.reason === 'in_use' && deleteResult.associations.length > 0) {
      testLogger.info(`✗ Deletion failed - pattern in use. Unlinking from ${deleteResult.associations.length} stream(s).`);

      if (!streamAssociationPage) {
        throw new Error(`Pattern ${name} is in use but streamAssociationPage not provided. Cannot proceed with unlinking.`);
      }

      if (deleteResult.associations.length === 0) {
        testLogger.warn(`Pattern ${name} is in use but no associations were parsed from error message. This may indicate error parsing issue.`);
        testLogger.warn(`Will attempt to proceed anyway, but unlinking may fail.`);
      } else {
        testLogger.info(`Pattern ${name} needs to be unlinked from ${deleteResult.associations.length} stream(s).`);
      }

      // Step 5: Unlink pattern from all associated streams
      if (deleteResult.associations.length === 0) {
        testLogger.warn('No associations found to unlink. Will try deletion again anyway.');
      } else {
        testLogger.info('Step 5: Unlinking pattern from all associated streams');
      }

      for (const association of deleteResult.associations) {
        const { streamName, fieldName } = association;
        testLogger.info(`Unlinking pattern ${name} from stream: ${streamName}, field: ${fieldName}`);
        await streamAssociationPage.unlinkSpecificPatternByName(streamName, fieldName, name);
      }

      // Step 6: Attempt to delete pattern again after unlinking
      testLogger.info('Step 6: Attempting to delete pattern again after unlinking from all streams');
      await this.navigateToRegexPatterns();
      await this.page.waitForTimeout(1000);

      const finalDeleteResult = await this.deletePatternByName(name);

      // Step 7: Verify deletion succeeded
      if (!finalDeleteResult.success) {
        throw new Error(`Failed to delete pattern ${name} even after unlinking from all streams. Deletion reason: ${finalDeleteResult.reason}. Test cannot proceed.`);
      }

      testLogger.info(`Pattern ${name} deleted successfully after unlinking. Verifying deletion...`);

      // Verify pattern no longer exists
      await this.searchPattern(name);
      await this.page.waitForTimeout(1000);
      const stillExists = await this.checkPatternExists(name);

      if (stillExists) {
        throw new Error(`Pattern ${name} still exists after deletion and verification. Test cannot proceed.`);
      }

      testLogger.info(`Pattern ${name} verified as deleted. Proceeding to create new pattern.`);

      // Navigate to SDR page and create the new pattern
      testLogger.info('Step 8: Navigating to SDR page to create new pattern');
      await this.navigateToRegexPatterns();
      await this.page.waitForTimeout(1000);
      await this.searchPatternInput.clear();
      await this.page.waitForTimeout(500);
      await this.createPattern(name, description, pattern);
      testLogger.info(`============ Pattern creation flow completed for: ${name} ============`);
      return;
    } else {
      // Unknown error - might be linked, attempt to handle it
      testLogger.warn(`Failed to delete pattern ${name}. Reason: ${deleteResult.reason}. Attempting to unlink if it's in use...`);

      // Try to get associations even if reason is unknown
      if (deleteResult.associations && deleteResult.associations.length > 0) {
        testLogger.info(`Found ${deleteResult.associations.length} associations for pattern ${name}. Unlinking...`);

        // Get StreamAssociationPage reference
        const StreamAssociationPage = require('../streamsPages/streamAssociationPage.js').StreamAssociationPage;
        const streamAssociationPage = new StreamAssociationPage(this.page);

        // Collect unique stream-field pairs
        const uniqueStreamFields = new Set();
        for (const association of deleteResult.associations) {
          const key = `${association.streamName}|||${association.fieldName}`;
          uniqueStreamFields.add(key);
        }

        testLogger.info(`Found ${uniqueStreamFields.size} unique stream-field pair(s) to unlink from`);

        // Unlink the specific pattern by name from each stream-field pair
        for (const key of uniqueStreamFields) {
          const [streamName, fieldName] = key.split('|||');
          testLogger.info(`Unlinking pattern ${name} from stream: ${streamName}, field: ${fieldName}`);
          await streamAssociationPage.unlinkSpecificPatternByName(streamName, fieldName, name);
        }

        // Try deleting again after unlinking
        testLogger.info(`Attempting to delete pattern ${name} again after unlinking...`);
        await this.navigateToRegexPatterns();
        const retryDelete = await this.deletePatternByName(name);

        if (!retryDelete.success) {
          throw new Error(`Failed to delete pattern ${name} even after attempting to unlink. Reason: ${retryDelete.reason}. Test cannot proceed.`);
        }

        testLogger.info(`Pattern ${name} deleted successfully after unlinking. Creating new pattern...`);
        await this.navigateToRegexPatterns();
        await this.page.waitForTimeout(1000);
        await this.searchPatternInput.clear();
        await this.page.waitForTimeout(500);
        await this.createPattern(name, description, pattern);
        testLogger.info(`============ Pattern creation flow completed for: ${name} ============`);
        return;
      } else {
        // No associations found, truly unknown error
        throw new Error(`Failed to delete pattern ${name}. Reason: ${deleteResult.reason}. No associations found. Test cannot proceed.`);
      }
    }
  }

}
