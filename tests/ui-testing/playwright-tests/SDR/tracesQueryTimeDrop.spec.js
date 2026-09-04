const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Traces variant of the SDR query-time drop suite. Data stays intact in storage;
// the field is dropped from the search response at query time. One ingested batch
// is inspected both before (visible) and after (dropped) the pattern is applied.
test.describe("Traces Query Time Drop - Combined Test", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  // Generate unique test run ID for isolation
  const testRunId = Date.now().toString(36);

  // All patterns used in this spec file - with full pattern definitions for uniqueness
  const patternsToTest = [
    {
      name: `traces_url_query_drop_${testRunId}`,
      description: 'URL validation pattern (for traces query drop tests)',
      pattern: '^https?://[\\w.-]+\\.[\\w.-]+.*$',
      field: 'website_url',
      value: 'https://example.com'
    },
    {
      name: `traces_password_query_drop_${testRunId}`,
      description: 'Strong password pattern (for traces query drop tests)',
      pattern: '^[A-Za-z0-9@$!%*?&]{8,}$',
      field: 'user_password',
      value: 'P@ssw0rd!123'
    },
    {
      name: `traces_ipv4_query_drop_${testRunId}`,
      description: 'IPv4 address format (for traces query drop tests)',
      pattern: '^(\\d{1,3}\\.){3}\\d{1,3}$',
      field: 'server_ip',
      value: '192.168.1.1'
    },
    {
      name: `traces_hex_color_query_drop_${testRunId}`,
      description: 'Hexadecimal color code (for traces query drop tests)',
      pattern: '^#[0-9a-fA-F]{6}$',
      field: 'theme_color',
      value: '#FF5733'
    }
  ];

  // Use unique stream name to avoid "stream being deleted" conflicts
  const testStreamName = `sdr_traces_query_drop_${testRunId}`;
  const streamType = 'traces';

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Combined traces query time drop test setup completed');
  });

  test("setup: cleanup patterns", {
    tag: ['@sdr', '@traces', '@cleanup', '@queryDrop']
  }, async ({ page }) => {
    testLogger.info('=== SPEC-LEVEL CLEANUP: Cleaning up patterns for traces query drop test ===');

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

  test("should drop multiple trace fields at query time when patterns are applied", {
    tag: ['@sdr', '@traces', '@queryDrop', '@all', '@combined']
  }, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'dependency', description: 'setup: cleanup patterns' });

    testLogger.info('=== Testing combined traces drop for 4 patterns at query time ===');

    // STEP 1: Ingest trace data once (data will remain unchanged in storage)
    testLogger.info('STEP 1: Ingest 4 trace spans (before any patterns are applied)');

    const dataToIngest = patternsToTest.map(p => ({
      fieldName: p.field,
      fieldValue: p.value
    }));

    // Query-time SDR transforms data at search time, so STEP 1 (visible) and STEP 4
    // (dropped) inspect the SAME ingested batch — reuse one marker for both.
    const ingestMarker = await pm.sdrTracesPage.ingestMultipleFields(testStreamName, dataToIngest);

    // Verify all fields are visible before drop
    const fieldsBeforeDrop = patternsToTest.map(p => ({
      fieldName: p.field,
      shouldBeDropped: false
    }));
    await pm.sdrVerificationPage.verifyMultipleFields(pm.logsPage, testStreamName, fieldsBeforeDrop, ingestMarker, streamType);
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

    // STEP 3: Link all 4 patterns to their respective trace fields with QUERY TIME drop
    testLogger.info('STEP 3: Link all 4 patterns to their respective trace fields with DROP action');

    for (const patternConfig of patternsToTest) {
      await pm.streamAssociationPage.associatePatternWithStream(
        testStreamName,
        patternConfig.name,
        'drop',
        'query', // QUERY TIME - key difference from ingestion time
        patternConfig.field,
        streamType
      );
      testLogger.info(`✓ Linked pattern ${patternConfig.name} to field ${patternConfig.field} with DROP action`);
    }

    testLogger.info('✓ STEP 3 PASSED: All 4 patterns linked to trace fields with DROP action');

    // STEP 4: Verify all fields are DROPPED at query time (NO RE-INGESTION)
    testLogger.info('STEP 4: Verify trace fields are DROPPED at query time (data unchanged in storage)');

    const fieldsAfterDrop = patternsToTest.map(p => ({
      fieldName: p.field,
      shouldBeDropped: true
    }));
    await pm.sdrVerificationPage.verifyMultipleFields(pm.logsPage, testStreamName, fieldsAfterDrop, ingestMarker, streamType);
    testLogger.info('✓ STEP 4 PASSED: All trace fields are DROPPED at query time');

    testLogger.info('=== ✓ COMBINED TRACES QUERY TIME DROP TEST COMPLETED SUCCESSFULLY ===');
  });
});
