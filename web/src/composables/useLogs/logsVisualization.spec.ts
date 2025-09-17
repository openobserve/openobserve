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
  decodeVisualizationConfig 
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