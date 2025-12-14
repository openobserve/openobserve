// streamAssociationPage.js
import { expect } from '@playwright/test';
import testLogger from '../../playwright-tests/utils/test-logger.js';

export class StreamAssociationPage {
  constructor(page) {
    this.page = page;

    // Navigation
    this.streamsMenuItem = page.locator('[data-test="menu-link-\\/streams-item"]');
    this.searchStreamInput = page.getByPlaceholder('Search Stream');
    this.streamDetailButton = page.getByRole('button', { name: 'Stream Detail' });

    // Pattern Association Dialog
    this.addPatternCell = page.getByRole('cell', { name: 'Add Pattern' });
    this.noPatternAppliedTitle = page.locator('[data-test="associated-regex-patterns-no-pattern-applied-title"]');
    this.patternSearchInput = page.locator('[data-test="associated-regex-patterns-search-input"]');

    // Pattern Configuration
    this.redactRadio = page.locator('[data-test="associated-regex-patterns-redact-radio"]');
    this.dropFieldRadio = page.locator('[data-test="associated-regex-patterns-drop-field-radio"]');
    this.hashRadio = page.locator('[data-test="associated-regex-patterns-hash-radio"]');
    this.ingestionCheckbox = page.locator('[data-test="associated-regex-patterns-ingestion-checkbox"]');
    this.queryCheckbox = page.locator('[data-test="associated-regex-patterns-query-checkbox"]');

    // Action Buttons
    this.addPatternButton = page.getByRole('button', { name: 'Add Pattern' });
    this.updateButton = page.locator('[data-test="associated-regex-patterns-update-btn"]');
    this.closeButton = page.locator('[data-test="associated-regex-patterns-close-btn"]');
    this.cancelButton = page.getByRole('button').filter({ hasText: /^cancel$/ });

    // Messages
    this.successMessage = (text) => page.getByText(text);
    this.redactDescription = page.getByText('Redact This will redact the');
    this.dropDescription = page.getByText('Drop This will drop the field');
  }

  async navigateToStreams() {
    const orgName = process.env.ORGNAME || 'default';
    const baseUrl = process.env.ZO_BASE_URL;
    const targetUrl = `${baseUrl}/web/streams?org_identifier=${orgName}`;
    testLogger.info(`Navigating to Streams page with org: ${orgName}`);
    await this.page.goto(targetUrl);
    await this.page.waitForLoadState('networkidle');
  }

  async searchForStream(streamName) {
    testLogger.info(`Searching for stream: ${streamName}`);
    await this.searchStreamInput.click();
    await this.searchStreamInput.fill(streamName);
    await this.page.waitForLoadState('networkidle');
  }

  async openStreamDetail(streamName) {
    testLogger.info(`Opening stream detail for: ${streamName}`);
    await this.page.waitForLoadState('networkidle');

    // Find the cell with stream name
    const streamCell = this.page.getByRole('cell', { name: streamName }).first();
    await streamCell.waitFor({ state: 'visible', timeout: 5000 });
    testLogger.info(`Found stream cell for: ${streamName}`);

    // Navigate to parent row
    const streamRow = streamCell.locator('..');
    testLogger.info('Got parent row');

    // Wait for the row to be fully rendered
    await this.page.waitForTimeout(500);

    // Find the Stream Detail button in that row - try multiple times
    let detailButton = streamRow.getByRole('button', { name: 'Stream Detail' });
    let buttonCount = await detailButton.count();
    testLogger.info(`Stream Detail button count (by role): ${buttonCount}`);

    // If not found, wait and retry up to 3 times
    for (let retry = 0; retry < 3 && buttonCount === 0; retry++) {
      testLogger.info(`Waiting 1 second and retrying (attempt ${retry + 2})...`);
      await this.page.waitForTimeout(1000);
      detailButton = streamRow.getByRole('button', { name: 'Stream Detail' });
      buttonCount = await detailButton.count();
      testLogger.info(`Stream Detail button count (after wait ${retry + 1}): ${buttonCount}`);
    }

    if (buttonCount === 0) {
      testLogger.error('Stream Detail button not found! Taking screenshot...');
      await this.page.screenshot({ path: `test-results/no-stream-detail-button-${Date.now()}.png` });
      throw new Error('Stream Detail button not found in the row');
    }

    await detailButton.waitFor({ state: 'visible', timeout: 5000 });
    testLogger.info('Stream Detail button is visible, attempting click with JavaScript...');

    // Try JavaScript click first - sometimes Playwright's click doesn't work if element is partially obscured
    await detailButton.evaluate(el => el.click());
    testLogger.info('Executed JavaScript click on Stream Detail button');

    // Wait for sidebar to open - just use waitFor, no fixed timeout
    const updateSettingsButton = this.page.locator('[data-test="schema-update-settings-button"]');

    // Wait up to 3 seconds for sidebar to appear, if not try regular click
    const opened = await updateSettingsButton.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);

    if (!opened) {
      testLogger.warn('Sidebar did not open with JavaScript click, trying regular click...');
      await detailButton.scrollIntoViewIfNeeded();
      await detailButton.click();
      testLogger.info('Executed Playwright click on Stream Detail button');
      await updateSettingsButton.waitFor({ state: 'visible', timeout: 5000 });
    }

    testLogger.info('Stream detail sidebar opened successfully');

    // Wait for schema table to load (minimal wait)
    await this.page.waitForTimeout(300);
  }

  async clickAddPatternCell(fieldName) {
    testLogger.info(`Clicking Add Pattern cell for field: ${fieldName}`);

    // Wait for schema table to be fully loaded - this is INSIDE the stream detail sidebar
    const schemaTable = this.page.locator('table').filter({ has: this.page.locator('th:has-text("Field")') });
    await schemaTable.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for table content to stabilize (reduced from 3000ms)
    await this.page.waitForTimeout(1000);

    // Find row with the field name WITHIN the schema table only
    const fieldRow = schemaTable.locator(`tr:has-text("${fieldName}")`).first();
    await fieldRow.waitFor({ state: 'visible', timeout: 10000 });
    testLogger.info(`Found field row for: ${fieldName} in schema table`);

    // Get the SDR column (last column in the row)
    const sdrColumn = fieldRow.locator('td').last();

    // Check if pattern is already linked (would show "View" text)
    const hasViewPatterns = await sdrColumn.getByText(/View \d+ Patterns?/).count() > 0;

    if (hasViewPatterns) {
      testLogger.error(`Field ${fieldName} already has patterns linked!`);
      throw new Error(`Field ${fieldName} already has patterns associated. Pre-test cleanup may have failed.`);
    }

    // Find the Add Pattern link in the SDR column - use getByText to find the actual text
    const addPatternButton = sdrColumn.getByText(/Add Pattern/i);
    const buttonCount = await addPatternButton.count();
    testLogger.info(`Add Pattern button count for ${fieldName}: ${buttonCount}`);

    if (buttonCount === 0) {
      const sdrColumnHTML = await sdrColumn.innerHTML();
      testLogger.error(`No Add Pattern button found for ${fieldName}. SDR column HTML: ${sdrColumnHTML}`);
      throw new Error(`Add Pattern button not found for field ${fieldName}`);
    }

    await addPatternButton.waitFor({ state: 'visible', timeout: 5000 });

    // Scroll into view before clicking
    await addPatternButton.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(500);

    testLogger.info(`Clicking Add Pattern button for field: ${fieldName}`);

    // Try JavaScript click first
    try {
      await addPatternButton.evaluate(el => el.click());
      testLogger.info('Clicked Add Pattern button using JavaScript');
    } catch (error) {
      testLogger.warn('JavaScript click failed, trying regular click');
      await addPatternButton.click();
    }

    await this.noPatternAppliedTitle.waitFor({ state: 'visible', timeout: 10000 });
    testLogger.info('Pattern association dialog opened successfully');
  }

  async verifyPatternAssociationDialogOpened() {
    testLogger.info('Verifying pattern association dialog opened');
    await expect(this.noPatternAppliedTitle).toBeVisible();
    await expect(this.patternSearchInput).toBeVisible();
  }

  async searchAndSelectPattern(patternName) {
    testLogger.info(`Searching and selecting pattern: ${patternName}`);
    await this.patternSearchInput.click();

    // Clear first, then fill
    await this.patternSearchInput.clear();
    await this.patternSearchInput.fill(patternName);

    // Wait for search results to filter
    await this.page.waitForTimeout(1500);

    // Find the pattern name element - it has class "regex-pattern-name"
    // Click the span element directly, not the table row (which can be blocked by accordion)
    const patternNameElement = this.page.locator('.regex-pattern-name').filter({ hasText: patternName }).first();

    const found = await patternNameElement.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);

    if (!found) {
      testLogger.error(`Pattern ${patternName} not found in search results. Taking screenshot...`);
      await this.page.screenshot({ path: `test-results/pattern-not-found-${patternName}-${Date.now()}.png` });

      // Log all visible patterns
      const allPatterns = await this.page.locator('.regex-pattern-name').allTextContents();
      testLogger.error(`Available patterns: ${allPatterns.join(', ')}`);

      throw new Error(`Pattern ${patternName} not found in search results`);
    }

    testLogger.info(`Found pattern element for: ${patternName}`);

    // Click the pattern name
    await patternNameElement.click();
    testLogger.info(`Clicked pattern: ${patternName}`);
  }

  async verifyActionOptionsVisible() {
    testLogger.info('Verifying action options are visible');
    await expect(this.redactDescription).toBeVisible();
    await expect(this.dropDescription).toBeVisible();
  }

  async selectRedactAction() {
    testLogger.info('Selecting Redact action');
    await this.redactRadio.click();
  }

  async selectDropFieldAction() {
    testLogger.info('Selecting Drop Field action');
    await this.dropFieldRadio.click();
  }

  async selectHashAction() {
    testLogger.info('Selecting Hash action');
    await this.hashRadio.click();
  }

  async selectIngestionTime() {
    testLogger.info('Selecting Ingestion time');
    const isChecked = await this.ingestionCheckbox.isChecked();
    if (!isChecked) {
      await this.ingestionCheckbox.click();
    }
  }

  async selectQueryTime() {
    testLogger.info('Selecting Query time');
    const isChecked = await this.queryCheckbox.isChecked();
    if (!isChecked) {
      await this.queryCheckbox.click();
    }
  }

  async unselectIngestionTime() {
    testLogger.info('Unselecting Ingestion time');
    const isChecked = await this.ingestionCheckbox.isChecked();
    if (isChecked) {
      await this.ingestionCheckbox.click();
    }
  }

  async unselectQueryTime() {
    testLogger.info('Unselecting Query time');
    const isChecked = await this.queryCheckbox.isChecked();
    if (isChecked) {
      await this.queryCheckbox.click();
    }
  }

  async clickAddPattern() {
    testLogger.info('Clicking Add Pattern button');
    await this.addPatternButton.click();
  }

  async clickUpdate() {
    testLogger.info('Clicking Update button');
    await this.updateButton.click();
  }

  async verifyStreamSettingsUpdated() {
    testLogger.info('Verifying stream settings updated');
    await expect(this.successMessage('Stream settings updated')).toBeVisible();
  }

  async closePatternDialog() {
    testLogger.info('Closing pattern dialog');
    await this.closeButton.click();

    // Wait for dialog backdrop to disappear
    await this.page.waitForTimeout(1000);

    // Wait for any dialog backdrop to be hidden
    const backdrop = this.page.locator('.q-dialog__backdrop');
    await backdrop.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {
      testLogger.info('Dialog backdrop already hidden or not found');
    });

    testLogger.info('Pattern dialog closed successfully');
  }

  async clickCancel() {
    testLogger.info('Clicking Cancel button');
    await this.cancelButton.click();
  }

  async associatePatternWithStream(streamName, patternName, action, timeType, fieldName) {
    testLogger.info(`Associating pattern ${patternName} with stream ${streamName} for field ${fieldName} (Action: ${action}, Time: ${timeType})`);

    // Close any open sidebar first - use try-catch to handle unstable elements
    try {
      const cancelButton = this.page.getByRole('button', { name: 'Cancel' });
      const cancelVisible = await cancelButton.isVisible({ timeout: 1000 }).catch(() => false);
      if (cancelVisible) {
        await cancelButton.click({ timeout: 3000, force: true });
        testLogger.info('Closed open sidebar before navigating to streams');
        await this.page.waitForTimeout(500);
      }
    } catch (error) {
      testLogger.info('No sidebar to close or sidebar already closed');
    }

    await this.navigateToStreams();
    await this.searchForStream(streamName);
    await this.openStreamDetail(streamName);
    await this.clickAddPatternCell(fieldName);
    await this.searchAndSelectPattern(patternName);

    // Select action
    if (action === 'redact') {
      await this.selectRedactAction();
    } else if (action === 'drop') {
      await this.selectDropFieldAction();
    } else if (action === 'hash') {
      await this.selectHashAction();
    }

    // Select time type
    if (timeType === 'ingestion') {
      await this.selectIngestionTime();
      await this.unselectQueryTime();
    } else if (timeType === 'query') {
      await this.selectQueryTime();
      await this.unselectIngestionTime();
    } else if (timeType === 'both') {
      await this.selectIngestionTime();
      await this.selectQueryTime();
    }

    await this.clickAddPattern();
    await this.clickUpdate();
    await this.verifyStreamSettingsUpdated();
    await this.closePatternDialog();
  }

  async removePatternFromField(streamName, fieldName) {
    testLogger.info(`Removing pattern from stream ${streamName}, field ${fieldName}`);

    await this.navigateToStreams();
    await this.searchForStream(streamName);
    await this.openStreamDetail(streamName);
    await this.page.waitForTimeout(1000);

    // Find the field row and click "Remove Pattern" button where "Add Pattern" was
    const fieldRow = this.page.locator(`tr:has-text("${fieldName}")`).first();
    const removeButton = fieldRow.getByRole('cell', { name: 'Remove Pattern' });

    const removeButtonVisible = await removeButton.isVisible().catch(() => false);

    if (removeButtonVisible) {
      await removeButton.click();
      testLogger.info(`Clicked Remove Pattern for field ${fieldName}`);
      await this.page.waitForTimeout(1000);

      // Click update to save the change
      await this.clickUpdate();
      await this.page.waitForTimeout(1000);
      return true;
    } else {
      testLogger.warn(`Remove Pattern button not found for field ${fieldName} - pattern may not be associated`);
      return false;
    }
  }

  async unlinkPatternFromField(streamName, fieldName, patternName) {
    testLogger.info(`Unlinking pattern ${patternName} from stream ${streamName}, field ${fieldName}`);

    await this.navigateToStreams();
    await this.searchForStream(streamName);
    await this.openStreamDetail(streamName);
    await this.page.waitForTimeout(1500);

    // Wait for schema table to be visible
    const schemaTable = this.page.locator('table').filter({ has: this.page.locator('th:has-text("Field")') });
    await schemaTable.waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForTimeout(2000);

    // Find the field row WITHIN the schema table
    const fieldRow = schemaTable.locator(`tr:has-text("${fieldName}")`).first();
    await fieldRow.waitFor({ state: 'visible', timeout: 5000 });
    testLogger.info(`Found field row for ${fieldName} in schema table`);

    // Click View Patterns link
    const viewPatternsLink = fieldRow.locator('text=/View \\d+ Patterns?/');
    await viewPatternsLink.click();
    testLogger.info('Clicked View Patterns link');
    await this.page.waitForTimeout(2000);

    // Click Remove Pattern button
    const removeButton = this.page.getByRole('button', { name: 'Remove Pattern' });
    await removeButton.click();
    testLogger.info('Clicked Remove Pattern button');
    await this.page.waitForTimeout(1500);

    // Click Update button
    const updateButton = this.page.locator('[data-test="associated-regex-patterns-update-btn"]');
    await updateButton.click();
    await this.page.waitForTimeout(2000);

    // Close the pattern dialog
    const closeButton = this.page.locator('[data-test="associated-regex-patterns-close-btn"]');
    await closeButton.click();
    await this.page.waitForTimeout(1000);

    // Close the stream detail sidebar
    const cancelButton = this.page.getByRole('button').filter({ hasText: /^cancel$/ });
    const cancelVisible = await cancelButton.isVisible({ timeout: 2000 }).catch(() => false);
    if (cancelVisible) {
      await cancelButton.click();
    }

    testLogger.info(`✓ Unlinked pattern ${patternName} from field ${fieldName}`);
  }

  async associateMultiplePatternsToOneField(streamName, fieldName, patternsConfig) {
    testLogger.info(`Associating ${patternsConfig.length} patterns to field ${fieldName} in stream ${streamName}`);

    // Close any open sidebar first
    try {
      const cancelButton = this.page.getByRole('button', { name: 'Cancel' });
      const cancelVisible = await cancelButton.isVisible({ timeout: 1000 }).catch(() => false);
      if (cancelVisible) {
        await cancelButton.click({ timeout: 3000, force: true });
        testLogger.info('Closed open sidebar before navigating to streams');
        await this.page.waitForTimeout(500);
      }
    } catch (error) {
      testLogger.info('No sidebar to close or sidebar already closed');
    }

    await this.navigateToStreams();
    await this.searchForStream(streamName);
    await this.openStreamDetail(streamName);
    await this.clickAddPatternCell(fieldName);

    // Now add all patterns one by one WITHOUT closing the dialog
    for (let i = 0; i < patternsConfig.length; i++) {
      const { patternName, action, timeType } = patternsConfig[i];
      testLogger.info(`Adding pattern ${i + 1}/${patternsConfig.length}: ${patternName} (${action}/${timeType})`);

      // Search and select pattern
      await this.searchAndSelectPattern(patternName);

      // Select action
      if (action === 'redact') {
        await this.selectRedactAction();
      } else if (action === 'drop') {
        await this.selectDropFieldAction();
      }

      // Select time type
      if (timeType === 'ingestion') {
        await this.selectIngestionTime();
        await this.unselectQueryTime();
      } else if (timeType === 'query') {
        await this.selectQueryTime();
        await this.unselectIngestionTime();
      } else if (timeType === 'both') {
        await this.selectIngestionTime();
        await this.selectQueryTime();
      }

      // Click "Add Pattern" button to add this pattern
      await this.clickAddPattern();
      testLogger.info(`✓ Pattern ${patternName} added (${i + 1}/${patternsConfig.length})`);

      // Small wait between patterns
      await this.page.waitForTimeout(500);
    }

    // After all patterns are added, click Update once
    testLogger.info('All patterns added. Clicking Update to save changes...');
    await this.clickUpdate();
    await this.verifyStreamSettingsUpdated();
    await this.closePatternDialog();

    // Verify the expected count
    testLogger.info(`Verifying ${patternsConfig.length} patterns are linked to field ${fieldName}`);
    await this.navigateToStreams();
    await this.searchForStream(streamName);
    await this.openStreamDetail(streamName);
    await this.page.waitForTimeout(1000);

    const fieldRow = this.page.locator(`tr:has-text("${fieldName}")`).first();
    const viewPatternsText = await fieldRow.locator(`text=/View ${patternsConfig.length} Patterns?/`).textContent().catch(() => null);

    if (viewPatternsText) {
      testLogger.info(`✓ Verified: ${viewPatternsText} found for field ${fieldName}`);
    } else {
      testLogger.warn(`Could not verify pattern count for field ${fieldName}`);
    }

    // Close the stream detail sidebar
    const cancelButton = this.page.getByRole('button').filter({ hasText: /^cancel$/ });
    const cancelVisible = await cancelButton.isVisible({ timeout: 2000 }).catch(() => false);
    if (cancelVisible) {
      await cancelButton.click();
      await this.page.waitForTimeout(500);
    }

    testLogger.info(`✓ Successfully associated ${patternsConfig.length} patterns to field ${fieldName}`);
  }

  async unlinkAllPatternsFromField(streamName, fieldName, specificPatterns = null) {
    testLogger.info(`Unlinking patterns from stream ${streamName}, field ${fieldName}`);
    if (specificPatterns) {
      testLogger.info(`Specific patterns to remove: ${specificPatterns.join(', ')}`);
    }

    await this.navigateToStreams();
    await this.searchForStream(streamName);
    await this.openStreamDetail(streamName);
    await this.page.waitForTimeout(1500);

    // Wait for schema table to be visible
    const schemaTable = this.page.locator('table').filter({ has: this.page.locator('th:has-text("Field")') });
    await schemaTable.waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForTimeout(2000);

    // Find the field row WITHIN the schema table
    const fieldRow = schemaTable.locator(`tr:has-text("${fieldName}")`).first();
    await fieldRow.waitFor({ state: 'visible', timeout: 5000 });
    testLogger.info(`Found field row for ${fieldName} in schema table`);

    // Check if field has patterns
    const sdrColumn = fieldRow.locator('td').last();
    const viewPatternsText = await sdrColumn.locator('text=/View \\d+ Patterns?/').textContent().catch(() => null);

    if (!viewPatternsText) {
      testLogger.info(`Field ${fieldName} has no patterns to unlink`);
      // Close sidebar and return
      const cancelButton = this.page.getByRole('button').filter({ hasText: /^cancel$/ });
      const cancelVisible = await cancelButton.isVisible({ timeout: 2000 }).catch(() => false);
      if (cancelVisible) {
        await cancelButton.click();
      }
      return { removed: 0, total: 0 };
    }

    // Extract the number of patterns
    const match = viewPatternsText.match(/View (\d+) Patterns?/);
    const totalPatterns = match ? parseInt(match[1]) : 0;
    testLogger.info(`Field has ${totalPatterns} pattern(s) linked`);

    // Click View Patterns link
    const viewPatternsLink = sdrColumn.locator('text=/View \\d+ Patterns?/');
    await viewPatternsLink.click();
    testLogger.info('Clicked View Patterns link');
    await this.page.waitForTimeout(2000);

    // Verify the Applied Patterns accordion is visible
    const appliedPatternsAccordion = this.page.getByRole('button', { name: new RegExp(`Collapse "Applied Patterns \\(${totalPatterns}`) });
    await appliedPatternsAccordion.waitFor({ state: 'visible', timeout: 5000 });
    testLogger.info(`✓ Applied Patterns accordion shows ${totalPatterns} patterns`);

    let patternsRemoved = 0;

    if (specificPatterns && specificPatterns.length > 0) {
      // Click and remove specific patterns by name
      testLogger.info(`Removing ${specificPatterns.length} specific patterns by clicking on them`);

      for (const patternName of specificPatterns) {
        testLogger.info(`Looking for pattern: ${patternName}`);

        // Find the pattern name in the applied patterns table cell
        // The pattern is inside a table cell with data-test attribute like: associated-regex-patterns-applied-patterns-table-cell-*
        const patternElement = this.page.locator('[data-test^="associated-regex-patterns-applied-patterns-table-cell-"]').getByText(patternName, { exact: true });
        const patternCount = await patternElement.count();

        if (patternCount > 0) {
          testLogger.info(`Found pattern ${patternName}, clicking on it`);

          // Click on the pattern name
          await patternElement.first().click();
          await this.page.waitForTimeout(500);

          // Click Remove Pattern button
          const removeButton = this.page.getByRole('button', { name: 'Remove Pattern' });
          await removeButton.click();
          testLogger.info(`✓ Removed pattern: ${patternName}`);
          patternsRemoved++;
          await this.page.waitForTimeout(1000);
        } else {
          testLogger.info(`Pattern ${patternName} not found in applied patterns (already removed or not linked)`);
        }
      }

      // Verify all patterns removed
      const finalAccordion = this.page.getByRole('button', { name: /Collapse "Applied Patterns \(0/ });
      const isZero = await finalAccordion.isVisible({ timeout: 2000 }).catch(() => false);
      if (isZero) {
        testLogger.info('✓ Verified: Applied Patterns now shows (0)');
      }
    } else {
      // Remove all patterns (old behavior)
      testLogger.info('Removing all patterns without specific names');
      const maxAttempts = 10;

      while (patternsRemoved < maxAttempts) {
        // Find any pattern name element in the table cells
        const anyPattern = this.page.locator('[data-test^="associated-regex-patterns-applied-patterns-table-cell-"]').first();
        const patternExists = await anyPattern.isVisible({ timeout: 1000 }).catch(() => false);

        if (!patternExists) {
          testLogger.info('No more patterns found');
          break;
        }

        // Click on the pattern
        await anyPattern.click();
        await this.page.waitForTimeout(500);

        // Click Remove Pattern button
        const removeButton = this.page.getByRole('button', { name: 'Remove Pattern' });
        await removeButton.click();
        testLogger.info(`Removed pattern #${patternsRemoved + 1}`);
        patternsRemoved++;
        await this.page.waitForTimeout(1000);
      }
    }

    testLogger.info(`Removed ${patternsRemoved} pattern(s) from field ${fieldName}`);

    // Click Update button
    const updateButton = this.page.locator('[data-test="associated-regex-patterns-update-btn"]');
    await updateButton.click();
    await this.page.waitForTimeout(2000);

    // Verify success message
    const successMessage = this.page.getByText('Stream settings updated');
    await successMessage.waitFor({ state: 'visible', timeout: 5000 });
    testLogger.info('✓ Stream settings updated successfully');

    // Close the pattern dialog
    const closeButton = this.page.locator('[data-test="associated-regex-patterns-close-btn"]');
    await closeButton.click();
    await this.page.waitForTimeout(1000);

    // Verify field now shows "Add Pattern"
    await this.page.waitForTimeout(1000);
    const addPatternCell = this.page.getByRole('cell', { name: 'Add Pattern' });
    const addPatternVisible = await addPatternCell.isVisible({ timeout: 3000 }).catch(() => false);
    if (addPatternVisible) {
      testLogger.info('✓ Field now shows "Add Pattern" (all patterns removed)');
    }

    // Close the stream detail sidebar
    const cancelButton = this.page.getByRole('button').filter({ hasText: /^cancel$/ });
    const cancelVisible = await cancelButton.isVisible({ timeout: 2000 }).catch(() => false);
    if (cancelVisible) {
      await cancelButton.click();
    }

    testLogger.info(`✓ Unlinked ${patternsRemoved} pattern(s) from field ${fieldName}`);
    return { removed: patternsRemoved, total: totalPatterns };
  }

  async clickViewPatternsCell(fieldName) {
    testLogger.info(`Clicking View Patterns cell for field: ${fieldName}`);

    // Wait for schema table to be fully loaded
    const schemaTable = this.page.locator('table').filter({ has: this.page.locator('th:has-text("Field")') });
    await schemaTable.waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForTimeout(1000);

    // Find row with the field name WITHIN the schema table only
    const fieldRow = schemaTable.locator(`tr:has-text("${fieldName}")`).first();
    await fieldRow.waitFor({ state: 'visible', timeout: 10000 });
    testLogger.info(`Found field row for: ${fieldName} in schema table`);

    // Get the SDR column (last column in the row)
    const sdrColumn = fieldRow.locator('td').last();

    // Find the "View N Patterns" link
    const viewPatternsLink = sdrColumn.locator('text=/View \\d+ Patterns?/');
    const linkCount = await viewPatternsLink.count();

    if (linkCount === 0) {
      testLogger.error(`No "View Patterns" link found for field ${fieldName}`);
      throw new Error(`Field ${fieldName} does not have any patterns linked`);
    }

    await viewPatternsLink.waitFor({ state: 'visible', timeout: 5000 });
    await viewPatternsLink.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(500);

    testLogger.info(`Clicking View Patterns link for field: ${fieldName}`);

    try {
      await viewPatternsLink.evaluate(el => el.click());
      testLogger.info('Clicked View Patterns link using JavaScript');
    } catch (error) {
      testLogger.warn('JavaScript click failed, trying regular click');
      await viewPatternsLink.click();
    }

    // Wait for pattern dialog to open - look for pattern list
    await this.page.waitForTimeout(2000);
    testLogger.info('Pattern association dialog opened (existing patterns view)');
  }

  async addAdditionalPatternToField(streamName, fieldName, patternName, action, timeType) {
    testLogger.info(`Adding additional pattern ${patternName} to field ${fieldName} in stream ${streamName} (Action: ${action}, Time: ${timeType})`);

    // Close any open sidebar first
    try {
      const cancelButton = this.page.getByRole('button', { name: 'Cancel' });
      const cancelVisible = await cancelButton.isVisible({ timeout: 1000 }).catch(() => false);
      if (cancelVisible) {
        await cancelButton.click({ timeout: 3000, force: true });
        testLogger.info('Closed open sidebar before navigating to streams');
        await this.page.waitForTimeout(500);
      }
    } catch (error) {
      testLogger.info('No sidebar to close or sidebar already closed');
    }

    await this.navigateToStreams();
    await this.searchForStream(streamName);
    await this.openStreamDetail(streamName);
    await this.clickViewPatternsCell(fieldName);

    // Now we're in the pattern dialog with existing patterns showing
    // Search and select the new pattern
    await this.searchAndSelectPattern(patternName);

    // Select action
    if (action === 'redact') {
      await this.selectRedactAction();
    } else if (action === 'drop') {
      await this.selectDropFieldAction();
    } else if (action === 'hash') {
      await this.selectHashAction();
    }

    // Select time type
    if (timeType === 'ingestion') {
      await this.selectIngestionTime();
      await this.unselectQueryTime();
    } else if (timeType === 'query') {
      await this.selectQueryTime();
      await this.unselectIngestionTime();
    } else if (timeType === 'both') {
      await this.selectIngestionTime();
      await this.selectQueryTime();
    }

    await this.clickAddPattern();
    testLogger.info(`✓ Pattern ${patternName} added to existing patterns`);

    await this.clickUpdate();
    await this.verifyStreamSettingsUpdated();
    await this.closePatternDialog();

    testLogger.info(`✓ Successfully added additional pattern ${patternName} to field ${fieldName}`);
  }

  async unlinkAllPatterns(streamName, fieldName, patternName) {
    testLogger.info(`Unlinking all patterns from stream ${streamName}, field ${fieldName} (triggered by ${patternName})`);

    await this.navigateToStreams();
    await this.searchForStream(streamName);
    await this.openStreamDetail(streamName);
    await this.page.waitForTimeout(1500);

    // Wait for schema table to be visible
    const schemaTable = this.page.locator('table').filter({ has: this.page.locator('th:has-text("Field")') });
    await schemaTable.waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForTimeout(2000);

    // Find the field row WITHIN the schema table
    const fieldRow = schemaTable.locator(`tr:has-text("${fieldName}")`).first();
    await fieldRow.waitFor({ state: 'visible', timeout: 5000 });
    testLogger.info(`Found field row for ${fieldName} in schema table`);

    // Check if field has patterns
    const sdrColumn = fieldRow.locator('td').last();
    const viewPatternsText = await sdrColumn.locator('text=/View \\d+ Patterns?/').textContent().catch(() => null);

    if (!viewPatternsText) {
      testLogger.info(`Field ${fieldName} has no patterns to unlink`);
      // Close sidebar and return
      const cancelButton = this.page.getByRole('button').filter({ hasText: /^cancel$/ });
      const cancelVisible = await cancelButton.isVisible({ timeout: 2000 }).catch(() => false);
      if (cancelVisible) {
        await cancelButton.click();
      }
      return;
    }

    // Extract the number of patterns
    const match = viewPatternsText.match(/View (\d+) Patterns?/);
    const totalPatterns = match ? parseInt(match[1]) : 0;
    testLogger.info(`Field has ${totalPatterns} pattern(s) linked`);

    // Click View Patterns link
    const viewPatternsLink = sdrColumn.locator('text=/View \\d+ Patterns?/');
    await viewPatternsLink.click();
    testLogger.info('Clicked View Patterns link');
    await this.page.waitForTimeout(2000);

    // Verify the Applied Patterns accordion is visible
    const appliedPatternsAccordion = this.page.getByRole('button', { name: new RegExp(`Collapse "Applied Patterns \\(${totalPatterns}`) });
    await appliedPatternsAccordion.waitFor({ state: 'visible', timeout: 5000 });
    testLogger.info(`✓ Applied Patterns accordion shows ${totalPatterns} patterns`);

    // Remove all patterns (same logic as unlinkAllPatternsFromField)
    let patternsRemoved = 0;
    const maxAttempts = 10;

    while (patternsRemoved < maxAttempts) {
      // Find any pattern name element in the table cells
      const anyPattern = this.page.locator('[data-test^="associated-regex-patterns-applied-patterns-table-cell-"]').first();
      const patternExists = await anyPattern.isVisible({ timeout: 1000 }).catch(() => false);

      if (!patternExists) {
        testLogger.info('No more patterns found');
        break;
      }

      // Click on the pattern
      await anyPattern.click();
      await this.page.waitForTimeout(500);

      // Click Remove Pattern button
      const removeButton = this.page.getByRole('button', { name: 'Remove Pattern' });
      await removeButton.click();
      testLogger.info(`Removed pattern #${patternsRemoved + 1}`);
      patternsRemoved++;
      await this.page.waitForTimeout(1000);
    }

    testLogger.info(`Removed ${patternsRemoved} pattern(s) from field ${fieldName}`);

    // Click Update button
    const updateButton = this.page.locator('[data-test="associated-regex-patterns-update-btn"]');
    await updateButton.click();
    await this.page.waitForTimeout(2000);

    // Verify success message
    const successMessage = this.page.getByText('Stream settings updated');
    await successMessage.waitFor({ state: 'visible', timeout: 5000 });
    testLogger.info('✓ Stream settings updated successfully');

    // Close the pattern dialog
    const closeButton = this.page.locator('[data-test="associated-regex-patterns-close-btn"]');
    await closeButton.click();
    await this.page.waitForTimeout(1000);

    // Verify field now shows "Add Pattern"
    await this.page.waitForTimeout(1000);
    const addPatternCell = this.page.getByRole('cell', { name: 'Add Pattern' });
    const addPatternVisible = await addPatternCell.isVisible({ timeout: 3000 }).catch(() => false);
    if (addPatternVisible) {
      testLogger.info('✓ Field now shows "Add Pattern" (all patterns removed)');
    }

    // Close the stream detail sidebar
    const cancelButton2 = this.page.getByRole('button').filter({ hasText: /^cancel$/ });
    const cancelVisible2 = await cancelButton2.isVisible({ timeout: 2000 }).catch(() => false);
    if (cancelVisible2) {
      await cancelButton2.click();
    }

    testLogger.info(`✓ Unlinked all patterns from field ${fieldName} (triggered by ${patternName})`);
  }
}
