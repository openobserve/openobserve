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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { convertPanelData } from "./convertPanelData";

vi.mock("./convertPromQLData", () => ({
  convertPromQLData: vi.fn().mockResolvedValue({ series: [], xAxis: [] })
}));

vi.mock("./convertSQLData", () => ({
  convertMultiSQLData: vi.fn().mockResolvedValue({ series: [], xAxis: [] }),
  convertSQLData: vi.fn().mockResolvedValue({ series: [], xAxis: [] })
}));

vi.mock("./convertTableData", () => ({
  convertTableData: vi.fn().mockReturnValue({ columns: [], rows: [] })
}));

vi.mock("./convertGeoMapData", () => ({
  convertGeoMapData: vi.fn().mockReturnValue({ geoData: [] })
}));

vi.mock("./convertMapsData", () => ({
  convertMapsData: vi.fn().mockReturnValue({ mapData: [] })
}));

vi.mock("./convertSankeyData", () => ({
  convertSankeyData: vi.fn().mockReturnValue({ nodes: [], links: [] })
}));

vi.mock("./convertCustomChartData", () => ({
  runJavaScriptCode: vi.fn().mockResolvedValue({ customData: [] })
}));

describe("convertPanelData", () => {
  const mockStore = {
    state: { selectedOrganization: { identifier: "test-org" } }
  };
  const mockChartPanelRef = { value: { getBoundingClientRect: () => ({ width: 800, height: 400 }) } };
  const mockHoveredSeriesState = { value: null };
  const mockResultMetaData = {};
  const mockMetadata = {};
  const mockChartPanelStyle = {};
  const mockAnnotations = [];
  const mockData = [[{ field: "test", value: 100 }]];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Chart Types", () => {
    const chartTypes = [
      "area", "area-stacked", "bar", "h-bar", "stacked", 
      "heatmap", "h-stacked", "line", "pie", "donut", 
      "scatter", "metric", "gauge"
    ];

    chartTypes.forEach(type => {
      it(`should handle ${type} chart type with SQL query`, async () => {
        const panelSchema = {
          type,
          queryType: "sql",
          queries: [{ query: "SELECT * FROM test" }]
        };

        const result = await convertPanelData(
          panelSchema,
          mockData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.chartType).toBe(type);
        expect(result).toHaveProperty('series');
        expect(result).toHaveProperty('xAxis');
      });

      it(`should handle ${type} chart type with PromQL query`, async () => {
        const panelSchema = {
          type,
          queryType: "promql",
          queries: [{ query: "up" }]
        };

        const { convertPromQLData } = await import("./convertPromQLData");
        const result = await convertPanelData(
          panelSchema,
          mockData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(convertPromQLData).toHaveBeenCalledWith(
          panelSchema,
          mockData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockAnnotations
        );
        expect(result.chartType).toBe(type);
      });
    });
  });

  describe("Table Type", () => {
    it("should handle table chart type", async () => {
      const panelSchema = {
        type: "table",
        queries: [{ query: "SELECT * FROM test" }]
      };

      const { convertTableData } = await import("./convertTableData");
      const result = await convertPanelData(
        panelSchema,
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(convertTableData).toHaveBeenCalledWith(panelSchema, mockData, mockStore);
      expect(result.chartType).toBe("table");
      expect(result).toHaveProperty('columns');
      expect(result).toHaveProperty('rows');
    });
  });

  describe("GeoMap Type", () => {
    it("should handle geomap chart type", async () => {
      const panelSchema = {
        type: "geomap",
        queries: [{ query: "SELECT lat, lon FROM locations" }]
      };

      const { convertGeoMapData } = await import("./convertGeoMapData");
      const result = await convertPanelData(
        panelSchema,
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(convertGeoMapData).toHaveBeenCalledWith(panelSchema, mockData);
      expect(result.chartType).toBe("geomap");
      expect(result).toHaveProperty('geoData');
    });
  });

  describe("Maps Type", () => {
    it("should handle maps chart type", async () => {
      const panelSchema = {
        type: "maps",
        queries: [{ query: "SELECT region, value FROM data" }]
      };

      const { convertMapsData } = await import("./convertMapsData");
      const result = await convertPanelData(
        panelSchema,
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(convertMapsData).toHaveBeenCalledWith(panelSchema, mockData);
      expect(result.chartType).toBe("maps");
      expect(result).toHaveProperty('mapData');
    });
  });

  describe("Sankey Type", () => {
    it("should handle sankey chart type", async () => {
      const panelSchema = {
        type: "sankey",
        queries: [{ query: "SELECT source, target, value FROM flows" }]
      };

      const { convertSankeyData } = await import("./convertSankeyData");
      const result = await convertPanelData(
        panelSchema,
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(convertSankeyData).toHaveBeenCalledWith(panelSchema, mockData);
      expect(result.chartType).toBe("sankey");
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('links');
    });
  });

  describe("Custom Chart Type", () => {
    it("should handle custom chart type with data", async () => {
      const panelSchema = {
        type: "custom_chart",
        queries: [{ query: "SELECT * FROM test" }]
      };

      const { runJavaScriptCode } = await import("./convertCustomChartData");
      const result = await convertPanelData(
        panelSchema,
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(runJavaScriptCode).toHaveBeenCalledWith(panelSchema, mockData);
      expect(result.chartType).toBe("custom_chart");
      expect(result).toHaveProperty('customData');
    });

    it("should handle custom chart type with no data", async () => {
      const panelSchema = {
        type: "custom_chart",
        queries: [{ query: "" }]
      };
      const emptyData = [];

      await expect(
        convertPanelData(
          panelSchema,
          emptyData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        )
      ).rejects.toThrow("No data found");
    });

    it("should handle custom chart type with invalid JavaScript result", async () => {
      const panelSchema = {
        type: "custom_chart",
        queries: [{ query: "SELECT * FROM test" }]
      };

      const { runJavaScriptCode } = await import("./convertCustomChartData");
      vi.mocked(runJavaScriptCode).mockResolvedValueOnce(null);

      const result = await convertPanelData(
        panelSchema,
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result.chartType).toBe("custom_chart");
      expect(result).toEqual({ chartType: "custom_chart" });
    });
  });

  describe("Default Case", () => {
    it("should return empty object for unknown chart type", async () => {
      const panelSchema = {
        type: "unknown_type",
        queries: [{ query: "SELECT * FROM test" }]
      };

      const result = await convertPanelData(
        panelSchema,
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result).toEqual({});
    });
  });

  describe("Error Handling", () => {
    it("should handle SQL conversion errors gracefully", async () => {
      const panelSchema = {
        type: "bar",
        queryType: "sql",
        queries: [{ query: "INVALID SQL" }]
      };

      const { convertMultiSQLData } = await import("./convertSQLData");
      vi.mocked(convertMultiSQLData).mockRejectedValueOnce(new Error("SQL Error"));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await convertPanelData(
        panelSchema,
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(consoleSpy).toHaveBeenCalled();
      expect(result).toEqual({});
      
      consoleSpy.mockRestore();
    });

    it("should handle missing panel schema", async () => {
      const result = await convertPanelData(
        { type: 'unknown' },
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result).toEqual({});
    });

    it("should handle loading state", async () => {
      const panelSchema = {
        type: "line",
        queryType: "sql",
        queries: [{ query: "SELECT * FROM test" }]
      };

      const result = await convertPanelData(
        panelSchema,
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations,
        true
      );

      expect(result.chartType).toBe("line");
    });
  });

  describe("Integration Tests", () => {
    it("should properly pass all parameters to conversion functions", async () => {
      const panelSchema = {
        type: "area",
        queryType: "sql",
        queries: [{ query: "SELECT time, value FROM metrics" }]
      };

      const { convertMultiSQLData } = await import("./convertSQLData");

      await convertPanelData(
        panelSchema,
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(convertMultiSQLData).toHaveBeenCalledWith(
        panelSchema,
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );
    });

    it("should handle different query types correctly", async () => {
      const sqlPanelSchema = {
        type: "line",
        queryType: "sql",
        queries: [{ query: "SELECT * FROM test" }]
      };

      const promqlPanelSchema = {
        type: "line",
        queryType: "promql",
        queries: [{ query: "up" }]
      };

      const { convertMultiSQLData } = await import("./convertSQLData");
      const { convertPromQLData } = await import("./convertPromQLData");

      await convertPanelData(
        sqlPanelSchema,
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      await convertPanelData(
        promqlPanelSchema,
        mockData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(convertMultiSQLData).toHaveBeenCalled();
      expect(convertPromQLData).toHaveBeenCalled();
    });
  });
});
