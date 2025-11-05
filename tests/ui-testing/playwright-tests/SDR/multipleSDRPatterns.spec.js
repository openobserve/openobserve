const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const path = require('path');

// Helper function to ingest a SINGLE log entry
async function ingestSingleLog(page, streamName, fieldName, fieldValue) {
  const orgId = process.env["ORGNAME"];
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };

  const logEntry = {
    level: "info",
    [fieldName]: fieldValue,
    log: `Test log with ${fieldName} = ${fieldValue}`,
    _timestamp: Date.now() * 1000
  };

  testLogger.info(`Ingesting single log with ${fieldName}: ${fieldValue}`);

  const response = await page.evaluate(async ({ url, headers, orgId, streamName, logData }) => {
    const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify([logData])
    });
    const responseJson = await fetchResponse.json();
    return {
      status: fetchResponse.status,
      statusText: fetchResponse.statusText,
      body: responseJson
    };
  }, {
    url: process.env.INGESTION_URL,
    headers: headers,
    orgId: orgId,
    streamName: streamName,
    logData: logEntry
  });

  testLogger.info(`Ingestion API response - Status: ${response.status}, Body:`, response.body);

  if (response.status !== 200) {
    testLogger.error(`Ingestion failed! Status: ${response.status}, Response:`, response.body);
  }

  await page.waitForTimeout(2000);
}

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

// Verify a single field in the most recent log entry
async function verifySingleFieldInLatestLog(page, pm, streamName, fieldName, shouldBeDropped, shouldBeRedacted) {
  testLogger.info(`Verifying field: ${fieldName}, shouldBeDropped: ${shouldBeDropped}, shouldBeRedacted: ${shouldBeRedacted}`);

  await closeStreamDetailSidebar(page);
  await navigateToLogsQuick(page);
  await pm.logsPage.selectStream(streamName);
  await page.waitForTimeout(1000);
  await pm.logsPage.clickRefreshButton();
  await page.waitForTimeout(2000);

  // Get log entries
  let logTableCell = page.locator('[data-test="log-table-column-0-source"]');
  let logCount = await logTableCell.count();

  if (logCount === 0) {
    logTableCell = page.locator('tbody tr');
    logCount = await logTableCell.count();
  }

  testLogger.info(`Found ${logCount} log entries in the UI`);

  if (logCount === 0) {
    throw new Error('No logs found in the stream');
  }

  // Get the first log entry (most recent)
  const logText = await logTableCell.nth(0).textContent();
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

test.describe("Import POC - Multiple Patterns on One Field", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  let cleanupPerformedInSetup = false;

  // All 6 patterns from import file (for cleanup purposes)
  const allImportedPatterns = [
    'ifsc_code',
    'date_dd_mm_yyyy',
    'log_filename',
    'time_hh_mm_ss',
    'log_level_keyword',
    'hex_number'
  ];

  // Query-time patterns (2) - tested first, no re-ingestion needed
  const queryTimePatterns = [
    { name: 'log_filename', value: 'application.log', action: 'drop', timeType: 'query', scenario: 'query_drop' },
    { name: 'time_hh_mm_ss', value: '14:30:45', action: 'redact', timeType: 'query', scenario: 'query_redact' }
  ];

  // Ingestion-time patterns (2) - tested second, requires re-ingestion
  const ingestionTimePatterns = [
    { name: 'ifsc_code', value: 'AB12CDEF1234567890', action: 'drop', timeType: 'ingestion', scenario: 'ingestion_drop' },
    { name: 'date_dd_mm_yyyy', value: '25/12/2024', action: 'redact', timeType: 'ingestion', scenario: 'ingestion_redact' }
  ];

  const fieldName = "multi_data"; // Single field for all patterns
  const testStreamName = "sdr_poc_multi_pattern_test";
  const importFilePath = path.resolve(__dirname, '../../../test-data/regex_patterns_import.json');

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle');
    testLogger.info('Import POC test setup completed');
  });

  // TEST 1: Setup cleanup
  test('setup: cleanup imported patterns', {
    tag: ['@sdr', '@cleanup', '@import', '@poc']
  }, async ({ page }) => {
    testLogger.info('=== SETUP CLEANUP: Cleaning up ALL 6 imported patterns ===');

    // Our 4 test patterns that are linked to the same field
    const testPatterns = [...queryTimePatterns.map(p => p.name), ...ingestionTimePatterns.map(p => p.name)];
    let needsUnlinking = false;

    // STEP 1: Try to delete all patterns first
    testLogger.info('STEP 1: Attempting to delete all patterns');
    for (const patternName of allImportedPatterns) {
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      const exists = await pm.sdrPatternsPage.checkPatternExists(patternName);

      if (exists) {
        cleanupPerformedInSetup = true;
        testLogger.info(`Pattern ${patternName} exists, attempting delete...`);
        const deleteResult = await pm.sdrPatternsPage.deletePatternByName(patternName);

        if (deleteResult.success) {
          testLogger.info(`✓ Pattern ${patternName} deleted successfully`);
        } else if (deleteResult.reason === 'in_use') {
          testLogger.info(`Pattern ${patternName} is in use, will need to unlink`);
          needsUnlinking = true;
          // Don't try to unlink yet, just mark that we need to
        }
      } else {
        testLogger.info(`✓ Pattern ${patternName} does not exist`);
      }
    }

    // STEP 2: If any patterns are in use, unlink all test patterns at once
    if (needsUnlinking) {
      testLogger.info('STEP 2: Some patterns in use, unlinking our 4 test patterns from field');
      await pm.streamAssociationPage.unlinkAllPatternsFromField(
        testStreamName,
        fieldName,
        testPatterns
      );
      testLogger.info('✓ Unlinking complete');

      // STEP 3: Now delete the patterns that were in use
      testLogger.info('STEP 3: Deleting patterns after unlinking');
      for (const patternName of allImportedPatterns) {
        await pm.sdrPatternsPage.navigateToRegexPatterns();
        const exists = await pm.sdrPatternsPage.checkPatternExists(patternName);

        if (exists) {
          testLogger.info(`Deleting pattern: ${patternName}`);
          const deleteResult = await pm.sdrPatternsPage.deletePatternByName(patternName);

          if (deleteResult.success) {
            testLogger.info(`✓ Pattern ${patternName} deleted successfully`);
          } else if (deleteResult.reason === 'in_use') {
            // Handle non-test patterns that might still be linked elsewhere
            testLogger.warn(`Pattern ${patternName} still in use (non-test pattern), unlinking individually`);
            for (const association of deleteResult.associations) {
              await pm.streamAssociationPage.unlinkPatternFromField(
                association.streamName,
                association.fieldName,
                patternName
              );
            }
            await pm.sdrPatternsPage.navigateToRegexPatterns();
            const retryDelete = await pm.sdrPatternsPage.deletePatternByName(patternName);
            expect(retryDelete.success).toBeTruthy();
            testLogger.info(`✓ Pattern ${patternName} deleted after unlinking`);
          } else {
            throw new Error(`Failed to delete pattern ${patternName}. Reason: ${deleteResult.reason}`);
          }
        }
      }
    }

    testLogger.info(`=== SETUP CLEANUP COMPLETE (Cleanup performed: ${cleanupPerformedInSetup}) ===`);
  });

  // TEST 2: Import patterns and verify
  test('should import 4 patterns and verify they exist', {
    tag: ['@sdr', '@import', '@poc']
  }, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'dependency', description: 'setup: cleanup imported patterns' });
    testLogger.info('=== Testing pattern import functionality ===');

    await pm.sdrPatternsPage.navigateToRegexPatterns();

    // Import patterns
    testLogger.info('Importing patterns from file');
    const importSuccess = await pm.sdrPatternsPage.importPatternsFromFile(importFilePath);
    expect(importSuccess).toBeTruthy();

    // Verify each imported pattern exists by searching for it
    testLogger.info('Verifying all 4 patterns exist by searching for them');
    await pm.sdrPatternsPage.navigateToRegexPatterns();
    await page.waitForTimeout(1000);

    // Combine both pattern arrays to verify all 4
    const allPatternsToVerify = [...queryTimePatterns, ...ingestionTimePatterns];

    for (const pattern of allPatternsToVerify) {
      testLogger.info(`Searching for pattern: ${pattern.name}`);
      const exists = await pm.sdrPatternsPage.verifyPatternExistsInList(pattern.name);
      expect(exists).toBeTruthy();
      testLogger.info(`✓ Pattern ${pattern.name} found in list`);
    }

    testLogger.info('=== ✓ IMPORT TEST COMPLETED SUCCESSFULLY ===');
  });

  // TEST 3: Multiple patterns on ONE field (SEQUENTIAL FLOW)
  test('should link 4 patterns to one field and verify with sequential ingestion', {
    tag: ['@sdr', '@import', '@poc', '@multiPattern']
  }, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'dependency', description: 'should import 4 patterns and verify they exist' });
    testLogger.info('=== Testing multiple patterns on ONE field - SEQUENTIAL FLOW ===');
    testLogger.info(`Field: ${fieldName}`);
    testLogger.info('Strategy: Ingest one log → verify → ingest next → verify (repeating pattern)');

    // ==================== STEP 1: Ingest log #1 for query-time drop pattern ====================
    testLogger.info('========== STEP 1: Ingest log with value "application.log" ==========');
    await ingestSingleLog(page, testStreamName, fieldName, queryTimePatterns[0].value); // "application.log"
    await verifySingleFieldInLatestLog(page, pm, testStreamName, fieldName, false, false);
    testLogger.info('✓ STEP 1 PASSED: Log #1 ingested, field visible (no patterns yet)');

    // ==================== STEP 2: Link query-time DROP pattern ====================
    testLogger.info('========== STEP 2: Link query-time DROP pattern (log_filename) ==========');
    await pm.streamAssociationPage.associatePatternWithStream(
      testStreamName,
      queryTimePatterns[0].name, // 'log_filename'
      queryTimePatterns[0].action, // 'drop'
      queryTimePatterns[0].timeType, // 'query'
      fieldName
    );
    testLogger.info('✓ STEP 2 PASSED: Query-time DROP pattern linked');

    // ==================== STEP 3: Verify query-time DROP on existing log ====================
    testLogger.info('========== STEP 3: Verify query-time DROP works on EXISTING log ==========');
    await verifySingleFieldInLatestLog(page, pm, testStreamName, fieldName, true, false);
    testLogger.info('✓ STEP 3 PASSED: Field DROPPED at query time (no re-ingestion needed)');

    // ==================== STEP 4: Ingest log #2 for query-time redact pattern ====================
    testLogger.info('========== STEP 4: Ingest log with value "14:30:45" ==========');
    await ingestSingleLog(page, testStreamName, fieldName, queryTimePatterns[1].value); // "14:30:45"
    await verifySingleFieldInLatestLog(page, pm, testStreamName, fieldName, false, false);
    testLogger.info('✓ STEP 4 PASSED: Log #2 ingested, field visible (pattern not yet linked)');

    // ==================== STEP 5: Link query-time REDACT pattern ====================
    testLogger.info('========== STEP 5: Link query-time REDACT pattern (time_hh_mm_ss) ==========');
    await pm.streamAssociationPage.addAdditionalPatternToField(
      testStreamName,
      fieldName,
      queryTimePatterns[1].name, // 'time_hh_mm_ss'
      queryTimePatterns[1].action, // 'redact'
      queryTimePatterns[1].timeType // 'query'
    );
    testLogger.info('✓ STEP 5 PASSED: Query-time REDACT pattern linked (now 2 patterns total)');

    // ==================== STEP 6: Verify query-time REDACT on existing log ====================
    testLogger.info('========== STEP 6: Verify query-time REDACT works on EXISTING log ==========');
    await verifySingleFieldInLatestLog(page, pm, testStreamName, fieldName, false, true);
    testLogger.info('✓ STEP 6 PASSED: Field REDACTED at query time (no re-ingestion needed)');

    // ==================== STEP 7: Link ingestion-time DROP pattern ====================
    testLogger.info('========== STEP 7: Link ingestion-time DROP pattern (ifsc_code) ==========');
    await pm.streamAssociationPage.addAdditionalPatternToField(
      testStreamName,
      fieldName,
      ingestionTimePatterns[0].name, // 'ifsc_code'
      ingestionTimePatterns[0].action, // 'drop'
      ingestionTimePatterns[0].timeType // 'ingestion'
    );
    testLogger.info('✓ STEP 7 PASSED: Ingestion-time DROP pattern linked (now 3 patterns total)');

    // ==================== STEP 8: Ingest log #3 and verify ingestion-time DROP ====================
    testLogger.info('========== STEP 8: Ingest log with value "AB12CDEF1234567890" ==========');
    await ingestSingleLog(page, testStreamName, fieldName, ingestionTimePatterns[0].value); // IFSC code
    await verifySingleFieldInLatestLog(page, pm, testStreamName, fieldName, true, false);
    testLogger.info('✓ STEP 8 PASSED: Field DROPPED at ingestion time');

    // ==================== STEP 9: Link ingestion-time REDACT pattern ====================
    testLogger.info('========== STEP 9: Link ingestion-time REDACT pattern (date_dd_mm_yyyy) ==========');
    await pm.streamAssociationPage.addAdditionalPatternToField(
      testStreamName,
      fieldName,
      ingestionTimePatterns[1].name, // 'date_dd_mm_yyyy'
      ingestionTimePatterns[1].action, // 'redact'
      ingestionTimePatterns[1].timeType // 'ingestion'
    );
    testLogger.info('✓ STEP 9 PASSED: Ingestion-time REDACT pattern linked (now 4 patterns total on ONE field)');

    // ==================== STEP 10: Ingest log #4 and verify ingestion-time REDACT ====================
    testLogger.info('========== STEP 10: Ingest log with value "25/12/2024" ==========');
    await ingestSingleLog(page, testStreamName, fieldName, ingestionTimePatterns[1].value); // Date
    await verifySingleFieldInLatestLog(page, pm, testStreamName, fieldName, false, true);
    testLogger.info('✓ STEP 10 PASSED: Field REDACTED at ingestion time');

    testLogger.info('=== ✓ ALL 4 PATTERNS ON ONE FIELD TEST COMPLETED SUCCESSFULLY ===');
    testLogger.info('  - Field: multi_data has 4 patterns');
    testLogger.info('  - Query-time: 1 drop + 1 redact (work on existing data)');
    testLogger.info('  - Ingestion-time: 1 drop + 1 redact (require re-ingestion)');
    testLogger.info('  - Each pattern tested independently with sequential ingestion');
  });

  // TEST 4: End cleanup
  test('cleanup: unlink and delete patterns', {
    tag: ['@sdr', '@cleanup', '@import', '@poc']
  }, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'dependency', description: 'should link 4 patterns to one field and verify with sequential ingestion' });
    testLogger.info('=== END CLEANUP: Unlinking and deleting ALL 6 patterns ===');

    // First, unlink ALL patterns from the field in one go (since all 4 test patterns are on the same field)
    testLogger.info(`Unlinking all patterns from field ${fieldName} in stream ${testStreamName}`);
    await pm.streamAssociationPage.unlinkAllPatternsFromField(testStreamName, fieldName);
    testLogger.info('✓ All patterns unlinked from field');

    // Now delete each pattern
    for (const patternName of allImportedPatterns) {
      testLogger.info(`Checking and deleting pattern: ${patternName}`);

      await pm.sdrPatternsPage.navigateToRegexPatterns();
      const exists = await pm.sdrPatternsPage.checkPatternExists(patternName);

      if (exists) {
        testLogger.info(`Pattern ${patternName} exists. Deleting...`);
        const deleteResult = await pm.sdrPatternsPage.deletePatternByName(patternName);

        if (deleteResult.success) {
          testLogger.info(`✓ Pattern ${patternName} deleted successfully`);
        } else if (deleteResult.reason === 'in_use') {
          // This shouldn't happen since we already unlinked, but handle it just in case
          testLogger.warn(`Pattern ${patternName} still in use. Checking associations...`);
          for (const association of deleteResult.associations) {
            testLogger.info(`Unlinking from stream: ${association.streamName}, field: ${association.fieldName}`);
            await pm.streamAssociationPage.unlinkAllPatternsFromField(
              association.streamName,
              association.fieldName
            );
          }
          // Try deleting again with retry logic
          await pm.sdrPatternsPage.navigateToRegexPatterns();
          const finalDelete = await pm.sdrPatternsPage.deletePatternByName(patternName);

          if (!finalDelete.success) {
            testLogger.warn(`Pattern ${patternName} still in use after unlinking, waiting and retrying...`);
            await page.waitForTimeout(2000);
            await pm.sdrPatternsPage.navigateToRegexPatterns();
            const retryDelete = await pm.sdrPatternsPage.deletePatternByName(patternName);
            expect(retryDelete.success).toBeTruthy();
            testLogger.info(`✓ Pattern ${patternName} deleted successfully on retry`);
          } else {
            testLogger.info(`✓ Pattern ${patternName} deleted successfully after unlinking`);
          }
        } else {
          throw new Error(`Failed to delete pattern ${patternName}. Reason: ${deleteResult.reason}`);
        }
      } else {
        testLogger.info(`✓ Pattern ${patternName} does not exist, no cleanup needed`);
      }
    }

    // Verify all patterns have been removed
    testLogger.info('Verifying all patterns have been removed');
    await pm.sdrPatternsPage.navigateToRegexPatterns();
    await page.waitForTimeout(1000);

    for (const patternName of allImportedPatterns) {
      const exists = await pm.sdrPatternsPage.verifyPatternExistsInList(patternName);
      expect(exists).toBeFalsy();
      testLogger.info(`✓ Verified pattern ${patternName} is removed`);
    }

    testLogger.info('=== END CLEANUP COMPLETE ===');
  });
});
