/**
 * Create Playwright Test Results Dashboard in OpenObserve
 *
 * Run with: node scripts/create-dashboard.js
 */

require('dotenv').config();

const dashboard = {
  version: 8,
  dashboardId: "playwright-test-results",
  title: "Playwright Test Results",
  description: "Real-time Playwright end-to-end test execution metrics and analysis",
  role: "",
  owner: process.env.ZO_ROOT_USER_EMAIL || "root@example.com",
  created: new Date().toISOString(),
  tabs: [
    {
      tabId: "overview",
      name: "Overview",
      panels: [
        // Row 1: Key Metrics (8 panels)
        {
          id: "total-tests",
          type: "metric",
          title: "Total Tests",
          description: "Total test cases executed",
          layout: { x: 0, y: 0, w: 24, h: 5, i: 1 },
          queryType: "sql",
          config: { show_legends: false, decimals: 0, unit: "short" },
          queries: [{
            query: "SELECT COUNT(*) as value FROM playwright_tests",
            customQuery: true,
            fields: { stream: "playwright_tests", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 0 }
          }]
        },
        {
          id: "passed-tests",
          type: "metric",
          title: "Passed",
          description: "Tests that passed",
          layout: { x: 24, y: 0, w: 24, h: 5, i: 2 },
          queryType: "sql",
          config: { show_legends: false, decimals: 0, unit: "short" },
          queries: [{
            query: "SELECT COUNT(*) as value FROM playwright_tests WHERE status = 'passed'",
            customQuery: true,
            fields: { stream: "playwright_tests", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 0 }
          }]
        },
        {
          id: "failed-tests",
          type: "metric",
          title: "Failed",
          description: "Tests that failed",
          layout: { x: 48, y: 0, w: 24, h: 5, i: 3 },
          queryType: "sql",
          config: { show_legends: false, decimals: 0, unit: "short" },
          queries: [{
            query: "SELECT COUNT(*) as value FROM playwright_tests WHERE status = 'failed'",
            customQuery: true,
            fields: { stream: "playwright_tests", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 0 }
          }]
        },
        {
          id: "skipped-tests",
          type: "metric",
          title: "Skipped",
          description: "Tests that were skipped",
          layout: { x: 72, y: 0, w: 24, h: 5, i: 4 },
          queryType: "sql",
          config: { show_legends: false, decimals: 0, unit: "short" },
          queries: [{
            query: "SELECT COUNT(*) as value FROM playwright_tests WHERE status = 'skipped'",
            customQuery: true,
            fields: { stream: "playwright_tests", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 0 }
          }]
        },
        {
          id: "flaky-tests",
          type: "metric",
          title: "Flaky",
          description: "Tests that passed after retry",
          layout: { x: 96, y: 0, w: 24, h: 5, i: 5 },
          queryType: "sql",
          config: { show_legends: false, decimals: 0, unit: "short" },
          queries: [{
            query: "SELECT COUNT(*) as value FROM playwright_tests WHERE is_flaky = true",
            customQuery: true,
            fields: { stream: "playwright_tests", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 0 }
          }]
        },
        {
          id: "pass-rate",
          type: "metric",
          title: "Pass Rate",
          description: "Percentage of tests that passed",
          layout: { x: 120, y: 0, w: 24, h: 5, i: 6 },
          queryType: "sql",
          config: { show_legends: false, decimals: 1, unit: "percent" },
          queries: [{
            query: "SELECT pass_rate as value FROM playwright_run_metadata ORDER BY _timestamp DESC LIMIT 1",
            customQuery: true,
            fields: { stream: "playwright_run_metadata", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 1 }
          }]
        },
        {
          id: "avg-duration",
          type: "metric",
          title: "Avg Duration",
          description: "Average test duration in minutes",
          layout: { x: 144, y: 0, w: 24, h: 5, i: 7 },
          queryType: "sql",
          config: { show_legends: false, decimals: 2, unit: "m" },
          queries: [{
            query: "SELECT AVG(duration_ms)/60000 as value FROM playwright_tests",
            customQuery: true,
            fields: { stream: "playwright_tests", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 0 }
          }]
        },
        {
          id: "total-duration",
          type: "metric",
          title: "Total Duration",
          description: "Total run time in minutes",
          layout: { x: 168, y: 0, w: 24, h: 5, i: 8 },
          queryType: "sql",
          config: { show_legends: false, decimals: 2, unit: "m" },
          queries: [{
            query: "SELECT total_duration_ms/60000 as value FROM playwright_run_metadata ORDER BY _timestamp DESC LIMIT 1",
            customQuery: true,
            fields: { stream: "playwright_run_metadata", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 1 }
          }]
        },

        // Row 2: Charts
        {
          id: "status-distribution",
          type: "pie",
          title: "Test Status Distribution",
          description: "Breakdown of test results by status",
          layout: { x: 0, y: 5, w: 48, h: 10, i: 9 },
          queryType: "sql",
          config: { show_legends: true, decimals: 0 },
          queries: [{
            query: "SELECT status, COUNT(*) as count FROM playwright_tests GROUP BY status",
            customQuery: true,
            fields: { stream: "playwright_tests", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 0 }
          }]
        },
        {
          id: "tests-by-suite",
          type: "bar",
          title: "Tests by Suite",
          description: "Test count per suite",
          layout: { x: 48, y: 5, w: 72, h: 10, i: 10 },
          queryType: "sql",
          config: { show_legends: true, decimals: 0, axis_border_show: true },
          queries: [{
            query: "SELECT suite_name, COUNT(*) as count FROM playwright_tests GROUP BY suite_name ORDER BY count DESC",
            customQuery: true,
            fields: { stream: "playwright_tests", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 0 }
          }]
        },
        {
          id: "duration-by-suite",
          type: "bar",
          title: "Avg Duration by Suite (min)",
          description: "Average test duration per suite",
          layout: { x: 120, y: 5, w: 72, h: 10, i: 11 },
          queryType: "sql",
          config: { show_legends: true, decimals: 0, axis_border_show: true },
          queries: [{
            query: "SELECT suite_name, AVG(duration_ms)/60000 as avg_duration_min FROM playwright_tests GROUP BY suite_name ORDER BY avg_duration_min DESC",
            customQuery: true,
            fields: { stream: "playwright_tests", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 0 }
          }]
        },

        // Row 3: Tables
        {
          id: "slowest-tests",
          type: "table",
          title: "Slowest Tests",
          description: "Top 10 slowest test cases",
          layout: { x: 0, y: 15, w: 96, h: 10, i: 12 },
          queryType: "sql",
          config: { show_legends: false, wrap_table_cells: false },
          queries: [{
            query: "SELECT test_title, suite_name, duration_ms/60000 as duration_min, status FROM playwright_tests ORDER BY duration_ms DESC LIMIT 10",
            customQuery: true,
            fields: { stream: "playwright_tests", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 10 }
          }]
        },
        {
          id: "recent-runs",
          type: "table",
          title: "Recent Test Runs",
          description: "Latest test run summaries",
          layout: { x: 96, y: 15, w: 96, h: 10, i: 13 },
          queryType: "sql",
          config: { show_legends: false, wrap_table_cells: false },
          queries: [{
            query: "SELECT run_id, total_tests, passed, failed, skipped, pass_rate, ci_branch FROM playwright_run_metadata ORDER BY _timestamp DESC LIMIT 10",
            customQuery: true,
            fields: { stream: "playwright_run_metadata", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 10 }
          }]
        },

        // Row 4: All Tests Table
        {
          id: "all-tests",
          type: "table",
          title: "All Test Results",
          description: "Complete list of test results",
          layout: { x: 0, y: 25, w: 192, h: 12, i: 14 },
          queryType: "sql",
          config: { show_legends: false, wrap_table_cells: true },
          queries: [{
            query: "SELECT test_title, suite_name, status, duration_ms/60000 as duration_min, error_message, file_path FROM playwright_tests ORDER BY _timestamp DESC LIMIT 50",
            customQuery: true,
            fields: { stream: "playwright_tests", stream_type: "logs", x: [], y: [], z: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
            config: { promql_legend: "", limit: 50 }
          }]
        }
      ]
    }
  ],
  variables: { list: [] },
  layouts: []
};

async function createDashboard() {
  const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
  const orgId = process.env.ORGNAME || 'default';
  const username = process.env.ZO_ROOT_USER_EMAIL || 'root@example.com';
  const password = process.env.ZO_ROOT_USER_PASSWORD || 'Complexpass#123';

  const auth = Buffer.from(`${username}:${password}`).toString('base64');

  console.log('Creating Playwright Test Results Dashboard...');
  console.log(`URL: ${baseUrl}/api/${orgId}/dashboards`);

  try {
    const response = await fetch(`${baseUrl}/api/${orgId}/dashboards`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dashboard)
    });

    const result = await response.text();

    if (response.ok) {
      console.log('\n✓ Dashboard created successfully!');
      console.log(`\nView at: ${baseUrl}/web/dashboards?org_identifier=${orgId}&dashboard=playwright-test-results`);
    } else {
      console.log(`\n✗ Failed to create dashboard: ${response.status}`);
      console.log(result);
    }
  } catch (error) {
    console.error('Error creating dashboard:', error.message);
  }
}

createDashboard();
