#!/usr/bin/env node
/**
 * Generate the shared cross-run trends dashboard.
 *
 * This dashboard shows data across ALL runs — pass rate trends,
 * failure patterns, flaky tests, environment breakdown.
 * It is uploaded once and updated in-place (not per-run).
 *
 * Usage: node o2-reporting/generate-trends-dashboard.js
 */

const fs = require('fs');
const path = require('path');

const STREAM = 'e2e_playwright_reports';

// Helper: create a default empty filter
function emptyFilter() {
  return { type: 'list', values: [], logicalOperator: 'AND', filterType: 'list' };
}

// Helper: create an axis item for field mapping
function axis(label, alias, opts = {}) {
  return { label, alias, column: alias, ...opts };
}

// Helper: create a query with customQuery=true
function sqlQuery(sql, yFields = [], xFields = [], zFields = []) {
  return {
    query: sql,
    customQuery: true,
    fields: {
      stream: STREAM,
      stream_type: 'logs',
      x: xFields,
      y: yFields,
      z: zFields,
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
// Tab 1: Pass Rate Trends
// -----------------------------------------------------------------------
const VALID_SHARDS = "shard IN ('SDR', 'RUM', 'Streams')";

const trendsPanels = [
  panel('p_pass_rate_trend', 'line', 'Pass Rate Over Time (by Run)',
    sqlQuery(
      `SELECT run_id, ROUND(COUNT(CASE WHEN status = 'passed' THEN 1 END) * 100.0 / COUNT(*), 1) as pass_rate, COUNT(*) as total_tests FROM e2e_playwright_reports WHERE ${VALID_SHARDS} GROUP BY run_id ORDER BY MIN(_timestamp) DESC LIMIT 20`,
      [axis('Pass Rate %', 'pass_rate')],
      [axis('Run ID', 'run_id')]
    )),

  panel('p_failure_trend', 'bar', 'Failure Count Per Run',
    sqlQuery(
      `SELECT run_id, COUNT(CASE WHEN status = 'failed' THEN 1 END) as failures, COUNT(CASE WHEN status = 'passed' THEN 1 END) as passes FROM e2e_playwright_reports WHERE ${VALID_SHARDS} GROUP BY run_id ORDER BY MIN(_timestamp) DESC LIMIT 20`,
      [axis('Failures', 'failures'), axis('Passes', 'passes')],
      [axis('Run ID', 'run_id')]
    )),

  panel('p_shard_trend', 'line', 'Pass Rate by Shard Over Time',
    sqlQuery(
      `SELECT run_id, ROUND(SUM(CASE WHEN shard='SDR' AND status='passed' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN shard='SDR' THEN 1 ELSE 0 END),0),1) as sdr_pass_rate, ROUND(SUM(CASE WHEN shard='RUM' AND status='passed' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN shard='RUM' THEN 1 ELSE 0 END),0),1) as rum_pass_rate, ROUND(SUM(CASE WHEN shard='Streams' AND status='passed' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN shard='Streams' THEN 1 ELSE 0 END),0),1) as streams_pass_rate FROM e2e_playwright_reports WHERE ${VALID_SHARDS} GROUP BY run_id ORDER BY MIN(_timestamp) ASC LIMIT 20`,
      [axis('SDR', 'sdr_pass_rate'), axis('RUM', 'rum_pass_rate'), axis('Streams', 'streams_pass_rate')],
      [axis('Run ID', 'run_id')]
    )),

  panel('p_duration_trend', 'line', 'Average Test Duration by Shard (s)',
    sqlQuery(
      `SELECT run_id, ROUND(AVG(CASE WHEN shard='SDR' THEN duration_secs END),1) as sdr_avg_secs, ROUND(AVG(CASE WHEN shard='RUM' THEN duration_secs END),1) as rum_avg_secs, ROUND(AVG(CASE WHEN shard='Streams' THEN duration_secs END),1) as streams_avg_secs FROM e2e_playwright_reports WHERE ${VALID_SHARDS} GROUP BY run_id ORDER BY MIN(_timestamp) ASC LIMIT 20`,
      [axis('SDR (s)', 'sdr_avg_secs'), axis('RUM (s)', 'rum_avg_secs'), axis('Streams (s)', 'streams_avg_secs')],
      [axis('Run ID', 'run_id')]
    )),
];

// -----------------------------------------------------------------------
// Tab 2: Flaky Tests (cross-run)
// -----------------------------------------------------------------------
const flakyPanels = [
  panel('p_flaky_list', 'table', 'Flaky Tests (Mixed Pass/Fail Across Runs)',
    sqlQuery(
      `SELECT test_name, file_path, shard, COUNT(*) as total_runs, COUNT(CASE WHEN status = 'passed' THEN 1 END) as passes, COUNT(CASE WHEN status = 'failed' THEN 1 END) as failures, COUNT(CASE WHEN status = 'flaky' THEN 1 END) as flaky_count, ROUND(COUNT(CASE WHEN status = 'failed' THEN 1 END) * 100.0 / COUNT(*), 1) as failure_rate FROM e2e_playwright_reports WHERE ${VALID_SHARDS} GROUP BY test_name, file_path, shard HAVING COUNT(CASE WHEN status = 'failed' THEN 1 END) > 0 AND COUNT(CASE WHEN status = 'passed' THEN 1 END) > 0 ORDER BY failure_rate DESC LIMIT 30`,
      [axis('Total Runs', 'total_runs'), axis('Passes', 'passes'), axis('Failures', 'failures'), axis('Flaky', 'flaky_count'), axis('Failure Rate %', 'failure_rate')],
      [axis('Test', 'test_name'), axis('File', 'file_path'), axis('Shard', 'shard')]
    )),

  panel('p_flaky_trend', 'line', 'Flaky Test Count Per Run',
    sqlQuery(
      `SELECT run_id, COUNT(CASE WHEN status = 'flaky' THEN 1 END) as flaky_count FROM e2e_playwright_reports WHERE ${VALID_SHARDS} GROUP BY run_id ORDER BY MIN(_timestamp) DESC LIMIT 20`,
      [axis('Flaky Count', 'flaky_count')],
      [axis('Run ID', 'run_id')]
    )),

  panel('p_top_failing', 'table', 'Most Frequently Failing Tests (All Time)',
    sqlQuery(
      `SELECT test_name, file_path, shard, COUNT(*) as failure_count, COUNT(DISTINCT run_id) as runs_failed FROM e2e_playwright_reports WHERE status = 'failed' AND ${VALID_SHARDS} GROUP BY test_name, file_path, shard ORDER BY failure_count DESC LIMIT 20`,
      [axis('Failures', 'failure_count'), axis('Runs Failed', 'runs_failed')],
      [axis('Test', 'test_name'), axis('File', 'file_path'), axis('Shard', 'shard')]
    )),
];

// -----------------------------------------------------------------------
// Tab 3: Error Patterns
// -----------------------------------------------------------------------
const errorPanels = [
  panel('p_error_cats', 'pie', 'Error Categories (All Runs)',
    sqlQuery(
      `SELECT error_category, COUNT(*) as count FROM e2e_playwright_reports WHERE status = 'failed' AND error_category != '' AND ${VALID_SHARDS} GROUP BY error_category ORDER BY count DESC`,
      [axis('Count', 'count')],
      [axis('Category', 'error_category')]
    )),

  panel('p_error_trend', 'table', 'Error Categories by Run',
    sqlQuery(
      `SELECT run_id, error_category, COUNT(*) as count FROM e2e_playwright_reports WHERE status = 'failed' AND error_category != '' AND ${VALID_SHARDS} GROUP BY run_id, error_category ORDER BY MIN(_timestamp) DESC LIMIT 100`,
      [axis('Count', 'count')],
      [axis('Run ID', 'run_id'), axis('Error Category', 'error_category')]
    )),
];

// -----------------------------------------------------------------------
// Tab 4: Environment
// -----------------------------------------------------------------------
const envPanels = [
  panel('p_by_runner', 'stacked', 'Results by Runner (CI vs Local)',
    sqlQuery(
      `SELECT runner, COUNT(CASE WHEN status='passed' THEN 1 END) as passed, COUNT(CASE WHEN status='failed' THEN 1 END) as failed, COUNT(CASE WHEN status='skipped' THEN 1 END) as skipped, COUNT(CASE WHEN status='flaky' THEN 1 END) as flaky FROM e2e_playwright_reports WHERE ${VALID_SHARDS} GROUP BY runner ORDER BY runner`,
      [axis('Passed', 'passed'), axis('Failed', 'failed'), axis('Skipped', 'skipped'), axis('Flaky', 'flaky')],
      [axis('Runner', 'runner')]
    )),

  panel('p_branch', 'table', 'Pass Rate by Branch',
    sqlQuery(
      `SELECT git_branch, COUNT(*) as total_tests, COUNT(CASE WHEN status = 'passed' THEN 1 END) as passed, COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed, ROUND(COUNT(CASE WHEN status = 'passed' THEN 1 END) * 100.0 / COUNT(*), 1) as pass_rate, COUNT(DISTINCT run_id) as total_runs FROM e2e_playwright_reports WHERE ${VALID_SHARDS} GROUP BY git_branch ORDER BY total_runs DESC LIMIT 20`,
      [axis('Total Tests', 'total_tests'), axis('Passed', 'passed'), axis('Failed', 'failed'), axis('Pass Rate %', 'pass_rate'), axis('Total Runs', 'total_runs')],
      [axis('Branch', 'git_branch')]
    )),

  panel('p_all_runs', 'table', 'All Runs (Recent First)',
    sqlQuery(
      `SELECT run_id, run_timestamp, environment, runner, git_branch, os, COUNT(*) as total_tests, COUNT(CASE WHEN status = 'passed' THEN 1 END) as passed, COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed, COUNT(CASE WHEN status = 'skipped' THEN 1 END) as skipped, ROUND(COUNT(CASE WHEN status = 'passed' THEN 1 END) * 100.0 / COUNT(*), 1) as pass_rate FROM e2e_playwright_reports WHERE ${VALID_SHARDS} GROUP BY run_id, run_timestamp, environment, runner, git_branch, os ORDER BY MIN(_timestamp) DESC LIMIT 50`,
      [axis('Total Tests', 'total_tests'), axis('Passed', 'passed'), axis('Failed', 'failed'), axis('Skipped', 'skipped'), axis('Pass Rate %', 'pass_rate')],
      [axis('Run', 'run_id'), axis('Timestamp', 'run_timestamp'), axis('Environment', 'environment'), axis('Runner', 'runner'), axis('Branch', 'git_branch'), axis('OS', 'os')]
    )),
];

// -----------------------------------------------------------------------
// Assemble dashboard
// -----------------------------------------------------------------------

const tabs = [
  { tabId: 'trends', name: 'Trends', panels: trendsPanels },
  { tabId: 'flaky', name: 'Flaky & Failing', panels: flakyPanels },
  { tabId: 'errors', name: 'Error Patterns', panels: errorPanels },
  { tabId: 'environment', name: 'Environment', panels: envPanels },
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

const dashboard = {
  version: 8,
  title: 'E2E Playwright Test Trends',
  description: 'Cross-run trends — pass rates, flaky tests, error patterns, environment breakdown',
  role: '',
  owner: '',
  tabs,
  variables: { list: [], showDynamicFilters: false },
};

const outPath = path.resolve(__dirname, 'trends-dashboard-config.json');
fs.writeFileSync(outPath, JSON.stringify(dashboard, null, 2) + '\n');

const totalPanels = tabs.reduce((s, t) => s + t.panels.length, 0);
console.log(`Generated trends-dashboard-config.json`);
console.log(`  Title:  ${dashboard.title}`);
console.log(`  Tabs: ${tabs.length}`);
console.log(`  Panels: ${totalPanels}`);
for (const t of tabs) {
  console.log(`    ${t.name}: ${t.panels.length} panels`);
}
