const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Ingestion Time Hash - Combined Test", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  // Generate unique test run ID for isolation
  const testRunId = Date.now().toString(36);

  // All patterns used in this spec file - with full pattern definitions for uniqueness
  const patternsToTest = [
    {
      name: `url_format_hash_${testRunId}`,
      description: 'URL validation pattern (for hash tests)',
      pattern: '^https?://[\\w.-]+\\.[\\w.-]+.*$',
      field: 'website_url',
      value: 'https://example.com'
    },
    {
      name: `strong_password_hash_${testRunId}`,
      description: 'Strong password pattern (for hash tests)',
      pattern: '^[A-Za-z0-9@$!%*?&]{8,}$',
      field: 'user_password',
      value: 'P@ssw0rd!123'
    },
    {
      name: `ipv4_address_hash_${testRunId}`,
      description: 'IPv4 address format (for hash tests)',
      pattern: '^(\\d{1,3}\\.){3}\\d{1,3}$',
      field: 'server_ip',
      value: '192.168.1.1'
    },
    {
      name: `hex_color_hash_${testRunId}`,
      description: 'Hexadecimal color code (for hash tests)',
      pattern: '^#[0-9a-fA-F]{6}$',
      field: 'theme_color',
      value: '#FF5733'
    }
  ];

  // Use unique stream name to avoid "stream being deleted" conflicts
  const testStreamName = `sdr_hash_${testRunId}`;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Combined ingestion time hash test setup completed');
  });

  // Cleanup test - runs first
  test('setup: cleanup patterns', {
    tag: ['@sdr', '@cleanup', '@ingestionHash']
  }, async ({ page }) => {
    testLogger.info('=== SPEC-LEVEL CLEANUP: Cleaning up patterns for combined hash test ===');

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
  test("should hash multiple fields at ingestion time when patterns are applied", {
    tag: ['@sdr', '@ingestionHash', '@all', '@combined']
  }, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'dependency', description: 'setup: cleanup patterns' });
    testLogger.info('=== Testing combined HASH for 4 patterns at ingestion time ===');

    // STEP 1: Ingest data WITHOUT any SDR patterns - all fields should be visible
    testLogger.info('STEP 1: Ingest 4 lines of data WITHOUT any SDR patterns linked');
    const dataToIngest = patternsToTest.map(p => ({ fieldName: p.field, fieldValue: p.value }));
    const markerStep1 = await pm.logsPage.ingestMultipleFields(testStreamName, dataToIngest);

    const fieldsToVerifyStep1 = patternsToTest.map(p => ({ fieldName: p.field, shouldBeHashed: false }));
    await pm.sdrVerificationPage.verifyMultipleFields(pm.logsPage, testStreamName, fieldsToVerifyStep1, markerStep1);
    testLogger.info('✓ STEP 1 PASSED: All fields visible without SDR');

    // STEP 2: Create all 4 SDR patterns
    testLogger.info('STEP 2: Create all 4 SDR patterns');
    for (const patternConfig of patternsToTest) {
      await pm.sdrPatternsPage.navigateToRegexPatterns();
      await pm.sdrPatternsPage.createPattern(patternConfig.name, patternConfig.description, patternConfig.pattern);
      await pm.sdrPatternsPage.verifyPatternCreatedSuccess();

      await pm.sdrPatternsPage.navigateToRegexPatterns();
      const exists = await pm.sdrPatternsPage.checkPatternExists(patternConfig.name);
      if (!exists) {
        testLogger.error(`Pattern ${patternConfig.name} was not created successfully!`);
        throw new Error(`Pattern ${patternConfig.name} creation failed - not found in list`);
      }
      testLogger.info(`✓ Created and verified pattern: ${patternConfig.name}`);
    }
    testLogger.info('✓ STEP 2 PASSED: All 4 patterns created and verified');

    // STEP 3: Link all 4 patterns to their respective fields with HASH action
    testLogger.info('STEP 3: Link all 4 patterns to their respective fields with HASH action');
    for (const patternConfig of patternsToTest) {
      await pm.streamAssociationPage.associatePatternWithStream(
        testStreamName,
        patternConfig.name,
        'hash',
        'ingestion',
        patternConfig.field
      );
      testLogger.info(`✓ Linked pattern ${patternConfig.name} to field ${patternConfig.field} with HASH action`);
    }
    testLogger.info('✓ STEP 3 PASSED: All 4 patterns linked to fields with HASH action');

    // STEP 4: Ingest data WITH SDR patterns linked - all fields should be HASHED
    // Ingestion-time hashing is baked in at write time, so this is a NEW batch
    // (new marker) — distinct from the still-visible STEP 1 batch on the same stream.
    testLogger.info('STEP 4: Ingest 4 lines of data WITH SDR patterns linked');
    const markerStep4 = await pm.logsPage.ingestMultipleFields(testStreamName, dataToIngest);

    const fieldsToVerifyStep4 = patternsToTest.map(p => ({ fieldName: p.field, shouldBeHashed: true }));
    await pm.sdrVerificationPage.verifyMultipleFields(pm.logsPage, testStreamName, fieldsToVerifyStep4, markerStep4);
    testLogger.info('✓ STEP 4 PASSED: All fields are HASHED (present with hashed values)');

    testLogger.info('=== ✓ COMBINED HASH TEST COMPLETED SUCCESSFULLY ===');
  });
});
