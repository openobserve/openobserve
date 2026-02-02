const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Helper function to ingest a SINGLE log entry with retry logic
async function ingestSingleLog(page, streamName, fieldName, fieldValue, maxRetries = 5) {
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

  //Retry ingestion with exponential backoff for "stream being deleted" errors
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
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

    testLogger.info(`Ingestion API response (attempt ${attempt}/${maxRetries}) - Status: ${response.status}, Body:`, response.body);

    if (response.status === 200) {
      testLogger.info('Ingestion successful, waiting for stream to be indexed...');
      await page.waitForTimeout(3000);
      return;
    }

    // Check for "stream being deleted" error - retry with backoff
    const errorMessage = response.body?.message || JSON.stringify(response.body);
    if (errorMessage.includes('being deleted') && attempt < maxRetries) {
      const waitTime = attempt * 5000;
      testLogger.info(`Stream is being deleted, waiting ${waitTime/1000}s before retry...`);
      await page.waitForTimeout(waitTime);
      continue;
    }

    testLogger.error(`Ingestion failed! Status: ${response.status}, Response:`, response.body);
    throw new Error(`Ingestion failed with status ${response.status}: ${JSON.stringify(response.body)}`);
  }
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

test.describe("Multiple Patterns on One Field", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  // Generate unique test run ID for isolation - ensures parallel test runs don't conflict
  const testRunId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

  // Query-time patterns (2) - tested first, no re-ingestion needed
  // Each pattern name includes testRunId for isolation
  const queryTimePatterns = [
    { name: `log_filename_${testRunId}`, description: 'Log file name format', pattern: '^\\w+\\.log$', value: 'application.log', action: 'drop', timeType: 'query', scenario: 'query_drop' },
    { name: `time_hh_mm_ss_${testRunId}`, description: 'Time in HH:MM:SS format', pattern: '^\\d{2}:\\d{2}:\\d{2}$', value: '14:30:45', action: 'redact', timeType: 'query', scenario: 'query_redact' }
  ];

  // Ingestion-time patterns (2) - tested second, requires re-ingestion
  const ingestionTimePatterns = [
    { name: `ifsc_code_${testRunId}`, description: 'IFSC code format validation', pattern: '^[A-Z]{2}\\d{2}[A-Z]{4}\\d{10}$', value: 'AB12CDEF1234567890', action: 'drop', timeType: 'ingestion', scenario: 'ingestion_drop' },
    { name: `date_dd_mm_yyyy_${testRunId}`, description: 'Date in DD/MM/YYYY format', pattern: '^\\d{2}/\\d{2}/\\d{4}$', value: '25/12/2024', action: 'redact', timeType: 'ingestion', scenario: 'ingestion_redact' }
  ];

  // All patterns for this test run (for cleanup)
  const allTestPatterns = [...queryTimePatterns.map(p => p.name), ...ingestionTimePatterns.map(p => p.name)];

  const fieldName = "multi_data"; // Single field for all patterns
  // Use unique stream name to avoid "stream being deleted" conflicts
  const testStreamName = `sdr_poc_multi_${testRunId}`;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle');
    testLogger.info('Import POC test setup completed');
  });

  // TEST 1: Create patterns for this test run
  test('setup: create patterns', {
    tag: ['@sdr', '@cleanup', '@poc']
  }, async ({ page }) => {
    testLogger.info(`=== SETUP: Creating 4 patterns with unique testRunId: ${testRunId} ===`);

    // Combine both pattern arrays
    const allPatternsToCreate = [...queryTimePatterns, ...ingestionTimePatterns];

    // Create each pattern directly
    for (const patternDef of allPatternsToCreate) {
      testLogger.info(`Creating pattern: ${patternDef.name}`);
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      await pm.sdrPatternsPage.createPattern(patternDef.name, patternDef.description, patternDef.pattern);
      await pm.sdrPatternsPage.verifyPatternCreatedSuccess();
      testLogger.info(`✓ Pattern ${patternDef.name} created successfully`);
    }

    // Verify each pattern exists
    testLogger.info('Verifying all 4 patterns exist');
    await pm.sdrPatternsPage.navigateToRegexPatterns();
    await page.waitForTimeout(1000);

    for (const pattern of allPatternsToCreate) {
      const exists = await pm.sdrPatternsPage.verifyPatternExistsInList(pattern.name);
      expect(exists).toBeTruthy();
      testLogger.info(`✓ Pattern ${pattern.name} verified`);
    }

    testLogger.info('=== SETUP COMPLETE: All 4 patterns created ===');
  });

  // TEST 2: Multiple patterns on ONE field (SEQUENTIAL FLOW)
  // This test has 10 steps with multiple navigations, so needs extended timeout
  test('should link 4 patterns to one field and verify with sequential ingestion', {
    tag: ['@sdr', '@poc', '@multiPattern']
  }, async ({ page }, testInfo) => {
    // Extend timeout to 5 minutes - this test has 10 sequential steps with navigation
    test.setTimeout(300000);
    testInfo.annotations.push({ type: 'dependency', description: 'setup: create patterns' });
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

  // TEST 3: End cleanup
  test('cleanup: unlink and delete patterns', {
    tag: ['@sdr', '@cleanup', '@poc']
  }, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'dependency', description: 'should link 4 patterns to one field and verify with sequential ingestion' });
    testLogger.info(`=== END CLEANUP: Unlinking and deleting patterns for testRunId: ${testRunId} ===`);

    // First, unlink ALL patterns from the field in one go
    testLogger.info(`Unlinking all patterns from field ${fieldName} in stream ${testStreamName}`);
    await pm.streamAssociationPage.unlinkAllPatternsFromField(testStreamName, fieldName);
    testLogger.info('✓ All patterns unlinked from field');

    // Now delete each pattern (only our test's patterns with unique suffix)
    for (const patternName of allTestPatterns) {
      testLogger.info(`Checking and deleting pattern: ${patternName}`);

      await pm.sdrPatternsPage.navigateToRegexPatterns();
      const exists = await pm.sdrPatternsPage.checkPatternExists(patternName);

      if (exists) {
        testLogger.info(`Pattern ${patternName} exists. Deleting...`);
        const deleteResult = await pm.sdrPatternsPage.deletePatternByName(patternName);

        if (deleteResult.success) {
          testLogger.info(`✓ Pattern ${patternName} deleted successfully`);
        } else if (deleteResult.reason === 'in_use') {
          testLogger.warn(`Pattern ${patternName} still in use. Unlinking and retrying...`);
          for (const association of deleteResult.associations) {
            await pm.streamAssociationPage.unlinkAllPatternsFromField(
              association.streamName,
              association.fieldName
            );
          }
          await pm.sdrPatternsPage.navigateToRegexPatterns();
          const retryDelete = await pm.sdrPatternsPage.deletePatternByName(patternName);
          if (retryDelete.success) {
            testLogger.info(`✓ Pattern ${patternName} deleted after unlinking`);
          } else {
            testLogger.warn(`⚠ Could not delete pattern ${patternName}, may need manual cleanup`);
          }
        }
      } else {
        testLogger.info(`✓ Pattern ${patternName} does not exist, no cleanup needed`);
      }
    }

    testLogger.info('=== END CLEANUP COMPLETE ===');
  });
});
