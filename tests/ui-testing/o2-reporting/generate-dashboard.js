#!/usr/bin/env node
/**
 * Generate a per-run dashboard-config.json with proper O2 v8 format.
 *
 * Each run gets its own dashboard with SQL queries filtered by run_id.
 * For cross-run trends, see generate-trends-dashboard.js.
 *
 * Usage:
 *   node o2-reporting/generate-dashboard.js --run-id=abc1234
 *   node o2-reporting/generate-dashboard.js --run-id=abc1234 --out=my-dashboard.json
 */

const fs = require('fs');
const path = require('path');

const STREAM = 'e2e_playwright_reports';

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const getArg = (name) => {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=').slice(1).join('=') : undefined;
};

const RUN_ID = getArg('run-id');
const OUT_FILE = getArg('out') || 'dashboard-config.json';

if (!RUN_ID) {
  console.error('Error: --run-id is required');
  console.error('Usage: node generate-dashboard.js --run-id=abc1234');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// SQL helpers — inject run_id filter into WHERE clauses
// ---------------------------------------------------------------------------

function addRunFilter(sql) {
  const runFilter = `run_id = '${RUN_ID}'`;

  // If query already has WHERE, add AND
  if (/\bWHERE\b/i.test(sql)) {
    return sql.replace(/\bWHERE\b/i, `WHERE ${runFilter} AND`);
  }

  // If query has GROUP BY, insert WHERE before it
  if (/\bGROUP BY\b/i.test(sql)) {
    return sql.replace(/\bGROUP BY\b/i, `WHERE ${runFilter} GROUP BY`);
  }

  // If query has ORDER BY, insert WHERE before it
  if (/\bORDER BY\b/i.test(sql)) {
    return sql.replace(/\bORDER BY\b/i, `WHERE ${runFilter} ORDER BY`);
  }

  // Otherwise append WHERE
  return `${sql} WHERE ${runFilter}`;
}

// Helper: create a default empty filter
function emptyFilter() {
  return { type: 'list', values: [], logicalOperator: 'AND', filterType: 'list' };
}

// Helper: create an axis item for field mapping
function axis(label, alias, opts = {}) {
  return { label, alias, column: alias, ...opts };
}

// Helper: create a query with customQuery=true
function sqlQuery(sql, yFields = [], xFields = []) {
  return {
    query: addRunFilter(sql),
    customQuery: true,
    fields: {
      stream: STREAM,
      stream_type: 'logs',
      x: xFields,
      y: yFields,
      z: [],
      filter: emptyFilter(),
    },
    config: { promql_legend: '' },
  };
}

// Helper: create a panel
function panel(id, type, title, queries, layoutOverride = {}) {
  return {
    id,
    type,
    title,
    description: '',
    queryType: '',
    queries: Array.isArray(queries) ? queries : [queries],
    config: { show_legends: true },
    layout: { x: 0, y: 0, w: 192, h: 10, i: 0, ...layoutOverride },
  };
}

// -----------------------------------------------------------------------
// Tab 1: Overview
// -----------------------------------------------------------------------
const overviewPanels = [
  panel('p_total_tests', 'metric', 'Total Tests',
    sqlQuery('SELECT COUNT(*) as total FROM e2e_playwright_reports', [axis('Total', 'total')])),

  panel('p_passed', 'metric', 'Passed',
    sqlQuery("SELECT COUNT(*) as passed FROM e2e_playwright_reports WHERE status = 'passed'", [axis('Passed', 'passed')])),

  panel('p_failed', 'metric', 'Failed',
    sqlQuery("SELECT COUNT(*) as failed FROM e2e_playwright_reports WHERE status = 'failed'", [axis('Failed', 'failed')])),

  panel('p_skipped', 'metric', 'Skipped',
    sqlQuery("SELECT COUNT(*) as skipped FROM e2e_playwright_reports WHERE status = 'skipped'", [axis('Skipped', 'skipped')])),

  panel('p_pass_rate', 'metric', 'Pass Rate %',
    sqlQuery("SELECT ROUND(COUNT(CASE WHEN status = 'passed' THEN 1 END) * 100.0 / COUNT(*), 1) as pass_rate FROM e2e_playwright_reports", [axis('Pass Rate', 'pass_rate')])),

  panel('p_status_pie', 'pie', 'Test Status Distribution',
    sqlQuery(
      "SELECT status, COUNT(*) as count FROM e2e_playwright_reports GROUP BY status ORDER BY count DESC",
      [axis('Count', 'count')],
      [axis('Status', 'status')]
    )),

  panel('p_shard_bar', 'stacked', 'Results by Shard',
    sqlQuery(
      "SELECT shard, status, COUNT(*) as count FROM e2e_playwright_reports GROUP BY shard, status ORDER BY shard",
      [axis('Count', 'count')],
      [axis('Shard', 'shard')]
    )),

  panel('p_failed_table', 'table', 'Failed Tests',
    sqlQuery(
      "SELECT shard, file_path, test_name, duration_secs, error_category, error_message FROM e2e_playwright_reports WHERE status = 'failed' ORDER BY shard, file_path",
      [axis('Duration (s)', 'duration_secs'), axis('Error Category', 'error_category'), axis('Error Message', 'error_message')],
      [axis('Shard', 'shard'), axis('File', 'file_path'), axis('Test', 'test_name')]
    )),
];

// -----------------------------------------------------------------------
// Tab 2: Failures & Errors
// -----------------------------------------------------------------------
const failuresPanels = [
  panel('p_error_cats', 'pie', 'Error Categories',
    sqlQuery(
      "SELECT error_category, COUNT(*) as count FROM e2e_playwright_reports WHERE status = 'failed' AND error_category != '' GROUP BY error_category ORDER BY count DESC",
      [axis('Count', 'count')],
      [axis('Category', 'error_category')]
    )),

  panel('p_failing_tests', 'table', 'Failing Tests',
    sqlQuery(
      "SELECT test_name, file_path, shard, COUNT(*) as failure_count FROM e2e_playwright_reports WHERE status = 'failed' GROUP BY test_name, file_path, shard ORDER BY failure_count DESC LIMIT 20",
      [axis('Failures', 'failure_count')],
      [axis('Test', 'test_name'), axis('File', 'file_path'), axis('Shard', 'shard')]
    )),

  panel('p_error_messages', 'table', 'Error Messages',
    sqlQuery(
      "SELECT shard, test_name, error_category, error_message FROM e2e_playwright_reports WHERE status = 'failed' ORDER BY _timestamp DESC LIMIT 50",
      [axis('Error Category', 'error_category'), axis('Error Message', 'error_message')],
      [axis('Shard', 'shard'), axis('Test', 'test_name')]
    )),
];

// -----------------------------------------------------------------------
// Tab 3: Performance
// -----------------------------------------------------------------------
const performancePanels = [
  panel('p_slowest', 'h-bar', 'Slowest Tests',
    sqlQuery(
      "SELECT test_name, shard, ROUND(AVG(duration_secs), 1) as avg_duration_secs FROM e2e_playwright_reports WHERE status IN ('passed', 'failed') GROUP BY test_name, shard ORDER BY avg_duration_secs DESC LIMIT 20",
      [axis('Avg Duration (s)', 'avg_duration_secs')],
      [axis('Test', 'test_name')]
    )),

  panel('p_dur_dist', 'bar', 'Test Duration Distribution',
    sqlQuery(
      "SELECT CASE WHEN duration_secs < 5 THEN '0-5s' WHEN duration_secs < 15 THEN '5-15s' WHEN duration_secs < 30 THEN '15-30s' WHEN duration_secs < 60 THEN '30-60s' WHEN duration_secs < 120 THEN '1-2min' ELSE '2min+' END as duration_bucket, COUNT(*) as count FROM e2e_playwright_reports GROUP BY duration_bucket ORDER BY count DESC",
      [axis('Count', 'count')],
      [axis('Bucket', 'duration_bucket')]
    )),

  panel('p_shard_dur', 'bar', 'Shard Total Duration (s)',
    sqlQuery(
      "SELECT shard, ROUND(SUM(duration_secs), 1) as total_duration_secs, COUNT(*) as test_count FROM e2e_playwright_reports GROUP BY shard ORDER BY total_duration_secs DESC",
      [axis('Total Duration (s)', 'total_duration_secs')],
      [axis('Shard', 'shard')]
    )),
];

// -----------------------------------------------------------------------
// Tab 4: Retries & Flaky
// -----------------------------------------------------------------------
const retryPanels = [
  panel('p_flaky_list', 'table', 'Flaky Tests',
    sqlQuery(
      "SELECT test_name, file_path, shard, status, duration_secs FROM e2e_playwright_reports WHERE status = 'flaky' ORDER BY test_name",
      [axis('Status', 'status'), axis('Duration (s)', 'duration_secs')],
      [axis('Test', 'test_name'), axis('File', 'file_path'), axis('Shard', 'shard')]
    )),

  panel('p_retries', 'table', 'Tests That Required Retries',
    sqlQuery(
      "SELECT test_name, shard, attempt_number, status, duration_secs, error_category FROM e2e_playwright_reports WHERE attempt_number > 0 ORDER BY test_name, attempt_number LIMIT 50",
      [axis('Attempt', 'attempt_number'), axis('Status', 'status'), axis('Duration (s)', 'duration_secs'), axis('Error Category', 'error_category')],
      [axis('Test', 'test_name'), axis('Shard', 'shard')]
    )),
];

// -----------------------------------------------------------------------
// Tab 5: All Tests
// -----------------------------------------------------------------------
const allTestsPanels = [
  panel('p_all_tests', 'table', 'All Test Results',
    sqlQuery(
      "SELECT shard, file_path, test_name, status, duration_secs, attempt_number, error_category, error_message FROM e2e_playwright_reports ORDER BY shard, file_path, test_name",
      [axis('Status', 'status'), axis('Duration (s)', 'duration_secs'), axis('Attempt', 'attempt_number'), axis('Error Category', 'error_category'), axis('Error Message', 'error_message')],
      [axis('Shard', 'shard'), axis('File', 'file_path'), axis('Test', 'test_name')]
    )),
];

// -----------------------------------------------------------------------
// Assemble dashboard
// -----------------------------------------------------------------------

const tabs = [
  { tabId: 'overview', name: 'Overview', panels: overviewPanels },
  { tabId: 'failures', name: 'Failures & Errors', panels: failuresPanels },
  { tabId: 'performance', name: 'Performance', panels: performancePanels },
  { tabId: 'retries', name: 'Retries & Flaky', panels: retryPanels },
  { tabId: 'all_tests', name: 'All Tests', panels: allTestsPanels },
];

// Assign layout positions
let globalPanelIndex = 1;
for (const tab of tabs) {
  let yPos = 0;
  let metricInRow = 0;

  for (const p of tab.panels) {
    p.layout.i = globalPanelIndex++;

    if (p.type === 'metric') {
      p.layout.x = metricInRow * 48;
      p.layout.y = yPos;
      p.layout.w = 48;
      p.layout.h = 4;
      metricInRow++;
      if (metricInRow >= 4) {
        yPos += 4;
        metricInRow = 0;
      }
    } else {
      if (metricInRow > 0) {
        yPos += 4;
        metricInRow = 0;
      }
      p.layout.x = 0;
      p.layout.y = yPos;
      p.layout.w = 192;
      p.layout.h = 10;
      yPos += 10;
    }
  }
}

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const dashboardTitle = `${today}_E2E Playwright Test Reports_${RUN_ID}`;

const dashboard = {
  version: 8,
  title: dashboardTitle,
  description: `E2E test report for run ${RUN_ID}`,
  role: '',
  owner: '',
  tabs,
  variables: { list: [], showDynamicFilters: false },
};

const outPath = path.resolve(__dirname, OUT_FILE);
fs.writeFileSync(outPath, JSON.stringify(dashboard, null, 2) + '\n');

const totalPanels = tabs.reduce((s, t) => s + t.panels.length, 0);
console.log(`Generated ${OUT_FILE}`);
console.log(`  Title:  ${dashboardTitle}`);
console.log(`  Run ID: ${RUN_ID}`);
console.log(`  Tabs: ${tabs.length}`);
console.log(`  Panels: ${totalPanels}`);
for (const t of tabs) {
  console.log(`    ${t.name}: ${t.panels.length} panels`);
}
