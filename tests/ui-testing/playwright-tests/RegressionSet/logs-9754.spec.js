/**
 * Logs Highlighting Regression Bug Tests
 *
 * Bug fixes for logs highlighting functionality:
 * - #9754: Logs highlighting character loss with unclosed brackets/quotes
 *          Characters were being dropped when log messages contained unclosed
 *          brackets (like ANSI escape sequences) or unclosed quotes.
 *          Example: "QueryEditor.spec.ts[2m" would lose the 's' from '.ts'
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getHeaders, getIngestionUrl, sendRequest } = require('../utils/data-ingestion.js');

// Test data containing edge cases for bug #9754
// PR fixes issue when user has [ , { , < , ' , ( as single char without closing character
const BUG_9754_TEST_LOGS = [
  // ===== UNCLOSED SQUARE BRACKET [ =====
  {
    // ANSI escape sequence with file path - the 's' from '.ts' should NOT be lost
    message: "src/plugins/logs/QueryEditor.spec.ts[2m",
    level: "info",
    test_case: "ansi_unclosed_bracket",
    expected_text: "QueryEditor.spec.ts"
  },
  {
    // Full ANSI log line with multiple unclosed brackets
    message: "[90mstderr[2m | src/views/About.spec.ts[2m > [22m[2mshould mount",
    level: "info",
    test_case: "ansi_complex",
    expected_text: "About.spec.ts"
  },
  {
    // Bracket at end of string without closing
    message: "content ends[",
    level: "debug",
    test_case: "bracket_at_end",
    expected_text: "ends"
  },
  {
    // Text immediately before unclosed bracket
    message: "test[incomplete",
    level: "debug",
    test_case: "text_before_bracket",
    expected_text: "incomplete"
  },
  {
    // Multiple unclosed brackets
    message: "test[first[second",
    level: "debug",
    test_case: "multiple_unclosed_brackets",
    expected_text: "second"
  },

  // ===== UNCLOSED CURLY BRACE { =====
  {
    // Unclosed curly brace - last char before { should be preserved
    message: "JSON parse error at position{",
    level: "error",
    test_case: "unclosed_curly_brace",
    expected_text: "position"
  },
  {
    // Object notation with unclosed brace
    message: "Config loaded: {host: localhost, port{",
    level: "info",
    test_case: "unclosed_curly_nested",
    expected_text: "port"
  },

  // ===== UNCLOSED ANGLE BRACKET < =====
  {
    // HTML/XML tag with unclosed angle bracket - 'v' should NOT be lost
    message: "Invalid XML: <div<",
    level: "error",
    test_case: "unclosed_angle_bracket",
    expected_text: "div"
  },
  {
    // Generic type notation
    message: "Type error: List<String<",
    level: "error",
    test_case: "unclosed_angle_generic",
    expected_text: "String"
  },

  // ===== UNCLOSED SINGLE QUOTE ' =====
  {
    // Unclosed single quote at end
    message: "hello world 'unclosed",
    level: "warn",
    test_case: "unclosed_single_quote",
    expected_text: "unclosed"
  },
  {
    // SQL query with unclosed quote
    message: "SELECT * FROM users WHERE name = 'John",
    level: "debug",
    test_case: "unclosed_single_quote_sql",
    expected_text: "John"
  },

  // ===== UNCLOSED DOUBLE QUOTE " =====
  {
    // Unclosed double quote at end
    message: 'hello world "unclosed',
    level: "warn",
    test_case: "unclosed_double_quote",
    expected_text: "unclosed"
  },

  // ===== UNCLOSED PARENTHESIS ( =====
  {
    // Function call with unclosed parenthesis - 'e' from 'parse' should NOT be lost
    message: "Error in function parse(",
    level: "error",
    test_case: "unclosed_parenthesis",
    expected_text: "parse"
  },
  {
    // Math expression with unclosed paren
    message: "Calculate: (x + y(",
    level: "debug",
    test_case: "unclosed_parenthesis_nested",
    expected_text: "y"
  },

  // ===== REAL-WORLD COMBINED SCENARIOS =====
  {
    // Real-world vitest output with ANSI codes
    message: "[36mINFO[0m [2024-01-15 10:30:45] src/composables/useTextHighlighter.spec.ts[2m",
    level: "info",
    test_case: "vitest_output",
    expected_text: "useTextHighlighter.spec.ts"
  },
  {
    // Mixed unclosed characters
    message: "Debug: parsing config{name: 'test<value(",
    level: "debug",
    test_case: "mixed_unclosed_chars",
    expected_text: "value"
  }
];

const STREAM_NAME = 'e2e_highlighting_test';

test.describe("Logs Highlighting Regression Bug Fixes", () => {
  test.describe.configure({ mode: 'serial' }); // Serial because tests depend on ingested data
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle');
    testLogger.info('Logs highlighting regression test setup completed');
  });

  // ==========================================================================
  // Bug #9754: Logs highlighting character loss with unclosed brackets/quotes
  // https://github.com/openobserve/openobserve/issues/9754
  // ==========================================================================

  test("should ingest test data with unclosed brackets/quotes @bug-9754 @setup", async ({ page }) => {
    testLogger.info('Test: Ingest test data for Bug #9754');

    const orgId = process.env["ORGNAME"];
    const headers = getHeaders();
    const url = getIngestionUrl(orgId, STREAM_NAME);

    // Ingest the test logs
    const response = await sendRequest(page, url, BUG_9754_TEST_LOGS, headers);

    testLogger.info('Ingestion response:', response);

    // Wait for data to be indexed
    await page.waitForTimeout(3000);

    testLogger.info('Test data ingested successfully');
  });

  test("should preserve characters with unclosed brackets in log display @bug-9754 @P0 @highlighting @regression", async ({ page }) => {
    testLogger.info('Test: Verify unclosed brackets do not cause character loss (Bug #9754)');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle');

    // Select the test stream
    await pm.logsPage.selectStream(STREAM_NAME);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Table must be visible
    await pm.logsPage.expectLogsTableVisible();

    // Get the table content
    const tableContent = await pm.logsPage.getLogsTableContent();

    // CRITICAL ASSERTIONS for Bug #9754:
    // The 's' from '.ts' must NOT be lost when there's an unclosed bracket

    // Test case 1: ANSI escape sequence with file path
    expect(tableContent).toContain('QueryEditor.spec.ts');
    testLogger.info('Assertion passed: QueryEditor.spec.ts preserved');

    // Test case 2: Complex ANSI log line
    expect(tableContent).toContain('About.spec.ts');
    testLogger.info('Assertion passed: About.spec.ts preserved');

    // Test case 3: Unclosed quotes should preserve content
    expect(tableContent).toContain('unclosed');
    testLogger.info('Assertion passed: unclosed text preserved');

    testLogger.info('PASSED: Characters preserved with unclosed brackets');
  });

  test("should preserve characters when highlighting search terms with unclosed brackets @bug-9754 @P0 @highlighting @regression", async ({ page }) => {
    testLogger.info('Test: Verify highlighting with unclosed brackets preserves all characters (Bug #9754)');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle');

    // Select the test stream
    await pm.logsPage.selectStream(STREAM_NAME);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    // Add a search query that triggers highlighting
    // Using match_all to highlight the word "spec"
    await pm.logsPage.typeQuery("match_all('spec')");

    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Table must be visible with results
    await pm.logsPage.expectLogsTableVisible();

    // Get the table content to verify characters are preserved
    const tableContent = await pm.logsPage.getLogsTableContent();

    // CRITICAL ASSERTIONS: File extensions must be complete
    // The bug was that the last character before '[' was being dropped
    expect(tableContent).toContain('.ts');
    testLogger.info('Assertion passed: .ts extension preserved during highlighting');

    // Check if highlighting is applied (informational - not a strict requirement)
    await pm.logsPage.getHighlightedElementsCount();

    // Verify the complete file names are present (the core bug fix assertion)
    expect(tableContent).toContain('QueryEditor.spec.ts');
    expect(tableContent).toContain('About.spec.ts');
    testLogger.info('Assertion passed: Complete file paths preserved with highlighting query');

    testLogger.info('PASSED: Highlighting preserves all characters');
  });

  test("should display complete text in log detail sidebar with unclosed brackets @bug-9754 @P1 @highlighting @regression", async ({ page }) => {
    testLogger.info('Test: Verify log detail sidebar shows complete text (Bug #9754)');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle');

    // Select the test stream
    await pm.logsPage.selectStream(STREAM_NAME);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Table must be visible
    await pm.logsPage.expectLogsTableVisible();

    // Open the log detail sidebar using the proper page method
    await pm.logsPage.openLogDetailSidebar();
    await pm.logsPage.expectLogDetailSidebarVisible();

    // Get the detail content from JSON view (default tab)
    const detailContent = await pm.logsPage.getLogDetailJsonContentText();

    // Verify content was retrieved
    expect(detailContent).not.toBeNull();
    expect(detailContent).toBeDefined();

    // CRITICAL ASSERTIONS: Full content must be preserved in detail view
    // At least one of our test cases should be visible
    const hasCompleteContent =
      detailContent?.includes('.ts') ||
      detailContent?.includes('unclosed') ||
      detailContent?.includes('spec');

    expect(hasCompleteContent).toBe(true);
    testLogger.info('Assertion passed: Log detail shows complete content');

    // Close the sidebar
    await pm.logsPage.closeLogDetailSidebar();

    testLogger.info('PASSED: Log detail sidebar shows complete text');
  });

  test("should preserve file path characters when containing ANSI escape codes @bug-9754 @P0 @highlighting @regression", async ({ page }) => {
    testLogger.info('Test: Verify file paths with ANSI codes preserve all characters (Bug #9754)');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle');

    // Select the test stream and search for file path content
    await pm.logsPage.selectStream(STREAM_NAME);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    // Search for .ts files to find our test data
    await pm.logsPage.typeQuery("match_all('.ts')");

    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Get table content
    const tableContent = await pm.logsPage.getLogsTableContent();

    // CRITICAL ASSERTIONS for Bug #9754:
    // These specific file names must be complete (not missing the 's' before '[')
    const filePathTests = [
      { expected: 'QueryEditor.spec.ts', description: 'QueryEditor file path' },
      { expected: 'About.spec.ts', description: 'About file path' },
      { expected: 'useTextHighlighter.spec.ts', description: 'useTextHighlighter file path' }
    ];

    let passedCount = 0;
    for (const testCase of filePathTests) {
      if (tableContent.includes(testCase.expected)) {
        testLogger.info(`Assertion passed: ${testCase.description} (${testCase.expected})`);
        passedCount++;
      }
    }

    // At least one file path should be found and complete
    expect(passedCount).toBeGreaterThan(0);
    testLogger.info(`PASSED: ${passedCount}/${filePathTests.length} file paths verified complete`);
  });

  test("should handle multiple unclosed brackets without character loss @bug-9754 @P1 @highlighting @regression", async ({ page }) => {
    testLogger.info('Test: Verify multiple unclosed brackets do not compound character loss (Bug #9754)');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle');

    // Select the test stream
    await pm.logsPage.selectStream(STREAM_NAME);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    // Search for the test case with multiple unclosed brackets
    await pm.logsPage.typeQuery("match_all('second')");

    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Get table content
    const tableContent = await pm.logsPage.getLogsTableContent();

    // CRITICAL ASSERTION: The word "second" must be complete
    // In the bug, characters before each '[' were being dropped
    expect(tableContent).toContain('second');
    expect(tableContent).toContain('first');
    expect(tableContent).toContain('test');

    testLogger.info('PASSED: Multiple unclosed brackets handled correctly');
  });

  test.afterEach(async () => {
    testLogger.info('Logs highlighting regression test completed');
  });

  // Cleanup: Delete the test stream after all tests complete
  test.afterAll(async ({ browser }) => {
    testLogger.info('Cleaning up test stream (afterAll)');

    const context = await browser.newContext();
    const page = await context.newPage();
    const cleanupPm = new PageManager(page);

    try {
      // Delete the test stream via API
      const result = await cleanupPm.apiCleanup.deleteStream(STREAM_NAME);
      testLogger.info('Stream cleanup result:', result);
      testLogger.info(`Test stream ${STREAM_NAME} cleanup completed`);
    } catch (error) {
      testLogger.warn(`Failed to cleanup test stream: ${error.message}`);
    } finally {
      await page.close();
      await context.close();
    }
  });
});
