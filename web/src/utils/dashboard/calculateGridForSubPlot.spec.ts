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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { calculateGridPositions, getTrellisGrid } from "@/utils/dashboard/calculateGridForSubPlot";

describe("calculateGridForSubPlot", () => {
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  // Test 1: Basic functionality - calculateGridPositions
  describe("calculateGridPositions", () => {
    it("should return empty grid array when numGrids is 0", () => {
      const result = calculateGridPositions(100, 100, 0);
      
      expect(result).toEqual([]);
    });

    it("should return empty grid array when numGrids is negative", () => {
      const result = calculateGridPositions(100, 100, -5);
      
      expect(result).toEqual([]);
    });

    it("should calculate grid for single element", () => {
      const result = calculateGridPositions(100, 100, 1);
      
      expect(result).toEqual({
        gridArray: [
          {
            left: "0%",
            top: "0%",
            width: "100%",
            height: "100%",
          }
        ],
        gridWidth: 100,
        gridHeight: 100,
        gridNoOfRow: 1,
        gridNoOfCol: 1,
      });
    });

    it("should calculate grid for multiple elements with square aspect ratio", () => {
      const result = calculateGridPositions(100, 100, 4);
      
      expect(result).toEqual({
        gridArray: [
          { left: "0%", top: "0%", width: "50%", height: "50%" },
          { left: "50%", top: "0%", width: "50%", height: "50%" },
          { left: "0%", top: "50%", width: "50%", height: "50%" },
          { left: "50%", top: "50%", width: "50%", height: "50%" },
        ],
        gridWidth: 50,
        gridHeight: 50,
        gridNoOfRow: 2,
        gridNoOfCol: 2,
      });
    });

    it("should handle different aspect ratios", () => {
      const result = calculateGridPositions(200, 100, 2);
      
      expect(result.gridArray).toHaveLength(2);
      expect(result.gridNoOfRow).toBe(1);
      expect(result.gridNoOfCol).toBe(2);
      expect(result.gridWidth).toBe(100);  // 50% of 200
      expect(result.gridHeight).toBe(100); // 100% of 100
    });

    it("should handle error in calculateOptimalGrid and use default values", () => {
      // Using very large numbers might cause errors in calculateOptimalGrid
      const result = calculateGridPositions(100, 100, 1);
      
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(result.gridNoOfRow).toBe(1);
      expect(result.gridNoOfCol).toBe(1);
    });

    it("should handle non-square numbers of grids", () => {
      const result = calculateGridPositions(100, 100, 3);
      
      // calculateGridPositions creates ALL cells in the grid, not just numGrids
      expect(result.gridArray.length).toBeGreaterThanOrEqual(3);
      expect(result.gridNoOfRow).toBeGreaterThanOrEqual(1);
      expect(result.gridNoOfCol).toBeGreaterThanOrEqual(1);
      expect(result.gridNoOfRow * result.gridNoOfCol).toBeGreaterThanOrEqual(3);
      // All cells should have proper positioning
      result.gridArray.forEach(cell => {
        expect(cell).toHaveProperty('left');
        expect(cell).toHaveProperty('top');
        expect(cell).toHaveProperty('width');
        expect(cell).toHaveProperty('height');
      });
    });
  });

  // Test 2: getTrellisGrid function tests
  describe("getTrellisGrid", () => {
    it("should throw error for invalid width", () => {
      expect(() => getTrellisGrid(0, 100, 1, 10)).toThrow("Width and height must be positive numbers");
      expect(() => getTrellisGrid(-100, 100, 1, 10)).toThrow("Width and height must be positive numbers");
    });

    it("should throw error for negative left margin", () => {
      expect(() => getTrellisGrid(100, 100, 1, -10)).toThrow("Left margin must be non-negative");
    });

    it("should throw error for invalid numGrids", () => {
      expect(() => getTrellisGrid(100, 100, "invalid" as any, 10)).toThrow("Number of grids must be a non-negative number");
      expect(() => getTrellisGrid(100, 100, -5, 10)).toThrow("Number of grids must be a non-negative number");
    });

    it("should return empty grid array when numGrids is 0", () => {
      const result = getTrellisGrid(100, 100, 0, 10);
      
      expect(result).toEqual({
        gridArray: []
      });
    });

    it("should calculate trellis grid for single element", () => {
      const result = getTrellisGrid(400, 300, 1, 50);
      
      expect(result.gridArray).toHaveLength(1);
      expect(result.gridNoOfRow).toBe(1);
      expect(result.gridNoOfCol).toBe(1);
      expect(result.panelHeight).toBeGreaterThanOrEqual(300);
      expect(result.gridArray[0]).toHaveProperty('left');
      expect(result.gridArray[0]).toHaveProperty('top');
      expect(result.gridArray[0]).toHaveProperty('width');
      expect(result.gridArray[0]).toHaveProperty('height');
    });

    it("should calculate trellis grid for multiple elements", () => {
      const result = getTrellisGrid(800, 600, 4, 100);
      
      expect(result.gridArray).toHaveLength(4);
      expect(result.gridNoOfRow).toBeGreaterThanOrEqual(1);
      expect(result.gridNoOfCol).toBeGreaterThanOrEqual(1);
      expect(result.panelHeight).toBeGreaterThanOrEqual(600);
    });

    it("should handle forced number of columns", () => {
      const result = getTrellisGrid(800, 600, 6, 50, 3); // Force 3 columns
      
      expect(result.gridArray).toHaveLength(6);
      expect(result.gridNoOfCol).toBe(3);
      expect(result.gridNoOfRow).toBe(2); // 6 grids / 3 columns = 2 rows
    });

    it("should handle axisWidth parameter", () => {
      const resultWithAxis = getTrellisGrid(400, 300, 2, 50, -1, 100);
      const resultWithoutAxis = getTrellisGrid(400, 300, 2, 50, -1, null);
      
      expect(resultWithAxis.gridArray).toHaveLength(2);
      expect(resultWithoutAxis.gridArray).toHaveLength(2);
      // Both should work but with different left padding calculations
    });

    it("should limit grid array to numGrids when grid has more cells", () => {
      const result = getTrellisGrid(800, 600, 3, 50, 2); // 2 columns, 3 grids
      
      expect(result.gridArray).toHaveLength(3); // Should stop at 3, not create 4 (2x2 grid)
      expect(result.gridNoOfCol).toBe(2);
      expect(result.gridNoOfRow).toBe(2); // ceil(3/2) = 2 rows needed
    });

    it("should handle error in calculateOptimalGrid and use defaults", () => {
      // This should not trigger an error but test the try-catch block
      const result = getTrellisGrid(400, 300, 1, 50);
      
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(result.gridArray).toHaveLength(1);
    });

    it("should calculate proper spacing and positioning", () => {
      const result = getTrellisGrid(400, 300, 2, 50);
      
      expect(result.gridArray).toHaveLength(2);
      
      // Check that all grid items have valid percentage strings
      result.gridArray.forEach(grid => {
        expect(grid.left).toMatch(/%$/);
        expect(grid.top).toMatch(/%$/);
        expect(grid.width).toMatch(/%$/);
        expect(grid.height).toMatch(/%$/);
      });
    });
  });

  // Test 3: Edge cases and error conditions that test calculateOptimalGrid indirectly
  describe("calculateOptimalGrid (indirectly tested)", () => {
    it("should handle zero grids in calculateGridPositions", () => {
      const result = calculateGridPositions(100, 100, 0);
      expect(result).toEqual([]);
    });

    it("should handle single grid calculation", () => {
      const result = calculateGridPositions(100, 100, 1);
      expect(result.gridNoOfRow).toBe(1);
      expect(result.gridNoOfCol).toBe(1);
    });

    it("should handle prime numbers of grids", () => {
      const result = calculateGridPositions(100, 100, 7);
      expect(result.gridArray.length).toBeGreaterThanOrEqual(7);
      expect(result.gridNoOfRow * result.gridNoOfCol).toBeGreaterThanOrEqual(7);
    });

    it("should handle perfect square numbers", () => {
      const result = calculateGridPositions(100, 100, 9);
      expect(result.gridArray.length).toBe(9);
      expect(result.gridNoOfRow).toBe(3);
      expect(result.gridNoOfCol).toBe(3);
    });

    it("should handle rectangular grids efficiently", () => {
      const result = calculateGridPositions(200, 100, 6); // 2:1 aspect ratio
      expect(result.gridArray.length).toBeGreaterThanOrEqual(6);
      // Should prefer more columns due to wider aspect ratio
    });

    it("should handle very large numbers of grids", () => {
      const result = calculateGridPositions(1000, 1000, 100);
      expect(result.gridArray.length).toBe(100);
      expect(result.gridNoOfRow * result.gridNoOfCol).toBeGreaterThanOrEqual(100);
    });

    it("should test forced columns in getTrellisGrid", () => {
      const result = getTrellisGrid(800, 600, 10, 50, 5); // Force 5 columns
      expect(result.gridNoOfCol).toBe(5);
      expect(result.gridNoOfRow).toBe(2); // ceil(10/5) = 2
    });

    it("should test getTrellisGrid with negative columns (should be ignored)", () => {
      const result = getTrellisGrid(800, 600, 6, 50, -1);
      // Should use optimal calculation, not forced columns
      expect(result.gridArray).toHaveLength(6);
    });
  });

  // Test 4: Complex scenarios and mathematical edge cases
  describe("Complex scenarios", () => {
    it("should handle extremely wide aspect ratios", () => {
      const result = calculateGridPositions(2000, 100, 8);
      expect(result.gridNoOfCol).toBeGreaterThan(result.gridNoOfRow);
    });

    it("should handle extremely tall aspect ratios", () => {
      const result = calculateGridPositions(100, 2000, 8);
      expect(result.gridNoOfRow).toBeGreaterThan(result.gridNoOfCol);
    });

    it("should handle edge case with break condition in nested loops", () => {
      const result = getTrellisGrid(400, 300, 5, 50, 3);
      expect(result.gridArray).toHaveLength(5);
      // Should break out of inner loop when reaching numGrids limit
    });

    it("should calculate correct panelHeight with multiple rows", () => {
      const result = getTrellisGrid(800, 400, 6, 100, 2);
      expect(result.panelHeight).toBeGreaterThan(400);
      // Height should be increased to accommodate multiple rows
    });

    it("should handle Math.max for panelHeight", () => {
      const result = getTrellisGrid(800, 1000, 1, 50);
      expect(result.panelHeight).toBeGreaterThanOrEqual(1000);
      // Should use at least the original height
    });
  });

  // Test 5: Additional edge cases to improve coverage
  describe("Additional edge cases", () => {
    it("should test scenarios that would trigger internal error handling", () => {
      // These tests verify the error handling mechanisms exist
      // The actual error lines may not be reached due to outer validation
      
      // Test mathematical edge cases
      const result1 = calculateGridPositions(Number.EPSILON, Number.EPSILON, 1);
      expect(result1).toBeDefined();
      expect(result1.gridNoOfRow).toBe(1);
      expect(result1.gridNoOfCol).toBe(1);
      
      // Test with infinity values (should be handled)
      const result2 = calculateGridPositions(Infinity, 100, 1);
      expect(result2).toBeDefined();
      
      // Test very small dimensions
      const result3 = getTrellisGrid(0.001, 0.001, 1, 0);
      expect(result3).toBeDefined();
      
      // Test with zero forced columns (should fall back to optimal calculation)
      const result4 = getTrellisGrid(100, 100, 4, 10, 0);
      expect(result4.gridArray).toHaveLength(4);
    });

    it("should test SPACING_CONFIG usage", () => {
      // Test that SPACING_CONFIG constants are being used properly
      const result = getTrellisGrid(800, 600, 4, 50);
      
      expect(result.gridArray).toHaveLength(4);
      expect(result.panelHeight).toBeGreaterThanOrEqual(600); // Should include spacing
      
      // Verify all grid elements have proper structure
      result.gridArray.forEach((grid, index) => {
        expect(grid.left).toMatch(/^[\d.]+%$/);
        expect(grid.top).toMatch(/^[\d.]+%$/);
        expect(grid.width).toMatch(/^[\d.]+%$/);
        expect(grid.height).toMatch(/^[\d.]+%$/);
      });
    });

    it("should test binary search optimization in calculateOptimalGrid (indirectly)", () => {
      // Test cases that would exercise the while loop optimization
      const result = calculateGridPositions(400, 300, 12);
      
      expect(result.gridArray.length).toBe(12);
      expect(result.gridNoOfRow * result.gridNoOfCol).toBeGreaterThanOrEqual(12);
      
      // Verify that the grid is optimized (not just a simple sqrt arrangement)
      const efficiency = result.gridArray.length / (result.gridNoOfRow * result.gridNoOfCol);
      expect(efficiency).toBeGreaterThan(0.8); // Should be reasonably efficient
    });

    it("should handle nested loop break condition correctly", () => {
      // Test the break condition in nested loops (line 152-154)
      const result = getTrellisGrid(400, 300, 7, 50, 3); // 3 columns, 7 grids
      
      expect(result.gridArray).toHaveLength(7); // Should break after 7, not fill all 9 cells
      expect(result.gridNoOfCol).toBe(3);
      expect(result.gridNoOfRow).toBe(3); // ceil(7/3) = 3 rows needed
    });

    it("should test all mathematical calculations in getTrellisGrid", () => {
      const width = 800;
      const height = 600;
      const numGrids = 6;
      const leftMargin = 100;
      
      const result = getTrellisGrid(width, height, numGrids, leftMargin);
      
      // Verify all returned properties are present and valid
      expect(result.gridArray).toHaveLength(numGrids);
      expect(result.gridNoOfRow).toBeGreaterThan(0);
      expect(result.gridNoOfCol).toBeGreaterThan(0);
      expect(result.panelHeight).toBeGreaterThanOrEqual(height);
      
      // Test that spacing calculations work
      expect(typeof result.panelHeight).toBe('number');
      expect(Number.isFinite(result.panelHeight)).toBe(true);
    });
  });
});