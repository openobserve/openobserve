const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

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
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
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
    const markerStep1 = await pm.logsPage.ingestMultipleFields(testStreamName, dataToIngest);

    const fieldsToVerifyStep1 = patternsToTest.map(p => ({ fieldName: p.field, shouldBeDropped: false }));
    await pm.sdrVerificationPage.verifyMultipleFields(pm.logsPage, testStreamName, fieldsToVerifyStep1, markerStep1);
    testLogger.info('✓ STEP 1 PASSED: All fields visible without SDR');

    // STEP 2: Create all 4 SDR patterns
    testLogger.info('STEP 2: Create all 4 SDR patterns');
    for (const patternConfig of patternsToTest) {
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      await pm.sdrPatternsPage.createPattern(patternConfig.name, patternConfig.description, patternConfig.pattern);
      await pm.sdrPatternsPage.verifyPatternCreatedSuccess();

      // Verify the pattern actually exists in the list
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      const exists = await pm.sdrPatternsPage.waitForPatternCreated(patternConfig.name); // backend-consistent create gate (API source of truth)
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
    // Ingestion-time drop removes the fields at write time, so this is a NEW batch
    // (new marker) — distinct from the still-visible STEP 1 batch on the same stream.
    testLogger.info('STEP 4: Ingest 4 lines of data WITH SDR patterns linked');
    const markerStep4 = await pm.logsPage.ingestMultipleFields(testStreamName, dataToIngest);

    const fieldsToCheck = patternsToTest.map(p => p.field);
    await pm.sdrVerificationPage.verifyFieldsAreAbsent(pm.logsPage, testStreamName, fieldsToCheck, markerStep4);
    testLogger.info('✓ STEP 4 PASSED: All fields are DROPPED (not present)');

    testLogger.info('=== ✓ COMBINED DROP TEST COMPLETED SUCCESSFULLY ===');
  });
});
