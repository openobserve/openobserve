/**
 * OpenObserve E2E Test Reporter
 *
 * Reads Playwright's report.json, transforms each test case into structured
 * log entries, and sends them to OpenObserve for reporting and analytics.
 *
 * Usage:
 *   Called by run-e2e-report.js after each shard completes.
 *   Can also be run standalone:
 *     node o2-reporter.js --report=path/to/report.json --shard=SDR --run-id=abc1234
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getConfig() {
  // Try dotenv if available
  try {
    require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  } catch (_) { /* dotenv not required */ }

  return {
    reportUrl: process.env.O2_REPORT_URL,
    reportOrg: process.env.O2_REPORT_ORG,
    reportEmail: process.env.O2_REPORT_EMAIL,
    reportPassword: process.env.O2_REPORT_PASSWORD,
    reportStream: process.env.O2_REPORT_STREAM || 'e2e_playwright_reports',
  };
}

// ---------------------------------------------------------------------------
// Git metadata helpers
// ---------------------------------------------------------------------------

function getGitMetadata() {
  const exec = (cmd) => {
    try { return execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim(); }
    catch { return ''; }
  };
  return {
    git_branch: exec('git rev-parse --abbrev-ref HEAD'),
  };
}

// ---------------------------------------------------------------------------
// Environment metadata
// ---------------------------------------------------------------------------

function getEnvironmentMetadata() {
  const isCI = !!(process.env.CI || process.env.GITHUB_ACTIONS);
  let playwrightVersion = '';
  try {
    const pwPkg = require('@playwright/test/package.json');
    playwrightVersion = pwPkg.version;
  } catch { /* not critical */ }

  // Environment reflects the target test env, not where the runner executes
  // Set O2_TARGET_ENV to override (e.g., "staging", "production", "dev")
  // Falls back to extracting from ZO_BASE_URL or defaults to "test"
  let environment = process.env.O2_TARGET_ENV || '';
  if (!environment) {
    const baseUrl = process.env.ZO_BASE_URL || '';
    if (baseUrl.includes('alpha1')) environment = 'alpha1';
    else if (baseUrl.includes('alpha2')) environment = 'alpha2';
    else if (baseUrl.includes('test.o2aks1')) environment = 'test';
    else if (baseUrl.includes('staging')) environment = 'staging';
    else if (baseUrl.includes('prod')) environment = 'production';
    else environment = 'test';
  }

  return {
    environment,
    runner: isCI ? (process.env.RUNNER_NAME || 'ci') : os.hostname(),
    os: os.platform(),
    os_version: os.release(),
    node_version: process.version,
    playwright_version: playwrightVersion,
    hostname: os.hostname(),
  };
}

// ---------------------------------------------------------------------------
// Text sanitization — clean strings for safe JSON ingestion
// ---------------------------------------------------------------------------

function sanitizeText(str) {
  if (!str) return '';
  // Strip ANSI escape codes (color codes from Playwright output)
  let clean = str.replace(/\u001b\[[0-9;]*m/g, '');
  // Remove lone surrogates (incomplete emoji from truncation)
  clean = clean.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '');
  clean = clean.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  // Remove other control characters (except \n, \r, \t)
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return clean;
}

// Safe truncate — won't split surrogate pairs
function safeTruncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  let truncated = str.slice(0, maxLen);
  // If we cut in the middle of a surrogate pair, remove the lone high surrogate
  const lastChar = truncated.charCodeAt(truncated.length - 1);
  if (lastChar >= 0xD800 && lastChar <= 0xDBFF) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

// ---------------------------------------------------------------------------
// Error categorization
// ---------------------------------------------------------------------------

function categorizeError(errorMessage) {
  if (!errorMessage) return '';
  const msg = errorMessage.toLowerCase();

  if (msg.includes('timeout') || msg.includes('exceeded'))
    return 'timeout_issues';
  if (msg.includes('expect(') || msg.includes('tobe') || msg.includes('tohave') || msg.includes('assertion'))
    return 'assertion_failures';
  if (msg.includes('locator') || msg.includes('element') || msg.includes('selector') || msg.includes('waiting for'))
    return 'element_not_found';
  if (msg.includes('net::err_') || msg.includes('econnrefused') || msg.includes('fetch failed') || msg.includes('network'))
    return 'network_issues';
  if (msg.includes('navigation') || msg.includes('page.goto') || msg.includes('navigating'))
    return 'navigation_issues';
  if (msg.includes('permission') || msg.includes('forbidden') || msg.includes('401') || msg.includes('403'))
    return 'auth_issues';

  return 'other';
}

// ---------------------------------------------------------------------------
// Report parsing — recursively extract specs from nested suites
// ---------------------------------------------------------------------------

function extractSpecs(suites, parentSuiteTitles = []) {
  const specs = [];

  for (const suite of suites) {
    const currentPath = [...parentSuiteTitles];
    // Only add the suite title if it's not the file path itself
    if (suite.title && !suite.title.includes('.spec.')) {
      currentPath.push(suite.title);
    }

    // Collect specs at this level (skip setup/teardown hooks)
    if (suite.specs) {
      for (const spec of suite.specs) {
        const title = (spec.title || '').toLowerCase();
        if (title.startsWith('setup:') || title.startsWith('teardown:') || title.startsWith('cleanup:')) {
          continue;
        }
        specs.push({
          ...spec,
          _suitePath: currentPath.join(' > '),
          _filePath: spec.file || suite.file || '',
        });
      }
    }

    // Recurse into nested suites
    if (suite.suites) {
      specs.push(...extractSpecs(suite.suites, currentPath));
    }
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Transform a single spec into O2 log entries (one per result/attempt)
// ---------------------------------------------------------------------------

function transformSpec(spec, shard, runId, shardStats, metadata) {
  const entries = [];

  for (const test of (spec.tests || [])) {
    for (const result of (test.results || [])) {
      // Determine effective status
      let status = result.status; // 'passed', 'failed', 'timedOut', 'skipped', 'interrupted'
      if (status === 'timedOut') status = 'failed';
      if (status === 'interrupted') status = 'failed';

      // For flaky detection: if test.status === 'flaky' in the overall spec
      const isFlaky = test.status === 'flaky';
      if (isFlaky && status === 'passed') status = 'flaky';

      // Extract error details (sanitize to remove ANSI codes and lone surrogates)
      let errorMessage = '';
      let errorStack = '';
      if (result.errors && result.errors.length > 0) {
        errorMessage = sanitizeText(safeTruncate(
          result.errors.map(e => e.message || '').join('\n'), 2000
        ));
        errorStack = sanitizeText(safeTruncate(
          result.errors.map(e => e.stack || e.snippet || '').join('\n'), 5000
        ));
      }

      // Build the log entry
      const entry = {
        // Run identification
        run_id: runId,
        run_timestamp: metadata.runTimestamp,
        environment: metadata.env.environment,
        run_attempt: parseInt(process.env.GITHUB_RUN_ATTEMPT || '1', 10),

        // Shard info
        shard: shard,
        total_tests_in_shard: shardStats.total,
        shard_passed: shardStats.passed,
        shard_failed: shardStats.failed,
        shard_skipped: shardStats.skipped,
        shard_flaky: shardStats.flaky,
        shard_pass_rate: shardStats.total > 0
          ? parseFloat(((shardStats.passed / shardStats.total) * 100).toFixed(2))
          : 0,
        shard_duration_secs: parseFloat((shardStats.duration / 1000).toFixed(2)),

        // Test case info
        test_name: spec.title || '',
        test_suite: spec._suitePath || '',
        file_path: spec._filePath || '',
        full_title: spec._suitePath
          ? `${spec._suitePath} > ${spec.title}`
          : spec.title || '',
        status: status,
        duration_secs: parseFloat(((result.duration || 0) / 1000).toFixed(2)),
        attempt_number: result.retry || 0,
        worker_index: result.workerIndex ?? -1,

        // Tags
        tags: (spec.tags || []).join(','),
        tag_list: spec.tags || [],

        // Git info
        ...metadata.git,

        // Environment info
        browser: test.projectName || 'chromium',
        project_name: test.projectName || 'chromium',
        ...metadata.env,

        // Error details
        error_message: errorMessage,
        error_stack: errorStack,
        error_category: categorizeError(errorMessage),

        // Computed boolean fields for easy dashboard filtering
        is_failure: status === 'failed',
        is_flaky: isFlaky,
        is_retry: (result.retry || 0) > 0,
        is_skipped: status === 'skipped',

        // Timestamps (O2 expects _timestamp in microseconds)
        _timestamp: result.startTime
          ? new Date(result.startTime).getTime() * 1000
          : Date.now() * 1000,
        test_start_time: result.startTime || new Date().toISOString(),

        // Stdout/stderr preview (sanitized + truncated)
        stdout_preview: sanitizeText(safeTruncate(
          (result.stdout || []).map(s => s.text || '').join(''), 1000
        )),
      };

      entries.push(entry);
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Calculate shard-level stats from report
// ---------------------------------------------------------------------------

function calculateShardStats(report) {
  const stats = report.stats || {};
  return {
    total: (stats.expected || 0) + (stats.unexpected || 0) + (stats.skipped || 0) + (stats.flaky || 0),
    passed: stats.expected || 0,
    failed: stats.unexpected || 0,
    skipped: stats.skipped || 0,
    flaky: stats.flaky || 0,
    duration: Math.round(stats.duration || 0),
  };
}

// ---------------------------------------------------------------------------
// Send data to OpenObserve
// ---------------------------------------------------------------------------

async function sendToO2(logs, config) {
  if (logs.length === 0) {
    console.log('  No test results to send.');
    return { success: true, count: 0 };
  }

  const url = `${config.reportUrl}/api/${config.reportOrg}/${config.reportStream}/_json`;
  const auth = Buffer.from(`${config.reportEmail}:${config.reportPassword}`).toString('base64');

  // Send in batches of 100
  const batchSize = 100;
  let totalSent = 0;

  for (let i = 0; i < logs.length; i += batchSize) {
    const batch = logs.slice(i, i + batchSize);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`O2 ingestion failed (${response.status}): ${body}`);
    }

    totalSent += batch.length;
    if (logs.length > batchSize) {
      console.log(`  Sent batch ${Math.floor(i / batchSize) + 1}: ${batch.length} entries`);
    }
  }

  return { success: true, count: totalSent };
}

// ---------------------------------------------------------------------------
// Main: process a report file and send to O2
// ---------------------------------------------------------------------------

async function processReport(reportPath, shard, runId, overrideMetadata = {}) {
  const config = getConfig();

  // Validate config
  if (!config.reportUrl || !config.reportOrg || !config.reportEmail || !config.reportPassword) {
    console.error('Missing O2 reporting config. Required env vars:');
    console.error('  O2_REPORT_URL, O2_REPORT_ORG, O2_REPORT_EMAIL, O2_REPORT_PASSWORD');
    return { success: false, error: 'Missing config' };
  }

  // Read report
  if (!fs.existsSync(reportPath)) {
    console.error(`Report file not found: ${reportPath}`);
    return { success: false, error: 'Report not found' };
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

  // Collect metadata
  const metadata = {
    runTimestamp: overrideMetadata.runTimestamp || new Date().toISOString(),
    git: overrideMetadata.git || getGitMetadata(),
    env: overrideMetadata.env || getEnvironmentMetadata(),
  };

  // Calculate stats
  const shardStats = calculateShardStats(report);

  // Extract and transform all specs
  const specs = extractSpecs(report.suites || []);
  const logs = [];

  for (const spec of specs) {
    logs.push(...transformSpec(spec, shard, runId, shardStats, metadata));
  }

  console.log(`  Parsed ${logs.length} test result entries from ${specs.length} specs`);
  console.log(`  Stats: ${shardStats.passed} passed, ${shardStats.failed} failed, ${shardStats.skipped} skipped, ${shardStats.flaky} flaky`);

  // Send to O2
  const result = await sendToO2(logs, config);
  console.log(`  Successfully sent ${result.count} entries to O2 stream: ${config.reportStream}`);

  return {
    success: true,
    shard,
    runId,
    entries: logs.length,
    stats: shardStats,
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const match = args.find(a => a.startsWith(`--${name}=`));
    return match ? match.split('=').slice(1).join('=') : undefined;
  };

  const reportPath = getArg('report') || 'playwright-results/report.json';
  const shard = getArg('shard') || 'unknown';
  const runId = getArg('run-id') || 'standalone';

  console.log(`\nO2 Reporter — Processing ${shard} shard (run: ${runId})`);
  console.log(`  Report: ${reportPath}`);

  processReport(reportPath, shard, runId)
    .then(result => {
      if (result.success) {
        console.log(`  Done.\n`);
      } else {
        console.error(`  Failed: ${result.error}\n`);
        process.exit(1);
      }
    })
    .catch(err => {
      console.error(`  Error: ${err.message}\n`);
      process.exit(1);
    });
}

module.exports = { processReport, getGitMetadata, getEnvironmentMetadata };
