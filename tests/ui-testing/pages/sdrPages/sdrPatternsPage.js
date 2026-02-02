// sdrPatternsPage.js (formerly regexPatternsPage.js)
import { expect } from '@playwright/test';
import testLogger from '../../playwright-tests/utils/test-logger.js';

export class SDRPatternsPage {
  constructor(page) {
    this.page = page;

    // Navigation
    this.settingsMenuItem = page.locator('[data-test="menu-link-settings-item"]');
    this.regexPatternsTab = page.locator('[data-test="regex-patterns-tab"]');

    // List View
    this.noPatternsMessage = page.getByText('No Patterns in the Library');
    this.addPatternButton = page.locator('[data-test="regex-pattern-list-add-pattern-btn"]');
    this.searchPatternInput = page.getByPlaceholder('Search Pattern');
    this.importButton = page.locator('[data-test="regex-pattern-list-import"]');

    // Add/Edit Pattern Form
    this.addPatternTitle = page.locator('[data-test="add-regex-pattern-title"]');
    this.patternNameInput = page.locator('[data-test="add-regex-pattern-name-input"]');
    this.patternDescriptionInput = page.locator('[data-test="add-regex-pattern-description-input"]');
    this.patternInput = page.locator('[data-test="add-regex-pattern-input"]');
    this.testInputButton = page.getByRole('button', { name: 'Test Input' });
    this.saveButton = page.locator('[data-test="add-regex-pattern-save-btn"]');
    this.cancelButton = page.getByRole('button', { name: /^cancel$/i });

    // Import Dialog Elements
    this.importDialogTitle = page.getByText('Import Pattern');
    this.builtInPatternSearch = page.locator('[data-test="built-in-pattern-search"]');
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
    await this.page.waitForLoadState('networkidle');
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
    testLogger.info('Verifying pattern created successfully');
    await expect(this.successMessage('Regex pattern created')).toBeVisible();
  }

  async verifyPatternUpdatedSuccess() {
    testLogger.info('Verifying pattern updated successfully');
    await expect(this.successMessage('Regex pattern updated')).toBeVisible();
  }

  async verifyPatternDeletedSuccess() {
    testLogger.info('Verifying pattern deleted successfully');
    await expect(this.successMessage('Regex pattern deleted')).toBeVisible();
  }

  async verifyPatternCreationFailed(errorText) {
    testLogger.info(`Verifying pattern creation failed with error: ${errorText}`);
    await expect(this.errorMessage(errorText)).toBeVisible();
  }

  async verifyDuplicatePatternError() {
    testLogger.info('Verifying duplicate pattern error');
    await expect(this.errorMessage('Pattern with given id/name')).toBeVisible();
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
    const confirmButton = this.page.locator('[data-test="confirm-button"]');
    await expect(this.page.getByText('Delete Regex Pattern')).toBeVisible();
    await confirmButton.click();
  }

  async verifyCannotDeletePatternInUse() {
    testLogger.info('Verifying cannot delete pattern in use error');
    await expect(this.errorMessage('Cannot delete pattern,')).toBeVisible();
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
    await this.page.waitForLoadState('networkidle');
  }

  async importPatternsFromFile(filePath) {
    testLogger.info(`Importing patterns from file: ${filePath}`);

    // Click Import button
    await this.importButton.click();
    await this.page.waitForTimeout(500);

    // Verify Import Pattern dialog is visible
    await expect(this.page.getByText('Import Pattern')).toBeVisible();
    await expect(this.page.locator('[data-test="tab-import_json_file"]')).toBeVisible();
    await expect(this.page.locator('[data-test="tab-import_json_url"]')).toBeVisible();

    // Upload file using the standard file input locator
    const fileInput = this.page.locator('[data-test="regex-pattern-import-file-input"]');
    await expect(fileInput).toBeVisible();
    await fileInput.setInputFiles(filePath);
    testLogger.info('File selected for import');

    // Click import button
    const importJsonBtn = this.page.locator('[data-test="regex-pattern-import-json-btn"]');
    await importJsonBtn.click();
    testLogger.info('Clicked import JSON button');

    // Wait for success message
    await this.page.waitForTimeout(2000);
    const successMessage = this.page.getByText('Successfully imported regex-');
    const isVisible = await successMessage.isVisible({ timeout: 5000 }).catch(() => false);

    if (isVisible) {
      testLogger.info('✓ Import successful - success message displayed');
    } else {
      testLogger.warn('⚠ Success message not visible after import');
    }

    await this.page.waitForLoadState('networkidle');
    return isVisible;
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

  async checkPatternExists(patternName, maxRetries = 3) {
    testLogger.info(`Checking if pattern exists: ${patternName}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await this.searchPattern(patternName);
      await this.page.waitForTimeout(1000);

      const count = await this.page.locator(`text="${patternName}"`).count();
      const exists = count > 0;

      if (exists) {
        testLogger.info(`Pattern ${patternName} exists: true (found on attempt ${attempt})`);
        return true;
      }

      if (attempt < maxRetries) {
        testLogger.info(`Pattern ${patternName} not found on attempt ${attempt}, retrying in 2s...`);
        await this.page.waitForTimeout(2000);
        // Navigate back to refresh the list
        await this.navigateToRegexPatterns();
      }
    }

    testLogger.info(`Pattern ${patternName} exists: false (after ${maxRetries} attempts)`);
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

    // No error message - verify deletion by searching for the pattern
    testLogger.info(`No error message detected. Verifying deletion by searching for pattern ${patternName}`);
    await this.searchPattern(patternName);
    await this.page.waitForTimeout(1500);

    const stillExists = await this.checkPatternExists(patternName);

    if (!stillExists) {
      testLogger.info(`✓ Pattern ${patternName} deleted successfully (verified by search)`);
      return { success: true, reason: 'deleted', associations: [] };
    } else {
      testLogger.warn(`✗ Pattern ${patternName} still exists after deletion attempt`);
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
    testLogger.info(`Selecting pattern checkbox: ${checkboxIndex}`);
    await this.page.locator(`[data-test="pattern-checkbox-${checkboxIndex}"]`).click();
  }

  async selectPatternCheckboxes(checkboxIndices) {
    testLogger.info(`Selecting pattern checkboxes: ${checkboxIndices.join(', ')}`);
    for (const index of checkboxIndices) {
      await this.page.locator(`[data-test="pattern-checkbox-${index}"]`).click();
    }
  }

  async isPatternCheckboxChecked(checkboxIndex) {
    const isChecked = await this.page.locator(`[data-test="pattern-checkbox-${checkboxIndex}"]`).isChecked();
    testLogger.info(`Pattern checkbox ${checkboxIndex} checked: ${isChecked}`);
    return isChecked;
  }

  async clickImportJsonButton() {
    testLogger.info('Clicking import JSON button');
    await this.importJsonButton.click();
    await this.page.waitForTimeout(1500);
  }

  async verifyImportSuccess() {
    testLogger.info('Verifying import success message');
    const importSuccess = await this.page.getByText(/Successfully imported|imported successfully/i).isVisible({ timeout: 3000 }).catch(() => false);

    if (importSuccess) {
      testLogger.info('✓ Import successful');
    } else {
      testLogger.warn('⚠ Import success message not visible');
    }

    return importSuccess;
  }

  async verifyImportResult() {
    testLogger.info('Verifying import result (success or error)');

    // Check for success message
    const importSuccess = await this.page.getByText(/Successfully imported|imported successfully/i).isVisible({ timeout: 3000 }).catch(() => false);

    if (importSuccess) {
      testLogger.info('✓ Import successful');
      return { success: true, message: 'Imported successfully' };
    }

    // Check for duplicate/already exists error
    const alreadyExistsMsg = await this.page.getByText(/already exists|Pattern with given id\/name/i).isVisible({ timeout: 2000 }).catch(() => false);

    if (alreadyExistsMsg) {
      testLogger.info('⚠ Patterns already exist (duplicate)');
      // Close any error dialog
      const okButton = this.page.getByRole('button', { name: 'OK' });
      if (await okButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await okButton.click();
      }
      return { success: false, message: 'Pattern already exists', isDuplicate: true };
    }

    // No success or error message detected
    testLogger.warn('⚠ No success or error message detected');
    return { success: false, message: 'No response message detected', isDuplicate: false };
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
    await this.page.waitForLoadState('networkidle');
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
