/**
 * OpenObserve Playwright Reporter - POC
 *
 * Custom Playwright reporter that sends test results to OpenObserve log streams.
 *
 * Usage in playwright.config.js:
 *   reporter: [
 *     ['./playwright-tests/utils/o2-reporter.js', { enabled: true }]
 *   ]
 */

class O2Reporter {
  constructor(options = {}) {
    this.options = {
      baseUrl: options.baseUrl || process.env.ZO_BASE_URL || 'http://localhost:5080',
      orgId: options.orgId || process.env.ORGNAME || 'default',
      username: options.username || process.env.ZO_ROOT_USER_EMAIL,
      password: options.password || process.env.ZO_ROOT_USER_PASSWORD,
      testStream: options.testStream || 'playwright_tests',
      metadataStream: options.metadataStream || 'playwright_run_metadata',
      consoleStream: options.consoleStream || 'playwright_console_logs',
      enabled: options.enabled !== false,
      debug: options.debug || false
    };

    // Run metadata
    this.runId = `run_${new Date().toISOString().replace(/[:.]/g, '-')}_${Math.random().toString(36).substring(2, 8)}`;
    this.startTime = null;
    this.testResults = [];
    this.consoleLogs = [];

    // CI detection
    this.ciInfo = this.detectCI();

    this.log(`O2 Reporter initialized - Run ID: ${this.runId}`);
    this.log(`Config: baseUrl=${this.options.baseUrl}, org=${this.options.orgId}, enabled=${this.options.enabled}`);
  }

  log(message) {
    if (this.options.debug) {
      console.log(`[O2Reporter] ${message}`);
    }
  }

  detectCI() {
    return {
      buildId: process.env.GITHUB_RUN_ID || process.env.CI_BUILD_ID || 'local',
      branch: process.env.GITHUB_REF_NAME || process.env.CI_BRANCH || process.env.GIT_BRANCH || 'local',
      commitSha: process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || 'local',
      commitAuthor: process.env.GITHUB_ACTOR || process.env.CI_COMMIT_AUTHOR || 'local',
      prNumber: process.env.GITHUB_PR_NUMBER || process.env.CI_PR_NUMBER || null,
      environment: process.env.CI ? 'ci' : 'local'
    };
  }

  // Called once before running tests
  onBegin(config, suite) {
    this.startTime = Date.now();
    this.totalTests = suite.allTests().length;
    this.log(`Test run started - ${this.totalTests} tests`);
  }

  // Called after each test
  onTestEnd(test, result) {
    const testRecord = this.transformTestResult(test, result);
    this.testResults.push(testRecord);

    const statusIcon = result.status === 'passed' ? '✓' : result.status === 'failed' ? '✗' : '○';
    this.log(`${statusIcon} ${test.title} (${result.duration}ms)`);
  }

  // Called after all tests
  async onEnd(result) {
    if (!this.options.enabled) {
      this.log('O2 Reporter disabled - skipping ingestion');
      return;
    }

    const endTime = Date.now();
    const totalDuration = endTime - this.startTime;

    // Calculate stats
    const passed = this.testResults.filter(t => t.status === 'passed').length;
    const failed = this.testResults.filter(t => t.status === 'failed').length;
    const skipped = this.testResults.filter(t => t.status === 'skipped').length;
    const flaky = this.testResults.filter(t => t.is_flaky).length;
    const timedOut = this.testResults.filter(t => t.status === 'timedOut').length;

    console.log('\n' + '='.repeat(60));
    console.log('OpenObserve Test Reporting');
    console.log('='.repeat(60));
    console.log(`Run ID: ${this.runId}`);
    console.log(`Total: ${this.testResults.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped} | Flaky: ${flaky}`);
    console.log(`Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log('='.repeat(60));

    try {
      // 1. Ingest test results
      console.log(`\nIngesting ${this.testResults.length} test results to ${this.options.testStream}...`);
      const testIngestionResult = await this.ingestData(this.options.testStream, this.testResults);
      console.log(`✓ Test results ingested: ${testIngestionResult.successful || this.testResults.length} records`);

      // 2. Ingest run metadata
      const runMetadata = {
        _timestamp: endTime,
        run_id: this.runId,
        total_tests: this.testResults.length,
        passed,
        failed,
        skipped,
        flaky,
        timed_out: timedOut,
        total_duration_ms: totalDuration,
        start_time: this.startTime,
        end_time: endTime,
        pass_rate: this.testResults.length > 0 ? ((passed / this.testResults.length) * 100).toFixed(2) : 0,
        avg_duration_ms: this.testResults.length > 0
          ? Math.round(this.testResults.reduce((sum, t) => sum + t.duration_ms, 0) / this.testResults.length)
          : 0,
        ci_build_id: this.ciInfo.buildId,
        ci_branch: this.ciInfo.branch,
        ci_commit_sha: this.ciInfo.commitSha,
        ci_commit_author: this.ciInfo.commitAuthor,
        environment: this.ciInfo.environment,
        playwright_version: require('@playwright/test/package.json').version,
        node_version: process.version,
        os_platform: process.platform
      };

      console.log(`Ingesting run metadata to ${this.options.metadataStream}...`);
      await this.ingestData(this.options.metadataStream, [runMetadata]);
      console.log('✓ Run metadata ingested');

      console.log('\n' + '='.repeat(60));
      console.log('View results at:');
      console.log(`${this.options.baseUrl}/web/logs?org_identifier=${this.options.orgId}&stream=${this.options.testStream}`);
      console.log('='.repeat(60) + '\n');

    } catch (error) {
      console.error('\n[O2Reporter] Failed to ingest data:', error.message);
      // Don't fail the test run due to reporting issues
    }
  }

  transformTestResult(test, result) {
    const now = Date.now();
    const startTime = result.startTime ? new Date(result.startTime).getTime() : now - result.duration;

    // Extract file path relative to project
    const filePath = test.location?.file || '';
    const relativePath = filePath.includes('playwright-tests')
      ? filePath.substring(filePath.indexOf('playwright-tests'))
      : filePath;

    // Determine if flaky (passed after retry)
    const isFlaky = result.status === 'passed' && result.retry > 0;

    return {
      _timestamp: now,
      run_id: this.runId,
      test_id: test.id || `${relativePath}:${test.location?.line || 0}:${this.sanitizeTitle(test.title)}`,
      test_title: test.title,
      test_full_title: test.titlePath().join(' > '),
      suite_name: test.parent?.title || 'root',
      file_path: relativePath,
      line_number: test.location?.line || 0,
      status: result.status,
      is_flaky: isFlaky,
      duration_ms: result.duration,
      start_time: startTime,
      end_time: startTime + result.duration,
      retry_count: result.retry || 0,
      max_retries: test.retries || 0,
      browser: test.parent?.project?.name || 'chromium',
      project_name: test.parent?.project?.name || 'default',
      worker_index: result.workerIndex || 0,
      ci_build_id: this.ciInfo.buildId,
      ci_branch: this.ciInfo.branch,
      ci_commit_sha: this.ciInfo.commitSha,
      ci_commit_author: this.ciInfo.commitAuthor,
      ci_pr_number: this.ciInfo.prNumber,
      environment: this.ciInfo.environment,
      tags: (test.tags || []).join(','),
      error_message: result.error?.message || null,
      error_type: result.error?.name || null,
      stack_trace: result.error?.stack ? result.error.stack.substring(0, 2000) : null, // Truncate long stacks
      screenshot_path: this.extractArtifactPath(result.attachments, 'screenshot'),
      video_path: this.extractArtifactPath(result.attachments, 'video'),
      trace_path: this.extractArtifactPath(result.attachments, 'trace')
    };
  }

  sanitizeTitle(title) {
    return title.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  }

  extractArtifactPath(attachments, type) {
    if (!attachments) return null;
    const artifact = attachments.find(a => a.name === type || a.contentType?.includes(type));
    return artifact?.path || null;
  }

  async ingestData(stream, records) {
    if (!records || records.length === 0) {
      return { successful: 0 };
    }

    const url = `${this.options.baseUrl}/api/${this.options.orgId}/${stream}/_json`;
    const auth = Buffer.from(`${this.options.username}:${this.options.password}`).toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(records)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (result.code !== 200) {
      throw new Error(`Ingestion failed: ${result.error || 'Unknown error'}`);
    }

    return result.status?.[0] || { successful: records.length };
  }
}

module.exports = O2Reporter;
