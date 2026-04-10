#!/usr/bin/env node
/**
 * E2E Test Runner with OpenObserve Reporting
 *
 * Generates a unique run ID, spawns Playwright test shards in parallel,
 * and sends results to OpenObserve after each shard completes.
 *
 * Usage:
 *   node o2-reporting/run-e2e-report.js                          # Run all POC shards
 *   node o2-reporting/run-e2e-report.js --shards=SDR,Streams     # Run specific shards
 *   node o2-reporting/run-e2e-report.js --run-id=abc1234         # Use specific run ID
 *   node o2-reporting/run-e2e-report.js --dry-run                # Parse + print, don't send
 */

const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Load env vars
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} catch (_) { /* dotenv not required */ }

const { processReport, getGitMetadata, getEnvironmentMetadata } = require('./o2-reporter');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const POC_SHARDS = {
  SDR: {
    name: 'SDR',
    testDir: './playwright-tests/SDR/',
  },
  RUM: {
    name: 'RUM',
    testDir: './playwright-tests/RUM/',
  },
  Streams: {
    name: 'Streams',
    testDir: './playwright-tests/Streams/',
  },
};

// ---------------------------------------------------------------------------
// Run ID generation
// ---------------------------------------------------------------------------

function generateRunId() {
  const isCI = !!(process.env.CI || process.env.GITHUB_ACTIONS);

  // 4 chars from timestamp (base36) + 3 random chars = 7 chars
  const timePart = Date.now().toString(36).slice(-4);
  const randomPart = crypto.randomBytes(2).toString('hex').slice(0, 3);
  const id = `${timePart}${randomPart}`;

  return isCI ? `ci_${id}` : id;
}

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const match = args.find(a => a.startsWith(`--${name}=`));
    return match ? match.split('=').slice(1).join('=') : undefined;
  };

  const shardNames = getArg('shards')
    ? getArg('shards').split(',').map(s => s.trim())
    : Object.keys(POC_SHARDS);

  return {
    shards: shardNames,
    runId: getArg('run-id') || generateRunId(),
    dryRun: args.includes('--dry-run'),
  };
}

// ---------------------------------------------------------------------------
// Run a single Playwright test (shard or cleanup)
// ---------------------------------------------------------------------------

function runPlaywrightTest(label, testPath, options = {}) {
  const { cwd, reportFile, extraEnv = {} } = options;

  return new Promise((resolve) => {
    const env = {
      ...process.env,
      ...extraEnv,
    };

    // If a reportFile is specified, set PLAYWRIGHT_JSON_OUTPUT_FILE
    if (reportFile) {
      const reportDir = path.dirname(reportFile);
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }
      env.PLAYWRIGHT_JSON_OUTPUT_FILE = reportFile;
    }

    const args = ['playwright', 'test', testPath];
    if (reportFile) args.push('--reporter=json');

    console.log(`  [${label}] Starting: ${testPath}`);
    if (reportFile) console.log(`  [${label}] Report output: ${reportFile}`);

    const child = spawn('npx', args, {
      env,
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      const line = data.toString();
      stderr += line;
      if (line.includes('Running') || line.includes('passed') || line.includes('failed') || line.includes('test')) {
        process.stderr.write(`  [${label}] ${line}`);
      }
    });

    child.on('close', (exitCode) => {
      console.log(`  [${label}] Exited with code ${exitCode}`);
      resolve({
        label,
        exitCode,
        reportFile,
        stdout,
        stderr,
      });
    });

    child.on('error', (err) => {
      console.error(`  [${label}] Failed to start: ${err.message}`);
      resolve({
        label,
        exitCode: 1,
        reportFile,
        error: err.message,
      });
    });
  });
}

// Convenience: run a shard with report output
function runShard(shard, runId, cwd) {
  const reportFile = path.resolve(cwd, `playwright-results/report-${shard.name}.json`);
  return runPlaywrightTest(shard.name, shard.testDir, {
    cwd,
    reportFile,
    extraEnv: { O2_RUN_ID: runId, O2_SHARD_NAME: shard.name },
  }).then(result => ({ ...result, shard: shard.name }));
}

// Run cleanup spec (no report output — not reported to O2)
function runCleanup(cwd) {
  return runPlaywrightTest('Cleanup', './playwright-tests/cleanup.spec.js', { cwd });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { shards: shardNames, runId, dryRun } = parseArgs();
  const cwd = path.resolve(__dirname, '..');

  // Validate shards
  const shards = [];
  for (const name of shardNames) {
    if (!POC_SHARDS[name]) {
      console.error(`Unknown shard: ${name}. Available: ${Object.keys(POC_SHARDS).join(', ')}`);
      process.exit(1);
    }
    shards.push(POC_SHARDS[name]);
  }

  // Collect metadata once (shared across all shards)
  const metadata = {
    runTimestamp: new Date().toISOString(),
    git: getGitMetadata(),
    env: getEnvironmentMetadata(),
  };

  console.log('\n' + '='.repeat(70));
  console.log('  OpenObserve E2E Test Reporter — POC Run');
  console.log('='.repeat(70));
  console.log(`  Run ID:      ${runId}`);
  console.log(`  Target Env:  ${metadata.env.environment}`);
  console.log(`  Runner:      ${metadata.env.runner}`);
  console.log(`  Branch:      ${metadata.git.git_branch}`);
  console.log(`  OS:          ${metadata.env.os} (${metadata.env.os_version})`);
  console.log(`  Node:        ${metadata.env.node_version}`);
  console.log(`  Playwright:  ${metadata.env.playwright_version}`);
  console.log(`  Shards:      ${shards.map(s => s.name).join(', ')}`);
  console.log(`  Dry Run:     ${dryRun}`);
  console.log(`  Report URL:  ${process.env.O2_REPORT_URL || '(not set)'}`);
  console.log(`  Stream:      ${process.env.O2_REPORT_STREAM || 'e2e_playwright_reports'}`);
  console.log('='.repeat(70) + '\n');

  // Run cleanup once, then all shards in parallel
  console.log('--- Running cleanup ---');
  const cleanupResult = await runCleanup(cwd);
  if (cleanupResult.exitCode !== 0) {
    console.warn(`  [Cleanup] Warning: cleanup exited with code ${cleanupResult.exitCode} (continuing anyway)`);
  }

  console.log(`\n--- Running ${shards.length} shard(s) in parallel: ${shards.map(s => s.name).join(', ')} ---\n`);
  const shardResults = await Promise.all(
    shards.map(shard => runShard(shard, runId, cwd))
  );

  // Process and send reports
  console.log('\n' + '-'.repeat(70));
  console.log('  Processing Reports & Sending to OpenObserve');
  console.log('-'.repeat(70) + '\n');

  const reportResults = [];

  for (const result of shardResults) {
    console.log(`[${result.shard}] Processing report...`);

    if (!fs.existsSync(result.reportFile)) {
      console.error(`  [${result.shard}] Report file not found: ${result.reportFile}`);
      console.error(`  [${result.shard}] Playwright may have failed before generating the report.`);

      // Check if JSON was written to stdout instead (--reporter=json outputs to stdout)
      if (result.stdout && result.stdout.includes('"suites"')) {
        console.log(`  [${result.shard}] Found JSON report in stdout, saving to file...`);
        // Extract JSON from stdout (it may have other output mixed in)
        const jsonMatch = result.stdout.match(/\{[\s\S]*"suites"[\s\S]*\}/);
        if (jsonMatch) {
          fs.writeFileSync(result.reportFile, jsonMatch[0]);
          console.log(`  [${result.shard}] Saved extracted JSON report.`);
        }
      }

      if (!fs.existsSync(result.reportFile)) {
        reportResults.push({ shard: result.shard, success: false, error: 'No report file' });
        continue;
      }
    }

    if (dryRun) {
      console.log(`  [${result.shard}] DRY RUN — would send report from ${result.reportFile}`);
      reportResults.push({ shard: result.shard, success: true, dryRun: true });
      continue;
    }

    try {
      const reportResult = await processReport(
        result.reportFile,
        result.shard,
        runId,
        metadata
      );
      reportResults.push(reportResult);
    } catch (err) {
      console.error(`  [${result.shard}] Failed to process report: ${err.message}`);
      reportResults.push({ shard: result.shard, success: false, error: err.message });
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('  Run Summary');
  console.log('='.repeat(70));
  console.log(`  Run ID: ${runId}\n`);

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalFlaky = 0;
  let anyFailure = false;

  for (const r of reportResults) {
    const icon = r.success ? (r.stats?.failed > 0 ? '!' : '+') : 'x';
    const statsLine = r.stats
      ? `${r.stats.passed} passed, ${r.stats.failed} failed, ${r.stats.skipped} skipped, ${r.stats.flaky} flaky`
      : r.error || 'dry run';
    console.log(`  [${icon}] ${r.shard}: ${statsLine} (${r.entries || 0} entries sent)`);

    if (r.stats) {
      totalPassed += r.stats.passed;
      totalFailed += r.stats.failed;
      totalSkipped += r.stats.skipped;
      totalFlaky += r.stats.flaky;
    }
    if (!r.success || (r.stats && r.stats.failed > 0)) anyFailure = true;
  }

  const total = totalPassed + totalFailed + totalSkipped + totalFlaky;
  console.log(`\n  Total: ${total} tests | ${totalPassed} passed | ${totalFailed} failed | ${totalSkipped} skipped | ${totalFlaky} flaky`);
  console.log('='.repeat(70) + '\n');

  // Check which shard had test failures (non-zero exit code)
  const testFailures = shardResults.filter(r => r.exitCode !== 0);
  if (testFailures.length > 0) {
    console.log(`Note: ${testFailures.length} shard(s) had test failures (non-zero exit): ${testFailures.map(r => r.shard).join(', ')}`);
  }

  // Exit with failure if any reporting failed (not test failures - those are expected)
  const reportingFailures = reportResults.filter(r => !r.success);
  if (reportingFailures.length > 0) {
    console.error(`ERROR: ${reportingFailures.length} shard(s) failed to report: ${reportingFailures.map(r => r.shard).join(', ')}`);
    process.exit(1);
  }

  console.log('All reports sent successfully to OpenObserve!');

  // -------------------------------------------------------------------------
  // Generate and upload per-run dashboard
  // -------------------------------------------------------------------------
  if (!dryRun) {
    console.log('\n' + '-'.repeat(70));
    console.log('  Generating & Uploading Per-Run Dashboard');
    console.log('-'.repeat(70) + '\n');

    try {
      // Generate dashboard config filtered by this run_id
      const generateScript = path.resolve(__dirname, 'generate-dashboard.js');
      execSync(`node "${generateScript}" --run-id=${runId}`, {
        cwd: __dirname,
        stdio: 'inherit',
      });

      // Upload the dashboard into "Playwright Reports" folder (always create new for per-run)
      const uploadScript = path.resolve(__dirname, 'upload-dashboard.js');
      const folder = 'Playwright Reports';
      execSync(`node "${uploadScript}" --config=dashboard-config.json --create --folder="${folder}"`, {
        cwd: __dirname,
        stdio: 'inherit',
      });

      // Also update the shared trends dashboard in the same folder
      const trendsScript = path.resolve(__dirname, 'generate-trends-dashboard.js');
      execSync(`node "${trendsScript}"`, {
        cwd: __dirname,
        stdio: 'inherit',
      });
      execSync(`node "${uploadScript}" --config=trends-dashboard-config.json --upsert --folder="${folder}"`, {
        cwd: __dirname,
        stdio: 'inherit',
      });

    } catch (dashErr) {
      console.error(`  Dashboard upload failed: ${dashErr.message}`);
      console.error('  (Reports were sent successfully — dashboard can be uploaded manually)');
    }
  }
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
