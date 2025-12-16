const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

async function closeStreamDetailSidebar(page) {
  const cancelButton = page.getByRole('button', { name: 'Cancel' });
  const cancelVisible = await cancelButton.isVisible({ timeout: 1000 }).catch(() => false);
  if (cancelVisible) {
    await cancelButton.click();
    testLogger.info('Closed stream detail sidebar');
    await page.waitForTimeout(500);
  }
}

async function navigateToLogsQuick(page) {
  await page.locator('[data-test="menu-link-\\/logs-item"]').click();
  await page.waitForLoadState('networkidle');
  testLogger.info('Navigated to Logs (fast - no VRL wait)');
}

async function verifyMultipleFieldsRedaction(page, pm, streamName, fieldsToVerify) {
  testLogger.info(`Verifying ${fieldsToVerify.length} fields for redaction status`);

  await closeStreamDetailSidebar(page);
  await navigateToLogsQuick(page);
  await pm.logsPage.selectStream(streamName);
  await page.waitForTimeout(1000);
  await pm.logsPage.clickRefreshButton();
  await page.waitForTimeout(2000);

  let logTableCell = page.locator('[data-test="log-table-column-0-source"]');
  let logCount = await logTableCell.count();
  testLogger.info(`Selector [data-test="log-table-column-0-source"] found ${logCount} entries`);

  if (logCount < fieldsToVerify.length) {
    logTableCell = page.locator('.logs-result-table tbody tr[role="row"]');
    logCount = await logTableCell.count();
    testLogger.info(`Selector .logs-result-table tbody tr[role="row"] found ${logCount} entries`);
  }

  if (logCount < fieldsToVerify.length) {
    logTableCell = page.locator('tbody tr');
    logCount = await logTableCell.count();
    testLogger.info(`Selector tbody tr found ${logCount} entries`);
  }

  testLogger.info(`Final: Found ${logCount} log entries in the UI`);

  if (logCount === 0) {
    throw new Error('No logs found in the stream');
  }

  const allLogTexts = [];
  for (let i = 0; i < logCount; i++) {
    const text = await logTableCell.nth(i).textContent();
    allLogTexts.push(text);
  }

  for (const { fieldName, shouldBeRedacted } of fieldsToVerify) {
    testLogger.info(`Searching for log containing field: ${fieldName}`);

    let foundLog = null;
    let foundIndex = -1;

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

    if (shouldBeRedacted) {
      testLogger.info(`Checking if field ${fieldName} is REDACTED at query time`);
      expect(foundLog).toContain('[REDACTED]');
      testLogger.info(`✓ Field ${fieldName} is correctly REDACTED at query time`);
    } else {
      testLogger.info(`Checking if field ${fieldName} is visible with actual value`);
      expect(foundLog).not.toContain('[REDACTED]');
      testLogger.info(`✓ Field ${fieldName} is visible with actual value`);
    }
  }
}


test.describe("Query Time Redaction - Combined Test", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  // Generate unique test run ID for isolation
  const testRunId = Date.now().toString(36);

  // All patterns used in this spec file - with full pattern definitions for uniqueness
  const patternsToTest = [
    {
      name: `email_format_query_redact_${testRunId}`,
      description: 'Email address validation pattern (for query time redaction tests)',
      pattern: '^[\\w\\.-]+@[\\w\\.-]+\\.\\w{2,}$',
      field: 'user_email',
      value: 'john.doe@example.com'
    },
    {
      name: `us_phone_query_redact_${testRunId}`,
      description: 'US phone number (10 digits) (for query time redaction tests)',
      pattern: '^\\d{10}$',
      field: 'phone',
      value: '5551234567'
    },
    {
      name: `credit_card_query_redact_${testRunId}`,
      description: 'Credit card number pattern (for query time redaction tests)',
      pattern: '^\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}$',
      field: 'cc_number',
      value: '1234 5678 9012 3456'
    },
    {
      name: `ssn_query_redact_${testRunId}`,
      description: 'Social Security Number pattern (for query time redaction tests)',
      pattern: '^\\d{3}-\\d{2}-\\d{4}$',
      field: 'ssn',
      value: '123-45-6789'
    }
  ];

  // Use unique stream name to avoid "stream being deleted" conflicts
  const testStreamName = `sdr_query_redact_${testRunId}`;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle');
    testLogger.info('Combined query time redaction test setup completed');
  });

  test("setup: cleanup patterns", {
    tag: ['@sdr', '@cleanup', '@queryRedact']
  }, async ({ page }) => {
    testLogger.info('=== SPEC-LEVEL CLEANUP: Cleaning up patterns for combined query redaction test ===');

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

  test("should redact multiple fields at query time when patterns are applied", {
    tag: ['@sdr', '@queryRedact', '@all', '@combined']
  }, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'dependency', description: 'setup: cleanup patterns' });

    testLogger.info('=== Testing combined redaction for 4 patterns at query time ===');

    // STEP 1: Ingest data once (data will remain unchanged in storage)
    testLogger.info('STEP 1: Ingest 4 lines of data (before any patterns are applied)');

    const dataToIngest = patternsToTest.map(p => ({
      fieldName: p.field,
      fieldValue: p.value
    }));

    await pm.logsPage.ingestMultipleFields(testStreamName, dataToIngest);

    // Verify all fields are visible without redaction
    testLogger.info('Verifying 4 fields for redaction status');
    const fieldsBeforeRedaction = patternsToTest.map(p => ({
      fieldName: p.field,
      shouldBeRedacted: false
    }));
    await verifyMultipleFieldsRedaction(page, pm, testStreamName, fieldsBeforeRedaction);
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

    // STEP 3: Link all 4 patterns to their respective fields with QUERY TIME redaction
    testLogger.info('STEP 3: Link all 4 patterns to their respective fields');

    for (const patternConfig of patternsToTest) {
      await pm.streamAssociationPage.associatePatternWithStream(
        testStreamName,
        patternConfig.name,
        'redact',
        'query', // QUERY TIME - key difference from ingestion time
        patternConfig.field
      );
      testLogger.info(`✓ Linked pattern ${patternConfig.name} to field ${patternConfig.field}`);
    }

    testLogger.info('✓ STEP 3 PASSED: All 4 patterns linked to fields');

    // STEP 4: Verify all fields are REDACTED at query time (NO RE-INGESTION)
    testLogger.info('STEP 4: Verify fields are REDACTED at query time (data unchanged in storage)');

    const fieldsAfterRedaction = patternsToTest.map(p => ({
      fieldName: p.field,
      shouldBeRedacted: true
    }));
    await verifyMultipleFieldsRedaction(page, pm, testStreamName, fieldsAfterRedaction);
    testLogger.info('✓ STEP 4 PASSED: All fields are REDACTED at query time');

    testLogger.info('=== ✓ COMBINED QUERY TIME REDACTION TEST COMPLETED SUCCESSFULLY ===');
  });
});
