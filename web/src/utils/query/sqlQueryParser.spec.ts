import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isQueryParseable,
  parseSQL,
  parsedQueryToPanelFields,
  shouldUseCustomMode,
} from "./sqlQueryParser";

// Mock sqlUtils
vi.mock("./sqlUtils", () => ({
  getFieldsFromQuery: vi.fn().mockResolvedValue({
    fields: [
      { column: "timestamp", alias: "time", aggregationFunction: "histogram" },
      { column: "count", alias: "count", aggregationFunction: "count" },
    ],
    filters: { filterType: "group", logicalOperator: "AND", conditions: [] },
    streamName: "logs",
  }),
  getStreamFromQuery: vi.fn().mockResolvedValue("logs"),
}));

describe("sqlQueryParser", () => {
  describe("isQueryParseable", () => {
    describe("should return parseable for simple queries", () => {
      it("should return parseable for simple SELECT", () => {
        const result = isQueryParseable("SELECT * FROM logs");
        expect(result.isParseable).toBe(true);
      });

      it("should return parseable for SELECT with WHERE", () => {
        const result = isQueryParseable("SELECT * FROM logs WHERE level = 'ERROR'");
        expect(result.isParseable).toBe(true);
      });

      it("should return parseable for SELECT with GROUP BY", () => {
        const result = isQueryParseable("SELECT level, COUNT(*) FROM logs GROUP BY level");
        expect(result.isParseable).toBe(true);
      });

      it("should return parseable for SELECT with ORDER BY", () => {
        const result = isQueryParseable("SELECT * FROM logs ORDER BY timestamp DESC");
        expect(result.isParseable).toBe(true);
      });

      it("should return parseable for SELECT with LIMIT", () => {
        const result = isQueryParseable("SELECT * FROM logs LIMIT 100");
        expect(result.isParseable).toBe(true);
      });

      it("should return parseable for simple JOIN", () => {
        const result = isQueryParseable("SELECT * FROM logs JOIN users ON logs.user_id = users.id");
        expect(result.isParseable).toBe(true);
      });
    });

    describe("should return not parseable for complex queries", () => {
      it("should return not parseable for subqueries", () => {
        const result = isQueryParseable("SELECT * FROM (SELECT * FROM logs)");
        expect(result.isParseable).toBe(false);
        expect(result.reason).toBe("Contains subqueries or derived tables");
      });

      it("should return not parseable for derived tables in JOINs", () => {
        // Derived table / subquery in JOIN - not supported
        const result = isQueryParseable("SELECT * FROM users INNER JOIN (SELECT user_id, SUM(amount) FROM orders GROUP BY user_id) AS order_summary ON users.id = order_summary.user_id");
        expect(result.isParseable).toBe(false);
        expect(result.reason).toBe("Contains subqueries or derived tables");
      });

      it("should return not parseable for parenthesized/nested JOINs", () => {
        // Nested JOIN grouping like a JOIN (b JOIN c) - not supported
        const result = isQueryParseable("SELECT * FROM a JOIN (b JOIN c ON b.id = c.b_id) ON a.id = b.a_id");
        expect(result.isParseable).toBe(false);
        expect(result.reason).toBe("Contains parenthesized/nested JOINs");
      });

      it("should return not parseable for CTEs", () => {
        // Note: This query also contains a subquery, which is matched first
        const result = isQueryParseable("WITH temp AS (SELECT * FROM logs) SELECT * FROM temp");
        expect(result.isParseable).toBe(false);
        // The subquery pattern matches first since (SELECT is detected
        expect(result.reason).toBe("Contains subqueries or derived tables");
      });

      it("should return not parseable for CTE pattern", () => {
        // Test the CTE pattern directly - WITH name AS (
        const result = isQueryParseable("WITH temp AS (\nVALUES (1)\n) SELECT * FROM temp");
        expect(result.isParseable).toBe(false);
        // Pattern matches "WITH temp AS ("
        expect(result.reason).toBe("Contains WITH clause (CTE)");
      });

      it("should return not parseable for UNION", () => {
        const result = isQueryParseable("SELECT * FROM logs UNION SELECT * FROM errors");
        expect(result.isParseable).toBe(false);
        expect(result.reason).toBe("Contains UNION/INTERSECT/EXCEPT");
      });

      it("should return not parseable for INTERSECT", () => {
        const result = isQueryParseable("SELECT * FROM logs INTERSECT SELECT * FROM errors");
        expect(result.isParseable).toBe(false);
        expect(result.reason).toBe("Contains UNION/INTERSECT/EXCEPT");
      });

      it("should return not parseable for window functions", () => {
        const result = isQueryParseable("SELECT *, ROW_NUMBER() OVER (PARTITION BY level) FROM logs");
        expect(result.isParseable).toBe(false);
        expect(result.reason).toBe("Contains window functions");
      });

      it("should return not parseable for DISTINCT ON", () => {
        const result = isQueryParseable("SELECT DISTINCT ON (user_id) * FROM logs");
        expect(result.isParseable).toBe(false);
        expect(result.reason).toBe("Contains DISTINCT ON");
      });

      it("should return not parseable for ARRAY operations", () => {
        const result = isQueryParseable("SELECT ARRAY_AGG(level) FROM logs");
        expect(result.isParseable).toBe(false);
        expect(result.reason).toBe("Contains array operations");
      });

      it("should return not parseable for JSON operations", () => {
        const result = isQueryParseable("SELECT data->>'name' FROM logs");
        expect(result.isParseable).toBe(false);
        expect(result.reason).toBe("Contains JSON operations");
      });
    });

    describe("should return parseable for supported features", () => {
      it("should return parseable for CASE/WHEN statements", () => {
        // CASE/WHEN is supported via field type "raw" with rawQuery
        const result = isQueryParseable("SELECT CASE WHEN level = 'ERROR' THEN 1 ELSE 0 END FROM logs");
        expect(result.isParseable).toBe(true);
      });

      it("should return parseable for multiple JOINs", () => {
        // Multiple JOINs are supported in panel schema
        const result = isQueryParseable("SELECT * FROM logs JOIN users ON logs.user_id = users.id JOIN sessions ON users.id = sessions.user_id");
        expect(result.isParseable).toBe(true);
      });

      it("should return parseable for HAVING clause", () => {
        // HAVING is supported via havingConditions on y-axis fields
        const result = isQueryParseable("SELECT level, COUNT(*) FROM logs GROUP BY level HAVING COUNT(*) > 10");
        expect(result.isParseable).toBe(true);
      });
    });

    describe("should handle edge cases", () => {
      it("should return not parseable for null query", () => {
        const result = isQueryParseable(null as any);
        expect(result.isParseable).toBe(false);
        expect(result.reason).toBe("Invalid query");
      });

      it("should return not parseable for undefined query", () => {
        const result = isQueryParseable(undefined as any);
        expect(result.isParseable).toBe(false);
        expect(result.reason).toBe("Invalid query");
      });

      it("should return not parseable for empty string", () => {
        const result = isQueryParseable("");
        expect(result.isParseable).toBe(false);
        expect(result.reason).toBe("Invalid query");
      });

      it("should return not parseable for non-string", () => {
        const result = isQueryParseable(123 as any);
        expect(result.isParseable).toBe(false);
        expect(result.reason).toBe("Invalid query");
      });
    });
  });

  describe("shouldUseCustomMode", () => {
    it("should return false for empty query", () => {
      expect(shouldUseCustomMode("")).toBe(false);
    });

    it("should return false for simple query", () => {
      expect(shouldUseCustomMode("SELECT * FROM logs")).toBe(false);
    });

    it("should return true for complex query with subquery", () => {
      expect(shouldUseCustomMode("SELECT * FROM (SELECT * FROM logs)")).toBe(true);
    });

    it("should return true for query with CTE", () => {
      // This query contains both CTE and subquery pattern, but returns true for custom mode
      expect(shouldUseCustomMode("WITH temp AS (SELECT * FROM logs) SELECT * FROM temp")).toBe(true);
    });

    it("should return false for query with HAVING (supported)", () => {
      // HAVING is supported via havingConditions on y-axis fields
      expect(shouldUseCustomMode("SELECT level, COUNT(*) FROM logs GROUP BY level HAVING COUNT(*) > 10")).toBe(false);
    });

    it("should return true for query with UNION", () => {
      expect(shouldUseCustomMode("SELECT * FROM logs UNION SELECT * FROM errors")).toBe(true);
    });
  });

  describe("parseSQL", () => {
    it("should return customQuery: false for empty query", async () => {
      const result = await parseSQL("", "logs");
      expect(result.customQuery).toBe(false);
    });

    it("should return customQuery: true for complex query", async () => {
      const result = await parseSQL("SELECT * FROM (SELECT * FROM logs)", "logs");
      expect(result.customQuery).toBe(true);
      expect(result.parseError).toBe("Contains subqueries or derived tables");
    });

    it("should preserve raw query", async () => {
      const query = "SELECT * FROM logs WHERE level = 'ERROR'";
      const result = await parseSQL(query, "logs");
      expect(result.rawQuery).toBe(query);
    });

    it("should use provided streamType", async () => {
      const result = await parseSQL("SELECT * FROM logs", "metrics");
      expect(result.streamType).toBe("metrics");
    });

    it("should default to logs streamType", async () => {
      const result = await parseSQL("SELECT * FROM logs");
      expect(result.streamType).toBe("logs");
    });
  });

  describe("parsedQueryToPanelFields", () => {
    it("should convert parsed query to panel fields", () => {
      const parsed = {
        stream: "logs",
        streamType: "logs",
        xFields: [{ column: "timestamp", alias: "time", aggregationFunction: "histogram" }],
        yFields: [{ column: "count", alias: "count", aggregationFunction: "count" }],
        breakdownFields: [{ column: "level", alias: "level", aggregationFunction: null }],
        filters: { filterType: "group" as const, logicalOperator: "AND", conditions: [] },
        customQuery: false,
        rawQuery: "SELECT histogram(timestamp), COUNT(*) FROM logs GROUP BY level",
      };

      const result = parsedQueryToPanelFields(parsed);

      expect(result.stream).toBe("logs");
      expect(result.stream_type).toBe("logs");
      expect(result.x.length).toBe(1);
      expect(result.y.length).toBe(1);
      expect(result.breakdown.length).toBe(1);
    });

    it("should set correct field structure", () => {
      const parsed = {
        stream: "logs",
        streamType: "logs",
        xFields: [{ column: "timestamp", alias: "time", aggregationFunction: "histogram" }],
        yFields: [],
        breakdownFields: [],
        filters: { filterType: "group" as const, logicalOperator: "AND", conditions: [] },
        customQuery: false,
        rawQuery: "SELECT * FROM logs",
      };

      const result = parsedQueryToPanelFields(parsed);

      const xField = result.x[0];
      expect(xField.label).toBe("timestamp");
      expect(xField.alias).toBe("x_axis_1");
      expect(xField.column).toBe("timestamp");
      expect(xField.functionName).toBe("histogram");
      expect(xField.sortBy).toBe("ASC");
      expect(xField.args).toEqual([
        { type: "field", value: { field: "timestamp", streamAlias: null } },
      ]);
    });

    it("should handle empty fields arrays", () => {
      const parsed = {
        stream: "",
        streamType: "logs",
        xFields: [],
        yFields: [],
        breakdownFields: [],
        filters: { filterType: "group" as const, logicalOperator: "AND", conditions: [] },
        customQuery: false,
        rawQuery: "",
      };

      const result = parsedQueryToPanelFields(parsed);

      expect(result.x).toEqual([]);
      expect(result.y).toEqual([]);
      expect(result.breakdown).toEqual([]);
    });

    it("should move first breakdown field to x-axis when x-axis is empty", () => {
      // Simulates: SELECT count(_timestamp) as "y_axis_1", k8s_namespace_name as "x_axis_1" FROM "default"
      // where k8s_namespace_name is classified as breakdown (no aggregation function)
      const parsed = {
        stream: "default",
        streamType: "logs",
        xFields: [], // No histogram/timeseries field
        yFields: [{ column: "_timestamp", alias: "y_axis_1", aggregationFunction: "count" }],
        breakdownFields: [
          { column: "k8s_namespace_name", alias: "x_axis_1", aggregationFunction: null },
          { column: "k8s_pod_name", alias: "x_axis_2", aggregationFunction: null },
        ],
        filters: { filterType: "group" as const, logicalOperator: "AND", conditions: [] },
        customQuery: false,
        rawQuery: 'SELECT count(_timestamp) as "y_axis_1", k8s_namespace_name as "x_axis_1", k8s_pod_name as "x_axis_2" FROM "default"',
      };

      const result = parsedQueryToPanelFields(parsed);

      // First breakdown field should be moved to x-axis
      expect(result.x.length).toBe(1);
      expect(result.x[0].column).toBe("k8s_namespace_name");
      expect(result.x[0].alias).toBe("x_axis_1");

      // Y-axis should remain unchanged
      expect(result.y.length).toBe(1);
      expect(result.y[0].column).toBe("_timestamp");

      // Remaining breakdown fields should stay in breakdown
      expect(result.breakdown.length).toBe(1);
      expect(result.breakdown[0].column).toBe("k8s_pod_name");
    });

    it("should not move breakdown to x-axis when x-axis already has fields", () => {
      const parsed = {
        stream: "logs",
        streamType: "logs",
        xFields: [{ column: "_timestamp", alias: "time", aggregationFunction: "histogram" }],
        yFields: [{ column: "count", alias: "count", aggregationFunction: "count" }],
        breakdownFields: [{ column: "level", alias: "level", aggregationFunction: null }],
        filters: { filterType: "group" as const, logicalOperator: "AND", conditions: [] },
        customQuery: false,
        rawQuery: "SELECT histogram(_timestamp), COUNT(*) FROM logs GROUP BY level",
      };

      const result = parsedQueryToPanelFields(parsed);

      // X-axis should keep the histogram field
      expect(result.x.length).toBe(1);
      expect(result.x[0].column).toBe("_timestamp");
      expect(result.x[0].functionName).toBe("histogram");

      // Breakdown should remain unchanged
      expect(result.breakdown.length).toBe(1);
      expect(result.breakdown[0].column).toBe("level");
    });

    it("should use table chart when more than 2 GROUP BY fields (1 x-axis + 2 breakdown)", () => {
      // Simulates a query with 3 non-aggregation fields that would exceed x-axis + breakdown limit
      const parsed = {
        stream: "logs",
        streamType: "logs",
        xFields: [{ column: "_timestamp", alias: "x_axis_1", aggregationFunction: "histogram" }],
        yFields: [{ column: "amount", alias: "y_axis_1", aggregationFunction: "sum" }],
        breakdownFields: [
          { column: "country", alias: "x_axis_2", aggregationFunction: null },
          { column: "subscription_type", alias: "x_axis_3", aggregationFunction: null },
        ],
        filters: { filterType: "group" as const, logicalOperator: "AND", conditions: [] },
        joins: [],
        customQuery: false,
        rawQuery: "SELECT histogram(_timestamp), country, subscription_type, sum(amount) FROM logs GROUP BY x_axis_1, x_axis_2, x_axis_3",
      };

      const result = parsedQueryToPanelFields(parsed);

      // All GROUP BY fields should be moved to x-axis
      expect(result.x.length).toBe(3);
      expect(result.x[0].column).toBe("_timestamp");
      expect(result.x[1].column).toBe("country");
      expect(result.x[2].column).toBe("subscription_type");

      // Breakdown should be empty
      expect(result.breakdown.length).toBe(0);

      // useTableChart flag should be true
      expect(result.useTableChart).toBe(true);
    });

    it("should use table chart when more than 2 GROUP BY fields (0 x-axis + 3 breakdown)", () => {
      // Simulates a query with 3 non-aggregation fields, no histogram
      const parsed = {
        stream: "logs",
        streamType: "logs",
        xFields: [], // No histogram field
        yFields: [{ column: "amount", alias: "y_axis_1", aggregationFunction: "sum" }],
        breakdownFields: [
          { column: "order_date", alias: "x_axis_1", aggregationFunction: null },
          { column: "country", alias: "x_axis_2", aggregationFunction: null },
          { column: "subscription_type", alias: "x_axis_3", aggregationFunction: null },
        ],
        filters: { filterType: "group" as const, logicalOperator: "AND", conditions: [] },
        joins: [],
        customQuery: false,
        rawQuery: "SELECT order_date, country, subscription_type, sum(amount) FROM logs GROUP BY x_axis_1, x_axis_2, x_axis_3",
      };

      const result = parsedQueryToPanelFields(parsed);

      // All breakdown fields should be moved to x-axis
      expect(result.x.length).toBe(3);
      expect(result.x[0].column).toBe("order_date");
      expect(result.x[1].column).toBe("country");
      expect(result.x[2].column).toBe("subscription_type");

      // Breakdown should be empty
      expect(result.breakdown.length).toBe(0);

      // useTableChart flag should be true
      expect(result.useTableChart).toBe(true);
    });

    it("should not use table chart when exactly 2 GROUP BY fields", () => {
      // 1 x-axis + 1 breakdown = 2 fields, within limit
      const parsed = {
        stream: "logs",
        streamType: "logs",
        xFields: [{ column: "_timestamp", alias: "x_axis_1", aggregationFunction: "histogram" }],
        yFields: [{ column: "count", alias: "y_axis_1", aggregationFunction: "count" }],
        breakdownFields: [{ column: "level", alias: "breakdown_1", aggregationFunction: null }],
        filters: { filterType: "group" as const, logicalOperator: "AND", conditions: [] },
        joins: [],
        customQuery: false,
        rawQuery: "SELECT histogram(_timestamp), level, count(*) FROM logs GROUP BY x_axis_1, breakdown_1",
      };

      const result = parsedQueryToPanelFields(parsed);

      // Fields should remain as-is
      expect(result.x.length).toBe(1);
      expect(result.breakdown.length).toBe(1);

      // useTableChart flag should be false
      expect(result.useTableChart).toBe(false);
    });

    it("should handle raw fields (CASE/WHEN expressions) in breakdown", () => {
      // Simulates: SELECT histogram(_timestamp), count(_timestamp), CASE WHEN level = 'ERROR' THEN 'Bad' ELSE 'Good' END as status FROM logs
      const parsed = {
        stream: "logs",
        streamType: "logs",
        xFields: [{ column: "_timestamp", alias: "x_axis_1", aggregationFunction: "histogram" }],
        yFields: [{ column: "_timestamp", alias: "y_axis_1", aggregationFunction: "count" }],
        breakdownFields: [
          {
            column: "",
            alias: "breakdown_1",
            aggregationFunction: null,
            type: "raw" as const,
            rawQuery: "CASE WHEN level = 'ERROR' THEN 'Bad' ELSE 'Good' END",
          },
        ],
        filters: { filterType: "group" as const, logicalOperator: "AND", conditions: [] },
        joins: [],
        customQuery: false,
        rawQuery: "SELECT histogram(_timestamp), count(_timestamp), CASE WHEN level = 'ERROR' THEN 'Bad' ELSE 'Good' END as breakdown_1 FROM logs",
      };

      const result = parsedQueryToPanelFields(parsed);

      // Raw field should be converted to panel format with type: "raw" and rawQuery
      expect(result.breakdown.length).toBe(1);
      expect(result.breakdown[0].type).toBe("raw");
      expect(result.breakdown[0].rawQuery).toBe("CASE WHEN level = 'ERROR' THEN 'Bad' ELSE 'Good' END");
      expect(result.breakdown[0].alias).toBe("z_axis_1");
      expect(result.breakdown[0].column).toBe("");
    });

    it("should handle raw fields (CASE/WHEN expressions) in y-axis", () => {
      // CASE/WHEN can also be used as y-axis field
      const parsed = {
        stream: "logs",
        streamType: "logs",
        xFields: [{ column: "_timestamp", alias: "x_axis_1", aggregationFunction: "histogram" }],
        yFields: [
          {
            column: "",
            alias: "y_axis_1",
            aggregationFunction: null,
            type: "raw" as const,
            rawQuery: "CASE WHEN status = 'success' THEN 1 ELSE 0 END",
          },
        ],
        breakdownFields: [],
        filters: { filterType: "group" as const, logicalOperator: "AND", conditions: [] },
        joins: [],
        customQuery: false,
        rawQuery: "SELECT histogram(_timestamp), CASE WHEN status = 'success' THEN 1 ELSE 0 END as y_axis_1 FROM logs",
      };

      const result = parsedQueryToPanelFields(parsed);

      // Raw field should be converted to panel format with type: "raw" and rawQuery
      expect(result.y.length).toBe(1);
      expect(result.y[0].type).toBe("raw");
      expect(result.y[0].rawQuery).toBe("CASE WHEN status = 'success' THEN 1 ELSE 0 END");
      expect(result.y[0].alias).toBe("y_axis_1");
    });
  });
});
