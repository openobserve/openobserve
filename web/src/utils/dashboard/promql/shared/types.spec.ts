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

import { describe, it, expect } from "vitest";
import type {
  PromQLResultItem,
  PromQLResponse,
  ProcessedPromQLData,
  PromQLChartConverter,
  ConversionContext,
  AggregationFunction,
  TableColumnConfig,
  GeoMapConfig,
  MapsConfig,
} from "./types";

describe("PromQL Types", () => {
  describe("PromQLResultItem", () => {
    it("should accept a result item with metric and values", () => {
      const item: PromQLResultItem = {
        metric: { __name__: "up", job: "prometheus" },
        values: [
          [1609459200, "1"],
          [1609459260, "1"],
        ],
      };

      expect(item.metric).toEqual({ __name__: "up", job: "prometheus" });
      expect(item.values).toHaveLength(2);
      expect(item.values?.[0]).toEqual([1609459200, "1"]);
    });

    it("should accept a result item with metric and single value", () => {
      const item: PromQLResultItem = {
        metric: { __name__: "up", job: "prometheus" },
        value: [1609459200, "1"],
      };

      expect(item.metric).toEqual({ __name__: "up", job: "prometheus" });
      expect(item.value).toEqual([1609459200, "1"]);
    });

    it("should accept a result item with empty metric", () => {
      const item: PromQLResultItem = {
        metric: {},
        values: [[1609459200, "42"]],
      };

      expect(item.metric).toEqual({});
      expect(item.values).toBeDefined();
    });
  });

  describe("PromQLResponse", () => {
    it("should accept standard PromQL API response format", () => {
      const response: PromQLResponse = {
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            {
              metric: { __name__: "up" },
              values: [[1609459200, "1"]],
            },
          ],
        },
      };

      expect(response.status).toBe("success");
      expect(response.data?.resultType).toBe("matrix");
      expect(response.data?.result).toHaveLength(1);
    });

    it("should accept OpenObserve format with direct result", () => {
      const response: PromQLResponse = {
        status: "success",
        resultType: "vector",
        result: [
          {
            metric: { instance: "localhost:9090" },
            value: [1609459200, "100"],
          },
        ],
      };

      expect(response.status).toBe("success");
      expect(response.resultType).toBe("vector");
      expect(response.result).toHaveLength(1);
    });

    it("should accept response with error status", () => {
      const response: PromQLResponse = {
        status: "error",
      };

      expect(response.status).toBe("error");
    });

    it("should accept response with scalar result type", () => {
      const response: PromQLResponse = {
        data: {
          resultType: "scalar",
          result: [],
        },
      };

      expect(response.data?.resultType).toBe("scalar");
    });

    it("should accept response with string result type", () => {
      const response: PromQLResponse = {
        data: {
          resultType: "string",
          result: [],
        },
      };

      expect(response.data?.resultType).toBe("string");
    });
  });

  describe("ProcessedPromQLData", () => {
    it("should accept fully populated processed data", () => {
      const processed: ProcessedPromQLData = {
        timestamps: [
          [1609459200, new Date(1609459200 * 1000)],
          [1609459260, "2021-01-01 00:01:00"],
        ],
        series: [
          {
            name: "up{job='prometheus'}",
            metric: { __name__: "up", job: "prometheus" },
            values: [
              [1609459200, "1"],
              [1609459260, "1"],
            ],
            data: {
              1609459200: "1",
              1609459260: "1",
            },
          },
        ],
        queryIndex: 0,
        queryConfig: { query: "up" },
      };

      expect(processed.timestamps).toHaveLength(2);
      expect(processed.series).toHaveLength(1);
      expect(processed.queryIndex).toBe(0);
      expect(processed.queryConfig.query).toBe("up");
    });

    it("should accept processed data with Date objects in timestamps", () => {
      const date = new Date(1609459200 * 1000);
      const processed: ProcessedPromQLData = {
        timestamps: [[1609459200, date]],
        series: [],
        queryIndex: 0,
        queryConfig: {},
      };

      expect(processed.timestamps[0][1]).toBeInstanceOf(Date);
    });

    it("should accept processed data with string dates in timestamps", () => {
      const processed: ProcessedPromQLData = {
        timestamps: [[1609459200, "2021-01-01 00:00:00"]],
        series: [],
        queryIndex: 1,
        queryConfig: null,
      };

      expect(typeof processed.timestamps[0][1]).toBe("string");
    });

    it("should accept series with empty values", () => {
      const processed: ProcessedPromQLData = {
        timestamps: [],
        series: [
          {
            name: "empty_series",
            metric: {},
            values: [],
            data: {},
          },
        ],
        queryIndex: 0,
        queryConfig: {},
      };

      expect(processed.series[0].values).toHaveLength(0);
      expect(Object.keys(processed.series[0].data)).toHaveLength(0);
    });
  });

  describe("PromQLChartConverter", () => {
    it("should implement converter interface", () => {
      const mockConverter: PromQLChartConverter = {
        convert: (processedData, panelSchema, store, extras, chartPanelRef) => {
          return {
            series: [],
            xAxis: {},
            yAxis: {},
          };
        },
        supportedTypes: ["line", "bar"],
      };

      expect(mockConverter.convert).toBeDefined();
      expect(mockConverter.supportedTypes).toContain("line");
      expect(mockConverter.supportedTypes).toContain("bar");
    });

    it("should accept converter with all chart options", () => {
      const mockConverter: PromQLChartConverter = {
        convert: () => ({
          series: [{ type: "line", data: [] }],
          xAxis: { type: "time" },
          yAxis: { type: "value" },
          grid: { left: 50 },
          tooltip: { trigger: "axis" },
          legend: { show: true },
          dataZoom: [],
          toolbox: {},
        }),
        supportedTypes: ["line", "bar", "scatter"],
      };

      const result = mockConverter.convert([], {}, {}, {});
      expect(result.series).toBeDefined();
      expect(result.xAxis).toBeDefined();
      expect(result.yAxis).toBeDefined();
      expect(result.grid).toBeDefined();
      expect(result.tooltip).toBeDefined();
      expect(result.legend).toBeDefined();
    });

    it("should accept converter with minimal return", () => {
      const mockConverter: PromQLChartConverter = {
        convert: () => ({
          series: [],
        }),
        supportedTypes: ["gauge"],
      };

      const result = mockConverter.convert([], {}, {}, {});
      expect(result.series).toEqual([]);
      expect(result.xAxis).toBeUndefined();
    });
  });

  describe("ConversionContext", () => {
    it("should accept fully populated conversion context", () => {
      const context: ConversionContext = {
        panelSchema: { type: "line" },
        store: { state: {} },
        chartPanelRef: { current: null },
        hoveredSeriesState: { index: -1 },
        annotations: [],
        metadata: { title: "Test Chart" },
      };

      expect(context.panelSchema.type).toBe("line");
      expect(context.metadata?.title).toBe("Test Chart");
    });

    it("should accept context without optional metadata", () => {
      const context: ConversionContext = {
        panelSchema: {},
        store: {},
        chartPanelRef: null,
        hoveredSeriesState: null,
        annotations: null,
      };

      expect(context.metadata).toBeUndefined();
    });
  });

  describe("AggregationFunction", () => {
    it("should accept all valid aggregation function types", () => {
      const functions: AggregationFunction[] = [
        "last",
        "first",
        "min",
        "max",
        "avg",
        "sum",
        "count",
        "range",
        "diff",
      ];

      functions.forEach((func) => {
        const agg: AggregationFunction = func;
        expect(agg).toBe(func);
      });
    });

    it("should use aggregation function in context", () => {
      const processWithAggregation = (agg: AggregationFunction) => {
        return `Processing with ${agg}`;
      };

      expect(processWithAggregation("last")).toBe("Processing with last");
      expect(processWithAggregation("avg")).toBe("Processing with avg");
      expect(processWithAggregation("sum")).toBe("Processing with sum");
    });
  });

  describe("TableColumnConfig", () => {
    it("should accept column config with all properties", () => {
      const column: TableColumnConfig = {
        name: "timestamp",
        field: "timestamp",
        label: "Timestamp",
        align: "left",
        sortable: true,
        format: (val) => new Date(val).toISOString(),
        type: "timestamp",
      };

      expect(column.name).toBe("timestamp");
      expect(column.align).toBe("left");
      expect(column.sortable).toBe(true);
      expect(column.type).toBe("timestamp");
      expect(column.format?.(1609459200000)).toContain("2021");
    });

    it("should accept column config without optional properties", () => {
      const column: TableColumnConfig = {
        name: "value",
        field: "value",
        label: "Value",
        align: "right",
        sortable: false,
      };

      expect(column.format).toBeUndefined();
      expect(column.type).toBeUndefined();
    });

    it("should accept all alignment options", () => {
      const leftAlign: TableColumnConfig = {
        name: "left",
        field: "left",
        label: "Left",
        align: "left",
        sortable: true,
      };
      const centerAlign: TableColumnConfig = {
        name: "center",
        field: "center",
        label: "Center",
        align: "center",
        sortable: true,
      };
      const rightAlign: TableColumnConfig = {
        name: "right",
        field: "right",
        label: "Right",
        align: "right",
        sortable: true,
      };

      expect(leftAlign.align).toBe("left");
      expect(centerAlign.align).toBe("center");
      expect(rightAlign.align).toBe("right");
    });

    it("should accept all column types", () => {
      const types: Array<TableColumnConfig["type"]> = [
        "string",
        "number",
        "timestamp",
        "duration",
        "bytes",
        "boolean",
        "link",
        "json",
      ];

      types.forEach((type) => {
        const column: TableColumnConfig = {
          name: "test",
          field: "test",
          label: "Test",
          align: "left",
          sortable: false,
          type: type,
        };
        expect(column.type).toBe(type);
      });
    });
  });

  describe("GeoMapConfig", () => {
    it("should accept geomap config with all labels", () => {
      const config: GeoMapConfig = {
        lat_label: "latitude",
        lon_label: "longitude",
        weight_label: "count",
        name_label: "location",
      };

      expect(config.lat_label).toBe("latitude");
      expect(config.lon_label).toBe("longitude");
      expect(config.weight_label).toBe("count");
      expect(config.name_label).toBe("location");
    });

    it("should accept geomap config with partial labels", () => {
      const config: GeoMapConfig = {
        lat_label: "lat",
      };

      expect(config.lat_label).toBe("lat");
      expect(config.lon_label).toBeUndefined();
    });

    it("should accept empty geomap config", () => {
      const config: GeoMapConfig = {};

      expect(config.lat_label).toBeUndefined();
      expect(config.lon_label).toBeUndefined();
      expect(config.weight_label).toBeUndefined();
      expect(config.name_label).toBeUndefined();
    });
  });

  describe("MapsConfig", () => {
    it("should accept maps config with all properties", () => {
      const config: MapsConfig = {
        name_label: "country",
        map_type: { type: "world" },
        enable_roam: true,
        aggregation: "sum",
        emphasis_area_color: "#ff0000",
        select_area_color: "#00ff00",
      };

      expect(config.name_label).toBe("country");
      expect(config.map_type?.type).toBe("world");
      expect(config.enable_roam).toBe(true);
      expect(config.aggregation).toBe("sum");
      expect(config.emphasis_area_color).toBe("#ff0000");
      expect(config.select_area_color).toBe("#00ff00");
    });

    it("should accept maps config with minimal properties", () => {
      const config: MapsConfig = {
        name_label: "region",
      };

      expect(config.name_label).toBe("region");
      expect(config.map_type).toBeUndefined();
      expect(config.enable_roam).toBeUndefined();
    });

    it("should accept empty maps config", () => {
      const config: MapsConfig = {};

      expect(Object.keys(config)).toHaveLength(0);
    });

    it("should accept different map types", () => {
      const worldMap: MapsConfig = {
        map_type: { type: "world" },
      };
      const usaMap: MapsConfig = {
        map_type: { type: "usa" },
      };

      expect(worldMap.map_type?.type).toBe("world");
      expect(usaMap.map_type?.type).toBe("usa");
    });
  });

  describe("Type Integration", () => {
    it("should work together in a complete flow", () => {
      const response: PromQLResponse = {
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            {
              metric: { job: "prometheus" },
              values: [[1609459200, "100"]],
            },
          ],
        },
      };

      const processed: ProcessedPromQLData = {
        timestamps: [[1609459200, new Date(1609459200 * 1000)]],
        series: [
          {
            name: "prometheus",
            metric: { job: "prometheus" },
            values: [[1609459200, "100"]],
            data: { 1609459200: "100" },
          },
        ],
        queryIndex: 0,
        queryConfig: { query: "up" },
      };

      const converter: PromQLChartConverter = {
        convert: (data) => ({
          series: data.map((d) => ({
            type: "line",
            data: d.series[0].values,
          })),
        }),
        supportedTypes: ["line"],
      };

      expect(response.status).toBe("success");
      expect(processed.series).toHaveLength(1);
      expect(converter.supportedTypes).toContain("line");
    });
  });
});
