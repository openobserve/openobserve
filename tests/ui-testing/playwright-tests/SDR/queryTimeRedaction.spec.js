const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const testData = require("../../../test-data/sdr_test_data.json");

async function ingestMultipleFields(page, streamName, dataObjects) {
  const orgId = process.env["ORGNAME"];
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };

  const baseTimestamp = Date.now() * 1000;
  const logData = dataObjects.map(({ fieldName, fieldValue }, index) => ({
    level: "info",
    [fieldName]: fieldValue,
    log: `Test log with ${fieldName} field - entry ${index}`,
    _timestamp: baseTimestamp + (index * 1000000) // Add 1ms offset for each log to ensure they're separate
  }));

  testLogger.info(`Preparing to ingest ${logData.length} separate log entries`);

  const response = await page.evaluate(async ({ url, headers, orgId, streamName, logData }) => {
    const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(logData)
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
    logData: logData
  });

  testLogger.info(`Ingestion API response - Status: ${response.status}, Body:`, response.body);

  if (response.status !== 200) {
    testLogger.error(`Ingestion failed! Status: ${response.status}, Response:`, response.body);
  }

  await page.waitForTimeout(2000);
}

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

async function verifyMultipleFieldsRedaction(page, pm, streamName, fieldsToVerify) {
  testLogger.info(`Verifying ${fieldsToVerify.length} fields for redaction status`);

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
  for (const { fieldName, shouldBeRedacted } of fieldsToVerify) {
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

  // All patterns used in this spec file for QUERY TIME REDACTION tests
  const patternsToTest = [
    { name: 'email_format_query_redact', field: 'user_email', value: 'john.doe@example.com' },
    { name: 'us_phone_query_redact', field: 'phone', value: '5551234567' },
    { name: 'credit_card_query_redact', field: 'cc_number', value: '1234 5678 9012 3456' },
    { name: 'ssn_query_redact', field: 'ssn', value: '123-45-6789' }
  ];

  const testStreamName = "sdr_query_redact_combined_test";

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

    await ingestMultipleFields(page, testStreamName, dataToIngest);

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

    for (const pattern of patternsToTest) {
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      const patternData = testData.regexPatterns.find(p => p.name === pattern.name);
      if (!patternData) {
        throw new Error(`Pattern ${pattern.name} not found in test data`);
      }
      await pm.sdrPatternsPage.createPattern(patternData.name, patternData.description, patternData.pattern);
      await pm.sdrPatternsPage.verifyPatternCreatedSuccess();

      // Verify pattern was created
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      const exists = await pm.sdrPatternsPage.checkPatternExists(patternData.name);
      expect(exists).toBeTruthy();
      testLogger.info(`✓ Created and verified pattern: ${pattern.name}`);
    }

    testLogger.info('✓ STEP 2 PASSED: All 4 patterns created and verified');

    // STEP 3: Link all 4 patterns to their respective fields with QUERY TIME redaction
    testLogger.info('STEP 3: Link all 4 patterns to their respective fields');

    for (const pattern of patternsToTest) {
      const patternData = testData.regexPatterns.find(p => p.name === pattern.name);
      await pm.streamAssociationPage.associatePatternWithStream(
        testStreamName,
        pattern.name,
        'redact',
        'query', // QUERY TIME - key difference from ingestion time
        patternData.testField
      );
      testLogger.info(`✓ Linked pattern ${pattern.name} to field ${pattern.field}`);
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
