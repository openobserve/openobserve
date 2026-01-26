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
      [
        'auto_',
        'newdest_',
        'sanitydest-',
        'rbac_basic_dest_',
        'rbac_editor_create_dest_',
        'rbac_403_test_dest_',
        'rbac_sql_dest_',
        'rbac_user_delete_dest_',
        'rbac_user_update_dest_',
        'rbac_viewer_delete_dest_',
        'rbac_viewer_update_dest_',
        'incident_e2e_dest_',
        'e2e_promql_',             // alerts-regression.spec.js (Bug #9967 PromQL tests)
        /^destination\d{1,3}$/     // destination4, destination44, destination444, etc.
      ],
      // Template prefixes to clean up
      [
        'auto_',
        'sanitytemp-',
        'newtemp_',
        'email_tmpl_',
        'rbac_403_test_tmpl_',
        'rbac_basic_tmpl_',
        'rbac_del_tmpl_',
        'rbac_editor_create_tmpl_',
        'rbac_editor_update_tmpl_',
        'rbac_sql_tmpl_',
        'rbac_user_delete_tmpl_',
        'rbac_viewer_delete_tmpl_',
        'rbac_viewer_update_tmpl_',
        'incident_e2e_template_',
        'e2e_promql_'              // alerts-regression.spec.js (Bug #9967 PromQL tests)
      ],
      // Folder prefixes to clean up
      ['auto_', 'incident_e2e_folder_']
    );

    // Clean up all reports owned by automation user
    await pm.apiCleanup.cleanupReports();

    // Clean up all dashboards owned by automation user
    // This includes: Joins_Test_* (dashboard joins parallel tests), and other test dashboards
    await pm.apiCleanup.cleanupDashboards();

    // Clean up all pipelines for e2e_automate streams
    await pm.apiCleanup.cleanupPipelines(
      // Stream names to match
      [
        'e2e_automate',
        'e2e_automate1',
        'e2e_automate2',
        'e2e_automate3',
        'e2e_conditions_validation_precedence_src',
        'e2e_conditions_validation_nested_and_src',
        'e2e_conditions_validation_nested_or_src',
        'e2e_conditions_validation_numeric_src',
        'e2e_conditions_validation_contains_src',
        'e2e_conditions_validation_deep_src',
        'e2e_conditions_basic',
        'e2e_conditions_groups',
        'e2e_conditions_validation',
        'e2e_conditions_precedence',
        'e2e_conditions_multiple',
        'e2e_conditions_delete',
        'e2e_conditions_operators'
      ],
      // Source stream patterns to match
      [
        /^e2e_precedence_src_\d+$/,
        /^e2e_multiple_or_src_\d+$/,
        /^e2e_nested_or_src_\d+$/,
        /^e2e_numeric_src_\d+$/,
        /^e2e_multiple_and_src_\d+$/,
        /^e2e_deep_src_\d+$/,
        /^e2e_not_operator_src_\d+$/,
        /^e2e_impossible_src_\d+$/,
        /^e2e_universal_src_\d+$/,
        /^e2e_4level_src_\d+$/,
        /^simple_src_\d+$/,
        /^manual_debug_src_/,
        /^manual_verify_src_/
      ],
      // Pipeline name patterns to match
      [
        /^validation-precedence-\d+$/,
        /^validation-multiple-or-\d+$/,
        /^validation-nested-or-\d+$/,
        /^validation-numeric-\d+$/,
        /^validation-multiple-and-\d+$/,
        /^validation-deep-nested-\d+$/,
        /^validation-not-operator-\d+$/,
        /^validation-impossible-\d+$/,
        /^validation-universal-\d+$/,
        /^validation-4level-\d+$/,
        /^simple-test-\d+$/,
        /^or-root-test-\d+$/,
        /^manual-debug-pipeline-/,
        /^manual-verify-pipeline-/,
        /^scheurl\d+$/,       // scheurl556, scheurl149, etc. (pipelineImport.spec.js)
        /^schefile\d+$/,      // schefile399, schefile971, etc. (pipelineImport.spec.js)
        /^realurl\d+$/,       // realurl822, etc. (pipelineImport.spec.js)
        /^realfile\d+$/       // realfile123, etc. (pipelineImport.spec.js) - was missing!
      ]
    );

    // Clean up pipeline destinations matching test patterns
    await pm.apiCleanup.cleanupPipelineDestinations([
      /^destination\d{1,3}$/  // destination4, destination44, destination444, etc.
    ]);

    // Clean up functions matching test patterns
    // Patterns from sanity/pipeline tests (default org only)
    const sanityFunctionPatterns = [
      /^Pipeline\d{1,3}$/,           // Pipeline1, Pipeline12, Pipeline123
      /^first\d{1,3}$/,              // first0, first1, first99
      /^second\d{1,3}$/,             // second0, second1, second99
      /^sanitytest_/,                // sanitytest_a3f2, etc.
      /^e2eautomatefunctions_/       // e2eautomatefunctions_x9y2, etc.
    ];

    // Patterns from Functions folder tests (js-transform-type.spec.js)
    const jsFunctionPatterns = [
      /^test_js_fn_/,                // JS function creation tests
      /^test_js_validate_/,          // JS validation tests
      /^test_js_exec_/,              // JS execution tests
      /^test_js_error_/,             // JS error handling tests
      /^test_js_syntax_err_/,        // JS syntax error tests
      /^test_js_empty_/,             // JS empty function tests
      /^meta_js_fn_/,                // Meta org JS function tests
      /^default_vrl_fn_/             // Default org VRL function tests
    ];

    // Patterns from Functions folder tests (row-expansion.spec.js)
    const rowExpansionPatterns = [
      /^vrl_row_expand_/,            // VRL row expansion tests
      /^js_row_expand_/,             // JS row expansion tests
      /^vrl_empty_expand_/,          // VRL empty expansion tests
      /^js_empty_expand_/,           // JS empty expansion tests
      /^vrl_single_expand_/,         // VRL single element tests
      /^js_single_expand_/,          // JS single element tests
      /^js_complex_expand_/,         // JS complex transformation tests
      /^vrl_compare_/,               // VRL comparison tests
      /^js_compare_/,                // JS comparison tests
      /^pipeline_expand_fn_/,        // Pipeline integration tests
      /^invalid_expand_/             // Invalid expansion tests
    ];

    // Clean up functions in default org (sanity tests + VRL functions from Functions folder)
    const defaultOrgPatterns = [
      ...sanityFunctionPatterns,
      ...jsFunctionPatterns,         // default_vrl_fn_* created in default org
      ...rowExpansionPatterns        // vrl_* patterns created in default org
    ];
    await pm.apiCleanup.cleanupFunctionsInOrg('default', defaultOrgPatterns);

    // Clean up functions in _meta org (JS functions only work there)
    const metaOrgFunctionPatterns = [
      ...jsFunctionPatterns,         // test_js_*, meta_js_fn_* created in _meta org
      ...rowExpansionPatterns        // js_* patterns created in _meta org
    ];
    await pm.apiCleanup.cleanupFunctionsInOrg('_meta', metaOrgFunctionPatterns);

    // Clean up enrichment tables matching test patterns
    await pm.apiCleanup.cleanupEnrichmentTables([
      /^protocols_[a-f0-9]{8}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{12}_csv$/,       // protocols_<uuid>_csv (VRL test)
      /^enrichment_info_[a-f0-9]{8}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{12}_csv$/, // enrichment_info_<uuid>_csv (upload test)
      /^append_[a-f0-9]{8}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{12}_csv$/,          // append_<uuid>_csv (append test)
      /^search_test_[a-f0-9]{8}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{12}_csv$/,     // search_test_<uuid>_csv (search filter test)
      /^edit_test_[a-f0-9]{8}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{12}_csv$/,       // edit_test_<uuid>_csv (edit workflow test)
      /^delete_test_[a-f0-9]{8}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{4}_[a-f0-9]{12}_csv$/,     // delete_test_<uuid>_csv (delete confirmation test)
      // URL-based enrichment table tests (enrichment-table-url.spec.js) - uses UUID first segment (8 hex chars)
      /^url_lifecycle_[a-f0-9]{8}$/,                                                         // url_lifecycle_<uuid> (full lifecycle test)
      /^invalid_url_[a-f0-9]{8}$/,                                                           // invalid_url_<uuid> (URL format validation test)
      /^cancel_test_[a-f0-9]{8}$/,                                                           // cancel_test_<uuid> (cancel form test)
      /^toggle_test_[a-f0-9]{8}$/,                                                           // toggle_test_<uuid> (source toggle test)
      /^edit_form_[a-f0-9]{8}$/,                                                             // edit_form_<uuid> (edit form test)
      /^schema_view_[a-f0-9]{8}$/,                                                           // schema_view_<uuid> (schema view test)
      /^duplicate_test_[a-f0-9]{8}$/,                                                        // duplicate_test_<uuid> (duplicate name test)
      /^empty_url_[a-f0-9]{8}$/,                                                             // empty_url_<uuid> (empty URL validation test)
      /^url_404_[a-f0-9]{8}$/,                                                               // url_404_<uuid> (invalid URL 404 test)
      /^schema_mismatch_[a-f0-9]{8}$/,                                                        // schema_mismatch_<uuid> (schema mismatch test)
      // Pytest API tests (test_enrichment_table_url.py) - uses api_url_<test>_<uuid8> naming
      /^api_url_create_[a-f0-9]{8}$/,                                                         // api_url_create_<uuid> (create test)
      /^api_url_status_[a-f0-9]{8}$/,                                                         // api_url_status_<uuid> (status test)
      /^api_url_delete_[a-f0-9]{8}$/,                                                         // api_url_delete_<uuid> (delete test)
      /^api_url_empty_[a-f0-9]{8}$/,                                                          // api_url_empty_<uuid> (empty URL test)
      /^api_url_scheme_[a-f0-9]{8}$/,                                                         // api_url_scheme_<uuid> (invalid scheme test)
      /^api_url_localhost_[a-f0-9]{8}$/,                                                      // api_url_localhost_<uuid> (localhost test)
      /^api_url_private_[a-f0-9]{8}$/,                                                        // api_url_private_<uuid> (private IP test)
      /^api_url_aws_[a-f0-9]{8}$/,                                                            // api_url_aws_<uuid> (AWS metadata test)
      /^api_url_404_[a-f0-9]{8}$/,                                                            // api_url_404_<uuid> (404 error test)
      /^api_url_append_[a-f0-9]{8}$/,                                                         // api_url_append_<uuid> (append test)
      /^api_url_retry_[a-f0-9]{8}$/,                                                          // api_url_retry_<uuid> (retry test)
      /^api_url_schema_[a-f0-9]{8}$/,                                                         // api_url_schema_<uuid> (schema mismatch test)
      /^api_test_manual_\d+$/                                                                 // api_test_manual_<timestamp> (manual curl tests)
    ]);

    // Clean up streams matching test patterns
    await pm.apiCleanup.cleanupStreams(
      [
        /^sanitylogstream_/,           // sanitylogstream_61hj, etc.
        /^test\d+$/,                   // test1, test2, test3, etc.
        /^stress_test/,                // stress_test*, stress_test_<runId>_w0, stress_test1, etc.
        /^sdr_/,                       // sdr_* (SDR test streams)
        /^e2e_join_/,                  // e2e_join_* (UNION test streams)
        /^e2e_conditions_/,            // e2e_conditions_* (Pipeline conditions UI test streams)
        /^e2e_streamcreation_/,        // e2e_streamcreation_* (Stream creation UI test streams)
        /^e2e_MyUpperStream/i,         // e2e_MyUpperStream* (Stream name casing test streams)
        /^e2e_mylowerstream/i,         // e2e_mylowerstream* (Stream name casing test streams)
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
        /^e2e_4level_(src|dest)_\d+$/,        // Test 10: 4-level nested test streams
        /^stream\d{13}$/,                     // stream1765164273471, etc. (timestamp-based test streams)
        /^e2e_stream_(a|b)_\d+$/,             // Regression test streams (e2e_stream_a_*, e2e_stream_b_*)
        /^join_[a-z0-9]+_(requests|users|sessions)$/,  // Dashboard joins test streams (join_<testId>_requests, etc.)
        /^join_[a-z0-9]+_[a-z0-9]+_(requests|users|sessions)$/,  // Dashboard joins test streams with extra segment (join_<id1>_<id2>_requests, etc.)
        /^func_test_[a-z0-9]+$/,                       // Dashboard functions test streams (func_test_<testId>)
        /^join_manual_test$/,                          // Manual join test stream
        /^test_app_users$/,                            // Test app users stream
        /^test_sessions$/,                             // Test sessions stream
        /^test_web_requests$/,                         // Test web requests stream
        /^alert_trigger_validation$/,                  // Alert trigger validation stream (self-referential POC)
        /^alert_val_[a-zA-Z0-9]+$/,                    // Unique validation streams per test (alert_val_<suffix>)
        /^severity_test_\d+$/,                         // Severity test streams (severity_test_<timestamp>)
        /^alert_e2e_/,                                 // Alert e2e test streams (alert_e2e_*)
        /^alert_import_/,                              // Alert import test streams (alert_import_*)
        /^dedup_test_/,                                // Dedup test streams (dedup_test_*)
        /^dedup_src_/,                                 // Dedup source streams (dedup_src_*)
        /^alert_validation_stream$/,                   // Alert validation stream
        /^auto_playwright_stream$/,                    // Auto playwright stream
        /^incident_e2e_/,                              // Incident e2e test streams (incident_e2e_*)
        /ellipsis_testing/,                            // Bug #7468 ellipsis test streams (long stream names)
        /^e2e_test_cpu_usage$/,                        // Pipeline regression test metrics stream (Issue #9901)
        /^e2e_test_traces$/                            // Pipeline regression test traces stream (Issue #9901)
      ],
      // Protected streams to never delete
      ['default', 'sensitive', 'important', 'critical', 'production', 'staging', 'automation', 'e2e_automate', 'k8s_json']
    );

    // Note: Pipeline regression test streams (e2e_test_cpu_usage for metrics, e2e_test_traces for traces)
    // are created by pipeline-regression.spec.js for Issue #9901 regression tests.
    // Custom traces stream uses "stream-name" header (ZO_GRPC_STREAM_HEADER_KEY config).
    // Since streams are re-used with fresh timestamps each test run, cleanup is not strictly required.

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

    // Clean up metrics streams matching test patterns
    // Metrics tests use OTLP ingestion which may create test-specific streams
    await pm.apiCleanup.cleanupMetricsStreams(
      [
        /^test_.*_metrics$/,              // test_*_metrics streams (general test streams)
        /^e2e_metrics_/,                  // e2e_metrics_* (E2E test streams)
        /^otlp_test_/,                    // otlp_test_* (OTLP ingestion test streams)
        /^metrics_test_/,                 // metrics_test_* (Metrics-specific test streams)
        /^prom_test_/,                    // prom_test_* (Prometheus test streams)
        /^temp_metrics_/                  // temp_metrics_* (Temporary test streams)
      ],
      // Protected metrics streams - never delete
      ['default', 'e2e_test_metrics']  // 'default' is the primary metrics stream, 'e2e_test_metrics' used by scheduled-pipeline-query-builder.spec.js
    );

    // Note: Stream deletion waiting is no longer needed here because:
    // 1. Pipeline conditions tests now use worker-specific stream names (e.g., e2e_conditions_basic_<runId>_w0)
    // 2. Schemaload/stress tests now use unique stream names (e.g., stress_test_<runId>_w0)
    // This avoids conflicts both within a test run (parallelIndex) and across test runs (testRunId)
    // The cleanup patterns above will clean up old test streams via regex matching

    // Clean up test semantic groups created by correlation settings tests
    // Groups: k8s-cluster, k8s-namespace, k8s-deployment, service
    // These are created by ensureSemanticGroupsExist() in correlationSettingsPage.js
    await pm.apiCleanup.cleanupCorrelationSettings();

    testLogger.info('Pre-test cleanup completed successfully');
  });
});

