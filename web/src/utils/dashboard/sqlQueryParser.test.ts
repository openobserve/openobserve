// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach } from "vitest";
import { SQLQueryParser, parseSQLQueryToPanelObject } from "./sqlQueryParser";

describe("SQLQueryParser", () => {
  let parser: SQLQueryParser;

  beforeEach(() => {
    parser = new SQLQueryParser();
  });

  describe("Basic SELECT queries", () => {
    it("should parse simple SELECT with single column", () => {
      const query = "SELECT user_id FROM users";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.stream).toBe("users");
      expect(result.fields.x).toHaveLength(1);
      expect(result.fields.x[0].alias).toBe("user_id");
      expect(result.fields.x[0].type).toBe("raw");
      expect(result.fields.y).toHaveLength(0);
    });

    it("should parse SELECT with multiple columns", () => {
      const query = "SELECT user_id, email, created_at FROM users";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x).toHaveLength(3);
      expect(result.fields.x[0].alias).toBe("user_id");
      expect(result.fields.x[1].alias).toBe("email");
      expect(result.fields.x[2].alias).toBe("created_at");
    });

    it("should parse SELECT with column aliases", () => {
      const query = "SELECT user_id as id, email as user_email FROM users";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x[0].alias).toBe("id");
      expect(result.fields.x[0].label).toBe("Id");
      expect(result.fields.x[1].alias).toBe("user_email");
      expect(result.fields.x[1].label).toBe("User Email");
    });

    it("should parse SELECT with table alias", () => {
      const query = "SELECT u.user_id, u.email FROM users u";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x).toHaveLength(2);
      expect(result.fields.x[0].args[0].value).toHaveProperty("streamAlias", "u");
    });
  });

  describe("Aggregation functions", () => {
    it("should parse COUNT(*)", () => {
      const query = "SELECT COUNT(*) as total FROM logs";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.y).toHaveLength(1);
      expect(result.fields.y[0].alias).toBe("total");
      expect(result.fields.y[0].functionName).toBe("count");
      expect(result.fields.y[0].type).toBe("build");
      expect(result.fields.y[0].args[0].type).toBe("star");
    });

    it("should parse COUNT with column", () => {
      const query = "SELECT COUNT(user_id) as user_count FROM users";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.y[0].functionName).toBe("count");
      expect(result.fields.y[0].args[0].type).toBe("field");
      expect(result.fields.y[0].args[0].value).toHaveProperty("field", "user_id");
    });

    it("should parse SUM aggregation", () => {
      const query = "SELECT SUM(amount) as total_amount FROM transactions";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.y[0].functionName).toBe("sum");
      expect(result.fields.y[0].alias).toBe("total_amount");
    });

    it("should parse AVG aggregation", () => {
      const query = "SELECT AVG(response_time) as avg_response FROM logs";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.y[0].functionName).toBe("avg");
      expect(result.fields.y[0].alias).toBe("avg_response");
    });

    it("should parse MIN and MAX aggregations", () => {
      const query = "SELECT MIN(price) as min_price, MAX(price) as max_price FROM products";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.y).toHaveLength(2);
      expect(result.fields.y[0].functionName).toBe("min");
      expect(result.fields.y[1].functionName).toBe("max");
    });

    it("should assign different colors to y-axis fields", () => {
      const query = "SELECT COUNT(*) as c1, SUM(amount) as s1, AVG(value) as a1 FROM data";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.y).toHaveLength(3);
      expect(result.fields.y[0].color).toBeTruthy();
      expect(result.fields.y[1].color).toBeTruthy();
      expect(result.fields.y[2].color).toBeTruthy();
      // Colors should be different
      expect(result.fields.y[0].color).not.toBe(result.fields.y[1].color);
    });
  });

  describe("Transformation functions", () => {
    it("should parse histogram function", () => {
      const query = "SELECT histogram(_timestamp, '1h') as time_bucket FROM logs";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x).toHaveLength(1);
      expect(result.fields.x[0].functionName).toBe("histogram");
      expect(result.fields.x[0].alias).toBe("time_bucket");
      expect(result.fields.x[0].args).toHaveLength(2);
      expect(result.fields.x[0].args[0].type).toBe("field");
      expect(result.fields.x[0].args[1].type).toBe("histogramInterval");
      expect(result.fields.x[0].args[1].value).toBe("1h");
      expect(result.fields.x[0].treatAsNonTimestamp).toBe(false);
    });

    it("should parse DATE_TRUNC function", () => {
      const query = "SELECT DATE_TRUNC('hour', created_at) as hour FROM events";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x[0].functionName).toBe("date_trunc");
      expect(result.fields.x[0].args).toHaveLength(2);
    });

    it("should parse ROUND function with numeric precision", () => {
      const query = "SELECT ROUND(value, 2) as rounded_value FROM metrics";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x[0].functionName).toBe("round");
      expect(result.fields.x[0].args[1].type).toBe("number");
      expect(result.fields.x[0].args[1].value).toBe(2);
    });
  });

  describe("Nested functions", () => {
    it("should parse single-level nested function", () => {
      const query = "SELECT ROUND(AVG(response_time), 2) as avg_rounded FROM logs";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.y).toHaveLength(1);
      expect(result.fields.y[0].functionName).toBe("round");
      expect(result.fields.y[0].args[0].type).toBe("function");
      expect(result.fields.y[0].args[0].value).toHaveProperty("functionName", "avg");
    });

    it("should parse multi-level nested functions", () => {
      const query = "SELECT UPPER(TRIM(LOWER(name))) as cleaned_name FROM users";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x[0].functionName).toBe("upper");
      expect(result.fields.x[0].args[0].type).toBe("function");
    });

    it("should parse aggregation with nested transformation", () => {
      const query = "SELECT COUNT(DISTINCT user_id) as unique_users FROM events";
      const result = parser.parseQueryToPanelObject(query);

      // This will be parsed as count function with distinct as nested
      expect(result.fields.y).toHaveLength(1);
      expect(result.fields.y[0].functionName).toBeTruthy();
    });
  });

  describe("WHERE clause filtering", () => {
    it("should parse simple WHERE with equality", () => {
      const query = "SELECT * FROM logs WHERE status_code = 200";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.filter.filterType).toBe("group");
      expect(result.fields.filter.conditions).toHaveLength(1);
      const condition = result.fields.filter.conditions[0] as any;
      expect(condition.column.field).toBe("status_code");
      expect(condition.operator).toBe("=");
      expect(condition.value).toBe("200");
    });

    it("should parse WHERE with comparison operators", () => {
      const query = "SELECT * FROM logs WHERE response_time >= 1000";
      const result = parser.parseQueryToPanelObject(query);

      const condition = result.fields.filter.conditions[0] as any;
      expect(condition.operator).toBe(">=");
      expect(condition.value).toBe("1000");
    });

    it("should parse WHERE with LIKE", () => {
      const query = "SELECT * FROM logs WHERE message LIKE '%error%'";
      const result = parser.parseQueryToPanelObject(query);

      const condition = result.fields.filter.conditions[0] as any;
      expect(condition.operator).toBe("Contains");
      expect(condition.value).toBe("%error%");
    });

    it("should parse WHERE with IN clause", () => {
      const query = "SELECT * FROM logs WHERE status_code IN (200, 201, 204)";
      const result = parser.parseQueryToPanelObject(query);

      const condition = result.fields.filter.conditions[0] as any;
      expect(condition.type).toBe("list");
      expect(condition.operator).toBe("In");
      expect(condition.values).toHaveLength(3);
      expect(condition.values).toContain("200");
      expect(condition.values).toContain("201");
      expect(condition.values).toContain("204");
    });

    it("should parse WHERE with AND condition", () => {
      const query = "SELECT * FROM logs WHERE status_code = 500 AND severity = 'ERROR'";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.filter.logicalOperator).toBe("AND");
      expect(result.fields.filter.conditions).toHaveLength(2);
    });

    it("should parse WHERE with OR condition", () => {
      const query = "SELECT * FROM logs WHERE status_code = 500 OR status_code = 404";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.filter.logicalOperator).toBe("OR");
      expect(result.fields.filter.conditions).toHaveLength(2);
    });

    it("should parse WHERE with nested AND/OR", () => {
      const query = "SELECT * FROM logs WHERE (status_code = 500 OR status_code = 404) AND severity = 'ERROR'";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.filter.logicalOperator).toBe("AND");
      expect(result.fields.filter.conditions).toHaveLength(2);
    });

    it("should parse WHERE with table alias", () => {
      const query = "SELECT * FROM logs l WHERE l.status_code = 500";
      const result = parser.parseQueryToPanelObject(query);

      const condition = result.fields.filter.conditions[0] as any;
      expect(condition.column.streamAlias).toBe("l");
    });
  });

  describe("GROUP BY clause", () => {
    it("should parse simple GROUP BY", () => {
      const query = "SELECT service_name, COUNT(*) as count FROM logs GROUP BY service_name";
      const result = parser.parseQueryToPanelObject(query);

      // service_name should appear in x-axis
      expect(result.fields.x.some(x => x.alias === "service_name")).toBe(true);
    });

    it("should parse GROUP BY with multiple columns", () => {
      const query = "SELECT service_name, status_code, COUNT(*) FROM logs GROUP BY service_name, status_code";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x.length).toBeGreaterThanOrEqual(2);
    });

    it("should parse GROUP BY with function", () => {
      const query = "SELECT DATE_TRUNC('hour', _timestamp) as hour, COUNT(*) FROM logs GROUP BY hour";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x.some(x => x.alias === "hour")).toBe(true);
    });

    it("should merge GROUP BY fields into x-axis", () => {
      const query = "SELECT COUNT(*) as total FROM logs GROUP BY service_name";
      const result = parser.parseQueryToPanelObject(query);

      // service_name from GROUP BY should be added to x-axis
      expect(result.fields.x.some(x => x.alias === "service_name")).toBe(true);
    });
  });

  describe("HAVING clause", () => {
    it("should parse HAVING with simple condition", () => {
      const query = "SELECT service_name, COUNT(*) as count FROM logs GROUP BY service_name HAVING COUNT(*) > 100";
      const result = parser.parseQueryToPanelObject(query);

      // HAVING condition should be added to y-axis items
      expect(result.fields.y).toHaveLength(1);
      expect(result.fields.y[0].havingConditions).toBeDefined();
    });

    it("should parse HAVING with aggregation alias", () => {
      const query = "SELECT service_name, AVG(response_time) as avg_time FROM logs GROUP BY service_name HAVING avg_time > 1000";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.y[0].havingConditions).toBeDefined();
    });
  });

  describe("ORDER BY clause", () => {
    it("should parse ORDER BY ASC", () => {
      const query = "SELECT service_name, COUNT(*) as count FROM logs GROUP BY service_name ORDER BY count ASC";
      const result = parser.parseQueryToPanelObject(query);

      const countField = result.fields.y.find(y => y.alias === "count");
      expect(countField?.sortBy).toBe("ASC");
    });

    it("should parse ORDER BY DESC", () => {
      const query = "SELECT service_name, COUNT(*) as count FROM logs GROUP BY service_name ORDER BY count DESC";
      const result = parser.parseQueryToPanelObject(query);

      const countField = result.fields.y.find(y => y.alias === "count");
      expect(countField?.sortBy).toBe("DESC");
    });

    it("should parse ORDER BY with multiple columns", () => {
      const query = "SELECT service_name, status_code FROM logs ORDER BY service_name ASC, status_code DESC";
      const result = parser.parseQueryToPanelObject(query);

      const serviceField = result.fields.x.find(x => x.alias === "service_name");
      const statusField = result.fields.x.find(x => x.alias === "status_code");
      expect(serviceField?.sortBy).toBe("ASC");
      expect(statusField?.sortBy).toBe("DESC");
    });
  });

  describe("LIMIT clause", () => {
    it("should parse LIMIT", () => {
      const query = "SELECT * FROM logs LIMIT 100";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.config.limit).toBe(100);
    });

    it("should default to 0 when no LIMIT", () => {
      const query = "SELECT * FROM logs";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.config.limit).toBe(0);
    });
  });

  describe("JOIN queries", () => {
    it("should parse INNER JOIN", () => {
      const query = `
        SELECT a.user_id, b.order_count
        FROM users a
        INNER JOIN orders b ON a.user_id = b.user_id
      `;
      const result = parser.parseQueryToPanelObject(query);

      expect(result.joins).toHaveLength(1);
      expect(result.joins[0].stream).toBe("orders");
      expect(result.joins[0].streamAlias).toBe("b");
      expect(result.joins[0].joinType).toBe("INNER JOIN");
      expect(result.joins[0].conditions).toHaveLength(1);
      expect(result.joins[0].conditions[0].leftField.field).toBe("user_id");
      expect(result.joins[0].conditions[0].rightField.field).toBe("user_id");
    });

    it("should parse LEFT JOIN", () => {
      const query = `
        SELECT a.*, b.count
        FROM logs a
        LEFT JOIN metrics b ON a.trace_id = b.trace_id
      `;
      const result = parser.parseQueryToPanelObject(query);

      expect(result.joins).toHaveLength(1);
      expect(result.joins[0].joinType).toBe("LEFT JOIN");
    });

    it("should parse RIGHT JOIN", () => {
      const query = `
        SELECT a.*, b.*
        FROM table1 a
        RIGHT JOIN table2 b ON a.id = b.id
      `;
      const result = parser.parseQueryToPanelObject(query);

      expect(result.joins).toHaveLength(1);
      expect(result.joins[0].joinType).toBe("RIGHT JOIN");
    });

    it("should parse multiple JOINs", () => {
      const query = `
        SELECT a.*, b.*, c.*
        FROM table1 a
        INNER JOIN table2 b ON a.id = b.id
        LEFT JOIN table3 c ON b.id = c.id
      `;
      const result = parser.parseQueryToPanelObject(query);

      expect(result.joins).toHaveLength(2);
      expect(result.joins[0].joinType).toBe("INNER JOIN");
      expect(result.joins[1].joinType).toBe("LEFT JOIN");
    });

    it("should preserve stream aliases in fields", () => {
      const query = `
        SELECT a.user_id, b.order_count
        FROM users a
        INNER JOIN orders b ON a.user_id = b.user_id
      `;
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x[0].args[0].value).toHaveProperty("streamAlias", "a");
      expect(result.fields.x[1].args[0].value).toHaveProperty("streamAlias", "b");
    });
  });

  describe("Complex real-world queries", () => {
    it("should parse dashboard panel query with histogram and aggregations", () => {
      const query = `
        SELECT
          histogram(_timestamp, '1h') as time_bucket,
          COUNT(*) as total_requests,
          AVG(response_time) as avg_response_time,
          MAX(response_time) as max_response_time
        FROM api_logs
        WHERE status_code >= 400 AND status_code < 600
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
        LIMIT 1000
      `;
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.stream).toBe("api_logs");
      expect(result.fields.x).toHaveLength(1);
      expect(result.fields.x[0].functionName).toBe("histogram");
      expect(result.fields.y).toHaveLength(3);
      expect(result.fields.y[0].functionName).toBe("count");
      expect(result.fields.y[1].functionName).toBe("avg");
      expect(result.fields.y[2].functionName).toBe("max");
      expect(result.fields.filter.logicalOperator).toBe("AND");
      expect(result.config.limit).toBe(1000);
    });

    it("should parse error analytics query", () => {
      const query = `
        SELECT
          service_name,
          error_type,
          COUNT(*) as error_count,
          COUNT(DISTINCT user_id) as affected_users
        FROM error_logs
        WHERE severity IN ('ERROR', 'CRITICAL', 'FATAL')
          AND _timestamp >= NOW() - INTERVAL '24 hours'
        GROUP BY service_name, error_type
        HAVING COUNT(*) > 10
        ORDER BY error_count DESC
        LIMIT 50
      `;
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.stream).toBe("error_logs");
      expect(result.fields.x.length).toBeGreaterThanOrEqual(2);
      expect(result.fields.y.length).toBeGreaterThanOrEqual(1);
      expect(result.config.limit).toBe(50);
    });

    it("should parse query with JOINs and complex WHERE", () => {
      const query = `
        SELECT
          l.service_name,
          l.endpoint,
          COUNT(*) as request_count,
          AVG(m.duration) as avg_duration
        FROM logs l
        INNER JOIN metrics m ON l.trace_id = m.trace_id
        WHERE l.status_code >= 200 AND l.status_code < 300
          AND m.duration > 0
        GROUP BY l.service_name, l.endpoint
        ORDER BY request_count DESC
      `;
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.stream).toBe("logs");
      expect(result.joins).toHaveLength(1);
      expect(result.joins[0].stream).toBe("metrics");
      expect(result.fields.filter.logicalOperator).toBe("AND");
    });

    it("should parse nested function in aggregation", () => {
      const query = `
        SELECT
          DATE_TRUNC('hour', _timestamp) as hour,
          ROUND(AVG(response_time), 2) as avg_response,
          ROUND(PERCENTILE(response_time, 0.95), 2) as p95_response
        FROM api_logs
        GROUP BY hour
        ORDER BY hour ASC
      `;
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x[0].functionName).toBe("date_trunc");
      expect(result.fields.y.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Edge cases and error handling", () => {
    it("should handle query without FROM clause", () => {
      const query = "SELECT 1 as value";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.stream).toBe("");
    });

    it("should handle empty WHERE clause", () => {
      const query = "SELECT * FROM logs";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.filter.conditions).toHaveLength(0);
    });

    it("should handle query without GROUP BY", () => {
      const query = "SELECT COUNT(*) as total FROM logs";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.y).toHaveLength(1);
      expect(result.fields.x).toHaveLength(0);
    });

    it("should throw error for invalid SQL", () => {
      const query = "INVALID SQL QUERY HERE";
      expect(() => parser.parseQueryToPanelObject(query)).toThrow();
    });

    it("should throw error for non-SELECT queries", () => {
      const query = "UPDATE logs SET status = 'processed' WHERE id = 1";
      expect(() => parser.parseQueryToPanelObject(query)).toThrow("Only SELECT queries are supported");
    });

    it("should handle query with no columns selected", () => {
      const query = "SELECT FROM logs";
      // This should fail parsing
      expect(() => parser.parseQueryToPanelObject(query)).toThrow();
    });
  });

  describe("Stream type parameter", () => {
    it("should use logs as default stream type", () => {
      const query = "SELECT * FROM logs";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.stream_type).toBe("logs");
    });

    it("should accept metrics stream type", () => {
      const query = "SELECT * FROM metrics";
      const result = parser.parseQueryToPanelObject(query, "metrics");

      expect(result.fields.stream_type).toBe("metrics");
    });

    it("should accept traces stream type", () => {
      const query = "SELECT * FROM traces";
      const result = parser.parseQueryToPanelObject(query, "traces");

      expect(result.fields.stream_type).toBe("traces");
    });
  });

  describe("Color assignment", () => {
    it("should assign colors from palette", () => {
      const query = "SELECT COUNT(*) as c1, SUM(v) as s1 FROM data";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.y[0].color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(result.fields.y[1].color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it("should reset color index", () => {
      const query = "SELECT COUNT(*) FROM data";
      parser.parseQueryToPanelObject(query);
      const firstColor = parser["colorIndex"];

      parser.resetColorIndex();
      expect(parser["colorIndex"]).toBe(0);
    });
  });

  describe("Label generation", () => {
    it("should generate human-readable labels from snake_case", () => {
      const query = "SELECT user_id as user_id FROM users";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x[0].label).toBe("User Id");
    });

    it("should generate labels from kebab-case", () => {
      const query = "SELECT user_name as user_name FROM users";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x[0].label).toBe("User Name");
    });

    it("should handle already formatted labels", () => {
      const query = "SELECT name as 'Full Name' FROM users";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.fields.x[0].alias).toBe("Full Name");
    });
  });

  describe("Convenience function", () => {
    it("should work with standalone function", () => {
      const query = "SELECT COUNT(*) as total FROM logs";
      const result = parseSQLQueryToPanelObject(query);

      expect(result.fields.y[0].functionName).toBe("count");
    });

    it("should accept stream type parameter", () => {
      const query = "SELECT * FROM metrics";
      const result = parseSQLQueryToPanelObject(query, "metrics");

      expect(result.fields.stream_type).toBe("metrics");
    });
  });

  describe("Custom query flag", () => {
    it("should set customQuery to true", () => {
      const query = "SELECT * FROM logs";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.customQuery).toBe(true);
    });

    it("should preserve original query string", () => {
      const query = "SELECT COUNT(*) FROM logs WHERE status = 'active'";
      const result = parser.parseQueryToPanelObject(query);

      expect(result.query).toBe(query);
    });
  });
});
