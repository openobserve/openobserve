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

async function verifyMultipleFieldsDrop(page, pm, streamName, fieldsToVerify) {
  testLogger.info(`Verifying ${fieldsToVerify.length} fields for drop status`);

  await closeStreamDetailSidebar(page);
  await navigateToLogsQuick(page);
  await pm.logsPage.selectStream(streamName);
  await page.waitForTimeout(1000);
  await pm.logsPage.clickRefreshButton();
  await page.waitForTimeout(2000);

  // Try multiple selectors to find all log entries
  let logTableCell = page.locator('[data-test="log-table-column-0-source"]');
  let logCount = await logTableCell.count();
  testLogger.info(`Selector [data-test="log-table-column-0-source"] found ${logCount} entries`);

  // If that doesn't work, try table rows
  if (logCount < fieldsToVerify.length) {
    logTableCell = page.locator('.logs-result-table tbody tr[role="row"]');
    logCount = await logTableCell.count();
    testLogger.info(`Selector .logs-result-table tbody tr[role="row"] found ${logCount} entries`);
  }

  // Try another common selector
  if (logCount < fieldsToVerify.length) {
    logTableCell = page.locator('tbody tr');
    logCount = await logTableCell.count();
    testLogger.info(`Selector tbody tr found ${logCount} entries`);
  }

  testLogger.info(`Final: Found ${logCount} log entries in the UI`);

  if (logCount === 0) {
    throw new Error('No logs found in the stream');
  }

  // Get all log texts
  const allLogTexts = [];
  for (let i = 0; i < logCount; i++) {
    const text = await logTableCell.nth(i).textContent();
    allLogTexts.push(text);
  }

  // For each field we want to verify, search through all logs to find the one containing that field
  for (const { fieldName, shouldBeDropped } of fieldsToVerify) {
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

    // For DROP, the logic is different - if dropped, the field should NOT be found at all
    if (shouldBeDropped) {
      // Field should be dropped - we shouldn't have found it
      testLogger.error(`Field ${fieldName} should have been DROPPED but was found in logs!`);
      throw new Error(`Field ${fieldName} was not dropped - still present in logs`);
    } else {
      // Field should be visible - we found it, good
      testLogger.info(`✓ Field ${fieldName} is visible with actual value (as expected)`);
    }
  }
}

// Special verification for dropped fields - they should NOT exist
async function verifyFieldsAreDropped(page, pm, streamName, fieldNames) {
  testLogger.info(`Verifying ${fieldNames.length} fields are DROPPED (not present) - checking ONLY most recent logs`);

  await closeStreamDetailSidebar(page);
  await navigateToLogsQuick(page);
  await pm.logsPage.selectStream(streamName);
  await page.waitForTimeout(1000);
  await pm.logsPage.clickRefreshButton();
  await page.waitForTimeout(2000);

  // Get all logs
  let logTableCell = page.locator('[data-test="log-table-column-0-source"]');
  let logCount = await logTableCell.count();

  if (logCount < fieldNames.length) {
    logTableCell = page.locator('tbody tr');
    logCount = await logTableCell.count();
  }

  testLogger.info(`Found ${logCount} log entries total. Will check only the FIRST ${fieldNames.length} logs (most recent)`);

  // Get only the FIRST N logs (most recent ones at the top)
  const recentLogTexts = [];
  const logsToCheck = Math.min(logCount, fieldNames.length);
  for (let i = 0; i < logsToCheck; i++) {
    const text = await logTableCell.nth(i).textContent();
    recentLogTexts.push(text);
    testLogger.info(`Log ${i}: ${text.substring(0, 150)}...`);
  }

  // For each field, verify it's NOT present in the recent logs
  for (const fieldName of fieldNames) {
    testLogger.info(`Verifying field ${fieldName} is DROPPED (not present in recent logs)`);

    let foundInRecentLogs = false;
    for (let i = 0; i < recentLogTexts.length; i++) {
      const logText = recentLogTexts[i];
      const fieldAsJsonKey = `"${fieldName}":`;
      const fieldAsKey = `${fieldName}:`;

      if (logText.includes(fieldAsJsonKey) || logText.includes(fieldAsKey)) {
        foundInRecentLogs = true;
        testLogger.error(`Field ${fieldName} found in recent log ${i}: ${logText.substring(0, 200)}`);
        break;
      }
    }

    if (foundInRecentLogs) {
      throw new Error(`Field ${fieldName} should have been DROPPED but was found in recent logs!`);
    }

    testLogger.info(`✓ Field ${fieldName} is correctly DROPPED (not present in recent logs)`);
  }
}


test.describe("Ingestion Time Drop - Combined Test", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  // Generate unique test run ID for isolation
  const testRunId = Date.now().toString(36);

  // All patterns used in this spec file - with full pattern definitions for uniqueness
  const patternsToTest = [
    {
      name: `url_format_drop_${testRunId}`,
      description: 'URL validation pattern (for drop tests)',
      pattern: '^https?://[\\w.-]+\\.[\\w.-]+.*$',
      field: 'website_url',
      value: 'https://example.com'
    },
    {
      name: `strong_password_drop_${testRunId}`,
      description: 'Strong password pattern (for drop tests)',
      pattern: '^[A-Za-z0-9@$!%*?&]{8,}$',
      field: 'user_password',
      value: 'P@ssw0rd!123'
    },
    {
      name: `ipv4_address_drop_${testRunId}`,
      description: 'IPv4 address format (for drop tests)',
      pattern: '^(\\d{1,3}\\.){3}\\d{1,3}$',
      field: 'server_ip',
      value: '192.168.1.1'
    },
    {
      name: `hex_color_drop_${testRunId}`,
      description: 'Hexadecimal color code (for drop tests)',
      pattern: '^#[0-9a-fA-F]{6}$',
      field: 'theme_color',
      value: '#FF5733'
    }
  ];

  // Use unique stream name to avoid "stream being deleted" conflicts
  const testStreamName = `sdr_drop_${testRunId}`;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Override the navigateToLogs method to skip VRL editor wait for this test
    const originalNavigateToLogs = pm.logsPage.navigateToLogs.bind(pm.logsPage);
    pm.logsPage.navigateToLogs = async function() {
      await this.logsMenuItem.click();
      await page.waitForLoadState('networkidle');
      testLogger.info('Navigated to Logs (skipped VRL editor wait)');
    };

    await page.waitForLoadState('networkidle');
    testLogger.info('Combined ingestion time drop test setup completed');
  });

  // Cleanup test - runs first
  test('setup: cleanup patterns', {
    tag: ['@sdr', '@cleanup', '@ingestionDrop']
  }, async ({ page }) => {
    testLogger.info('=== SPEC-LEVEL CLEANUP: Cleaning up patterns for combined drop test ===');

    // Clean up all patterns used in this spec file
    for (const pattern of patternsToTest) {
      testLogger.info(`Checking and cleaning up pattern: ${pattern.name}`);

      await pm.sdrPatternsPage.navigateToRegexPatterns();
      const exists = await pm.sdrPatternsPage.checkPatternExists(pattern.name);

      if (exists) {
        testLogger.info(`Pattern ${pattern.name} exists. Deleting (and unlinking if needed).`);
        const deleteResult = await pm.sdrPatternsPage.deletePatternByName(pattern.name);

        if (!deleteResult.success && deleteResult.reason === 'in_use') {
          testLogger.info(`Pattern ${pattern.name} in use, unlinking from streams first`);
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
        testLogger.info(`✓ Cleaned up pattern: ${pattern.name}`);
      } else {
        testLogger.info(`✓ Pattern ${pattern.name} does not exist, no cleanup needed`);
      }
    }

    testLogger.info('=== SPEC-LEVEL CLEANUP COMPLETE ===');
  });

  // Combined test for all 4 patterns
  test("should drop multiple fields at ingestion time when patterns are applied", {
    tag: ['@sdr', '@ingestionDrop', '@all', '@combined']
  }, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'dependency', description: 'setup: cleanup patterns' });
    testLogger.info('=== Testing combined DROP for 4 patterns at ingestion time ===');

    // STEP 1: Ingest data WITHOUT any SDR patterns - all fields should be visible
    testLogger.info('STEP 1: Ingest 4 lines of data WITHOUT any SDR patterns linked');
    const dataToIngest = patternsToTest.map(p => ({ fieldName: p.field, fieldValue: p.value }));
    await pm.logsPage.ingestMultipleFields(testStreamName, dataToIngest);

    const fieldsToVerifyStep1 = patternsToTest.map(p => ({ fieldName: p.field, shouldBeDropped: false }));
    await verifyMultipleFieldsDrop(page, pm, testStreamName, fieldsToVerifyStep1);
    testLogger.info('✓ STEP 1 PASSED: All fields visible without SDR');

    // STEP 2: Create all 4 SDR patterns
    testLogger.info('STEP 2: Create all 4 SDR patterns');
    for (const patternConfig of patternsToTest) {
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      await pm.sdrPatternsPage.createPattern(patternConfig.name, patternConfig.description, patternConfig.pattern);
      await pm.sdrPatternsPage.verifyPatternCreatedSuccess();

      // Verify the pattern actually exists in the list
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      const exists = await pm.sdrPatternsPage.checkPatternExists(patternConfig.name);
      if (!exists) {
        testLogger.error(`Pattern ${patternConfig.name} was not created successfully!`);
        throw new Error(`Pattern ${patternConfig.name} creation failed - not found in list`);
      }
      testLogger.info(`✓ Created and verified pattern: ${patternConfig.name}`);
    }
    testLogger.info('✓ STEP 2 PASSED: All 4 patterns created and verified');

    // STEP 3: Link all 4 patterns to their respective fields with DROP action
    testLogger.info('STEP 3: Link all 4 patterns to their respective fields with DROP action');
    for (const patternConfig of patternsToTest) {
      await pm.streamAssociationPage.associatePatternWithStream(
        testStreamName,
        patternConfig.name,
        'drop',
        'ingestion',
        patternConfig.field
      );
      testLogger.info(`✓ Linked pattern ${patternConfig.name} to field ${patternConfig.field} with DROP action`);
    }
    testLogger.info('✓ STEP 3 PASSED: All 4 patterns linked to fields with DROP action');

    // STEP 4: Ingest data WITH SDR patterns linked - all fields should be DROPPED
    testLogger.info('STEP 4: Ingest 4 lines of data WITH SDR patterns linked');
    await pm.logsPage.ingestMultipleFields(testStreamName, dataToIngest);

    const fieldsToCheck = patternsToTest.map(p => p.field);
    await verifyFieldsAreDropped(page, pm, testStreamName, fieldsToCheck);
    testLogger.info('✓ STEP 4 PASSED: All fields are DROPPED (not present)');

    testLogger.info('=== ✓ COMBINED DROP TEST COMPLETED SUCCESSFULLY ===');
  });
});
