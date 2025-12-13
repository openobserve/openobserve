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

  // For each field we want to verify, check if it exists in logs
  for (const { fieldName, shouldBeDropped } of fieldsToVerify) {
    testLogger.info(`Verifying field: ${fieldName}, shouldBeDropped: ${shouldBeDropped}`);

    let foundInAnyLog = false;

    // Search through all logs to see if field exists
    for (let i = 0; i < allLogTexts.length; i++) {
      const logText = allLogTexts[i];
      const fieldAsJsonKey = `"${fieldName}":`;
      const fieldAsKey = `${fieldName}:`;

      if (logText.includes(fieldAsJsonKey) || logText.includes(fieldAsKey)) {
        foundInAnyLog = true;
        testLogger.info(`Found ${fieldName} in log ${i}`);
        break;
      }
    }

    if (shouldBeDropped) {
      // Field should NOT be found in any log
      expect(foundInAnyLog).toBeFalsy();
      testLogger.info(`✓ Field ${fieldName} is correctly DROPPED at query time`);
    } else {
      // Field should be found in at least one log
      expect(foundInAnyLog).toBeTruthy();
      testLogger.info(`✓ Field ${fieldName} is visible as expected`);
    }
  }
}


test.describe("Query Time Drop - Combined Test", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  // Generate unique test run ID for isolation
  const testRunId = Date.now().toString(36);

  // All patterns used in this spec file - with full pattern definitions for uniqueness
  const patternsToTest = [
    {
      name: `url_format_query_drop_${testRunId}`,
      description: 'URL validation pattern (for query time drop tests)',
      pattern: '^https?://[\\w.-]+\\.[\\w.-]+.*$',
      field: 'website_url',
      value: 'https://openobserve.ai/docs'
    },
    {
      name: `strong_password_query_drop_${testRunId}`,
      description: 'Strong password pattern (for query time drop tests)',
      pattern: '^[A-Za-z0-9@$!%*?&]{8,}$',
      field: 'user_password',
      value: 'Xyz@1234'
    },
    {
      name: `ipv4_address_query_drop_${testRunId}`,
      description: 'IPv4 address format (for query time drop tests)',
      pattern: '^(\\d{1,3}\\.){3}\\d{1,3}$',
      field: 'server_ip',
      value: '192.168.1.100'
    },
    {
      name: `hex_color_query_drop_${testRunId}`,
      description: 'Hexadecimal color code (for query time drop tests)',
      pattern: '^#[0-9a-fA-F]{6}$',
      field: 'theme_color',
      value: '#1A2b3C'
    }
  ];

  // Use unique stream name to avoid "stream being deleted" conflicts
  const testStreamName = `sdr_query_drop_${testRunId}`;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle');
    testLogger.info('Combined query time drop test setup completed');
  });

  test("setup: cleanup patterns", {
    tag: ['@sdr', '@cleanup', '@queryDrop']
  }, async ({ page }) => {
    testLogger.info('=== SPEC-LEVEL CLEANUP: Cleaning up patterns for combined query drop test ===');

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

  test("should drop multiple fields at query time when patterns are applied", {
    tag: ['@sdr', '@queryDrop', '@all', '@combined']
  }, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'dependency', description: 'setup: cleanup patterns' });

    testLogger.info('=== Testing combined drop for 4 patterns at query time ===');

    // STEP 1: Ingest data once (data will remain unchanged in storage)
    testLogger.info('STEP 1: Ingest 4 lines of data (before any patterns are applied)');

    const dataToIngest = patternsToTest.map(p => ({
      fieldName: p.field,
      fieldValue: p.value
    }));

    await pm.logsPage.ingestMultipleFields(testStreamName, dataToIngest);

    // Verify all fields are visible before drop
    testLogger.info('Verifying 4 fields for drop status');
    const fieldsBeforeDrop = patternsToTest.map(p => ({
      fieldName: p.field,
      shouldBeDropped: false
    }));
    await verifyMultipleFieldsDrop(page, pm, testStreamName, fieldsBeforeDrop);
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

    // STEP 3: Link all 4 patterns to their respective fields with QUERY TIME drop
    testLogger.info('STEP 3: Link all 4 patterns to their respective fields with DROP action');

    for (const patternConfig of patternsToTest) {
      await pm.streamAssociationPage.associatePatternWithStream(
        testStreamName,
        patternConfig.name,
        'drop',
        'query', // QUERY TIME - key difference from ingestion time
        patternConfig.field
      );
      testLogger.info(`✓ Linked pattern ${patternConfig.name} to field ${patternConfig.field} with DROP action`);
    }

    testLogger.info('✓ STEP 3 PASSED: All 4 patterns linked to fields with DROP action');

    // STEP 4: Verify all fields are DROPPED at query time (NO RE-INGESTION)
    testLogger.info('STEP 4: Verify fields are DROPPED at query time (data unchanged in storage)');

    const fieldsAfterDrop = patternsToTest.map(p => ({
      fieldName: p.field,
      shouldBeDropped: true
    }));
    await verifyMultipleFieldsDrop(page, pm, testStreamName, fieldsAfterDrop);
    testLogger.info('✓ STEP 4 PASSED: All fields are DROPPED at query time');

    testLogger.info('=== ✓ COMBINED QUERY TIME DROP TEST COMPLETED SUCCESSFULLY ===');
  });
});
