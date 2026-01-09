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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TableConverter } from "./convertPromQLTableChart";
import { ProcessedPromQLData } from "./shared/types";

vi.mock("./shared/dataProcessor", () => ({
  applyAggregation: vi.fn((values: any[], aggregation: string) => {
    if (aggregation === "last" && values.length > 0) {
      return parseFloat(values[values.length - 1][1]);
    }
    if (aggregation === "first" && values.length > 0) {
      return parseFloat(values[0][1]);
    }
    if (aggregation === "min") {
      return Math.min(...values.map((v: any) => parseFloat(v[1])));
    }
    if (aggregation === "max") {
      return Math.max(...values.map((v: any) => parseFloat(v[1])));
    }
    if (aggregation === "avg") {
      const sum = values.reduce((acc, v) => acc + parseFloat(v[1]), 0);
      return sum / values.length;
    }
    if (aggregation === "sum") {
      return values.reduce((acc, v) => acc + parseFloat(v[1]), 0);
    }
    return 0;
  }),
}));

vi.mock("../convertDataIntoUnitValue", () => ({
  getUnitValue: vi.fn((value, unit, unitCustom, decimals = 2) => {
    if (unit === "bytes") {
      return { value: value.toFixed(decimals), unit: "B" };
    }
    if (unit === "percent") {
      return { value: value.toFixed(decimals), unit: "%" };
    }
    return { value: value.toFixed(decimals), unit: "" };
  }),
  formatUnitValue: vi.fn((obj) => `${obj.value}${obj.unit}`),
  formatDate: vi.fn((date) => {
    if (typeof date === "number") {
      return new Date(date).toISOString();
    }
    return date.toISOString();
  }),
  findFirstValidMappedValue: vi.fn((val, mappings, type) => {
    if (!mappings || mappings.length === 0) return null;

    const mapping = mappings.find((m: any) => {
      if (m.type === "value" && m.value === val) return true;
      if (m.type === "range" && val >= m.from && val <= m.to) return true;
      return false;
    });

    return mapping ? { text: mapping.text } : null;
  }),
}));

vi.mock("date-fns-tz", () => ({
  toZonedTime: vi.fn((timestamp, timezone) => {
    return new Date(timestamp);
  }),
}));

describe("TableConverter", () => {
  let converter: TableConverter;
  let mockStore: any;
  let mockExtras: any;

  beforeEach(() => {
    converter = new TableConverter();
    mockStore = {
      state: {
        theme: "light",
        timezone: "UTC",
      },
    };
    mockExtras = {
      legends: [],
    };
  });

  describe("supportedTypes", () => {
    it("should support table chart type", () => {
      expect(converter.supportedTypes).toEqual(["table"]);
    });
  });

  describe("convert - single mode", () => {
    it("should convert to timestamp + value columns in single mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "requests",
              data: [],
              values: [
                [1234567890, "100"],
                [1234567900, "200"],
              ],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "single",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.columns).toHaveLength(2);
      expect(result.columns[0].name).toBe("timestamp");
      expect(result.columns[1].name).toBe("value");
      expect(result.rows).toHaveLength(2);
    });

    it("should format values with unit in single mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {},
              name: "metric",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "single",
          unit: "bytes",
          decimals: 2,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const formatted = result.columns[1].format(100);
      expect(formatted).toBe("100.00B");
    });

    it("should apply value mappings in single mode", async () => {
      const { findFirstValidMappedValue } =
        await import("../convertDataIntoUnitValue");
      vi.mocked(findFirstValidMappedValue).mockReturnValueOnce({
        text: "High",
      });

      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {},
              name: "metric",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "single",
          mappings: [{ type: "value", value: 100, text: "High" }],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const formatted = result.columns[1].format(100);
      expect(formatted).toBe("High");
    });

    it("should apply row limit in single mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {},
              name: "metric",
              data: [],
              values: [
                [1234567890, "100"],
                [1234567900, "200"],
                [1234567910, "300"],
              ],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "single",
          row_limit: 2,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.rows).toHaveLength(2);
    });

    it("should support color mode override for timestamp in single mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {},
              name: "metric",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "single",
          override_config: [
            {
              field: { value: "timestamp" },
              config: [{ type: "unique_value_color", autoColor: true }],
            },
          ],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.columns[0].colorMode).toBe("auto");
    });

    it("should support color mode override for value in single mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {},
              name: "metric",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "single",
          override_config: [
            {
              field: { value: "value" },
              config: [{ type: "unique_value_color", autoColor: true }],
            },
          ],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.columns[1].colorMode).toBe("auto");
    });

    it("should support unit override for value in single mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {},
              name: "metric",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "single",
          unit: "bytes",
          override_config: [
            {
              field: { value: "value" },
              config: [
                {
                  type: "unit",
                  value: { unit: "percent", customUnit: "" },
                },
              ],
            },
          ],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const formatted = result.columns[1].format(100);
      expect(formatted).toBe("100.00%");
    });
  });

  describe("convert - expanded_timeseries mode", () => {
    it("should convert to timestamp + labels + value in expanded_timeseries mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api", instance: "localhost" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "expanded_timeseries",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.columns).toHaveLength(4); // timestamp, instance, job, value
      expect(result.columns[0].name).toBe("timestamp");
      expect(result.columns[3].name).toBe("value");
    });

    it("should filter visible columns in expanded_timeseries mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api", instance: "localhost", status: "200" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "expanded_timeseries",
          visible_columns: ["job"],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const labelColumns = result.columns.filter(
        (c: any) => c.name !== "timestamp" && c.name !== "value",
      );
      expect(labelColumns).toHaveLength(1);
      expect(labelColumns[0].name).toBe("job");
    });

    it("should filter hidden columns in expanded_timeseries mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api", instance: "localhost", status: "200" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "expanded_timeseries",
          hidden_columns: ["status"],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const labelColumns = result.columns.filter(
        (c: any) => c.name !== "timestamp" && c.name !== "value",
      );
      expect(labelColumns.map((c: any) => c.name)).not.toContain("status");
    });

    it("should make first column sticky in expanded_timeseries mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "expanded_timeseries",
          sticky_first_column: true,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.columns[0].sticky).toBe(true);
      expect(result.columns[0].headerClasses).toBe("sticky-column");
    });

    it("should make specific columns sticky in expanded_timeseries mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api", instance: "localhost" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "expanded_timeseries",
          sticky_columns: ["job"],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const jobColumn = result.columns.find((c: any) => c.name === "job");
      expect(jobColumn.sticky).toBe(true);
    });

    it("should apply row limit in expanded_timeseries mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "metric",
              data: [],
              values: [
                [1234567890, "100"],
                [1234567900, "200"],
                [1234567910, "300"],
              ],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "expanded_timeseries",
          row_limit: 2,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.rows).toHaveLength(2);
    });

    it("should apply value mappings to label columns in expanded_timeseries mode", async () => {
      const { findFirstValidMappedValue } =
        await import("../convertDataIntoUnitValue");
      vi.mocked(findFirstValidMappedValue).mockReturnValueOnce({
        text: "Production",
      });

      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api", env: "prod" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "expanded_timeseries",
          mappings: [{ type: "value", value: "prod", text: "Production" }],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const envColumn = result.columns.find((c: any) => c.name === "env");
      const formatted = envColumn.format("prod");
      expect(formatted).toBe("Production");
    });

    it("should support color mode override for timestamp in expanded_timeseries mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "expanded_timeseries",
          override_config: [
            {
              field: { value: "timestamp" },
              config: [{ type: "unique_value_color", autoColor: true }],
            },
          ],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.columns[0].colorMode).toBe("auto");
    });

    it("should support color mode override for label columns in expanded_timeseries mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "expanded_timeseries",
          override_config: [
            {
              field: { value: "job" },
              config: [{ type: "unique_value_color", autoColor: true }],
            },
          ],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const jobColumn = result.columns.find((c: any) => c.name === "job");
      expect(jobColumn.colorMode).toBe("auto");
    });

    it("should support color mode override for value in expanded_timeseries mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "expanded_timeseries",
          override_config: [
            {
              field: { value: "value" },
              config: [{ type: "unique_value_color", autoColor: true }],
            },
          ],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const valueColumn = result.columns.find((c: any) => c.name === "value");
      expect(valueColumn.colorMode).toBe("auto");
    });

    it("should apply value mappings in value column in expanded_timeseries mode", async () => {
      const { findFirstValidMappedValue } =
        await import("../convertDataIntoUnitValue");
      vi.mocked(findFirstValidMappedValue).mockReturnValueOnce({
        text: "High",
      });

      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "expanded_timeseries",
          mappings: [{ type: "value", value: 100, text: "High" }],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const valueColumn = result.columns.find((c: any) => c.name === "value");
      const formatted = valueColumn.format(100);
      expect(formatted).toBe("High");
    });

    it("should support unit override for value in expanded_timeseries mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "expanded_timeseries",
          unit: "bytes",
          override_config: [
            {
              field: { value: "value" },
              config: [
                {
                  type: "unit",
                  value: { unit: "percent", customUnit: "" },
                },
              ],
            },
          ],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const valueColumn = result.columns.find((c: any) => c.name === "value");
      const formatted = valueColumn.format(100);
      expect(formatted).toBe("100.00%");
    });
  });

  describe("convert - all mode (aggregate)", () => {
    it("should convert to labels + value in all mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api", instance: "localhost" },
              name: "requests",
              data: [],
              values: [
                [1234567890, "100"],
                [1234567900, "200"],
              ],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "all",
          aggregation: "last",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.columns.length).toBeGreaterThan(0);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].value).toBe(200);
    });

    it("should support multiple aggregations in all mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "requests",
              data: [],
              values: [
                [1234567890, "100"],
                [1234567900, "200"],
                [1234567910, "300"],
              ],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "all",
          table_aggregations: ["min", "max", "avg"],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const valueColumns = result.columns.filter((c: any) =>
        c.name.startsWith("value_"),
      );
      expect(valueColumns).toHaveLength(3);
      expect(result.rows[0].value_min).toBe(100);
      expect(result.rows[0].value_max).toBe(300);
    });

    it("should filter visible columns in all mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api", instance: "localhost", status: "200" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "all",
          visible_columns: ["job"],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const labelColumns = result.columns.filter(
        (c: any) => !c.name.startsWith("value"),
      );
      expect(labelColumns).toHaveLength(1);
      expect(labelColumns[0].name).toBe("job");
    });

    it("should filter hidden columns in all mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api", instance: "localhost", status: "200" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "all",
          hidden_columns: ["status"],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const labelColumns = result.columns.filter(
        (c: any) => !c.name.startsWith("value"),
      );
      expect(labelColumns.map((c: any) => c.name)).not.toContain("status");
    });

    it("should make first column sticky in all mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api", instance: "localhost" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "all",
          sticky_first_column: true,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.columns[0].sticky).toBe(true);
    });

    it("should make specific columns sticky in all mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api", instance: "localhost" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "all",
          sticky_columns: ["job"],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const jobColumn = result.columns.find((c: any) => c.name === "job");
      expect(jobColumn.sticky).toBe(true);
    });

    it("should apply row limit in all mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "metric1",
              data: [],
              values: [[1234567890, "100"]],
            },
            {
              metric: { job: "web" },
              name: "metric2",
              data: [],
              values: [[1234567890, "200"]],
            },
            {
              metric: { job: "db" },
              name: "metric3",
              data: [],
              values: [[1234567890, "300"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "all",
          row_limit: 2,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.rows).toHaveLength(2);
    });

    it("should use single value column when one aggregation in all mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "all",
          table_aggregations: ["last"],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const valueColumn = result.columns.find((c: any) => c.name === "value");
      expect(valueColumn).toBeDefined();
      expect(valueColumn.label).toBe("Value");
    });

    it("should apply value mappings to label columns in all mode", async () => {
      const { findFirstValidMappedValue } =
        await import("../convertDataIntoUnitValue");
      vi.mocked(findFirstValidMappedValue).mockReturnValueOnce({
        text: "Production",
      });

      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api", env: "prod" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "all",
          mappings: [{ type: "value", value: "prod", text: "Production" }],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const envColumn = result.columns.find((c: any) => c.name === "env");
      const formatted = envColumn.format("prod");
      expect(formatted).toBe("Production");
    });

    it("should support color mode override for label columns in all mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "all",
          override_config: [
            {
              field: { value: "job" },
              config: [{ type: "unique_value_color", autoColor: true }],
            },
          ],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const jobColumn = result.columns.find((c: any) => c.name === "job");
      expect(jobColumn.colorMode).toBe("auto");
    });

    it("should support color mode override for value columns in all mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "all",
          override_config: [
            {
              field: { value: "value" },
              config: [{ type: "unique_value_color", autoColor: true }],
            },
          ],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const valueColumn = result.columns.find((c: any) => c.name === "value");
      expect(valueColumn.colorMode).toBe("auto");
    });

    it("should support unit override for value columns in all mode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {
          promql_table_mode: "all",
          unit: "bytes",
          override_config: [
            {
              field: { value: "value" },
              config: [
                {
                  type: "unit",
                  value: { unit: "percent", customUnit: "" },
                },
              ],
            },
          ],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const valueColumn = result.columns.find((c: any) => c.name === "value");
      const formatted = valueColumn.format(100);
      expect(formatted).toBe("100.00%");
    });
  });

  describe("convert - default behavior", () => {
    it("should use all mode as default when promql_table_mode not specified", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: { job: "api" },
              name: "requests",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].value).toBeDefined();
    });

    it("should return empty series array", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {},
              name: "metric",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "table",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series).toEqual([]);
    });
  });
});
