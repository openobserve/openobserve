const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Traces variant of the SDR ingestion-time redaction suite. SDR was originally
// applied to logs only; this suite covers the traces pipeline (PR: apply SDR
// patterns to traces). Only the ingest (OTLP /v1/traces) and read (?type=traces)
// seams differ — the pattern create/associate/verify flow is shared with logs.
test.describe("Traces Ingestion Time Redaction - Combined Test", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  // Generate unique test run ID for isolation
  const testRunId = Date.now().toString(36);

  // All patterns used in this spec file - with full pattern definitions for uniqueness
  const patternsToTest = [
    {
      name: `traces_email_redact_${testRunId}`,
      description: 'Email address validation pattern (for traces redaction tests)',
      pattern: '^[\\w\\.-]+@[\\w\\.-]+\\.\\w{2,}$',
      field: 'user_email',
      value: 'john.doe@example.com'
    },
    {
      name: `traces_phone_redact_${testRunId}`,
      description: 'US phone number (10 digits) (for traces redaction tests)',
      pattern: '^\\d{10}$',
      field: 'phone',
      value: '5551234567'
    },
    {
      name: `traces_cc_redact_${testRunId}`,
      description: 'Credit card number pattern (for traces redaction tests)',
      pattern: '^\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}$',
      field: 'cc_number',
      value: '1234 5678 9012 3456'
    },
    {
      name: `traces_ssn_redact_${testRunId}`,
      description: 'Social Security Number pattern (for traces redaction tests)',
      pattern: '^\\d{3}-\\d{2}-\\d{4}$',
      field: 'ssn',
      value: '123-45-6789'
    }
  ];

  // Use unique stream name to avoid "stream being deleted" conflicts
  const testStreamName = `sdr_traces_redact_${testRunId}`;
  const streamType = 'traces';

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Combined traces ingestion time redaction test setup completed');
  });

  // Cleanup test - runs first
  test('setup: cleanup patterns', {
    tag: ['@sdr', '@traces', '@cleanup', '@ingestionRedact']
  }, async ({ page }) => {
    testLogger.info('=== SPEC-LEVEL CLEANUP: Cleaning up patterns for traces redaction test ===');

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
              pattern.name,
              streamType
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
  test("should redact multiple trace fields at ingestion time when patterns are applied", {
    tag: ['@sdr', '@traces', '@ingestionRedact', '@all', '@combined']
  }, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'dependency', description: 'setup: cleanup patterns' });
    testLogger.info('=== Testing combined traces redaction for 4 patterns at ingestion time ===');

    // STEP 1: Ingest trace data WITHOUT any SDR patterns - all fields should be visible
    testLogger.info('STEP 1: Ingest 4 trace spans WITHOUT any SDR patterns linked');
    const dataToIngest = patternsToTest.map(p => ({ fieldName: p.field, fieldValue: p.value }));
    const markerStep1 = await pm.sdrTracesPage.ingestMultipleFields(testStreamName, dataToIngest);

    const fieldsToVerifyStep1 = patternsToTest.map(p => ({ fieldName: p.field, shouldBeRedacted: false }));
    await pm.sdrVerificationPage.verifyMultipleFields(pm.logsPage, testStreamName, fieldsToVerifyStep1, markerStep1, streamType);
    testLogger.info('✓ STEP 1 PASSED: All trace fields visible without SDR');

    // STEP 2: Create all 4 SDR patterns
    testLogger.info('STEP 2: Create all 4 SDR patterns');
    for (const patternConfig of patternsToTest) {
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      await pm.sdrPatternsPage.createPattern(patternConfig.name, patternConfig.description, patternConfig.pattern);
      await pm.sdrPatternsPage.verifyPatternCreatedSuccess();

      await pm.sdrPatternsPage.navigateToRegexPatterns();
      const exists = await pm.sdrPatternsPage.waitForPatternCreated(patternConfig.name); // backend-consistent create gate (API source of truth)
      if (!exists) {
        testLogger.error(`Pattern ${patternConfig.name} was not created successfully!`);
        throw new Error(`Pattern ${patternConfig.name} creation failed - not found in list`);
      }
      testLogger.info(`✓ Created and verified pattern: ${patternConfig.name}`);
    }
    testLogger.info('✓ STEP 2 PASSED: All 4 patterns created and verified');

    // STEP 3: Link all 4 patterns to their respective trace fields
    testLogger.info('STEP 3: Link all 4 patterns to their respective trace fields');
    for (const patternConfig of patternsToTest) {
      await pm.streamAssociationPage.associatePatternWithStream(
        testStreamName,
        patternConfig.name,
        'redact',
        'ingestion',
        patternConfig.field,
        streamType
      );
      testLogger.info(`✓ Linked pattern ${patternConfig.name} to field ${patternConfig.field}`);
    }
    testLogger.info('✓ STEP 3 PASSED: All 4 patterns linked to trace fields');

    // STEP 4: Ingest trace data WITH SDR patterns linked - all fields should be REDACTED
    // Ingestion-time redaction is baked in at write time, so this is a NEW batch
    // (new marker) — distinct from the still-visible STEP 1 batch on the same stream.
    testLogger.info('STEP 4: Ingest 4 trace spans WITH SDR patterns linked');
    const markerStep4 = await pm.sdrTracesPage.ingestMultipleFields(testStreamName, dataToIngest);

    const fieldsToVerifyStep4 = patternsToTest.map(p => ({ fieldName: p.field, shouldBeRedacted: true }));
    await pm.sdrVerificationPage.verifyMultipleFields(pm.logsPage, testStreamName, fieldsToVerifyStep4, markerStep4, streamType);
    testLogger.info('✓ STEP 4 PASSED: All trace fields are REDACTED');

    testLogger.info('=== ✓ COMBINED TRACES REDACTION TEST COMPLETED SUCCESSFULLY ===');
  });
});
