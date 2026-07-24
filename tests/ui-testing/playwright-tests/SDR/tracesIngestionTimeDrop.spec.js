const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Traces variant of the SDR ingestion-time drop suite. Dropped fields are removed
// from the record at write time; the span record itself persists (marker + trace
// fields), so the batch is still queryable while the dropped field is absent.
test.describe("Traces Ingestion Time Drop - Combined Test", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  // Generate unique test run ID for isolation
  const testRunId = Date.now().toString(36);

  // All patterns used in this spec file - with full pattern definitions for uniqueness
  const patternsToTest = [
    {
      name: `traces_url_drop_${testRunId}`,
      description: 'URL validation pattern (for traces drop tests)',
      pattern: '^https?://[\\w.-]+\\.[\\w.-]+.*$',
      field: 'website_url',
      value: 'https://example.com'
    },
    {
      name: `traces_password_drop_${testRunId}`,
      description: 'Strong password pattern (for traces drop tests)',
      pattern: '^[A-Za-z0-9@$!%*?&]{8,}$',
      field: 'user_password',
      value: 'P@ssw0rd!123'
    },
    {
      name: `traces_ipv4_drop_${testRunId}`,
      description: 'IPv4 address format (for traces drop tests)',
      pattern: '^(\\d{1,3}\\.){3}\\d{1,3}$',
      field: 'server_ip',
      value: '192.168.1.1'
    },
    {
      name: `traces_hex_color_drop_${testRunId}`,
      description: 'Hexadecimal color code (for traces drop tests)',
      pattern: '^#[0-9a-fA-F]{6}$',
      field: 'theme_color',
      value: '#FF5733'
    }
  ];

  // Use unique stream name to avoid "stream being deleted" conflicts
  const testStreamName = `sdr_traces_drop_${testRunId}`;
  const streamType = 'traces';

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Combined traces ingestion time drop test setup completed');
  });

  // Cleanup test - runs first
  test('setup: cleanup patterns', {
    tag: ['@sdr', '@traces', '@cleanup', '@ingestionDrop']
  }, async ({ page }) => {
    testLogger.info('=== SPEC-LEVEL CLEANUP: Cleaning up patterns for traces drop test ===');

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
  test("should drop multiple trace fields at ingestion time when patterns are applied", {
    tag: ['@sdr', '@traces', '@ingestionDrop', '@all', '@combined']
  }, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'dependency', description: 'setup: cleanup patterns' });
    testLogger.info('=== Testing combined traces DROP for 4 patterns at ingestion time ===');

    // STEP 1: Ingest trace data WITHOUT any SDR patterns - all fields should be visible
    testLogger.info('STEP 1: Ingest 4 trace spans WITHOUT any SDR patterns linked');
    const dataToIngest = patternsToTest.map(p => ({ fieldName: p.field, fieldValue: p.value }));
    const markerStep1 = await pm.sdrTracesPage.ingestMultipleFields(testStreamName, dataToIngest);

    const fieldsToVerifyStep1 = patternsToTest.map(p => ({ fieldName: p.field, shouldBeDropped: false }));
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

    // STEP 3: Link all 4 patterns to their respective trace fields with DROP action
    testLogger.info('STEP 3: Link all 4 patterns to their respective trace fields with DROP action');
    for (const patternConfig of patternsToTest) {
      await pm.streamAssociationPage.associatePatternWithStream(
        testStreamName,
        patternConfig.name,
        'drop',
        'ingestion',
        patternConfig.field,
        streamType
      );
      testLogger.info(`✓ Linked pattern ${patternConfig.name} to field ${patternConfig.field} with DROP action`);
    }
    testLogger.info('✓ STEP 3 PASSED: All 4 patterns linked to trace fields with DROP action');

    // STEP 4: Ingest trace data WITH SDR patterns linked - all fields should be DROPPED
    // Ingestion-time drop removes the fields at write time, so this is a NEW batch
    // (new marker) — distinct from the still-visible STEP 1 batch on the same stream.
    testLogger.info('STEP 4: Ingest 4 trace spans WITH SDR patterns linked');
    const markerStep4 = await pm.sdrTracesPage.ingestMultipleFields(testStreamName, dataToIngest);

    const fieldsToCheck = patternsToTest.map(p => p.field);
    await pm.sdrVerificationPage.verifyFieldsAreAbsent(pm.logsPage, testStreamName, fieldsToCheck, markerStep4, streamType);
    testLogger.info('✓ STEP 4 PASSED: All trace fields are DROPPED (not present)');

    testLogger.info('=== ✓ COMBINED TRACES DROP TEST COMPLETED SUCCESSFULLY ===');
  });
});
