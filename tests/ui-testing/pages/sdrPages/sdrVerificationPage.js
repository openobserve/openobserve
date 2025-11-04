const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class SDRVerificationPage {
  constructor(page) {
    this.page = page;

    // Locators
    this.cancelButton = { role: 'button', name: 'Cancel' };
    this.logsMenuItem = '[data-test="menu-link-\\/logs-item"]';
    this.logTableColumnSource = '[data-test="log-table-column-0-source"]';
    this.logTableBodyRows = 'tbody tr';
  }

  async closeStreamDetailSidebarIfOpen() {
    const cancelButton = this.page.getByRole(this.cancelButton.role, { name: this.cancelButton.name });
    const cancelVisible = await cancelButton.isVisible({ timeout: 1000 }).catch(() => false);
    if (cancelVisible) {
      await cancelButton.click();
      testLogger.info('Closed stream detail sidebar');
    }
  }

  async navigateToLogsQuick() {
    await this.page.locator(this.logsMenuItem).click();
    await this.page.waitForLoadState('networkidle');
    testLogger.info('Navigated to Logs (fast - no VRL wait)');
  }

  async getLatestLogText() {
    // Try primary locator first
    let logTableCell = this.page.locator(this.logTableColumnSource);
    let logCount = await logTableCell.count();

    // Fallback to tbody tr if primary locator returns 0
    if (logCount === 0) {
      logTableCell = this.page.locator(this.logTableBodyRows);
      logCount = await logTableCell.count();
    }

    testLogger.info(`Found ${logCount} log entries in the UI`);

    if (logCount === 0) {
      return null;
    }

    // Get the first log entry (most recent)
    const logText = await logTableCell.nth(0).textContent();
    return logText;
  }

  /**
   * Verify a single field in the latest log entry
   * @param {Object} logsPage - The logsPage instance from PageManager
   * @param {string} streamName - Name of the stream
   * @param {string} fieldName - Name of the field to verify
   * @param {boolean} shouldBeDropped - Whether field should be dropped
   * @param {boolean} shouldBeRedacted - Whether field should be redacted
   */
  async verifySingleFieldInLatestLog(logsPage, streamName, fieldName, shouldBeDropped, shouldBeRedacted) {
    testLogger.info(`Verifying field: ${fieldName}, shouldBeDropped: ${shouldBeDropped}, shouldBeRedacted: ${shouldBeRedacted}`);

    // Use page object functions to navigate and get log
    await this.closeStreamDetailSidebarIfOpen();
    await this.navigateToLogsQuick();
    await logsPage.selectStream(streamName);

    // Small wait for stream to be selected and query to be ready
    await this.page.waitForTimeout(1000);

    await logsPage.clickRefreshButton();

    // Wait for logs to be fetched and displayed after refresh
    await this.page.waitForTimeout(2000);

    // Get the latest log text
    const logText = await this.getLatestLogText();

    if (!logText) {
      throw new Error('No logs found in the stream');
    }

    testLogger.info(`Latest log text (first 300 chars): ${logText.substring(0, 300)}...`);

    // Check if field exists in the log
    const fieldAsJsonKey = `"${fieldName}":`;
    const fieldAsKey = `${fieldName}:`;
    const fieldFound = logText.includes(fieldAsJsonKey) || logText.includes(fieldAsKey);

    if (shouldBeDropped) {
      // Field should NOT be present at all
      if (fieldFound) {
        testLogger.error(`Field ${fieldName} should have been DROPPED but was found in log!`);
        throw new Error(`Field ${fieldName} was not dropped - still present in logs`);
      }
      testLogger.info(`✓ Field ${fieldName} is correctly DROPPED (not present)`);
    } else if (shouldBeRedacted) {
      // Field should be present with [REDACTED]
      if (!fieldFound) {
        testLogger.error(`Field ${fieldName} should be present but was not found in log!`);
        throw new Error(`Field ${fieldName} not found in log`);
      }
      if (!logText.includes('[REDACTED]')) {
        testLogger.error(`Field ${fieldName} should be REDACTED but [REDACTED] marker not found!`);
        throw new Error(`Field ${fieldName} was not redacted`);
      }
      testLogger.info(`✓ Field ${fieldName} is correctly REDACTED`);
    } else {
      // Field should be visible with actual value
      if (!fieldFound) {
        testLogger.error(`Field ${fieldName} should be visible but was not found in log!`);
        throw new Error(`Field ${fieldName} not found in log`);
      }
      if (logText.includes('[REDACTED]')) {
        testLogger.error(`Field ${fieldName} should be visible but is REDACTED!`);
        throw new Error(`Field ${fieldName} is unexpectedly redacted`);
      }
      testLogger.info(`✓ Field ${fieldName} is visible with actual value (as expected)`);
    }
  }
}
