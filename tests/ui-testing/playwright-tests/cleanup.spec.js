const { test } = require('./utils/enhanced-baseFixtures.js');
const PageManager = require('../pages/page-manager.js');
const testLogger = require('./utils/test-logger.js');

test.describe("Pre-Test Cleanup", () => {
  /**
   * This cleanup test runs before all UI integration tests
   * It removes all test data from previous runs using API calls
   * This ensures a clean state for all subsequent tests 
   */
  test('Clean up all test data via API', {
    tag: ['@cleanup', '@all']
  }, async ({ page }) => {
    testLogger.info('Starting pre-test cleanup');

    const pm = new PageManager(page);

    // Run complete cascade cleanup for alert destinations, templates, and folders
    await pm.apiCleanup.completeCascadeCleanup(
      // Destination prefixes to clean up
      ['auto_', 'newdest_', 'sanitydest-'],
      // Template prefixes to clean up
      ['auto_email_template_', 'auto_webhook_template_', 'auto_playwright_template_', 'auto_url_webhook_template_', 'sanitytemp-', 'newtemp_'],
      // Folder prefixes to clean up
      ['auto_']
    );

    // Clean up all reports owned by automation user
    await pm.apiCleanup.cleanupReports();

    // Clean up all dashboards owned by automation user
    await pm.apiCleanup.cleanupDashboards();

    // Clean up all pipelines for e2e_automate streams
    await pm.apiCleanup.cleanupPipelines();

    // Clean up pipeline destinations matching test patterns
    await pm.apiCleanup.cleanupPipelineDestinations([
      /^destination\d{2,3}$/  // destination12, destination123, etc.
    ]);

    // Clean up functions matching test patterns
    await pm.apiCleanup.cleanupFunctions([
      /^Pipeline\d{1,3}$/,           // Pipeline1, Pipeline12, Pipeline123
      /^first\d{1,3}$/,              // first0, first1, first99
      /^second\d{1,3}$/,             // second0, second1, second99
      /^sanitytest_/,                // sanitytest_a3f2, etc.
      /^e2eautomatefunctions_/       // e2eautomatefunctions_x9y2, etc.
    ]);

    // Clean up enrichment tables matching test patterns
    await pm.apiCleanup.cleanupEnrichmentTables([
      /^protocols_[a-f0-9]{8}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{12}_csv$/  // protocols_<uuid>_csv
    ]);

    // Clean up streams matching test patterns
    await pm.apiCleanup.cleanupStreams(
      [
        /^sanitylogstream_/,           // sanitylogstream_61hj, etc.
        /^test\d+$/,                   // test1, test2, test3, etc.
        /^stress_test/,                // stress_test*, stress_test123, etc.
        /^sdr_/,                       // sdr_* (SDR test streams)
        /^e2e_join_/,                  // e2e_join_* (UNION test streams)
        /^e2e_conditions_/,            // e2e_conditions_* (Pipeline conditions UI test streams)
        /^[a-z]{8,9}$/,                // Random 8-9 char lowercase strings
        /^e2e_cond_prec_(src|dest)_\d+$/,     // Test 1: Operator precedence test streams
        /^e2e_multiple_or_(src|dest)_\d+$/,   // Test 2: Multiple OR test streams
        /^e2e_nested_or_(src|dest)_\d+$/,     // Test 3: Nested OR test streams
        /^e2e_numeric_(src|dest)_\d+$/,       // Test 4: Numeric comparison test streams
        /^e2e_multiple_and_(src|dest)_\d+$/,  // Test 5: Multiple AND test streams
        /^e2e_deep_(src|dest)_\d+$/,          // Test 6: Deeply nested test streams
        /^e2e_not_operator_(src|dest)_\d+$/,  // Test 7: NOT operator test streams
        /^e2e_impossible_(src|dest)_\d+$/,    // Test 8: Impossible condition test streams
        /^e2e_universal_(src|dest)_\d+$/,     // Test 9: Universal condition test streams
        /^e2e_4level_(src|dest)_\d+$/         // Test 10: 4-level nested test streams
      ],
      // Protected streams to never delete
      ['default', 'sensitive', 'important', 'critical', 'production', 'staging', 'automation', 'e2e_automate']
    );

    // Clean up all service accounts matching pattern "email*@gmail.com"
    await pm.apiCleanup.cleanupServiceAccounts();

    // Clean up all users matching patterns "email*@gmail.com" and "duplicate*@gmail.com"
    await pm.apiCleanup.cleanupUsers();

    // Clean up regex patterns matching test data
    await pm.apiCleanup.cleanupRegexPatterns();

    // Clean up custom logo from _meta organization
    await pm.apiCleanup.cleanupLogo();

    // Clean up all search jobs
    await pm.apiCleanup.cleanupSearchJobs();

    // Clean up saved views matching test patterns
    await pm.apiCleanup.cleanupSavedViews();

    testLogger.info('Pre-test cleanup completed successfully');
  });
});
