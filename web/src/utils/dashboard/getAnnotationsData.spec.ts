// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { getAnnotationsData } from "@/utils/dashboard/getAnnotationsData";

// Mock date-fns-tz
vi.mock("date-fns-tz", () => ({
  toZonedTime: vi.fn((date, timezone) => {
    // Simple mock that returns a predictable date object for testing
    if (date instanceof Date) {
      return new Date(date.getTime()); // Return the same date for simplicity
    }
    return date;
  }),
}));

describe("getAnnotationsData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Basic functionality - return structure
  it("should return object with markLines and markAreas arrays", () => {
    const annotations = { value: [] };
    const timezone = "UTC";

    const result = getAnnotationsData(annotations, timezone);

    expect(result).toEqual({
      markLines: [],
      markAreas: [],
    });
  });

  // Test 2: Edge cases - null/undefined/missing annotations
  it("should handle null annotations", () => {
    const result = getAnnotationsData(null, "UTC");
    
    expect(result).toEqual({
      markLines: [],
      markAreas: [],
    });
  });

  it("should handle undefined annotations", () => {
    const result = getAnnotationsData(undefined, "UTC");
    
    expect(result).toEqual({
      markLines: [],
      markAreas: [],
    });
  });

  it("should handle annotations without value property", () => {
    const annotations = {};
    const result = getAnnotationsData(annotations, "UTC");
    
    expect(result).toEqual({
      markLines: [],
      markAreas: [],
    });
  });

  it("should handle annotations with null value property", () => {
    const annotations = { value: null };
    const result = getAnnotationsData(annotations, "UTC");
    
    expect(result).toEqual({
      markLines: [],
      markAreas: [],
    });
  });

  // Test 3: MarkAreas - annotations with both start_time and end_time
  it("should create markAreas for annotations with both start_time and end_time", () => {
    const annotations = {
      value: [
        {
          title: "Test Area Annotation",
          start_time: 1640995200000000, // 2022-01-01 00:00:00 in microseconds
          end_time: 1641081600000000,   // 2022-01-02 00:00:00 in microseconds
          description: "Test description"
        }
      ]
    };

    const result = getAnnotationsData(annotations, "UTC");

    expect(result.markLines).toEqual([]);
    expect(result.markAreas).toHaveLength(1);
    expect(result.markAreas[0]).toHaveLength(2);
    
    // First element of markArea (start)
    expect(result.markAreas[0][0]).toEqual({
      name: "Test Area Annotation",
      label: { show: true, formatter: "Test Area Annotation", distance: 0.2 },
      xAxis: expect.any(Date),
      annotationDetails: annotations.value[0],
    });
    
    // Second element of markArea (end)
    expect(result.markAreas[0][1]).toEqual({
      xAxis: expect.any(Date),
      annotationDetails: annotations.value[0],
    });
  });

  it("should create markAreas for multiple annotations with start_time and end_time", () => {
    const annotations = {
      value: [
        {
          title: "First Area",
          start_time: 1640995200000000,
          end_time: 1641081600000000,
        },
        {
          title: "Second Area", 
          start_time: 1641168000000000,
          end_time: 1641254400000000,
        }
      ]
    };

    const result = getAnnotationsData(annotations, "UTC");

    expect(result.markLines).toEqual([]);
    expect(result.markAreas).toHaveLength(2);
    expect(result.markAreas[0][0].name).toBe("First Area");
    expect(result.markAreas[1][0].name).toBe("Second Area");
  });

  // Test 4: MarkLines - annotations with only start_time
  it("should create markLines for annotations with only start_time", () => {
    const annotations = {
      value: [
        {
          title: "Test Line Annotation",
          start_time: 1640995200000000, // 2022-01-01 00:00:00 in microseconds
          description: "Test line description"
        }
      ]
    };

    const result = getAnnotationsData(annotations, "UTC");

    expect(result.markAreas).toEqual([]);
    expect(result.markLines).toHaveLength(1);
    expect(result.markLines[0]).toEqual({
      symbol: ["circle", "triangle"],
      name: "Test Line Annotation",
      type: "xAxis",
      xAxis: expect.any(Date),
      label: { show: true, formatter: "Test Line Annotation", distance: 0.2 },
      annotationDetails: annotations.value[0],
    });
  });

  it("should create markLines for multiple annotations with only start_time", () => {
    const annotations = {
      value: [
        {
          title: "First Line",
          start_time: 1640995200000000,
        },
        {
          title: "Second Line",
          start_time: 1641081600000000,
        }
      ]
    };

    const result = getAnnotationsData(annotations, "UTC");

    expect(result.markAreas).toEqual([]);
    expect(result.markLines).toHaveLength(2);
    expect(result.markLines[0].name).toBe("First Line");
    expect(result.markLines[1].name).toBe("Second Line");
  });

  it("should handle annotations with only start_time but no end_time (undefined end_time)", () => {
    const annotations = {
      value: [
        {
          title: "Line with undefined end_time",
          start_time: 1640995200000000,
          end_time: undefined,
        }
      ]
    };

    const result = getAnnotationsData(annotations, "UTC");

    expect(result.markAreas).toEqual([]);
    expect(result.markLines).toHaveLength(1);
    expect(result.markLines[0].name).toBe("Line with undefined end_time");
  });

  // Test 5: Mixed scenarios - both markLines and markAreas
  it("should handle mixed annotations (both areas and lines)", () => {
    const annotations = {
      value: [
        {
          title: "Area Annotation",
          start_time: 1640995200000000,
          end_time: 1641081600000000,
        },
        {
          title: "Line Annotation",
          start_time: 1641168000000000,
        }
      ]
    };

    const result = getAnnotationsData(annotations, "UTC");

    expect(result.markAreas).toHaveLength(1);
    expect(result.markLines).toHaveLength(1);
    expect(result.markAreas[0][0].name).toBe("Area Annotation");
    expect(result.markLines[0].name).toBe("Line Annotation");
  });

  // Test 6: Edge cases for annotation properties
  it("should handle annotations without start_time", () => {
    const annotations = {
      value: [
        {
          title: "No Time Annotation",
          description: "This annotation has no time"
        }
      ]
    };

    const result = getAnnotationsData(annotations, "UTC");

    expect(result.markLines).toEqual([]);
    expect(result.markAreas).toEqual([]);
  });

  it("should handle annotations with null start_time", () => {
    const annotations = {
      value: [
        {
          title: "Null Start Time",
          start_time: null,
          end_time: 1641081600000000,
        }
      ]
    };

    const result = getAnnotationsData(annotations, "UTC");

    expect(result.markLines).toEqual([]);
    expect(result.markAreas).toEqual([]);
  });

  it("should handle annotations with null end_time", () => {
    const annotations = {
      value: [
        {
          title: "Null End Time",
          start_time: 1640995200000000,
          end_time: null,
        }
      ]
    };

    const result = getAnnotationsData(annotations, "UTC");

    expect(result.markAreas).toEqual([]);
    expect(result.markLines).toHaveLength(1);
    expect(result.markLines[0].name).toBe("Null End Time");
  });

  it("should handle annotations with zero start_time (skipped due to falsy 0)", () => {
    const annotations = {
      value: [
        {
          title: "Zero Start Time",
          start_time: 0,
          end_time: 1640995200000000,
        }
      ]
    };

    const result = getAnnotationsData(annotations, "UTC");

    // Zero start_time is falsy, so neither condition is met - annotation is skipped
    expect(result.markAreas).toEqual([]);
    expect(result.markLines).toEqual([]);
  });

  it("should handle annotations with zero end_time (creates markLine)", () => {
    const annotations = {
      value: [
        {
          title: "Zero End Time",
          start_time: 1640995200000000,
          end_time: 0,
        }
      ]
    };

    const result = getAnnotationsData(annotations, "UTC");

    // Zero end_time is falsy, so it goes to else if condition
    expect(result.markAreas).toEqual([]);
    expect(result.markLines).toHaveLength(1);
    expect(result.markLines[0].name).toBe("Zero End Time");
  });

  // Test 7: Different timezone handling
  it("should work with different timezone", () => {
    const annotations = {
      value: [
        {
          title: "PST Annotation",
          start_time: 1640995200000000,
        }
      ]
    };

    const result = getAnnotationsData(annotations, "America/Los_Angeles");

    expect(result.markLines).toHaveLength(1);
    expect(result.markLines[0].name).toBe("PST Annotation");
  });

  // Test 8: Empty value array (already covered but ensuring)
  it("should handle empty value array", () => {
    const annotations = { value: [] };
    const result = getAnnotationsData(annotations, "UTC");
    
    expect(result).toEqual({
      markLines: [],
      markAreas: [],
    });
  });
});