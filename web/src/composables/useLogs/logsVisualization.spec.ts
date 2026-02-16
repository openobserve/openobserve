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

import { describe, expect, it } from "vitest";
import {
  getVisualizationConfig,
  encodeVisualizationConfig,
  decodeVisualizationConfig,
  getBuildConfig,
  encodeBuildConfig,
  decodeBuildConfig,
} from "./logsVisualization";

describe('logsVisualization Functions', () => {
  
  describe("getVisualizationConfig", () => {
    it("should extract visualization config from dashboard panel data", () => {
      const dashboardPanelData = {
        data: {
          config: {
            decimals: 2,
          },
          type: "table"
        }
      };

      const config = getVisualizationConfig(dashboardPanelData);
      
      expect(config).toEqual({
        config: {
          decimals: 2,
        },
        type: "table"
      });
    });

    it("should handle empty dashboard panel data", () => {
      const dashboardPanelData = {};
      const config = getVisualizationConfig(dashboardPanelData);
      
      expect(config).toBeNull();
    });

    it("should handle null dashboard panel data", () => {
      const config = getVisualizationConfig(null);
      
      expect(config).toBeNull();
    });
  });

  describe("encodeVisualizationConfig", () => {
    it("should encode configuration object to base64", () => {
      const config = {
        chart_type: "bar",
        title: "Test Chart"
      };

      const encoded = encodeVisualizationConfig(config);
      
      expect(encoded).toBeTruthy();
      expect(typeof encoded).toBe('string');
    });

    it("should handle empty configuration", () => {
      const encoded = encodeVisualizationConfig({});
      
      expect(encoded).toBeTruthy();
      expect(typeof encoded).toBe('string');
    });

    it("should handle null configuration", () => {
      const encoded = encodeVisualizationConfig(null);
      
      expect(encoded).toBeTruthy();
      expect(typeof encoded).toBe('string');
    });

    it("should handle encoding errors gracefully", () => {
      // Create circular reference that would cause JSON.stringify to fail
      const circularConfig: any = {};
      circularConfig.self = circularConfig;

      const encoded = encodeVisualizationConfig(circularConfig);
      
      expect(encoded).toBeNull();
    });
  });

  describe("decodeVisualizationConfig", () => {
    it("should decode base64 string to configuration object", () => {
      const originalConfig = {
        chart_type: "pie",
        colors: ["red", "blue", "green"]
      };
      
      const encoded = encodeVisualizationConfig(originalConfig);
      const decoded = decodeVisualizationConfig(encoded!);
      
      expect(decoded).toEqual(originalConfig);
    });

    it("should handle invalid base64 string", () => {
      const result = decodeVisualizationConfig("invalid-base64");
      
      // Should handle the error gracefully, returns empty object as fallback
      expect(result).toEqual({});
    });

    it("should handle empty string", () => {
      const result = decodeVisualizationConfig("");
      
      expect(result).toBeNull();
    });

    it("should handle null input", () => {
      const result = decodeVisualizationConfig(null as any);

      // Returns empty object as fallback for null input
      expect(result).toEqual({});
    });
  });
});

describe("Build Configuration Functions", () => {
  describe("getBuildConfig", () => {
    it("should extract build config from dashboard panel data", () => {
      const dashboardPanelData = {
        data: {
          config: { showLegend: true },
          type: "bar",
          queries: [
            {
              fields: {
                stream: "test_stream",
                stream_type: "logs",
                x: [{ column: "timestamp" }],
                y: [{ column: "count" }],
                breakdown: [],
                filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
              },
              customQuery: false,
              query: "",
            },
          ],
        },
      };

      const config = getBuildConfig(dashboardPanelData);

      expect(config).toEqual({
        config: { showLegend: true },
        type: "bar",
        fields: {
          stream: "test_stream",
          stream_type: "logs",
          x: [{ column: "timestamp" }],
          y: [{ column: "count" }],
          breakdown: [],
          filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
        },
        joins: [],
        customQuery: false,
        query: "",
      });
    });

    it("should handle empty dashboard panel data", () => {
      const dashboardPanelData = {};
      const config = getBuildConfig(dashboardPanelData);

      expect(config).toBeNull();
    });

    it("should handle null dashboard panel data", () => {
      const config = getBuildConfig(null);

      expect(config).toBeNull();
    });

    it("should handle missing queries", () => {
      const dashboardPanelData = {
        data: {
          config: {},
          type: "line",
          queries: [],
        },
      };

      const config = getBuildConfig(dashboardPanelData);

      expect(config).toBeNull();
    });
  });

  describe("encodeBuildConfig", () => {
    it("should encode build configuration object to base64", () => {
      const config = {
        type: "metric",
        fields: { stream: "logs" },
      };

      const encoded = encodeBuildConfig(config);

      expect(encoded).toBeTruthy();
      expect(typeof encoded).toBe("string");
    });

    it("should handle empty configuration", () => {
      const encoded = encodeBuildConfig({});

      expect(encoded).toBeTruthy();
      expect(typeof encoded).toBe("string");
    });
  });

  describe("decodeBuildConfig", () => {
    it("should decode base64 string to build configuration object", () => {
      const originalConfig = {
        type: "bar",
        fields: {
          stream: "test",
          x: [],
          y: [{ column: "count" }],
        },
      };

      const encoded = encodeBuildConfig(originalConfig);
      const decoded = decodeBuildConfig(encoded!);

      expect(decoded).toEqual(originalConfig);
    });

    it("should handle invalid base64 string", () => {
      const result = decodeBuildConfig("invalid-base64");

      // Should handle the error gracefully, returns empty object as fallback
      expect(result).toEqual({});
    });

    it("should handle empty string", () => {
      const result = decodeBuildConfig("");

      expect(result).toBeNull();
    });
  });
});