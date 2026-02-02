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
import { MapsConverter } from "./convertPromQLMapsChart";
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

vi.mock("../countryMappings", () => ({
  getCountryName: vi.fn((code: string) => {
    const countryMap: Record<string, string> = {
      US: "United States",
      UK: "United Kingdom",
      CA: "Canada",
      JP: "Japan",
      CN: "China",
      DE: "Germany",
      FR: "France",
    };
    return countryMap[code] || code;
  }),
}));

describe("MapsConverter", () => {
  let converter: MapsConverter;
  let mockStore: any;
  let mockExtras: any;

  beforeEach(() => {
    converter = new MapsConverter();
    mockStore = {
      state: {
        theme: "light",
      },
    };
    mockExtras = {
      legends: [],
    };
  });

  describe("supportedTypes", () => {
    it("should support maps chart type", () => {
      expect(converter.supportedTypes).toEqual(["maps"]);
    });
  });

  describe("convert", () => {
    it("should convert basic map data with default label", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "United States",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series).toBeDefined();
      expect(result.series[0].type).toBe("map");
      expect(result.series[0].data).toEqual([
        { name: "United States", value: 100 },
      ]);
    });

    it("should use custom name label from config", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                country_code: "UK",
              },
              name: "UK Series",
              data: [],
              values: [[1234567890, "50"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {
          name_label: "country_code",
          aggregation: "last",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toEqual([
        { name: "United Kingdom", value: 50 },
      ]);
    });

    it("should use series name when metric label is missing", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {},
              name: "CA",
              data: [],
              values: [[1234567890, "75"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toEqual([{ name: "Canada", value: 75 }]);
    });

    it("should aggregate values from multiple series with same location", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "Series1",
              data: [],
              values: [[1234567890, "100"]],
            },
            {
              metric: {
                name: "US",
              },
              name: "Series2",
              data: [],
              values: [[1234567890, "50"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toEqual([
        { name: "United States", value: 150 },
      ]);
    });

    it("should apply aggregation to series values", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "JP",
              },
              name: "Japan",
              data: [],
              values: [
                [1234567890, "10"],
                [1234567900, "20"],
                [1234567910, "30"],
              ],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {
          aggregation: "last",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toEqual([{ name: "Japan", value: 30 }]);
    });

    it("should use default aggregation 'last' when not configured", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "CN",
              },
              name: "China",
              data: [],
              values: [
                [1234567890, "10"],
                [1234567900, "20"],
              ],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toEqual([{ name: "China", value: 20 }]);
    });

    it("should return error when series missing location name", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {},
              name: "",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.error).toBe(true);
      expect(result.message).toContain("No valid map data found");
      expect(result.series).toEqual([]);
    });

    it("should skip series with missing location and continue processing valid ones", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {},
              name: "",
              data: [],
              values: [[1234567890, "100"]],
            },
            {
              metric: {
                name: "US",
              },
              name: "Valid",
              data: [],
              values: [[1234567890, "50"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toHaveLength(1);
      expect(result.series[0].data[0]).toEqual({
        name: "United States",
        value: 50,
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        "Maps conversion warnings:",
        expect.arrayContaining([
          expect.stringContaining("missing location name"),
        ]),
      );

      consoleSpy.mockRestore();
    });

    it("should map country codes to full names", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US Series",
              data: [],
              values: [[1234567890, "100"]],
            },
            {
              metric: {
                name: "UK",
              },
              name: "UK Series",
              data: [],
              values: [[1234567890, "50"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toEqual([
        { name: "United States", value: 100 },
        { name: "United Kingdom", value: 50 },
      ]);
    });

    it("should add location names to legends", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "United States",
              data: [],
              values: [[1234567890, "100"]],
            },
            {
              metric: {
                name: "CA",
              },
              name: "Canada",
              data: [],
              values: [[1234567890, "50"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(mockExtras.legends).toContain("United States");
      expect(mockExtras.legends).toContain("Canada");
    });

    it("should use world map by default", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].map).toBe("world");
    });

    it("should use custom map type from config", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {
          map_type: {
            type: "USA",
          },
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].map).toBe("USA");
    });

    it("should enable roam by default", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].roam).toBe(true);
    });

    it("should disable roam when configured", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {
          enable_roam: false,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].roam).toBe(false);
    });

    it("should configure series emphasis", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].emphasis.label.show).toBe(true);
    });

    it("should configure tooltip", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.tooltip.trigger).toBe("item");
      expect(result.tooltip.showDelay).toBe(0);
      expect(result.tooltip.transitionDuration).toBe(0.2);
      expect(result.tooltip.backgroundColor).toBe("rgba(255,255,255,0.8)");
    });

    it("should format tooltip with valid value", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const formatted = result.tooltip.formatter({
        name: "United States",
        value: 100,
      });

      expect(formatted).toBe("United States: 100");
    });

    it("should format tooltip with dash for invalid value", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const formatted = result.tooltip.formatter({
        name: "United States",
        value: "-",
      });

      expect(formatted).toBe("United States: -");
    });

    it("should format tooltip with dash for NaN value", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const formatted = result.tooltip.formatter({
        name: "United States",
        value: NaN,
      });

      expect(formatted).toBe("United States: -");
    });

    it("should configure toolbox", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.toolbox.show).toBe(true);
      expect(result.toolbox.left).toBe("left");
      expect(result.toolbox.top).toBe("top");
    });

    it("should configure empty xAxis and yAxis", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.xAxis).toEqual([]);
      expect(result.yAxis).toEqual([]);
    });

    it("should calculate visualMap min/max from multiple values", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
            {
              metric: {
                name: "CA",
              },
              name: "CA",
              data: [],
              values: [[1234567890, "50"]],
            },
            {
              metric: {
                name: "UK",
              },
              name: "UK",
              data: [],
              values: [[1234567890, "75"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.visualMap.min).toBe(50);
      expect(result.visualMap.max).toBe(100);
    });

    it("should use 0 as min when only one value", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.visualMap.min).toBe(0);
      expect(result.visualMap.max).toBe(100);
    });

    it("should configure visualMap properties", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.visualMap.left).toBe("right");
      expect(result.visualMap.calculable).toBe(true);
      expect(result.visualMap.text).toEqual(["High", "Low"]);
    });

    it("should configure visualMap color range", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.visualMap.inRange.color).toEqual([
        "#313695",
        "#4575b4",
        "#74add1",
        "#abd9e9",
        "#e0f3f8",
        "#ffffbf",
        "#fee090",
        "#fdae61",
        "#f46d43",
        "#d73027",
        "#a50026",
      ]);
    });

    it("should handle multiple queries", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "Query1-US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
        {
          series: [
            {
              metric: {
                name: "CA",
              },
              name: "Query2-CA",
              data: [],
              values: [[1234567890, "50"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toEqual([
        { name: "United States", value: 100 },
        { name: "Canada", value: 50 },
      ]);
    });

    it("should filter out NaN values when calculating min/max", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                name: "US",
              },
              name: "US",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "maps",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data[0].value).toBe(100);
      expect(result.visualMap.min).toBe(0);
      expect(result.visualMap.max).toBe(100);
    });
  });
});
