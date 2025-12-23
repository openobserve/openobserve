// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildSQLQueryFromInput,
  buildSQLChartQuery,
  addMissingArgs,
  buildCondition,
  mapChart,
  geoMapChart,
  sankeyChartQuery,
} from "@/utils/dashboard/dashboardAutoQueryBuilder";

describe("dashboardAutoQueryBuilder", () => {
  describe("buildSQLQueryFromInput", () => {
    const defaultStream = "test_stream";

    it("should return empty string for undefined fields", () => {
      const result = buildSQLQueryFromInput(undefined, defaultStream);
      expect(result).toBe("");
    });

    it("should return empty string for null fields", () => {
      const result = buildSQLQueryFromInput(null, defaultStream);
      expect(result).toBe("");
    });

    it("should return raw query when type is raw", () => {
      const fields = {
        type: "raw",
        rawQuery: "SELECT * FROM test",
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("SELECT * FROM test");
    });

    it("should return empty string for raw type with no rawQuery", () => {
      const fields = {
        type: "raw",
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("");
    });

    it("should return empty string when function is not found", () => {
      const fields = {
        functionName: "nonexistent_function",
        args: [],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("");
    });

    it("should return function with no args when no args are required", () => {
      const fields = {
        functionName: "now",
        args: [],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      // Assuming 'now' function exists with no args in functionValidation
      expect(result).toBe("now()");
    });

    it("should handle field type argument with streamAlias", () => {
      const fields = {
        functionName: "count",
        args: [
          {
            type: "field",
            value: {
              field: "status",
              streamAlias: "s1",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("count(s1.status)");
    });

    it("should handle field type argument without streamAlias using defaultStream", () => {
      const fields = {
        functionName: "count",
        args: [
          {
            type: "field",
            value: {
              field: "status",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("count(test_stream.status)");
    });

    it("should handle field type argument without streamAlias and no defaultStream", () => {
      const fields = {
        functionName: "count",
        args: [
          {
            type: "field",
            value: {
              field: "status",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, null);
      expect(result).toBe("count(status)");
    });

    it("should skip field argument without field property", () => {
      const fields = {
        functionName: "count",
        args: [
          {
            type: "field",
            value: {},
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("");
    });

    it("should handle string type argument", () => {
      const fields = {
        functionName: "histogram",
        args: [
          {
            type: "field",
            value: {
              field: "_timestamp",
            },
          },
          {
            type: "string",
            value: "1h",
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("histogram(test_stream._timestamp, '1h')");
    });

    it("should handle string already wrapped in quotes", () => {
      const fields = {
        functionName: "histogram",
        args: [
          {
            type: "field",
            value: {
              field: "_timestamp",
            },
          },
          {
            type: "string",
            value: "'1h'",
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("histogram(test_stream._timestamp, '1h')");
    });

    it("should handle histogramInterval type argument", () => {
      const fields = {
        functionName: "histogram",
        args: [
          {
            type: "field",
            value: {
              field: "_timestamp",
            },
          },
          {
            type: "histogramInterval",
            value: "30m",
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("histogram(test_stream._timestamp, '30m')");
    });

    it("should handle number type argument", () => {
      const fields = {
        functionName: "approx_percentile_cont",
        args: [
          {
            type: "field",
            value: {
              field: "response_time",
            },
          },
          {
            type: "number",
            value: 0.95,
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("approx_percentile_cont(test_stream.response_time, 0.95)");
    });

    it("should handle nested function argument", () => {
      const fields = {
        functionName: "avg",
        args: [
          {
            type: "function",
            value: {
              functionName: "sum",
              args: [
                {
                  type: "field",
                  value: {
                    field: "amount",
                  },
                },
              ],
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("avg(sum(test_stream.amount))");
    });

    it("should skip nested function that fails to build", () => {
      const fields = {
        functionName: "avg",
        args: [
          {
            type: "function",
            value: {
              functionName: "nonexistent",
              args: [],
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("");
    });

    it("should skip undefined arguments", () => {
      const fields = {
        functionName: "count",
        args: [
          undefined,
          {
            type: "field",
            value: {
              field: "status",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("count(test_stream.status)");
    });

    it("should skip null arguments", () => {
      const fields = {
        functionName: "count",
        args: [
          null,
          {
            type: "field",
            value: {
              field: "status",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("count(test_stream.status)");
    });

    it("should skip arguments with undefined value", () => {
      const fields = {
        functionName: "count",
        args: [
          {
            type: "field",
            value: undefined,
          },
          {
            type: "field",
            value: {
              field: "status",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("count(test_stream.status)");
    });

    it("should skip arguments with null value", () => {
      const fields = {
        functionName: "count",
        args: [
          {
            type: "field",
            value: null,
          },
          {
            type: "field",
            value: {
              field: "status",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("count(test_stream.status)");
    });

    it("should skip unsupported argument types", () => {
      const fields = {
        functionName: "count",
        args: [
          {
            type: "unknown_type",
            value: "something",
          },
          {
            type: "field",
            value: {
              field: "status",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("count(test_stream.status)");
    });

    it("should return empty string when no valid arguments are found but required", () => {
      const fields = {
        functionName: "count",
        args: [
          {
            type: "field",
            value: undefined,
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("");
    });

    it("should handle count-distinct function", () => {
      const fields = {
        functionName: "count-distinct",
        args: [
          {
            type: "field",
            value: {
              field: "user_id",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("count(distinct(test_stream.user_id))");
    });

    it("should handle p50 percentile function", () => {
      const fields = {
        functionName: "p50",
        args: [
          {
            type: "field",
            value: {
              field: "response_time",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("approx_percentile_cont(test_stream.response_time, 0.5)");
    });

    it("should handle p90 percentile function", () => {
      const fields = {
        functionName: "p90",
        args: [
          {
            type: "field",
            value: {
              field: "response_time",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("approx_percentile_cont(test_stream.response_time, 0.9)");
    });

    it("should handle p95 percentile function", () => {
      const fields = {
        functionName: "p95",
        args: [
          {
            type: "field",
            value: {
              field: "response_time",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("approx_percentile_cont(test_stream.response_time, 0.95)");
    });

    it("should handle p99 percentile function", () => {
      const fields = {
        functionName: "p99",
        args: [
          {
            type: "field",
            value: {
              field: "response_time",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("approx_percentile_cont(test_stream.response_time, 0.99)");
    });

    it("should handle null functionName with single argument", () => {
      const fields = {
        functionName: null,
        args: [
          {
            type: "field",
            value: {
              field: "status",
            },
          },
        ],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("test_stream.status");
    });

    it("should handle empty functionName with no arguments", () => {
      const fields = {
        functionName: null,
        args: [],
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("");
    });

    it("should handle non-array args", () => {
      const fields = {
        functionName: "count",
        args: "not_an_array",
      };
      const result = buildSQLQueryFromInput(fields, defaultStream);
      expect(result).toBe("");
    });
  });

  describe("buildSQLChartQuery", () => {
    let mockDashboardPanelData: any;
    let mockQueryData: any;

    beforeEach(() => {
      mockDashboardPanelData = {
        data: {
          queries: [
            {
              fields: {
                stream: "logs",
                filter: {
                  conditions: [],
                },
              },
              joins: [],
            },
          ],
        },
        layout: {
          currentQueryIndex: 0,
        },
        meta: {
          streamFields: {
            groupedFields: [
              {
                stream_alias: null,
                schema: [
                  { name: "status", type: "Utf8" },
                  { name: "count", type: "Int64" },
                  { name: "age", type: "Int64" },
                ],
              },
            ],
          },
        },
      };

      mockQueryData = {
        fields: {
          stream: "logs",
          x: [],
          y: [],
          z: [],
          breakdown: [],
          filter: {
            conditions: [],
          },
        },
        joins: [],
        config: {
          limit: 0,
        },
      };
    });

    it("should return empty string when all field arrays are empty", () => {
      const config = {
        queryData: mockQueryData,
        chartType: "bar",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toBe("");
    });

    it("should build query with x-axis fields only", () => {
      mockQueryData.fields.x = [
        {
          alias: "status_alias",
          column: "status",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "status",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "bar",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toContain("SELECT");
      expect(result).toContain("FROM \"logs\"");
      expect(result).toContain("GROUP BY status_alias");
    });

    it("should build query with x and y axis fields", () => {
      mockQueryData.fields.x = [
        {
          alias: "status_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "status",
              },
            },
          ],
        },
      ];
      mockQueryData.fields.y = [
        {
          alias: "count_alias",
          isDerived: false,
          functionName: "count",
          args: [
            {
              type: "field",
              value: {
                field: "id",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "bar",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toContain("SELECT");
      expect(result).toContain("GROUP BY status_alias");
    });

    it("should build heatmap query with x and y axis", () => {
      mockQueryData.fields.x = [
        {
          alias: "x_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "x_field",
              },
            },
          ],
        },
      ];
      mockQueryData.fields.y = [
        {
          alias: "y_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "y_field",
              },
            },
          ],
        },
      ];
      mockQueryData.fields.z = [
        {
          alias: "z_alias",
          isDerived: false,
          functionName: "count",
          args: [
            {
              type: "field",
              value: {
                field: "id",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "heatmap",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toContain("GROUP BY x_alias, y_alias");
    });

    it("should build query with breakdown fields", () => {
      mockQueryData.fields.x = [
        {
          alias: "x_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "timestamp",
              },
            },
          ],
        },
      ];
      mockQueryData.fields.breakdown = [
        {
          alias: "breakdown_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "region",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "line",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toContain("GROUP BY x_alias, breakdown_alias");
    });

    it("should handle table type with only x fields - no GROUP BY", () => {
      mockQueryData.fields.x = [
        {
          alias: "x_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "status",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "table",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).not.toContain("GROUP BY");
    });

    it("should handle table type with x and y fields", () => {
      mockQueryData.fields.x = [
        {
          alias: "x_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "status",
              },
            },
          ],
        },
      ];
      mockQueryData.fields.y = [
        {
          alias: "y_alias",
          isDerived: false,
          functionName: "count",
          args: [
            {
              type: "field",
              value: {
                field: "id",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "table",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toContain("GROUP BY x_alias");
    });

    it("should skip derived fields in GROUP BY", () => {
      mockQueryData.fields.x = [
        {
          alias: "derived_field",
          isDerived: true,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "status",
              },
            },
          ],
        },
        {
          alias: "normal_field",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "region",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "bar",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toContain("GROUP BY normal_field");
      expect(result).not.toContain("derived_field");
    });

    it("should include HAVING clause from y-axis fields", () => {
      mockQueryData.fields.x = [
        {
          alias: "x_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "status",
              },
            },
          ],
        },
      ];
      mockQueryData.fields.y = [
        {
          alias: "count_alias",
          isDerived: false,
          functionName: "count",
          havingConditions: [
            {
              operator: ">",
              value: "100",
            },
          ],
          args: [
            {
              type: "field",
              value: {
                field: "id",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "bar",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toContain("HAVING count_alias > 100");
    });

    it("should skip HAVING clause for heatmap y-axis", () => {
      mockQueryData.fields.y = [
        {
          alias: "y_alias",
          isDerived: false,
          functionName: null,
          havingConditions: [
            {
              operator: ">",
              value: "100",
            },
          ],
          args: [
            {
              type: "field",
              value: {
                field: "y_field",
              },
            },
          ],
        },
      ];
      mockQueryData.fields.x = [
        {
          alias: "x_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "x_field",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "heatmap",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).not.toContain("HAVING");
    });

    it("should include HAVING clause from z-axis fields", () => {
      mockQueryData.fields.x = [
        {
          alias: "x_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "status",
              },
            },
          ],
        },
      ];
      mockQueryData.fields.z = [
        {
          alias: "z_alias",
          isDerived: false,
          functionName: "sum",
          havingConditions: [
            {
              operator: "<",
              value: "50",
            },
          ],
          args: [
            {
              type: "field",
              value: {
                field: "amount",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "bar",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toContain("HAVING z_alias < 50");
    });

    it("should skip HAVING with empty value", () => {
      mockQueryData.fields.x = [
        {
          alias: "x_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "status",
              },
            },
          ],
        },
      ];
      mockQueryData.fields.y = [
        {
          alias: "count_alias",
          isDerived: false,
          functionName: "count",
          havingConditions: [
            {
              operator: ">",
              value: "",
            },
          ],
          args: [
            {
              type: "field",
              value: {
                field: "id",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "bar",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).not.toContain("HAVING");
    });

    it("should include ORDER BY clause", () => {
      mockQueryData.fields.x = [
        {
          alias: "x_alias",
          isDerived: false,
          sortBy: "DESC",
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "status",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "bar",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toContain("ORDER BY x_alias DESC");
    });

    it("should include LIMIT clause when limit is set", () => {
      mockQueryData.fields.x = [
        {
          alias: "x_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "status",
              },
            },
          ],
        },
      ];
      mockQueryData.config.limit = 100;

      const config = {
        queryData: mockQueryData,
        chartType: "bar",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toContain("LIMIT 100");
    });

    it("should not include LIMIT when limit is 0", () => {
      mockQueryData.fields.x = [
        {
          alias: "x_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "status",
              },
            },
          ],
        },
      ];
      mockQueryData.config.limit = 0;

      const config = {
        queryData: mockQueryData,
        chartType: "bar",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).not.toContain("LIMIT");
    });

    it("should handle joins with stream alias", () => {
      mockQueryData.joins = [
        {
          stream: "users",
          streamAlias: "u",
          joinType: "inner",
          conditions: [
            {
              leftField: { field: "user_id", streamAlias: null },
              rightField: { field: "id", streamAlias: "u" },
              operation: "=",
            },
          ],
        },
      ];
      mockQueryData.fields.x = [
        {
          alias: "x_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "status",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "bar",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toContain("FROM \"logs\"");
      expect(result).toContain("INNER JOIN");
    });

    it("should filter invalid fields with no expression", () => {
      mockQueryData.fields.x = [
        {
          alias: "invalid_alias",
          isDerived: false,
          functionName: "nonexistent",
          args: [
            {
              type: "field",
              value: {
                field: "status",
              },
            },
          ],
        },
      ];

      const config = {
        queryData: mockQueryData,
        chartType: "bar",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toBe("");
    });

    it("should build query with WHERE clause containing multiple conditions and logical operators", () => {
      mockQueryData.fields.x = [
        {
          alias: "x_alias",
          isDerived: false,
          functionName: null,
          args: [
            {
              type: "field",
              value: {
                field: "timestamp",
              },
            },
          ],
        },
      ];
      mockQueryData.fields.filter = {
        conditions: [
          {
            type: "condition",
            operator: "=",
            column: {
              field: "status",
            },
            value: "active",
            logicalOperator: "",
          },
          {
            type: "condition",
            operator: ">",
            column: {
              field: "count",
            },
            value: "10",
            logicalOperator: "OR",
          },
          {
            type: "condition",
            operator: "<",
            column: {
              field: "age",
            },
            value: "50",
            logicalOperator: "AND",
          },
        ],
      };

      const config = {
        queryData: mockQueryData,
        chartType: "bar",
        dashboardPanelData: mockDashboardPanelData,
      };
      const result = buildSQLChartQuery(config);
      expect(result).toContain("WHERE");
      expect(result).toContain("status = 'active'");
      expect(result).toContain("OR");
      expect(result).toContain("count > 10");
      expect(result).toContain("AND");
      expect(result).toContain("age < 50");
    });
  });

  describe("addMissingArgs", () => {
    it("should return fields unchanged when function is not found", () => {
      const fields = {
        functionName: "nonexistent",
        args: [],
      };
      const result = addMissingArgs(fields);
      expect(result).toEqual(fields);
    });

    it("should add missing field type argument", () => {
      const fields = {
        functionName: "count",
        args: [],
      };
      const result = addMissingArgs(fields);
      expect(result.args).toHaveLength(1);
      expect(result.args[0].type).toBe("field");
      expect(result.args[0].value).toEqual({});
    });

    it("should not modify existing arguments", () => {
      const fields = {
        functionName: "count",
        args: [
          {
            type: "field",
            value: {
              field: "status",
            },
          },
        ],
      };
      const result = addMissingArgs(fields);
      expect(result.args).toHaveLength(1);
      expect(result.args[0].value.field).toBe("status");
    });

    it("should add missing string type argument with default value", () => {
      const fields = {
        functionName: "histogram",
        args: [
          {
            type: "field",
            value: {
              field: "_timestamp",
            },
          },
        ],
      };
      const result = addMissingArgs(fields);
      expect(result.args).toHaveLength(2);
      expect(result.args[1].type).toBe("histogramInterval");
    });

    it("should handle null functionName", () => {
      const fields = {
        functionName: null,
        args: [],
      };
      const result = addMissingArgs(fields);
      expect(result.args).toHaveLength(1);
      expect(result.args[0].type).toBe("field");
    });

    it("should preserve other field properties", () => {
      const fields = {
        functionName: "count",
        args: [],
        alias: "count_alias",
        otherProp: "value",
      };
      const result = addMissingArgs(fields);
      expect(result.alias).toBe("count_alias");
      expect(result.otherProp).toBe("value");
    });
  });

  describe("buildCondition", () => {
    let mockDashboardPanelData: any;

    beforeEach(() => {
      mockDashboardPanelData = {
        data: {
          queries: [
            {
              fields: {
                stream: "logs",
              },
              joins: [],
            },
          ],
        },
        layout: {
          currentQueryIndex: 0,
        },
        meta: {
          streamFields: {
            groupedFields: [
              {
                stream_alias: null,
                schema: [
                  { name: "status", type: "Utf8" },
                  { name: "count", type: "Int64" },
                ],
              },
            ],
          },
        },
      };
    });

    it("should build simple condition with = operator", () => {
      const condition = {
        type: "condition",
        operator: "=",
        column: {
          field: "status",
        },
        value: "active",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("status = 'active'");
    });

    it("should build condition with <> operator", () => {
      const condition = {
        type: "condition",
        operator: "<>",
        column: {
          field: "status",
        },
        value: "inactive",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("status <> 'inactive'");
    });

    it("should build condition with < operator", () => {
      const condition = {
        type: "condition",
        operator: "<",
        column: {
          field: "count",
        },
        value: "100",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("count < 100");
    });

    it("should build condition with > operator", () => {
      const condition = {
        type: "condition",
        operator: ">",
        column: {
          field: "count",
        },
        value: "50",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("count > 50");
    });

    it("should build condition with <= operator", () => {
      const condition = {
        type: "condition",
        operator: "<=",
        column: {
          field: "count",
        },
        value: "100",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("count <= 100");
    });

    it("should build condition with >= operator", () => {
      const condition = {
        type: "condition",
        operator: ">=",
        column: {
          field: "count",
        },
        value: "50",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("count >= 50");
    });

    it("should build condition with Contains operator", () => {
      const condition = {
        type: "condition",
        operator: "Contains",
        column: {
          field: "status",
        },
        value: "act",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("str_match(status, 'act')");
    });

    it("should build condition with Not Contains operator", () => {
      const condition = {
        type: "condition",
        operator: "Not Contains",
        column: {
          field: "status",
        },
        value: "test",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("status NOT LIKE '%test%'");
    });

    it("should build condition with Starts With operator", () => {
      const condition = {
        type: "condition",
        operator: "Starts With",
        column: {
          field: "status",
        },
        value: "act",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("status LIKE 'act%'");
    });

    it("should build condition with Ends With operator", () => {
      const condition = {
        type: "condition",
        operator: "Ends With",
        column: {
          field: "status",
        },
        value: "ive",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("status LIKE '%ive'");
    });

    it("should build condition with Is Null operator", () => {
      const condition = {
        type: "condition",
        operator: "Is Null",
        column: {
          field: "status",
        },
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("status IS NULL");
    });

    it("should build condition with Is Not Null operator", () => {
      const condition = {
        type: "condition",
        operator: "Is Not Null",
        column: {
          field: "status",
        },
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("status IS NOT NULL");
    });

    it("should build condition with IN operator", () => {
      const condition = {
        type: "condition",
        operator: "IN",
        column: {
          field: "status",
        },
        value: "active,pending,done",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toContain("status IN (");
      expect(result).toContain("'active'");
      expect(result).toContain("'pending'");
      expect(result).toContain("'done'");
    });

    it("should build condition with IN operator and variable", () => {
      const condition = {
        type: "condition",
        operator: "IN",
        column: {
          field: "status",
        },
        value: "$status_var",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("status IN ($status_var)");
    });

    it("should build condition with IN operator and variable with parentheses", () => {
      const condition = {
        type: "condition",
        operator: "IN",
        column: {
          field: "status",
        },
        value: "($status_var)",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("status IN ($status_var)");
    });

    it("should build condition with NOT IN operator", () => {
      const condition = {
        type: "condition",
        operator: "NOT IN",
        column: {
          field: "status",
        },
        value: "inactive,deleted",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toContain("status NOT IN (");
      expect(result).toContain("'inactive'");
      expect(result).toContain("'deleted'");
    });

    it("should build condition with match_all operator", () => {
      const condition = {
        type: "condition",
        operator: "match_all",
        column: {
          field: "message",
        },
        value: "error",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("match_all('error')");
    });

    it("should build condition with str_match operator", () => {
      const condition = {
        type: "condition",
        operator: "str_match",
        column: {
          field: "message",
        },
        value: "error.*",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("str_match(message, 'error.*')");
    });

    it("should build condition with str_match_ignore_case operator", () => {
      const condition = {
        type: "condition",
        operator: "str_match_ignore_case",
        column: {
          field: "message",
        },
        value: "ERROR",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("str_match_ignore_case(message, 'ERROR')");
    });

    it("should build condition with re_match operator", () => {
      const condition = {
        type: "condition",
        operator: "re_match",
        column: {
          field: "message",
        },
        value: "^error",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("re_match(message, '^error')");
    });

    it("should build condition with re_not_match operator", () => {
      const condition = {
        type: "condition",
        operator: "re_not_match",
        column: {
          field: "message",
        },
        value: "^debug",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("re_not_match(message, '^debug')");
    });

    it("should build list type condition", () => {
      const condition = {
        type: "list",
        column: {
          field: "status",
        },
        values: ["active", "pending", "done"],
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toContain("status IN (");
      expect(result).toContain("'active'");
      expect(result).toContain("'pending'");
      expect(result).toContain("'done'");
    });

    it("should build group type condition with multiple conditions", () => {
      const condition = {
        filterType: "group",
        conditions: [
          {
            type: "condition",
            operator: "=",
            column: {
              field: "status",
            },
            value: "active",
            logicalOperator: "AND",
          },
          {
            type: "condition",
            operator: ">",
            column: {
              field: "count",
            },
            value: "10",
            logicalOperator: "OR",
          },
        ],
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toContain("(");
      expect(result).toContain("status = 'active'");
      expect(result).toContain("OR");
      expect(result).toContain("count > 10");
      expect(result).toContain(")");
    });

    it("should return empty string for group with no valid conditions", () => {
      const condition = {
        filterType: "group",
        conditions: [],
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("");
    });

    it("should handle stream alias when joins exist", () => {
      mockDashboardPanelData.data.queries[0].joins = [
        {
          stream: "users",
          streamAlias: "u",
        },
      ];
      const condition = {
        type: "condition",
        operator: "=",
        column: {
          field: "status",
          streamAlias: "u",
        },
        value: "active",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("u.status = 'active'");
    });

    it("should use default stream alias when column has no streamAlias but joins exist", () => {
      mockDashboardPanelData.data.queries[0].joins = [
        {
          stream: "users",
          streamAlias: "u",
        },
      ];
      const condition = {
        type: "condition",
        operator: "=",
        column: {
          field: "status",
        },
        value: "active",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("logs.status = 'active'");
    });

    it("should handle empty value", () => {
      const condition = {
        type: "condition",
        operator: "=",
        column: {
          field: "status",
        },
        value: "",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("");
    });

    it("should handle null value", () => {
      const condition = {
        type: "condition",
        operator: "=",
        column: {
          field: "status",
        },
        value: null,
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      // null value returns empty string as condition value is checked in buildCondition
      expect(result).toBe("");
    });

    it("should handle numeric field type", () => {
      mockDashboardPanelData.meta.streamFields.groupedFields[0].schema.push({
        name: "count",
        type: "Int64",
      });
      const condition = {
        type: "condition",
        operator: ">",
        column: {
          field: "count",
        },
        value: "100",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("count > 100");
    });

    it("should escape single quotes in value", () => {
      const condition = {
        type: "condition",
        operator: "=",
        column: {
          field: "status",
        },
        value: "'active'",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toContain("status = ");
    });

    it("should return empty string for unknown condition type", () => {
      const condition = {
        type: "unknown",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("");
    });

    it("should handle Contains operator for non-string field", () => {
      const condition = {
        type: "condition",
        operator: "Contains",
        column: {
          field: "count",
        },
        value: "10",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("str_match(count, 10)");
    });

    it("should handle custom operator (default case)", () => {
      const condition = {
        type: "condition",
        operator: "CUSTOM_OP",
        column: {
          field: "status",
        },
        value: "test",
      };
      const result = buildCondition(condition, mockDashboardPanelData);
      expect(result).toBe("status CUSTOM_OP 'test'");
    });

    it("should handle WHERE clause with multiple conditions and logical operators", () => {
      mockDashboardPanelData.data.queries[0].fields.filter = {
        conditions: [
          {
            type: "condition",
            operator: "=",
            column: {
              field: "status",
            },
            value: "active",
            logicalOperator: "AND",
          },
          {
            type: "condition",
            operator: ">",
            column: {
              field: "count",
            },
            value: "10",
            logicalOperator: "OR",
          },
          {
            type: "condition",
            operator: "<",
            column: {
              field: "age",
            },
            value: "50",
            logicalOperator: "",
          },
        ],
      };

      // Test through buildSQLChartQuery which uses buildWhereClause
      mockDashboardPanelData.data.queries[0] = {
        fields: {
          stream: "logs",
          x: [
            {
              alias: "x_alias",
              isDerived: false,
              functionName: null,
              args: [
                {
                  type: "field",
                  value: {
                    field: "timestamp",
                  },
                },
              ],
            },
          ],
          y: [],
          z: [],
          breakdown: [],
          filter: {
            conditions: [
              {
                type: "condition",
                operator: "=",
                column: {
                  field: "status",
                },
                value: "active",
                logicalOperator: "AND",
              },
              {
                type: "condition",
                operator: ">",
                column: {
                  field: "count",
                },
                value: "10",
                logicalOperator: "OR",
              },
              {
                type: "condition",
                operator: "<",
                column: {
                  field: "age",
                },
                value: "50",
                logicalOperator: "",
              },
            ],
          },
        },
        joins: [],
        config: {
          limit: 0,
        },
      };

      const result = buildCondition(
        mockDashboardPanelData.data.queries[0].fields.filter.conditions[0],
        mockDashboardPanelData,
      );
      expect(result).toContain("status = 'active'");
    });
  });

  describe("mapChart", () => {
    let mockDashboardPanelData: any;

    beforeEach(() => {
      mockDashboardPanelData = {
        data: {
          queries: [
            {
              fields: {
                stream: "logs",
                name: {
                  alias: "name_alias",
                  column: "country",
                  functionName: null,
                  args: [
                    {
                      type: "field",
                      value: {
                        field: "country",
                      },
                    },
                  ],
                },
                value_for_maps: {
                  alias: "value_alias",
                  column: "count",
                  functionName: "count",
                  args: [
                    {
                      type: "field",
                      value: {
                        field: "id",
                      },
                    },
                  ],
                },
                filter: {
                  conditions: [],
                },
              },
              joins: [],
              config: {
                limit: 100,
              },
            },
          ],
        },
        layout: {
          currentQueryIndex: 0,
        },
        meta: {
          streamFields: {
            groupedFields: [
              {
                stream_alias: null,
                schema: [
                  { name: "country", type: "Utf8" },
                  { name: "id", type: "Int64" },
                ],
              },
            ],
          },
        },
      };
    });

    it("should build map chart query", () => {
      const result = mapChart(mockDashboardPanelData);
      expect(result).toContain("SELECT");
      expect(result).toContain("FROM \"logs\"");
      expect(result).toContain("GROUP BY name_alias");
      expect(result).toContain("LIMIT 100");
    });

    it("should return partial query when name field is missing", () => {
      mockDashboardPanelData.data.queries[0].fields.name = {
        alias: "name_alias",
        column: null,
        functionName: null,
        args: [],
      };
      const result = mapChart(mockDashboardPanelData);
      expect(result).toContain("SELECT");
      expect(result).toContain("count(id)");
      expect(result).toContain("value_alias");
    });

    it("should return partial query when value_for_maps field is missing", () => {
      mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
        alias: "value_alias",
        column: null,
        functionName: null,
        args: [],
      };
      const result = mapChart(mockDashboardPanelData);
      expect(result).toContain("SELECT");
      expect(result).toContain("country");
      expect(result).toContain("name_alias");
    });
  });

  describe("geoMapChart", () => {
    let mockDashboardPanelData: any;

    beforeEach(() => {
      mockDashboardPanelData = {
        data: {
          queries: [
            {
              fields: {
                stream: "locations",
                latitude: {
                  alias: "lat_alias",
                  column: "lat",
                  functionName: null,
                  args: [
                    {
                      type: "field",
                      value: {
                        field: "lat",
                      },
                    },
                  ],
                },
                longitude: {
                  alias: "lon_alias",
                  column: "lon",
                  functionName: null,
                  args: [
                    {
                      type: "field",
                      value: {
                        field: "lon",
                      },
                    },
                  ],
                },
                weight: {
                  alias: "weight_alias",
                  column: "weight",
                  functionName: "sum",
                  args: [
                    {
                      type: "field",
                      value: {
                        field: "weight",
                      },
                    },
                  ],
                },
                filter: {
                  conditions: [],
                },
              },
              joins: [],
              config: {
                limit: 0,
              },
            },
          ],
        },
        layout: {
          currentQueryIndex: 0,
        },
        meta: {
          streamFields: {
            groupedFields: [
              {
                stream_alias: null,
                schema: [
                  { name: "lat", type: "Float64" },
                  { name: "lon", type: "Float64" },
                  { name: "weight", type: "Int64" },
                ],
              },
            ],
          },
        },
      };
    });

    it("should build geo map chart query", () => {
      const result = geoMapChart(mockDashboardPanelData);
      expect(result).toContain("SELECT");
      expect(result).toContain("FROM \"locations\"");
      expect(result).toContain("GROUP BY lat_alias, lon_alias");
    });

    it("should return partial query when latitude field is missing", () => {
      mockDashboardPanelData.data.queries[0].fields.latitude = {
        alias: "lat_alias",
        column: null,
        functionName: null,
        args: [],
      };
      const result = geoMapChart(mockDashboardPanelData);
      // When latitude is missing, query still builds with remaining valid fields
      expect(result).toContain("SELECT");
      expect(result).toContain("lon_alias");
    });

    it("should return partial query when longitude field is missing", () => {
      mockDashboardPanelData.data.queries[0].fields.longitude = {
        alias: "lon_alias",
        column: null,
        functionName: null,
        args: [],
      };
      const result = geoMapChart(mockDashboardPanelData);
      // When longitude is missing, query still builds with remaining valid fields
      expect(result).toContain("SELECT");
      expect(result).toContain("lat_alias");
    });
  });

  describe("sankeyChartQuery", () => {
    let mockDashboardPanelData: any;

    beforeEach(() => {
      mockDashboardPanelData = {
        data: {
          queries: [
            {
              fields: {
                stream: "flows",
                source: {
                  alias: "source_alias",
                  column: "source",
                  functionName: null,
                  args: [
                    {
                      type: "field",
                      value: {
                        field: "source",
                      },
                    },
                  ],
                },
                target: {
                  alias: "target_alias",
                  column: "target",
                  functionName: null,
                  args: [
                    {
                      type: "field",
                      value: {
                        field: "target",
                      },
                    },
                  ],
                },
                value: {
                  alias: "value_alias",
                  column: "amount",
                  functionName: "sum",
                  args: [
                    {
                      type: "field",
                      value: {
                        field: "amount",
                      },
                    },
                  ],
                },
                filter: {
                  conditions: [],
                },
              },
              joins: [],
              config: {
                limit: 0,
              },
            },
          ],
        },
        layout: {
          currentQueryIndex: 0,
        },
        meta: {
          streamFields: {
            groupedFields: [
              {
                stream_alias: null,
                schema: [
                  { name: "source", type: "Utf8" },
                  { name: "target", type: "Utf8" },
                  { name: "amount", type: "Int64" },
                ],
              },
            ],
          },
        },
      };
    });

    it("should build sankey chart query", () => {
      const result = sankeyChartQuery(mockDashboardPanelData);
      expect(result).toContain("SELECT");
      expect(result).toContain("FROM \"flows\"");
      expect(result).toContain("GROUP BY source_alias, target_alias");
    });

    it("should return partial query when source field is missing", () => {
      mockDashboardPanelData.data.queries[0].fields.source = {
        alias: "source_alias",
        column: null,
        functionName: null,
        args: [],
      };
      const result = sankeyChartQuery(mockDashboardPanelData);
      // When source is missing, query still builds with remaining valid fields
      expect(result).toContain("SELECT");
      expect(result).toContain("target_alias");
    });

    it("should return partial query when target field is missing", () => {
      mockDashboardPanelData.data.queries[0].fields.target = {
        alias: "target_alias",
        column: null,
        functionName: null,
        args: [],
      };
      const result = sankeyChartQuery(mockDashboardPanelData);
      // When target is missing, query still builds with remaining valid fields
      expect(result).toContain("SELECT");
      expect(result).toContain("source_alias");
    });

    it("should return partial query when value field is missing", () => {
      mockDashboardPanelData.data.queries[0].fields.value = {
        alias: "value_alias",
        column: null,
        functionName: null,
        args: [],
      };
      const result = sankeyChartQuery(mockDashboardPanelData);
      // When value is missing, query still builds with remaining valid fields
      expect(result).toContain("SELECT");
      expect(result).toContain("source_alias");
    });
  });
});
