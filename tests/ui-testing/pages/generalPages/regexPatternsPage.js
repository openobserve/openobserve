// regexPatternsPage.js
import { expect } from '@playwright/test';
import testLogger from '../../playwright-tests/utils/test-logger.js';

export class RegexPatternsPage {
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

    // Upload file
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

  async checkPatternExists(patternName) {
    testLogger.info(`Checking if pattern exists: ${patternName}`);
    await this.searchPattern(patternName);
    await this.page.waitForTimeout(1000);

    const count = await this.page.locator(`text="${patternName}"`).count();
    const exists = count > 0;

    testLogger.info(`Pattern ${patternName} exists: ${exists}`);
    return exists;
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
        testLogger.info(`Unlinking pattern from stream: ${streamName}, field: ${fieldName}`);

        // Navigate to streams page
        await streamAssociationPage.navigateToStreams();
        await this.page.waitForTimeout(1000);

        // Search for the specific stream
        await streamAssociationPage.searchForStream(streamName);
        await this.page.waitForTimeout(1000);

        // Open stream detail
        await streamAssociationPage.openStreamDetail(streamName);
        await this.page.waitForTimeout(1500);

        // Find the field row with the pattern and click "View X Patterns" or check if pattern is there
        const fieldRow = this.page.locator(`tr:has-text("${fieldName}")`).first();
        const viewPatternsLink = fieldRow.locator('text=/View \\d+ Patterns?/');

        const viewPatternsVisible = await viewPatternsLink.isVisible({ timeout: 2000 }).catch(() => false);

        if (viewPatternsVisible) {
          testLogger.info(`Found "View Patterns" link for field ${fieldName}. Clicking it...`);
          await viewPatternsLink.click();
          await this.page.waitForTimeout(1500);

          // Now we should see the pattern association dialog with the pattern listed
          // Find and click "Remove Pattern" for this specific pattern
          const patternRow = this.page.locator(`tr:has-text("${name}")`).first();
          const removePatternButton = patternRow.getByRole('button', { name: 'Remove Pattern' }).or(
            patternRow.locator('text="Remove Pattern"')
          );

          const removeVisible = await removePatternButton.isVisible({ timeout: 2000 }).catch(() => false);

          if (removeVisible) {
            testLogger.info(`Remove Pattern button found, clicking with JavaScript...`);
            await removePatternButton.evaluate(el => el.click());
            testLogger.info(`Clicked Remove Pattern for ${name} on field ${fieldName}`);
            await this.page.waitForTimeout(1500);

            // Check if pattern was removed successfully
            const patternStillVisible = await this.page.locator(`tr:has-text("${name}")`).isVisible({ timeout: 1000 }).catch(() => false);
            if (!patternStillVisible) {
              testLogger.info(`Pattern ${name} successfully removed from field ${fieldName}`);
            } else {
              testLogger.warn(`Pattern ${name} may still be visible after removal`);
            }

            // Click Update button to save changes (required step from codegen)
            testLogger.info('Clicking Update button to save stream changes');
            const updateButton = this.page.locator('[data-test="associated-regex-patterns-update-btn"]');
            const updateVisible = await updateButton.isVisible({ timeout: 2000 }).catch(() => false);
            if (updateVisible) {
              await updateButton.click();
              testLogger.info('✓ Clicked Update button');
              await this.page.waitForTimeout(2000);

              // Verify success message
              const successMsg = await this.page.getByText('Stream settings updated').isVisible({ timeout: 3000 }).catch(() => false);
              if (successMsg) {
                testLogger.info('✓ Stream settings updated successfully');
              } else {
                testLogger.warn('⚠ Success message not visible after update');
              }
            } else {
              testLogger.warn('⚠ Update button not visible');
            }

            // Close button #1: Close the pattern association dialog
            testLogger.info('Closing pattern association dialog (1st close)');
            const closeButton = this.page.locator('[data-test="associated-regex-patterns-close-btn"]');
            const closeVisible = await closeButton.isVisible({ timeout: 2000 }).catch(() => false);
            if (closeVisible) {
              await closeButton.click();
              testLogger.info('✓ Clicked close button (1st)');
              await this.page.waitForTimeout(1000);
            } else {
              testLogger.warn('⚠ Close button (1st) not visible');
            }

            // Close button #2: Close the stream detail sidebar with cancel button
            testLogger.info('Closing stream detail sidebar (2nd close)');
            const cancelButton = this.page.getByRole('button').filter({ hasText: /^cancel$/ });
            const cancelVisible = await cancelButton.isVisible({ timeout: 2000 }).catch(() => false);
            if (cancelVisible) {
              await cancelButton.click();
              testLogger.info('✓ Clicked cancel button (2nd close)');
              await this.page.waitForTimeout(1000);
            } else {
              testLogger.warn('⚠ Cancel button (2nd close) not visible, trying Escape key');
              await this.page.keyboard.press('Escape').catch(() => {});
              await this.page.waitForTimeout(500);
            }
          } else {
            // If Remove Pattern button not found, this is an error condition
            const errorMsg = `Remove Pattern button not found for ${name} on field ${fieldName}. Cannot unlink pattern.`;
            testLogger.error(errorMsg);
            throw new Error(errorMsg);
          }
        } else {
          // View Patterns link not found - pattern may not be linked to this field
          const errorMsg = `View Patterns link not found for field ${fieldName} in stream ${streamName}. Pattern may not be linked to this field.`;
          testLogger.error(errorMsg);
          throw new Error(errorMsg);
        }
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
      // Unknown error - cannot proceed
      throw new Error(`Failed to delete pattern ${name}. Reason: ${deleteResult.reason}. Test cannot proceed.`);
    }
  }

}
