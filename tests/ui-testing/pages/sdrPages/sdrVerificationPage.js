const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class SDRVerificationPage {
  constructor(page) {
    this.page = page;

    // Locators
    this.cancelButton = { role: 'button', name: 'Cancel' };
    this.logsMenuItem = '[data-test="menu-link-\\/logs-item"]';
    this.logTableColumnSource = '[data-test="log-table-column-0-source"]';
    this.logTableBodyRowsAlt = '.logs-result-table tbody tr[role="row"]';
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
    await this.page.waitForLoadState('domcontentloaded');
    // Use short networkidle with catch — Logs page may have persistent connections
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Navigated to Logs (fast - no VRL wait)');
  }

  /**
   * Wait for the loading indicator to disappear.
   * @param {number} timeout - Max milliseconds to wait (default 15000)
   */
  async waitForLoadingToDisappear(timeout = 15000) {
    const loadingIndicator = this.page.getByText('Loading...').first();
    await loadingIndicator.waitFor({ state: 'hidden', timeout }).catch(() => {
      testLogger.info(`Loading indicator still visible after ${timeout}ms`);
    });
  }

  /**
   * Get log entry count and the matching locator.
   * Tries the source column first, falls back to tbody rows.
   * @returns {{ locator: import('@playwright/test').Locator, count: number }}
   */
  async getLogEntries() {
    let locator = this.page.locator(this.logTableColumnSource);
    let count = await locator.count();

    if (count === 0) {
      locator = this.page.locator(this.logTableBodyRows);
      count = await locator.count();
    }

    return { locator, count };
  }

  async getLatestLogText() {
    const { locator, count } = await this.getLogEntries();

    testLogger.info(`Found ${count} log entries in the UI`);

    if (count === 0) {
      return null;
    }

    // Get the first log entry (most recent)
    const logText = await locator.nth(0).textContent();
    return logText;
  }

  /**
   * Verify a single field in the latest log entry with retry logic for CI.
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

    // Retry loop: wait for logs to appear after ingestion (CI can be slow to index)
    const maxRetries = 5;
    let logText = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await this.page.waitForTimeout(1000);
      await logsPage.clickRefreshButton();
      await this.waitForLoadingToDisappear(15000);
      await this.page.waitForTimeout(2000);

      logText = await this.getLatestLogText();

      testLogger.info(`Attempt ${attempt}/${maxRetries}: ${logText ? 'Log entry found' : 'No logs found'}`);

      if (logText) {
        break;
      }

      if (attempt < maxRetries) {
        const waitTime = attempt * 3000;
        testLogger.info(`No logs found yet, waiting ${waitTime / 1000}s before retry...`);
        await this.page.waitForTimeout(waitTime);
      }
    }

    expect(logText, 'No logs found in the stream after multiple retries').not.toBeNull();

    testLogger.info(`Latest log text (first 300 chars): ${logText?.substring(0, 300)}...`);

    // Check if field exists in the log
    const fieldAsJsonKey = `"${fieldName}":`;
    const fieldAsKey = `${fieldName}:`;
    const fieldFound = logText.includes(fieldAsJsonKey) || logText.includes(fieldAsKey);

    if (shouldBeDropped) {
      // Field should NOT be present at all
      expect(fieldFound, `Field ${fieldName} should have been DROPPED but was found in log`).toBe(false);
      testLogger.info(`✓ Field ${fieldName} is correctly DROPPED (not present)`);
    } else if (shouldBeRedacted) {
      // Field should be present with [REDACTED]
      expect(fieldFound, `Field ${fieldName} should be present but was not found in log`).toBe(true);
      expect(logText, `Field ${fieldName} should be REDACTED but [REDACTED] marker not found`).toContain('[REDACTED]');
      testLogger.info(`✓ Field ${fieldName} is correctly REDACTED`);
    } else {
      // Field should be visible with actual value
      expect(fieldFound, `Field ${fieldName} should be visible but was not found in log`).toBe(true);
      expect(logText, `Field ${fieldName} should be visible but is REDACTED`).not.toContain('[REDACTED]');
      testLogger.info(`✓ Field ${fieldName} is visible with actual value (as expected)`);
    }
  }

  /**
   * Fetch all log entry texts with full retry and 3-tier locator fallback.
   * Navigates to Logs, selects stream, waits until at least minCount entries appear.
   * @returns {string[]} Array of log text strings (may be fewer than minCount on timeout).
   */
  async fetchAllLogTexts(logsPage, streamName, minCount = 1) {
    await this.closeStreamDetailSidebarIfOpen();
    await this.navigateToLogsQuick();
    await logsPage.selectStream(streamName);

    const maxRetries = 5;
    let logTexts = [];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await this.page.waitForTimeout(1000);
      await logsPage.clickRefreshButton();
      await this.page.waitForTimeout(2000);

      let locator = this.page.locator(this.logTableColumnSource);
      let count = await locator.count();

      if (count < minCount) {
        locator = this.page.locator(this.logTableBodyRowsAlt);
        count = await locator.count();
      }

      if (count < minCount) {
        locator = this.page.locator(this.logTableBodyRows);
        count = await locator.count();
      }

      if (count > 0) {
        logTexts = [];
        for (let i = 0; i < count; i++) {
          const text = await locator.nth(i).textContent();
          logTexts.push(text);
        }
        if (logTexts.length >= minCount) break;
      }

      testLogger.info(`fetchAllLogTexts attempt ${attempt}/${maxRetries}: found ${logTexts.length} entries (need ${minCount})`);

      if (attempt < maxRetries) {
        await this.page.waitForTimeout(attempt * 3000);
      }
    }

    testLogger.info(`fetchAllLogTexts: returning ${logTexts.length} log entries`);
    return logTexts;
  }

  /**
   * Verify multiple fields across log entries with a single navigation + retry.
   * Each field descriptor: { fieldName, shouldBeDropped?, shouldBeRedacted?, shouldBeHashed? }
   * Default (no flag / all false): field must be present and not redacted.
   */
  async verifyMultipleFields(logsPage, streamName, fieldsToVerify) {
    testLogger.info(`Verifying ${fieldsToVerify.length} fields in stream: ${streamName}`);

    const logTexts = await this.fetchAllLogTexts(logsPage, streamName, fieldsToVerify.length);
    expect(logTexts.length, 'No logs found in the stream after multiple retries').toBeGreaterThan(0);

    for (const { fieldName, shouldBeDropped, shouldBeRedacted, shouldBeHashed } of fieldsToVerify) {
      testLogger.info(`Verifying field: ${fieldName}`);

      let foundLog = null;
      for (const logText of logTexts) {
        if (logText.includes(`"${fieldName}":`) || logText.includes(`${fieldName}:`)) {
          foundLog = logText;
          break;
        }
      }

      if (shouldBeDropped) {
        expect(foundLog, `Field ${fieldName} should be DROPPED but was found in logs`).toBeNull();
        testLogger.info(`✓ Field ${fieldName} is correctly DROPPED`);
      } else if (shouldBeRedacted) {
        expect(foundLog, `Field ${fieldName} should be present but was not found`).not.toBeNull();
        expect(foundLog, `Field ${fieldName} should contain [REDACTED] marker`).toContain('[REDACTED]');
        testLogger.info(`✓ Field ${fieldName} is correctly REDACTED`);
      } else if (shouldBeHashed) {
        expect(foundLog, `Field ${fieldName} should be present but was not found`).not.toBeNull();
        const hashPattern = /\[REDACTED:[0-9a-f]{32}\]/i;
        expect(hashPattern.test(foundLog), `Field ${fieldName} should be in [REDACTED:hash] format`).toBe(true);
        const hashMatch = foundLog.match(/\[REDACTED:([0-9a-f]{32})\]/i);
        testLogger.info(`✓ Field ${fieldName} is correctly HASHED: [REDACTED:${hashMatch?.[1]}]`);
      } else {
        // shouldBeDropped/Redacted/Hashed all false or absent — field must be visible
        expect(foundLog, `Field ${fieldName} should be visible but was not found`).not.toBeNull();
        const redactedPresent = /\[REDACTED/.test(foundLog);
        expect(redactedPresent, `Field ${fieldName} should be visible but appears redacted/hashed`).toBe(false);
        testLogger.info(`✓ Field ${fieldName} is visible with actual value`);
      }
    }
  }

  /**
   * Verify that fields are completely absent from the most recent N log entries.
   * Use this for ingestion-time DROP where older logs still contain the fields.
   * @param {string[]} fieldNames - Plain array of field name strings
   */
  async verifyFieldsAreAbsent(logsPage, streamName, fieldNames) {
    testLogger.info(`Verifying ${fieldNames.length} fields are ABSENT in recent logs`);

    const logTexts = await this.fetchAllLogTexts(logsPage, streamName, fieldNames.length);
    expect(logTexts.length, 'No logs found in the stream after multiple retries').toBeGreaterThan(0);

    // Only inspect the most recent N entries — older logs pre-date the drop pattern
    const recentTexts = logTexts.slice(0, fieldNames.length);
    testLogger.info(`Checking ${recentTexts.length} most recent log entries for absence of fields`);

    for (const fieldName of fieldNames) {
      testLogger.info(`Verifying field ${fieldName} is ABSENT in recent logs`);

      let foundInRecent = false;
      for (const logText of recentTexts) {
        if (logText.includes(`"${fieldName}":`) || logText.includes(`${fieldName}:`)) {
          foundInRecent = true;
          testLogger.error(`Field ${fieldName} unexpectedly found: ${logText.substring(0, 200)}`);
          break;
        }
      }

      expect(foundInRecent, `Field ${fieldName} should be DROPPED but was found in recent logs`).toBe(false);
      testLogger.info(`✓ Field ${fieldName} is correctly absent from recent logs`);
    }
  }
}
