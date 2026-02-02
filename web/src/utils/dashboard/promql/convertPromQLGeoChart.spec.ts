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
import { GeoConverter } from "./convertPromQLGeoChart";
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
    return 0;
  }),
}));

describe("GeoConverter", () => {
  let converter: GeoConverter;
  let mockStore: any;
  let mockExtras: any;

  beforeEach(() => {
    converter = new GeoConverter();
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
    it("should support geomap chart type", () => {
      expect(converter.supportedTypes).toEqual(["geomap"]);
    });
  });

  describe("convert", () => {
    it("should convert basic geo data with default labels", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
                weight: "100",
              },
              name: "San Francisco",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series).toBeDefined();
      expect(result.series[0].type).toBe("scatter");
      expect(result.series[0].coordinateSystem).toBe("lmap");
      expect(result.series[0].data).toEqual([[-122.4194, 37.7749, 100]]);
    });

    it("should use custom lat/lon label names from config", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                custom_lat: "40.7128",
                custom_lon: "-74.0060",
              },
              name: "New York",
              data: [],
              values: [[1234567890, "50"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {
          lat_label: "custom_lat",
          lon_label: "custom_lon",
          aggregation: "last",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toEqual([[-74.006, 40.7128, 50]]);
    });

    it("should use weight from metric label if available", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "51.5074",
                longitude: "-0.1278",
                weight: "200",
              },
              name: "London",
              data: [],
              values: [[1234567890, "100"]],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {
          weight_label: "weight",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data[0][2]).toBe(200);
    });

    it("should aggregate values when weight not in metric label", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "48.8566",
                longitude: "2.3522",
              },
              name: "Paris",
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
        type: "geomap",
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

      expect(result.series[0].data[0][2]).toBe(30);
    });

    it("should use fixed weight when values are empty", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "35.6762",
                longitude: "139.6503",
              },
              name: "Tokyo",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {
          weight_fixed: 50,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data[0][2]).toBe(50);
    });

    it("should use default weight of 1 when no weight configuration", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "55.7558",
                longitude: "37.6173",
              },
              name: "Moscow",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data[0][2]).toBe(1);
    });

    it("should return error when series missing latitude", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                longitude: "-122.4194",
              },
              name: "Missing Lat",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.error).toBe(true);
      expect(result.message).toContain("No valid geo data found");
      expect(result.series).toEqual([]);
    });

    it("should return error when series missing longitude", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
              },
              name: "Missing Lon",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.error).toBe(true);
      expect(result.message).toContain("No valid geo data found");
    });

    it("should skip series with missing coordinates and continue processing valid ones", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
              },
              name: "Invalid",
              data: [],
              values: [],
            },
            {
              metric: {
                latitude: "40.7128",
                longitude: "-74.0060",
              },
              name: "Valid",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
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
      expect(result.series[0].data[0]).toEqual([-74.006, 40.7128, 1]);
      expect(consoleSpy).toHaveBeenCalledWith(
        "GeoMap conversion warnings:",
        expect.arrayContaining([
          expect.stringContaining("missing geo coordinates"),
        ]),
      );

      consoleSpy.mockRestore();
    });

    it("should configure map view from config", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "SF",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {
          map_view: {
            lat: 37.7749,
            lng: -122.4194,
            zoom: 10,
          },
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.lmap.center).toEqual([-122.4194, 37.7749]);
      expect(result.lmap.zoom).toBe(10);
    });

    it("should use default map view when not configured", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "SF",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.lmap.center).toEqual([0, 0]);
      expect(result.lmap.zoom).toBe(2);
    });

    it("should configure lmap properties correctly", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "SF",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.lmap.roam).toBe(true);
      expect(result.lmap.resizeEnable).toBe(true);
      expect(result.lmap.renderOnMoving).toBe(true);
      expect(result.lmap.echartsLayerInteractive).toBe(true);
      expect(result.lmap.largeMode).toBe(false);
    });

    it("should configure visualMap with calculated min/max", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
                weight: "10",
              },
              name: "City1",
              data: [],
              values: [],
            },
            {
              metric: {
                latitude: "40.7128",
                longitude: "-74.0060",
                weight: "100",
              },
              name: "City2",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.visualMap.min).toBe(10);
      expect(result.visualMap.max).toBe(100);
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
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "City",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
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

    it("should configure tooltip", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "City",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
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
      expect(result.tooltip.textStyle.fontSize).toBe(10);
      expect(result.tooltip.padding).toBe(6);
      expect(result.tooltip.backgroundColor).toBe("rgba(255,255,255,0.8)");
    });

    it("should format tooltip correctly", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "City",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const formattedTooltip = result.tooltip.formatter({
        value: [0, 0, 42],
      });

      expect(formattedTooltip).toBe("Layer 1: 42");
    });

    it("should configure toolbox", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "City",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
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

    it("should configure legend", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "City",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.legend.show).toBe(true);
      expect(result.legend.type).toBe("scroll");
      expect(result.legend.orient).toBe("vertical");
      expect(result.legend.left).toBe("left");
      expect(result.legend.top).toBe("bottom");
      expect(result.legend.padding).toEqual([10, 20, 10, 10]);
    });

    it("should use scatter layer type by default", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "City",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].type).toBe("scatter");
    });

    it("should use custom layer type from config", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "City",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {
          layer_type: "heatmap",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].type).toBe("heatmap");
    });

    it("should calculate symbolSize by value", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
                weight: "50",
              },
              name: "City1",
              data: [],
              values: [],
            },
            {
              metric: {
                latitude: "40.7128",
                longitude: "-74.0060",
                weight: "100",
              },
              name: "City2",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {
          map_symbol_style: {
            size: "by Value",
            size_by_value: {
              min: 10,
              max: 50,
            },
          },
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const symbolSize1 = result.series[0].symbolSize([-122.4194, 37.7749, 50]);
      const symbolSize2 = result.series[0].symbolSize([-74.006, 40.7128, 100]);

      expect(symbolSize1).toBe(10);
      expect(symbolSize2).toBe(50);
    });

    it("should use default min/max symbolSize when not configured", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
                weight: "10",
              },
              name: "City1",
              data: [],
              values: [],
            },
            {
              metric: {
                latitude: "40.7128",
                longitude: "-74.0060",
                weight: "100",
              },
              name: "City2",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {
          map_symbol_style: {
            size: "by Value",
          },
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const symbolSizeMin = result.series[0].symbolSize([
        -122.4194, 37.7749, 10,
      ]);
      const symbolSizeMax = result.series[0].symbolSize([
        -74.006, 40.7128, 100,
      ]);

      expect(symbolSizeMin).toBe(1);
      expect(symbolSizeMax).toBe(100);
    });

    it("should use fixed symbolSize when configured", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "City",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {
          map_symbol_style: {
            size: "fixed",
            size_fixed: 25,
          },
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const symbolSize = result.series[0].symbolSize([-122.4194, 37.7749, 100]);

      expect(symbolSize).toBe(25);
    });

    it("should use default fixed symbolSize of 2 when not configured", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "City",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {
          map_symbol_style: {
            size: "fixed",
          },
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const symbolSize = result.series[0].symbolSize([-122.4194, 37.7749, 100]);

      expect(symbolSize).toBe(2);
    });

    it("should configure series item style", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "City",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].itemStyle.color).toBe("#b02a02");
    });

    it("should configure series encode", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "City",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].encode.value).toBe(2);
    });

    it("should configure series emphasis", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "City",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
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

    it("should handle multiple queries", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "Query1-City1",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
        {
          series: [
            {
              metric: {
                latitude: "40.7128",
                longitude: "-74.0060",
              },
              name: "Query2-City2",
              data: [],
              values: [],
            },
          ],
          timestamps: [],
        },
      ];

      const panelSchema = {
        type: "geomap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toHaveLength(2);
    });

    it("should use aggregation for weight calculation", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              metric: {
                latitude: "37.7749",
                longitude: "-122.4194",
              },
              name: "City",
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
        type: "geomap",
        config: {
          aggregation: "max",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data[0][2]).toBe(30);
    });
  });
});
