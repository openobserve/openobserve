const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

async function closeStreamDetailSidebar(page) {
  // Close stream detail sidebar if open
  const cancelButton = page.getByRole('button', { name: 'Cancel' });
  const cancelVisible = await cancelButton.isVisible({ timeout: 1000 }).catch(() => false);
  if (cancelVisible) {
    await cancelButton.click();
    testLogger.info('Closed stream detail sidebar');
    await page.waitForTimeout(500);
  }
}

async function navigateToLogsQuick(page) {
  // Quick navigation to logs without VRL editor wait
  await page.locator('[data-test="menu-link-\\/logs-item"]').click();
  await page.waitForLoadState('networkidle');
  testLogger.info('Navigated to Logs (fast - no VRL wait)');
}

// Verify multiple fields for hash status
// Expected hash format: [REDACTED:32_hex_characters]
// Examples:
//   user_email:john.doe@example.com → [REDACTED:hash]
//   phone:5551234567 → [REDACTED:hash]
async function verifyMultipleFieldsRedaction(page, pm, streamName, fieldsToVerify) {
  testLogger.info(`Verifying ${fieldsToVerify.length} fields for hash status`);

  await closeStreamDetailSidebar(page);
  await navigateToLogsQuick(page);
  await pm.logsPage.selectStream(streamName);
  await page.waitForTimeout(2000);
  await pm.logsPage.clickRefreshButton();
  await page.waitForTimeout(4000); // Increased wait time for logs to load

  // Get data from all 4 columns (one field per column)
  const columnLocators = [
    page.locator('[data-test="log-table-column-0-source"]'),
    page.locator('[data-test="log-table-column-1-source"]'),
    page.locator('[data-test="log-table-column-2-source"]'),
    page.locator('[data-test="log-table-column-3-source"]')
  ];

  // Wait for first column to appear
  await columnLocators[0].first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
    testLogger.warn('Timeout waiting for logs to appear');
  });

  // Collect text from all 4 columns
  const allLogTexts = [];
  for (let colIndex = 0; colIndex < 4; colIndex++) {
    const locator = columnLocators[colIndex];
    const count = await locator.count();

    if (count > 0) {
      const text = await locator.first().textContent();
      allLogTexts.push(text);
      testLogger.info(`Column ${colIndex}: ${text.substring(0, 200)}...`);
    } else {
      testLogger.warn(`Column ${colIndex}: No data found`);
    }
  }

  testLogger.info(`Total columns with data: ${allLogTexts.length}. Expected ${fieldsToVerify.length} fields.`);

  if (allLogTexts.length === 0) {
    throw new Error('No logs found in any column');
  }

  // For each field we want to verify, search through all logs to find the one containing that field
  for (const { fieldName, shouldBeHashed } of fieldsToVerify) {
    testLogger.info(`Searching for log containing field: ${fieldName}`);

    let foundLog = null;
    let foundIndex = -1;

    // Search through all logs to find one containing this field
    for (let i = 0; i < allLogTexts.length; i++) {
      const logText = allLogTexts[i];
      const fieldAsJsonKey = `"${fieldName}":`;
      const fieldAsKey = `${fieldName}:`;

      if (logText.includes(fieldAsJsonKey) || logText.includes(fieldAsKey)) {
        foundLog = logText;
        foundIndex = i;
        break;
      }
    }

    if (!foundLog) {
      testLogger.error(`Could not find log containing field: ${fieldName}`);
      testLogger.error(`Available logs: ${allLogTexts.map((t, i) => `\n  Log ${i}: ${t.substring(0, 150)}...`).join('')}`);
      throw new Error(`Could not find log entry containing field: ${fieldName}`);
    }

    testLogger.info(`Found ${fieldName} in log ${foundIndex}`);

    // For HASH, the field should be present with [REDACTED:hash] format
    if (shouldBeHashed) {
      testLogger.info(`Checking if field ${fieldName} is HASHED at query time`);

      // Check if it contains [REDACTED:hash] format
      const redactedHashPattern = /\[REDACTED:[0-9a-f]{32}\]/i;
      if (!redactedHashPattern.test(foundLog)) {
        testLogger.error(`Field ${fieldName} found but value is NOT in [REDACTED:hash] format!`);
        testLogger.error(`Expected format: [REDACTED:hash] where hash is 32 hex characters`);
        testLogger.error(`Actual log text: ${foundLog.substring(0, 300)}`);
        throw new Error(`Field ${fieldName} is not properly hashed - missing [REDACTED:hash] format`);
      }

      // Extract and log the hash value
      const hashMatch = foundLog.match(/\[REDACTED:([0-9a-f]{32})\]/i);
      if (hashMatch) {
        testLogger.info(`✓ Field ${fieldName} is correctly HASHED at query time: [REDACTED:${hashMatch[1]}]`);
      }
    } else {
      testLogger.info(`Checking if field ${fieldName} is visible with actual value`);

      // Verify it's NOT hashed
      const redactedHashPattern = /\[REDACTED:[0-9a-f]{32}\]/i;
      if (redactedHashPattern.test(foundLog)) {
        testLogger.error(`Field ${fieldName} should be visible but appears to be hashed!`);
        throw new Error(`Field ${fieldName} is unexpectedly hashed`);
      }

      testLogger.info(`✓ Field ${fieldName} is visible with actual value`);
    }
  }
}


test.describe("Query Time Hash - Combined Test", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  // Generate unique test run ID for isolation
  const testRunId = Date.now().toString(36);

  // All patterns used in this spec file - with full pattern definitions for uniqueness
  const patternsToTest = [
    {
      name: `email_format_query_hash_${testRunId}`,
      description: 'Email address validation pattern (for query time hash tests)',
      pattern: '^[\\w\\.-]+@[\\w\\.-]+\\.\\w{2,}$',
      field: 'user_email',
      value: 'john.doe@example.com'
    },
    {
      name: `us_phone_query_hash_${testRunId}`,
      description: 'US phone number (10 digits) (for query time hash tests)',
      pattern: '^\\d{10}$',
      field: 'phone',
      value: '5551234567'
    },
    {
      name: `credit_card_query_hash_${testRunId}`,
      description: 'Credit card number pattern (for query time hash tests)',
      pattern: '^\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}$',
      field: 'cc_number',
      value: '1234 5678 9012 3456'
    },
    {
      name: `ssn_query_hash_${testRunId}`,
      description: 'Social Security Number pattern (for query time hash tests)',
      pattern: '^\\d{3}-\\d{2}-\\d{4}$',
      field: 'ssn',
      value: '123-45-6789'
    }
  ];

  // Use unique stream name to avoid "stream being deleted" conflicts
  const testStreamName = `sdr_query_hash_${testRunId}`;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle');
    testLogger.info('Combined query time hash test setup completed');
  });

  test("setup: cleanup patterns", {
    tag: ['@sdr', '@cleanup', '@queryHash']
  }, async ({ page }) => {
    testLogger.info('=== SPEC-LEVEL CLEANUP: Cleaning up patterns for combined query hash test ===');

    for (const pattern of patternsToTest) {
      testLogger.info(`Checking and cleaning up pattern: ${pattern.name}`);
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      const exists = await pm.sdrPatternsPage.checkPatternExists(pattern.name);

      if (exists) {
        testLogger.info(`Pattern ${pattern.name} exists. Deleting (and unlinking if needed).`);
        const deleteResult = await pm.sdrPatternsPage.deletePatternByName(pattern.name);

        if (!deleteResult.success && deleteResult.reason === 'in_use') {
          testLogger.info('Pattern in use, unlinking from streams first');
          for (const association of deleteResult.associations) {
            await pm.streamAssociationPage.unlinkPatternFromField(
              association.streamName,
              association.fieldName,
              pattern.name
            );
          }

          // Delete again after unlinking
          await pm.sdrPatternsPage.navigateToRegexPatterns();
          await pm.sdrPatternsPage.deletePatternByName(pattern.name);
        }
        testLogger.info(`✓ Pattern ${pattern.name} deleted successfully`);
      } else {
        testLogger.info(`✓ Pattern ${pattern.name} does not exist, no cleanup needed`);
      }
    }

    testLogger.info('=== SPEC-LEVEL CLEANUP COMPLETE ===');
  });

  test("should hash multiple fields at query time when patterns are applied", {
    tag: ['@sdr', '@queryHash', '@all', '@combined']
  }, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'dependency', description: 'setup: cleanup patterns' });

    testLogger.info('=== Testing combined HASH for 4 patterns at query time ===');

    // STEP 1: Ingest data once (data will remain unchanged in storage)
    testLogger.info('STEP 1: Ingest 4 lines of data (before any patterns are applied)');

    const dataToIngest = patternsToTest.map(p => ({
      fieldName: p.field,
      fieldValue: p.value
    }));

    await pm.logsPage.ingestMultipleFields(testStreamName, dataToIngest);

    // Verify all fields are visible without hashing
    testLogger.info('Verifying 4 fields for hash status');
    const fieldsBeforeHashing = patternsToTest.map(p => ({
      fieldName: p.field,
      shouldBeHashed: false
    }));
    await verifyMultipleFieldsRedaction(page, pm, testStreamName, fieldsBeforeHashing);
    testLogger.info('✓ STEP 1 PASSED: All fields visible without SDR');

    // STEP 2: Create all 4 SDR patterns
    testLogger.info('STEP 2: Create all 4 SDR patterns');

    for (const patternConfig of patternsToTest) {
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      await pm.sdrPatternsPage.createPattern(patternConfig.name, patternConfig.description, patternConfig.pattern);
      await pm.sdrPatternsPage.verifyPatternCreatedSuccess();

      // Verify pattern was created
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      const exists = await pm.sdrPatternsPage.checkPatternExists(patternConfig.name);
      expect(exists).toBeTruthy();
      testLogger.info(`✓ Created and verified pattern: ${patternConfig.name}`);
    }

    testLogger.info('✓ STEP 2 PASSED: All 4 patterns created and verified');

    // STEP 3: Link all 4 patterns to their respective fields with QUERY TIME hashing
    testLogger.info('STEP 3: Link all 4 patterns to their respective fields with HASH action');

    for (const patternConfig of patternsToTest) {
      await pm.streamAssociationPage.associatePatternWithStream(
        testStreamName,
        patternConfig.name,
        'hash',
        'query', // QUERY TIME - key difference from ingestion time
        patternConfig.field
      );
      testLogger.info(`✓ Linked pattern ${patternConfig.name} to field ${patternConfig.field} with HASH action`);
    }

    testLogger.info('✓ STEP 3 PASSED: All 4 patterns linked to fields with HASH action');

    // STEP 4: Verify all fields are HASHED at query time (NO RE-INGESTION)
    testLogger.info('STEP 4: Verify fields are HASHED at query time (data unchanged in storage)');

    const fieldsAfterHashing = patternsToTest.map(p => ({
      fieldName: p.field,
      shouldBeHashed: true
    }));
    await verifyMultipleFieldsRedaction(page, pm, testStreamName, fieldsAfterHashing);
    testLogger.info('✓ STEP 4 PASSED: All fields are HASHED at query time');

    testLogger.info('=== ✓ COMBINED QUERY TIME HASH TEST COMPLETED SUCCESSFULLY ===');
  });
});
