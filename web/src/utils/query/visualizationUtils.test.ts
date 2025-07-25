import { allSelectionFieldsHaveAlias } from "./visualizationUtils";

// Lightweight manual tests that log results to the console. Run with:  
//    node ./visualizationUtils.test.ts (after ts-node/esbuild-register) or bundle in your test runner.
// This keeps the dependency footprint tiny and avoids forcing a specific test framework.

interface TestCase {
  query: string;
  expected: boolean;
  testName: string;
}

const testCases: TestCase[] = [
  // ----- Simple SELECTs -----
  {
    query: "SELECT name AS n, age AS a FROM users",
    expected: true,
    testName: "All columns aliased",
  },
  {
    query: "SELECT name, age AS a FROM users",
    expected: false,
    testName: "One column missing alias",
  },

  // ----- JOINs -----
  {
    query:
      "SELECT u.name AS user_name, o.id AS order_id FROM users u JOIN orders o ON u.id = o.user_id",
    expected: true,
    testName: "JOIN with aliases",
  },
  {
    query:
      "SELECT u.name, o.id AS order_id FROM users u JOIN orders o ON u.id = o.user_id",
    expected: false,
    testName: "JOIN with a missing alias",
  },

  // ----- Single UNION -----
  {
    query:
      "SELECT id AS i FROM t1 UNION SELECT id AS i FROM t2",
    expected: true,
    testName: "Single UNION, both selects aliased",
  },
  {
    query:
      "SELECT id AS i FROM t1 UNION SELECT id FROM t2",
    expected: false,
    testName: "Single UNION, second select missing alias",
  },

  // ----- Multiple UNIONs -----
  {
    query:
      `SELECT id AS i FROM t1
       UNION
       SELECT id AS i FROM t2
       UNION
       SELECT id AS i FROM t3`,
    expected: true,
    testName: "Multi-UNION chain, all aliased",
  },
  {
    query:
      `SELECT id AS i FROM t1
       UNION
       SELECT id FROM t2
       UNION
       SELECT id AS i FROM t3`,
    expected: false,
    testName: "Multi-UNION chain, middle select missing alias",
  },

  // ----- Timestamp-oriented queries -----
  {
    query: "SELECT _timestamp FROM table1",
    expected: false,
    testName: "Basic timestamp selection",
  },
  {
    query: "SELECT name, _timestamp, status FROM table1",
    expected: false,
    testName: "Multiple column selection",
  },
  {
    query: "SELECT * FROM table1",
    expected: false,
    testName: "Wildcard selection",
  },
  {
    query: "SELECT COUNT(*) FROM table1",
    expected: false,
    testName: "Count aggregation",
  },
  {
    query: "SELECT COUNT(*) AS total_count FROM table1",
    expected: true,
    testName: "Count aggregation with alias",
  },
  {
    query: "SELECT MAX(_timestamp) FROM table1",
    expected: false,
    testName: "Max aggregation without alias",
  },
  {
    query: "SELECT MAX(_timestamp) AS max_time FROM table1",
    expected: true,
    testName: "Max aggregation with alias",
  },
  {
    query: "SELECT histogram(_timestamp) FROM table1",
    expected: false,
    testName: "Histogram function",
  },
  {
    query: "SELECT histogram(_timestamp) AS time_hist FROM table1",
    expected: true,
    testName: "Histogram function with alias",
  },
  {
    query: "SELECT histogram(_timestamp, '1h') FROM table1",
    expected: false,
    testName: "Histogram function with interval",
  },
  {
    query: "SELECT approx_percentile_cont(_timestamp, 0.5) FROM table1",
    expected: false,
    testName: "Percentile p50",
  },
  {
    query: "SELECT approx_percentile_cont(_timestamp, 0.9) FROM table1",
    expected: false,
    testName: "Percentile p90",
  },
  {
    query: "SELECT approx_percentile_cont(_timestamp, 0.95) FROM table1",
    expected: false,
    testName: "Percentile p95",
  },
  {
    query: "SELECT approx_percentile_cont(_timestamp, 0.99) FROM table1",
    expected: false,
    testName: "Percentile p99",
  },
  {
    query: "SELECT approx_percentile_cont(response_time, 0.5) AS median_response FROM table1",
    expected: true,
    testName: "Percentile with different field and alias",
  },
  {
    query: "SELECT COUNT(*), MAX(_timestamp), MIN(response_time) FROM table1",
    expected: false,
    testName: "Multiple aggregations",
  },
  {
    query: "SELECT name, COUNT(*) AS count, histogram(_timestamp) AS time_bucket FROM table1",
    expected: false,
    testName: "Mixed columns and functions",
  },
  {
    query: "SELECT _timestamp AS time, name AS user_name, status FROM table1",
    expected: false,
    testName: "Columns with aliases",
  },
  {
    query: "SELECT _timestamp FROM table1",
    expected: false,
    testName: "Direct timestamp selection",
  },
  {
    query: "SELECT name, _timestamp FROM table1",
    expected: false,
    testName: "Timestamp with other columns",
  },
  {
    query: "SELECT * FROM table1",
    expected: false,
    testName: "Wildcard selection includes timestamp",
  },
  {
    query: "SELECT name FROM table1",
    expected: false,
    testName: "No timestamp selected",
  },
  {
    query: "SELECT MAX(_timestamp) FROM table1",
    expected: false,
    testName: "Function without _timestamp alias",
  },
  {
    query: "SELECT MAX(_timestamp), MAX(_timestamp) as _timestamp FROM table1",
    expected: false,
    testName: "One function has _timestamp alias",
  },
  {
    query: "SELECT MAX(_timestamp) as _timestamp FROM table1",
    expected: true,
    testName: "Function aliased as _timestamp",
  },
  {
    query: "SELECT MIN(_timestamp) as other FROM table1",
    expected: true,
    testName: "Function with different alias",
  },
  {
    query: "SELECT _timestamp + 1 FROM table1",
    expected: false,
    testName: "Expression without _timestamp alias",
  },
  {
    query: "SELECT (_timestamp + 1) as _timestamp FROM table1",
    expected: true,
    testName: "Expression aliased as _timestamp",
  },
  {
    query: "SELECT t1._timestamp FROM table1 t1",
    expected: false,
    testName: "Table qualified timestamp",
  },
  {
    query: "SELECT t1._timestamp as other FROM table1 t1",
    expected: true,
    testName: "Table qualified timestamp with alias",
  },
  {
    query: "SELECT CASE WHEN _timestamp > 0 THEN _timestamp ELSE 0 END FROM table1",
    expected: false,
    testName: "CASE without alias",
  },
  {
    query: "SELECT CASE WHEN _timestamp > 0 THEN _timestamp ELSE 0 END as _timestamp FROM table1",
    expected: true,
    testName: "CASE aliased as _timestamp",
  },
  {
    query: "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT cnt FROM tbl1",
    expected: false,
    testName: "CTE without timestamp in final result",
  },
  {
    query: "WITH tbl1 AS (SELECT histogram(_timestamp) AS ts, count(*) AS cnt FROM tbl1) SELECT cnt as cnt1 FROM tbl1",
    expected: true,
    testName: "CTE with alias in final result",
  },

  // ----- Edge cases -----
  {
    query: "NOT A VALID SQL",
    expected: false,
    testName: "Invalid SQL string",
  },
  {
    query: "INSERT INTO t1 VALUES (1,2,3)",
    expected: false,
    testName: "Non-SELECT statement",
  },
];

export async function testAllSelectionFieldsHaveAlias() {
  console.log("=== Testing allSelectionFieldsHaveAlias ===\n");

  for (const { query, expected, testName } of testCases) {
    let result: boolean;
    try {
      result = allSelectionFieldsHaveAlias(query);
    } catch (err) {
      result = false;
    }

    const passFail = result === expected ? "PASS" : "FAIL";
    console.log(`${passFail}: ${testName}`);
    console.log(`  Query    : ${query.replace(/\s+/g, " ").trim()}`);
    console.log(`  Expected : ${expected}`);
    console.log(`  Got      : ${result}\n`);
  }

  console.log("=== Test run complete ===");
}

// Uncomment the line below to execute the tests directly with ts-node / node-loader.
// testAllSelectionFieldsHaveAlias();
