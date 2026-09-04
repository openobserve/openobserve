const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Traces variant of the SDR query-time redaction suite. Query-time SDR transforms
// data at search time, so one ingested batch is inspected both before (visible)
// and after (redacted) the pattern is applied. Traces read back via ?type=traces.
test.describe("Traces Query Time Redaction - Combined Test", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  // Generate unique test run ID for isolation
  const testRunId = Date.now().toString(36);

  // All patterns used in this spec file - with full pattern definitions for uniqueness
  const patternsToTest = [
    {
      name: `traces_email_query_redact_${testRunId}`,
      description: 'Email address validation pattern (for traces query time redaction tests)',
      pattern: '^[\\w\\.-]+@[\\w\\.-]+\\.\\w{2,}$',
      field: 'user_email',
      value: 'john.doe@example.com'
    },
    {
      name: `traces_phone_query_redact_${testRunId}`,
      description: 'US phone number (10 digits) (for traces query time redaction tests)',
      pattern: '^\\d{10}$',
      field: 'phone',
      value: '5551234567'
    },
    {
      name: `traces_cc_query_redact_${testRunId}`,
      description: 'Credit card number pattern (for traces query time redaction tests)',
      pattern: '^\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}$',
      field: 'cc_number',
      value: '1234 5678 9012 3456'
    },
    {
      name: `traces_ssn_query_redact_${testRunId}`,
      description: 'Social Security Number pattern (for traces query time redaction tests)',
      pattern: '^\\d{3}-\\d{2}-\\d{4}$',
      field: 'ssn',
      value: '123-45-6789'
    }
  ];

  // Use unique stream name to avoid "stream being deleted" conflicts
  const testStreamName = `sdr_traces_query_redact_${testRunId}`;
  const streamType = 'traces';

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Combined traces query time redaction test setup completed');
  });

  test("setup: cleanup patterns", {
    tag: ['@sdr', '@traces', '@cleanup', '@queryRedact']
  }, async ({ page }) => {
    testLogger.info('=== SPEC-LEVEL CLEANUP: Cleaning up patterns for traces query redaction test ===');

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
              pattern.name,
              streamType
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

  test("should redact multiple trace fields at query time when patterns are applied", {
    tag: ['@sdr', '@traces', '@queryRedact', '@all', '@combined']
  }, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'dependency', description: 'setup: cleanup patterns' });

    testLogger.info('=== Testing combined traces redaction for 4 patterns at query time ===');

    // STEP 1: Ingest trace data once (data will remain unchanged in storage)
    testLogger.info('STEP 1: Ingest 4 trace spans (before any patterns are applied)');

    const dataToIngest = patternsToTest.map(p => ({
      fieldName: p.field,
      fieldValue: p.value
    }));

    // Query-time SDR transforms data at search time, so STEP 1 (visible) and STEP 4
    // (redacted) inspect the SAME ingested batch — reuse one marker for both.
    const ingestMarker = await pm.sdrTracesPage.ingestMultipleFields(testStreamName, dataToIngest);

    // Verify all fields are visible without redaction
    const fieldsBeforeRedaction = patternsToTest.map(p => ({
      fieldName: p.field,
      shouldBeRedacted: false
    }));
    await pm.sdrVerificationPage.verifyMultipleFields(pm.logsPage, testStreamName, fieldsBeforeRedaction, ingestMarker, streamType);
    testLogger.info('✓ STEP 1 PASSED: All trace fields visible without SDR');

    // STEP 2: Create all 4 SDR patterns
    testLogger.info('STEP 2: Create all 4 SDR patterns');

    for (const patternConfig of patternsToTest) {
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      await pm.sdrPatternsPage.createPattern(patternConfig.name, patternConfig.description, patternConfig.pattern);
      await pm.sdrPatternsPage.verifyPatternCreatedSuccess();

      await pm.sdrPatternsPage.navigateToRegexPatterns();
      const exists = await pm.sdrPatternsPage.waitForPatternCreated(patternConfig.name); // backend-consistent create gate (API source of truth)
      expect(exists).toBeTruthy();
      testLogger.info(`✓ Created and verified pattern: ${patternConfig.name}`);
    }

    testLogger.info('✓ STEP 2 PASSED: All 4 patterns created and verified');

    // STEP 3: Link all 4 patterns to their respective trace fields with QUERY TIME redaction
    testLogger.info('STEP 3: Link all 4 patterns to their respective trace fields');

    for (const patternConfig of patternsToTest) {
      await pm.streamAssociationPage.associatePatternWithStream(
        testStreamName,
        patternConfig.name,
        'redact',
        'query', // QUERY TIME - key difference from ingestion time
        patternConfig.field,
        streamType
      );
      testLogger.info(`✓ Linked pattern ${patternConfig.name} to field ${patternConfig.field}`);
    }

    testLogger.info('✓ STEP 3 PASSED: All 4 patterns linked to trace fields');

    // STEP 4: Verify all fields are REDACTED at query time (NO RE-INGESTION)
    testLogger.info('STEP 4: Verify trace fields are REDACTED at query time (data unchanged in storage)');

    const fieldsAfterRedaction = patternsToTest.map(p => ({
      fieldName: p.field,
      shouldBeRedacted: true
    }));
    await pm.sdrVerificationPage.verifyMultipleFields(pm.logsPage, testStreamName, fieldsAfterRedaction, ingestMarker, streamType);
    testLogger.info('✓ STEP 4 PASSED: All trace fields are REDACTED at query time');

    testLogger.info('=== ✓ COMBINED TRACES QUERY TIME REDACTION TEST COMPLETED SUCCESSFULLY ===');
  });
});
