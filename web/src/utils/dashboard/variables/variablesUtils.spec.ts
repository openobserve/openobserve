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
  formatInterval, 
  getTimeInSecondsBasedOnUnit, 
  formatRateInterval, 
  processVariableContent 
} from "./variablesUtils";

describe("Variables Utils", () => {
  describe("formatInterval", () => {
    it("should return milliseconds for very small intervals", () => {
      expect(formatInterval(5)).toEqual({ value: 1, unit: "ms" });
      expect(formatInterval(10)).toEqual({ value: 1, unit: "ms" });
    });

    it("should return appropriate millisecond values for small intervals", () => {
      expect(formatInterval(12)).toEqual({ value: 10, unit: "ms" });
      expect(formatInterval(15)).toEqual({ value: 10, unit: "ms" });
      expect(formatInterval(30)).toEqual({ value: 20, unit: "ms" });
      expect(formatInterval(50)).toEqual({ value: 50, unit: "ms" });
      expect(formatInterval(100)).toEqual({ value: 100, unit: "ms" });
    });

    it("should return seconds for medium intervals", () => {
      expect(formatInterval(1000)).toEqual({ value: 1, unit: "s" });
      expect(formatInterval(1500)).toEqual({ value: 1, unit: "s" });
      expect(formatInterval(3000)).toEqual({ value: 2, unit: "s" });
      expect(formatInterval(5000)).toEqual({ value: 5, unit: "s" });
      expect(formatInterval(10000)).toEqual({ value: 10, unit: "s" });
      expect(formatInterval(15000)).toEqual({ value: 15, unit: "s" });
      expect(formatInterval(20000)).toEqual({ value: 20, unit: "s" });
      expect(formatInterval(30000)).toEqual({ value: 30, unit: "s" });
    });

    it("should return minutes for larger intervals", () => {
      expect(formatInterval(60000)).toEqual({ value: 1, unit: "m" });
      expect(formatInterval(90000)).toEqual({ value: 1, unit: "m" });
      expect(formatInterval(120000)).toEqual({ value: 2, unit: "m" });
      expect(formatInterval(300000)).toEqual({ value: 5, unit: "m" });
      expect(formatInterval(600000)).toEqual({ value: 10, unit: "m" });
      expect(formatInterval(900000)).toEqual({ value: 15, unit: "m" });
      expect(formatInterval(1200000)).toEqual({ value: 20, unit: "m" });
      expect(formatInterval(1800000)).toEqual({ value: 30, unit: "m" });
    });

    it("should return hours for very large intervals", () => {
      expect(formatInterval(3600000)).toEqual({ value: 1, unit: "h" });
      expect(formatInterval(7200000)).toEqual({ value: 2, unit: "h" });
      expect(formatInterval(10800000)).toEqual({ value: 3, unit: "h" });
      expect(formatInterval(21600000)).toEqual({ value: 6, unit: "h" });
      expect(formatInterval(43200000)).toEqual({ value: 12, unit: "h" });
      expect(formatInterval(86400000)).toEqual({ value: 12, unit: "h" });
    });

    it("should return days and weeks for massive intervals", () => {
      expect(formatInterval(172800000)).toEqual({ value: 24, unit: "h" });
      expect(formatInterval(604800000)).toEqual({ value: 24, unit: "h" });
      expect(formatInterval(1209600000)).toEqual({ value: 1, unit: "w" });
      expect(formatInterval(2592000000)).toEqual({ value: 30, unit: "d" });
    });

    it("should return years for extremely large intervals", () => {
      expect(formatInterval(31536000000)).toEqual({ value: 1, unit: "y" });
      expect(formatInterval(63072000000)).toEqual({ value: 1, unit: "y" });
    });

    it("should handle edge cases", () => {
      expect(formatInterval(0)).toEqual({ value: 1, unit: "ms" });
      expect(formatInterval(-10)).toEqual({ value: 1, unit: "ms" });
    });
  });

  describe("getTimeInSecondsBasedOnUnit", () => {
    it("should convert milliseconds to seconds", () => {
      expect(getTimeInSecondsBasedOnUnit(1000, "ms")).toBe(1);
      expect(getTimeInSecondsBasedOnUnit(5000, "ms")).toBe(5);
      expect(getTimeInSecondsBasedOnUnit(500, "ms")).toBe(0.5);
    });

    it("should return seconds unchanged", () => {
      expect(getTimeInSecondsBasedOnUnit(60, "s")).toBe(60);
      expect(getTimeInSecondsBasedOnUnit(1, "s")).toBe(1);
      expect(getTimeInSecondsBasedOnUnit(0, "s")).toBe(0);
    });

    it("should convert minutes to seconds", () => {
      expect(getTimeInSecondsBasedOnUnit(1, "m")).toBe(60);
      expect(getTimeInSecondsBasedOnUnit(5, "m")).toBe(300);
      expect(getTimeInSecondsBasedOnUnit(0.5, "m")).toBe(30);
    });

    it("should convert hours to seconds", () => {
      expect(getTimeInSecondsBasedOnUnit(1, "h")).toBe(3600);
      expect(getTimeInSecondsBasedOnUnit(2, "h")).toBe(7200);
      expect(getTimeInSecondsBasedOnUnit(0.5, "h")).toBe(1800);
    });

    it("should convert days to seconds", () => {
      expect(getTimeInSecondsBasedOnUnit(1, "d")).toBe(86400);
      expect(getTimeInSecondsBasedOnUnit(7, "d")).toBe(604800);
      expect(getTimeInSecondsBasedOnUnit(0.5, "d")).toBe(43200);
    });

    it("should convert weeks to seconds", () => {
      expect(getTimeInSecondsBasedOnUnit(1, "w")).toBe(604800);
      expect(getTimeInSecondsBasedOnUnit(2, "w")).toBe(1209600);
      expect(getTimeInSecondsBasedOnUnit(0.5, "w")).toBe(302400);
    });

    it("should convert years to seconds (using approximation)", () => {
      expect(getTimeInSecondsBasedOnUnit(1, "y")).toBe(7257600); // 1 * 60 * 60 * 24 * 7 * 12 (approximate)
      expect(getTimeInSecondsBasedOnUnit(2, "y")).toBe(14515200);
    });

    it("should return original value for unknown units", () => {
      expect(getTimeInSecondsBasedOnUnit(100, "unknown")).toBe(100);
      expect(getTimeInSecondsBasedOnUnit(50, "")).toBe(50);
      expect(getTimeInSecondsBasedOnUnit(25, null)).toBe(25);
    });

    it("should handle edge cases", () => {
      expect(getTimeInSecondsBasedOnUnit(0, "h")).toBe(0);
      expect(getTimeInSecondsBasedOnUnit(-5, "m")).toBe(-300);
    });
  });

  describe("formatRateInterval", () => {
    it("should format intervals with only seconds", () => {
      expect(formatRateInterval(30)).toBe("30s");
      expect(formatRateInterval(45)).toBe("45s");
      expect(formatRateInterval(59)).toBe("59s");
    });

    it("should format intervals with minutes and seconds", () => {
      expect(formatRateInterval(90)).toBe("1m30s");
      expect(formatRateInterval(125)).toBe("2m5s");
      expect(formatRateInterval(3599)).toBe("59m59s");
    });

    it("should format intervals with hours, minutes and seconds", () => {
      expect(formatRateInterval(3661)).toBe("1h1m1s");
      expect(formatRateInterval(7200)).toBe("2h");
      expect(formatRateInterval(7290)).toBe("2h1m30s");
    });

    it("should format intervals with days, hours, minutes and seconds", () => {
      expect(formatRateInterval(86400)).toBe("1d");
      expect(formatRateInterval(90061)).toBe("1d1h1m1s");
      expect(formatRateInterval(172800)).toBe("2d");
      expect(formatRateInterval(176461)).toBe("2d1h1m1s");
    });

    it("should handle zero interval", () => {
      expect(formatRateInterval(0)).toBe("");
    });

    it("should handle intervals with only minutes", () => {
      expect(formatRateInterval(60)).toBe("1m");
      expect(formatRateInterval(120)).toBe("2m");
      expect(formatRateInterval(600)).toBe("10m");
    });

    it("should handle intervals with only hours", () => {
      expect(formatRateInterval(3600)).toBe("1h");
      expect(formatRateInterval(10800)).toBe("3h");
    });

    it("should handle large intervals", () => {
      expect(formatRateInterval(604800)).toBe("7d");
      expect(formatRateInterval(694861)).toBe("8d1h1m1s");
    });
  });

  describe("processVariableContent", () => {
    const mockVariablesData = {
      values: [
        { name: "region", value: "us-east-1" },
        { name: "service", value: ["api", "web", "db"] },
        { name: "env", value: "production" },
        { name: "empty", value: "" },
        { name: "null", value: null },
      ]
    };

    it("should replace simple variable placeholders", () => {
      const content = "SELECT * FROM logs WHERE region = '${region}' AND env = '${env}'";
      const expected = "SELECT * FROM logs WHERE region = 'us-east-1' AND env = 'production'";
      
      expect(processVariableContent(content, mockVariablesData)).toBe(expected);
    });

    it("should replace alternative syntax variable placeholders", () => {
      const content = "SELECT * FROM logs WHERE region = '$region' AND env = '$env'";
      const expected = "SELECT * FROM logs WHERE region = 'us-east-1' AND env = 'production'";
      
      expect(processVariableContent(content, mockVariablesData)).toBe(expected);
    });

    it("should handle array values with default comma separation", () => {
      const content = "SELECT * FROM logs WHERE service IN (${service})";
      const expected = "SELECT * FROM logs WHERE service IN (api,web,db)";
      
      expect(processVariableContent(content, mockVariablesData)).toBe(expected);
    });

    it("should handle array values with CSV formatting", () => {
      const content = "SELECT * FROM logs WHERE service IN (${service:csv})";
      const expected = "SELECT * FROM logs WHERE service IN (api,web,db)";
      
      expect(processVariableContent(content, mockVariablesData)).toBe(expected);
    });

    it("should handle array values with pipe formatting", () => {
      const content = "SELECT * FROM logs WHERE service REGEXP '${service:pipe}'";
      const expected = "SELECT * FROM logs WHERE service REGEXP 'api|web|db'";
      
      expect(processVariableContent(content, mockVariablesData)).toBe(expected);
    });

    it("should handle array values with double quote formatting", () => {
      const content = "SELECT * FROM logs WHERE service IN (${service:doublequote})";
      const expected = 'SELECT * FROM logs WHERE service IN ("api","web","db")';
      
      expect(processVariableContent(content, mockVariablesData)).toBe(expected);
    });

    it("should handle array values with single quote formatting", () => {
      const content = "SELECT * FROM logs WHERE service IN (${service:singlequote})";
      const expected = "SELECT * FROM logs WHERE service IN ('api','web','db')";
      
      expect(processVariableContent(content, mockVariablesData)).toBe(expected);
    });

    it("should handle empty values", () => {
      const content = "SELECT * FROM logs WHERE field = '${empty}'";
      const expected = "SELECT * FROM logs WHERE field = ''";
      
      expect(processVariableContent(content, mockVariablesData)).toBe(expected);
    });

    it("should handle null values", () => {
      const content = "SELECT * FROM logs WHERE field = '${null}'";
      // Null values are replaced with SELECT_ALL_VALUE sentinel
      const expected = "SELECT * FROM logs WHERE field = '_o2_all_'";

      expect(processVariableContent(content, mockVariablesData)).toBe(expected);
    });

    it("should handle multiple occurrences of the same variable", () => {
      const content = "${region}-${region}-${region}";
      const expected = "us-east-1-us-east-1-us-east-1";
      
      expect(processVariableContent(content, mockVariablesData)).toBe(expected);
    });

    it("should handle content with no variables", () => {
      const content = "SELECT * FROM logs WHERE timestamp > '2023-01-01'";
      
      expect(processVariableContent(content, mockVariablesData)).toBe(content);
    });

    it("should handle undefined variables data", () => {
      const content = "SELECT * FROM logs WHERE region = '${region}'";
      
      expect(processVariableContent(content, null)).toBe(content);
      expect(processVariableContent(content, undefined)).toBe(content);
    });

    it("should handle empty variables data", () => {
      const content = "SELECT * FROM logs WHERE region = '${region}'";
      const emptyData = { values: [] };
      
      expect(processVariableContent(content, emptyData)).toBe(content);
    });

    it("should handle variables without names", () => {
      const content = "SELECT * FROM logs WHERE region = '${region}'";
      const invalidData = { 
        values: [
          { value: "us-east-1" }, // missing name
          { name: "", value: "test" }, // empty name
        ]
      };
      
      expect(processVariableContent(content, invalidData)).toBe(content);
    });

    it("should handle complex content with mixed variable types", () => {
      const content = `
        SELECT * FROM logs 
        WHERE region = '\${region}' 
        AND service IN (\${service:singlequote})
        AND env = '\$env'
        AND query REGEXP '\${service:pipe}'
      `;
      
      const expected = `
        SELECT * FROM logs 
        WHERE region = 'us-east-1' 
        AND service IN ('api','web','db')
        AND env = 'production'
        AND query REGEXP 'api|web|db'
      `;
      
      expect(processVariableContent(content, mockVariablesData)).toBe(expected);
    });

    it("should escape special regex characters in placeholders", () => {
      const specialCharContent = "test ${region} test";
      const result = processVariableContent(specialCharContent, mockVariablesData);
      expect(result).toBe("test us-east-1 test");
    });
  });

  describe("Additional Edge Cases and Boundary Tests", () => {
    describe("formatInterval additional tests", () => {
      it("should handle exactly boundary values", () => {
        // Test exact boundary values
        expect(formatInterval(11)).toEqual({ value: 10, unit: "ms" }); // Just over 10
        expect(formatInterval(16)).toEqual({ value: 20, unit: "ms" }); // Just over 15
        expect(formatInterval(151)).toEqual({ value: 200, unit: "ms" }); // Just over 150
        expect(formatInterval(1501)).toEqual({ value: 2, unit: "s" }); // Just over 1500
      });

      it("should handle very large numbers", () => {
        expect(formatInterval(Number.MAX_SAFE_INTEGER)).toEqual({ value: 1, unit: "y" });
        expect(formatInterval(999999999999)).toEqual({ value: 1, unit: "y" });
      });

      it("should handle floating point numbers", () => {
        expect(formatInterval(10.5)).toEqual({ value: 10, unit: "ms" });
        expect(formatInterval(1500.7)).toEqual({ value: 2, unit: "s" });
        expect(formatInterval(3600000.1)).toEqual({ value: 1, unit: "h" });
      });

      it("should handle negative numbers", () => {
        expect(formatInterval(-5)).toEqual({ value: 1, unit: "ms" });
        expect(formatInterval(-100)).toEqual({ value: 1, unit: "ms" });
      });

      it("should handle non-numeric inputs as best as possible", () => {
        expect(formatInterval(null)).toEqual({ value: 1, unit: "ms" }); // null <= 10 is true
        expect(formatInterval(undefined)).toEqual({ value: 1, unit: "y" }); // undefined comparisons fail, goes to default
        expect(formatInterval(NaN)).toEqual({ value: 1, unit: "y" }); // NaN comparisons are all false, goes to default
      });
    });

    describe("getTimeInSecondsBasedOnUnit additional tests", () => {
      it("should handle floating point inputs", () => {
        expect(getTimeInSecondsBasedOnUnit(1.5, "m")).toBe(90);
        expect(getTimeInSecondsBasedOnUnit(2.5, "h")).toBe(9000);
        expect(getTimeInSecondsBasedOnUnit(0.1, "d")).toBe(8640);
      });

      it("should handle very large numbers", () => {
        expect(getTimeInSecondsBasedOnUnit(1000, "y")).toBe(7257600000);
        expect(getTimeInSecondsBasedOnUnit(10000, "d")).toBe(864000000);
      });

      it("should handle case sensitivity in units", () => {
        expect(getTimeInSecondsBasedOnUnit(1, "MS")).toBe(1); // Different case should return original
        expect(getTimeInSecondsBasedOnUnit(1, "S")).toBe(1);
        expect(getTimeInSecondsBasedOnUnit(1, "M")).toBe(1);
      });

      it("should handle null and undefined inputs", () => {
        expect(getTimeInSecondsBasedOnUnit(null, "s")).toBe(null); // null * 1 = null  
        expect(getTimeInSecondsBasedOnUnit(undefined, "s")).toBe(undefined); // undefined * 1 = undefined
        expect(getTimeInSecondsBasedOnUnit(5, null)).toBe(5);
        expect(getTimeInSecondsBasedOnUnit(5, undefined)).toBe(5);
      });
    });

    describe("formatRateInterval additional tests", () => {
      it("should handle very large intervals", () => {
        expect(formatRateInterval(31536000)).toBe("365d"); // 1 year in seconds
        expect(formatRateInterval(2592000)).toBe("30d"); // 30 days
      });

      it("should handle complex combinations", () => {
        expect(formatRateInterval(90061)).toBe("1d1h1m1s"); // 1 day, 1 hour, 1 minute, 1 second
        expect(formatRateInterval(93784)).toBe("1d2h3m4s"); // 1 day, 2 hours, 3 minutes, 4 seconds
      });

      it("should handle floating point inputs", () => {
        expect(formatRateInterval(90.5)).toBe("1m30.5s"); // Floating point seconds are preserved
        expect(formatRateInterval(3661.7)).toBe("1h1m1.699999999999818s"); // Account for floating point precision
      });

      it("should handle negative and edge case inputs", () => {
        expect(formatRateInterval(-1)).toBe("");
        expect(formatRateInterval(null)).toBe("");
        expect(formatRateInterval(undefined)).toBe("");
        expect(formatRateInterval(NaN)).toBe("");
      });
    });

    describe("processVariableContent additional tests", () => {
      const extendedMockData = {
        values: [
          { name: "region", value: "us-east-1" },
          { name: "service", value: ["api", "web", "db", "cache"] },
          { name: "env", value: "production" },
          { name: "numbers", value: [1, 2, 3, 4, 5] },
          { name: "booleans", value: [true, false] },
          { name: "mixed", value: ["string", 123, true] },
          { name: "special_chars", value: "test@#$%^&*()_+" },
          { name: "unicode", value: "测试数据" },
        ]
      };

      it("should handle numeric array values", () => {
        const content = "SELECT * WHERE id IN (${numbers})";
        const expected = "SELECT * WHERE id IN (1,2,3,4,5)";
        expect(processVariableContent(content, extendedMockData)).toBe(expected);
      });

      it("should handle boolean array values", () => {
        const content = "SELECT * WHERE active IN (${booleans:csv})";
        const expected = "SELECT * WHERE active IN (true,false)";
        expect(processVariableContent(content, extendedMockData)).toBe(expected);
      });

      it("should handle mixed type array values", () => {
        const content = "SELECT * WHERE field IN (${mixed})";
        const expected = "SELECT * WHERE field IN (string,123,true)";
        expect(processVariableContent(content, extendedMockData)).toBe(expected);
      });

      it("should handle special characters in variable values", () => {
        const content = "SELECT * WHERE field = '${special_chars}'";
        const expected = "SELECT * WHERE field = 'test@#$%^&*()_+'";
        expect(processVariableContent(content, extendedMockData)).toBe(expected);
      });

      it("should handle unicode characters", () => {
        const content = "SELECT * WHERE field = '${unicode}'";
        const expected = "SELECT * WHERE field = '测试数据'";
        expect(processVariableContent(content, extendedMockData)).toBe(expected);
      });

      it("should handle larger arrays with formatting", () => {
        const content = "SELECT * FROM logs WHERE service IN (${service:doublequote})";
        const expected = 'SELECT * FROM logs WHERE service IN ("api","web","db","cache")';
        expect(processVariableContent(content, extendedMockData)).toBe(expected);
      });

      it("should handle nested variable-like patterns that aren't variables", () => {
        const content = "SELECT * FROM logs WHERE field LIKE '${region}' AND other = '$not_a_variable'";
        const expected = "SELECT * FROM logs WHERE field LIKE 'us-east-1' AND other = '$not_a_variable'";
        expect(processVariableContent(content, extendedMockData)).toBe(expected);
      });

      it("should handle malformed variable patterns", () => {
        const content = "SELECT * FROM logs WHERE field = '${' AND other = '}' AND valid = '${region}'";
        const expected = "SELECT * FROM logs WHERE field = '${' AND other = '}' AND valid = 'us-east-1'";
        expect(processVariableContent(content, extendedMockData)).toBe(expected);
      });

      it("should handle variables in different contexts", () => {
        const content = `
          {
            "query": "\${region}",
            "filters": [
              { "field": "service", "value": "\${service:pipe}" },
              { "field": "env", "operator": "=", "value": "\${env}" }
            ]
          }
        `;
        const expected = `
          {
            "query": "us-east-1",
            "filters": [
              { "field": "service", "value": "api|web|db|cache" },
              { "field": "env", "operator": "=", "value": "production" }
            ]
          }
        `;
        expect(processVariableContent(content, extendedMockData)).toBe(expected);
      });

      it("should handle variables with very long content", () => {
        const longArray = new Array(100).fill(0).map((_, i) => `item${i}`);
        const longData = { values: [{ name: "longlist", value: longArray }] };
        const content = "SELECT * WHERE id IN (${longlist:csv})";
        const result = processVariableContent(content, longData);
        expect(result).toContain("item0,item1,item2");
        expect(result).toContain("item99");
      });
    });
  });

  describe("Integration Tests", () => {
    it("should work together for time-based variable processing", () => {
      const interval = 3600000; // 1 hour in ms
      const formatted = formatInterval(interval);
      const seconds = getTimeInSecondsBasedOnUnit(formatted.value, formatted.unit);
      const rateFormatted = formatRateInterval(seconds);
      
      expect(formatted).toEqual({ value: 1, unit: "h" });
      expect(seconds).toBe(3600);
      expect(rateFormatted).toBe("1h");
    });

    it("should handle variable replacement with time formatting", () => {
      const variablesData = {
        values: [
          { name: "interval", value: "1h" },
          { name: "services", value: ["api", "web"] }
        ]
      };
      
      const query = "rate(requests[${interval}]) by (service) where service in (${services:singlequote})";
      const processed = processVariableContent(query, variablesData);
      
      expect(processed).toBe("rate(requests[1h]) by (service) where service in ('api','web')");
    });
  });
});
