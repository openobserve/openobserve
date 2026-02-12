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
      await page.waitForTimeout(5000);
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

  // API helper for setup/cleanup — no browser context needed
  function getApiConfig() {
    const baseUrl = process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080';
    const org = process.env.ORGNAME || 'default';
    const authHeader = 'Basic ' + Buffer.from(
      `${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`
    ).toString('base64');
    return { baseUrl, org, headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' } };
  }

  // Setup: Create patterns via API before tests run.
  // Uses beforeAll so it always executes even during -g filtered reruns.
  test.beforeAll(async () => {
    testLogger.info(`=== SETUP (beforeAll): Creating 4 patterns via API, testRunId: ${testRunId} ===`);
    const { baseUrl, org, headers } = getApiConfig();
    const allPatternsToCreate = [...queryTimePatterns, ...ingestionTimePatterns];

    for (const patternDef of allPatternsToCreate) {
      const res = await fetch(`${baseUrl}/api/${org}/re_patterns`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: patternDef.name, description: patternDef.description, pattern: patternDef.pattern })
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to create pattern ${patternDef.name}: ${res.status} ${body}`);
      }
      testLogger.info(`Pattern ${patternDef.name} created via API`);
    }

    // Verify all patterns exist
    const listRes = await fetch(`${baseUrl}/api/${org}/re_patterns`, { headers });
    const listData = await listRes.json();
    const existingNames = new Set((listData.patterns || []).map(p => p.name));
    for (const p of allPatternsToCreate) {
      if (!existingNames.has(p.name)) {
        throw new Error(`Pattern ${p.name} not found after creation`);
      }
    }
    testLogger.info('=== SETUP COMPLETE: All 4 patterns created via API ===');
  });

  // Cleanup: Unlink patterns from stream + delete patterns via API.
  // Uses afterAll so it always executes even during -g filtered reruns.
  // NOTE: The stream settings PUT uses a DELTA format { add: [], remove: [] },
  // NOT a replacement format. Sending { pattern_associations: [] } is a no-op.
  test.afterAll(async () => {
    testLogger.info(`=== CLEANUP (afterAll): API cleanup for testRunId: ${testRunId} ===`);
    const { baseUrl, org, headers } = getApiConfig();

    // Step 1: List patterns to get their IDs (needed for both unlink and delete)
    let patternMap = {}; // name -> { id, description, pattern }
    try {
      const listRes = await fetch(`${baseUrl}/api/${org}/re_patterns`, { headers });
      if (listRes.ok) {
        const listData = await listRes.json();
        const testPatternNames = new Set(allTestPatterns);
        for (const p of (listData.patterns || [])) {
          if (testPatternNames.has(p.name)) {
            patternMap[p.name] = { id: p.id, description: p.description || '', pattern: p.pattern || '' };
          }
        }
        testLogger.info(`Found ${Object.keys(patternMap).length} test patterns to clean up`);
      }
    } catch (listError) {
      testLogger.warn(`Could not list patterns: ${listError.message}`);
    }

    // Step 2: Unlink patterns using delta format { remove: [...associations] }
    // The backend expects PatternAssociation objects with field, pattern_name, pattern_id, policy, apply_at
    const allPatternDefs = [...queryTimePatterns, ...ingestionTimePatterns];
    const removeAssociations = [];
    for (const pDef of allPatternDefs) {
      const info = patternMap[pDef.name];
      if (info) {
        removeAssociations.push({
          field: fieldName,
          pattern_name: pDef.name,
          pattern_id: info.id,
          description: info.description,
          pattern: info.pattern,
          policy: pDef.action,
          apply_at: pDef.timeType
        });
      }
    }

    if (removeAssociations.length > 0) {
      try {
        const updateRes = await fetch(`${baseUrl}/api/${org}/streams/${testStreamName}/settings?type=logs`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ pattern_associations: { add: [], remove: removeAssociations } })
        });
        if (updateRes.ok) {
          testLogger.info(`Unlinked ${removeAssociations.length} patterns from stream via API`);
        } else {
          const updateBody = await updateRes.text();
          testLogger.warn(`Stream settings update returned ${updateRes.status}: ${updateBody}`);
        }
      } catch (unlinkError) {
        testLogger.warn(`Could not unlink patterns: ${unlinkError.message}`);
      }
    }

    // Step 3: Delete patterns by ID (now that they're unlinked)
    for (const [name, info] of Object.entries(patternMap)) {
      try {
        const delRes = await fetch(`${baseUrl}/api/${org}/re_patterns/${info.id}`, {
          method: 'DELETE', headers
        });
        if (delRes.ok) {
          testLogger.info(`Pattern ${name} deleted via API`);
        } else {
          const delBody = await delRes.text();
          testLogger.warn(`Pattern ${name} delete returned ${delRes.status}: ${delBody}`);
        }
      } catch (delError) {
        testLogger.warn(`Pattern ${name} delete failed: ${delError.message}`);
      }
    }

    testLogger.info('=== CLEANUP COMPLETE ===');
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle');
    testLogger.info('Import POC test setup completed');
  });

  // Multiple patterns on ONE field (SEQUENTIAL FLOW)
  // This test has 10 steps with multiple navigations, so needs extended timeout
  test('should link 4 patterns to one field and verify with sequential ingestion', {
    tag: ['@sdr', '@poc', '@sdrMultiPattern']
  }, async ({ page }, testInfo) => {
    // Extend timeout to 5 minutes - this test has 10 sequential steps with navigation
    test.setTimeout(300000);
    testLogger.info('=== Testing multiple patterns on ONE field - SEQUENTIAL FLOW ===');
    testLogger.info(`Field: ${fieldName}`);
    testLogger.info('Strategy: Ingest one log → verify → ingest next → verify (repeating pattern)');

    // ==================== STEP 1: Ingest log #1 for query-time drop pattern ====================
    testLogger.info('========== STEP 1: Ingest log with value "application.log" ==========');
    await ingestSingleLog(page, testStreamName, fieldName, queryTimePatterns[0].value); // "application.log"
    await pm.sdrVerificationPage.verifySingleFieldInLatestLog(pm.logsPage, testStreamName, fieldName, false, false);
    testLogger.info('STEP 1 PASSED: Log #1 ingested, field visible (no patterns yet)');

    // ==================== STEP 2: Link query-time DROP pattern ====================
    testLogger.info('========== STEP 2: Link query-time DROP pattern (log_filename) ==========');
    await pm.streamAssociationPage.associatePatternWithStream(
      testStreamName,
      queryTimePatterns[0].name, // 'log_filename'
      queryTimePatterns[0].action, // 'drop'
      queryTimePatterns[0].timeType, // 'query'
      fieldName
    );
    testLogger.info('STEP 2 PASSED: Query-time DROP pattern linked');

    // ==================== STEP 3: Verify query-time DROP on existing log ====================
    testLogger.info('========== STEP 3: Verify query-time DROP works on EXISTING log ==========');
    await pm.sdrVerificationPage.verifySingleFieldInLatestLog(pm.logsPage, testStreamName, fieldName, true, false);
    testLogger.info('STEP 3 PASSED: Field DROPPED at query time (no re-ingestion needed)');

    // ==================== STEP 4: Ingest log #2 for query-time redact pattern ====================
    testLogger.info('========== STEP 4: Ingest log with value "14:30:45" ==========');
    await ingestSingleLog(page, testStreamName, fieldName, queryTimePatterns[1].value); // "14:30:45"
    await pm.sdrVerificationPage.verifySingleFieldInLatestLog(pm.logsPage, testStreamName, fieldName, false, false);
    testLogger.info('STEP 4 PASSED: Log #2 ingested, field visible (pattern not yet linked)');

    // ==================== STEP 5: Link query-time REDACT pattern ====================
    testLogger.info('========== STEP 5: Link query-time REDACT pattern (time_hh_mm_ss) ==========');
    await pm.streamAssociationPage.addAdditionalPatternToField(
      testStreamName,
      fieldName,
      queryTimePatterns[1].name, // 'time_hh_mm_ss'
      queryTimePatterns[1].action, // 'redact'
      queryTimePatterns[1].timeType // 'query'
    );
    testLogger.info('STEP 5 PASSED: Query-time REDACT pattern linked (now 2 patterns total)');

    // ==================== STEP 6: Verify query-time REDACT on existing log ====================
    testLogger.info('========== STEP 6: Verify query-time REDACT works on EXISTING log ==========');
    await pm.sdrVerificationPage.verifySingleFieldInLatestLog(pm.logsPage, testStreamName, fieldName, false, true);
    testLogger.info('STEP 6 PASSED: Field REDACTED at query time (no re-ingestion needed)');

    // ==================== STEP 7: Link ingestion-time DROP pattern ====================
    testLogger.info('========== STEP 7: Link ingestion-time DROP pattern (ifsc_code) ==========');
    await pm.streamAssociationPage.addAdditionalPatternToField(
      testStreamName,
      fieldName,
      ingestionTimePatterns[0].name, // 'ifsc_code'
      ingestionTimePatterns[0].action, // 'drop'
      ingestionTimePatterns[0].timeType // 'ingestion'
    );
    testLogger.info('STEP 7 PASSED: Ingestion-time DROP pattern linked (now 3 patterns total)');

    // ==================== STEP 8: Ingest log #3 and verify ingestion-time DROP ====================
    testLogger.info('========== STEP 8: Ingest log with value "AB12CDEF1234567890" ==========');
    await ingestSingleLog(page, testStreamName, fieldName, ingestionTimePatterns[0].value); // IFSC code
    await pm.sdrVerificationPage.verifySingleFieldInLatestLog(pm.logsPage, testStreamName, fieldName, true, false);
    testLogger.info('STEP 8 PASSED: Field DROPPED at ingestion time');

    // ==================== STEP 9: Link ingestion-time REDACT pattern ====================
    testLogger.info('========== STEP 9: Link ingestion-time REDACT pattern (date_dd_mm_yyyy) ==========');
    await pm.streamAssociationPage.addAdditionalPatternToField(
      testStreamName,
      fieldName,
      ingestionTimePatterns[1].name, // 'date_dd_mm_yyyy'
      ingestionTimePatterns[1].action, // 'redact'
      ingestionTimePatterns[1].timeType // 'ingestion'
    );
    testLogger.info('STEP 9 PASSED: Ingestion-time REDACT pattern linked (now 4 patterns total on ONE field)');

    // ==================== STEP 10: Ingest log #4 and verify ingestion-time REDACT ====================
    testLogger.info('========== STEP 10: Ingest log with value "25/12/2024" ==========');
    await ingestSingleLog(page, testStreamName, fieldName, ingestionTimePatterns[1].value); // Date
    await pm.sdrVerificationPage.verifySingleFieldInLatestLog(pm.logsPage, testStreamName, fieldName, false, true);
    testLogger.info('STEP 10 PASSED: Field REDACTED at ingestion time');

    testLogger.info('=== ALL 4 PATTERNS ON ONE FIELD TEST COMPLETED SUCCESSFULLY ===');
    testLogger.info('  - Field: multi_data has 4 patterns');
    testLogger.info('  - Query-time: 1 drop + 1 redact (work on existing data)');
    testLogger.info('  - Ingestion-time: 1 drop + 1 redact (require re-ingestion)');
    testLogger.info('  - Each pattern tested independently with sequential ingestion');
  });
});
