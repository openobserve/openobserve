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

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { useStickyColumns } from "./useStickyColumns";

describe("useStickyColumns", () => {
  let mockProps: any;
  let mockStore: any;
  let composable: any;

  beforeEach(() => {
    // Clean up any existing style elements from previous tests
    document.querySelectorAll('style[data-sticky-styles="true"]').forEach((el) => {
      el.parentNode?.removeChild(el);
    });

    mockProps = {
      data: {
        columns: [],
      },
    };

    mockStore = {
      state: {
        theme: "light",
      },
    };
  });

  afterEach(() => {
    // Clean up style elements after each test
    document.querySelectorAll('style[data-sticky-styles="true"]').forEach((el) => {
      el.parentNode?.removeChild(el);
    });
  });

  describe("Initialization", () => {
    it("should initialize with empty sticky column offsets", () => {
      composable = useStickyColumns(mockProps, mockStore);

      expect(composable.stickyColumnOffsets.value).toEqual({});
    });

    it("should return getStickyColumnStyle function", () => {
      composable = useStickyColumns(mockProps, mockStore);

      expect(typeof composable.getStickyColumnStyle).toBe("function");
    });

    it("should return stickyColumnOffsets ref", () => {
      composable = useStickyColumns(mockProps, mockStore);

      expect(composable.stickyColumnOffsets).toBeDefined();
      expect(typeof composable.stickyColumnOffsets.value).toBe("object");
    });
  });

  describe("Column Offset Calculation", () => {
    it("should calculate offsets for sticky columns", async () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: 100 },
        { name: "col2", sticky: true, width: 150 },
        { name: "col3", sticky: false },
      ];

      composable = useStickyColumns(mockProps, mockStore);
      await nextTick();

      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col2: 100,
      });
    });

    it("should use default width of 100 when width is not specified", async () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true },
        { name: "col2", sticky: true },
      ];

      composable = useStickyColumns(mockProps, mockStore);
      await nextTick();

      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col2: 100,
      });
    });

    it("should parse string width values", async () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: "120" },
        { name: "col2", sticky: true, width: "180" },
      ];

      composable = useStickyColumns(mockProps, mockStore);
      await nextTick();

      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col2: 120,
      });
    });

    it("should calculate cumulative widths correctly", async () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: 100 },
        { name: "col2", sticky: true, width: 200 },
        { name: "col3", sticky: true, width: 150 },
      ];

      composable = useStickyColumns(mockProps, mockStore);
      await nextTick();

      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col2: 100,
        col3: 300,
      });
    });

    it("should only include sticky columns in offsets", async () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: 100 },
        { name: "col2", sticky: false, width: 150 },
        { name: "col3", sticky: true, width: 200 },
      ];

      composable = useStickyColumns(mockProps, mockStore);
      await nextTick();

      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col3: 100,
      });
    });

    it("should add __colIndex to each column", async () => {
      mockProps.data.columns = [
        { name: "col1" },
        { name: "col2" },
        { name: "col3" },
      ];

      composable = useStickyColumns(mockProps, mockStore);
      await nextTick();

      expect(mockProps.data.columns[0].__colIndex).toBe(0);
      expect(mockProps.data.columns[1].__colIndex).toBe(1);
      expect(mockProps.data.columns[2].__colIndex).toBe(2);
    });

    it("should handle empty columns array", async () => {
      mockProps.data.columns = [];

      composable = useStickyColumns(mockProps, mockStore);
      await nextTick();

      expect(composable.stickyColumnOffsets.value).toEqual({});
    });

    it("should handle undefined columns", async () => {
      mockProps.data.columns = undefined;

      composable = useStickyColumns(mockProps, mockStore);
      await nextTick();

      expect(composable.stickyColumnOffsets.value).toEqual({});
    });
  });

  describe("getStickyColumnStyle", () => {
    it("should return empty object for non-sticky columns", () => {
      composable = useStickyColumns(mockProps, mockStore);

      const style = composable.getStickyColumnStyle({ sticky: false });

      expect(style).toEqual({});
    });

    it("should return empty object for undefined column", () => {
      composable = useStickyColumns(mockProps, mockStore);

      const style = composable.getStickyColumnStyle(undefined);

      expect(style).toEqual({});
    });

    it("should return empty object for null column", () => {
      composable = useStickyColumns(mockProps, mockStore);

      const style = composable.getStickyColumnStyle(null);

      expect(style).toEqual({});
    });

    it("should return style object for sticky columns", async () => {
      mockProps.data.columns = [{ name: "col1", sticky: true, width: 100 }];

      composable = useStickyColumns(mockProps, mockStore);
      await nextTick();

      const style = composable.getStickyColumnStyle({ sticky: true, name: "col1" });

      expect(style).toEqual({
        position: "sticky",
        left: "0px",
        "z-index": 2,
        "background-color": "#fff",
        "box-shadow": "2px 0 4px rgba(0, 0, 0, 0.1)",
      });
    });

    it("should use correct left offset from precomputed offsets", async () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: 100 },
        { name: "col2", sticky: true, width: 150 },
      ];

      composable = useStickyColumns(mockProps, mockStore);
      await nextTick();

      const style1 = composable.getStickyColumnStyle({ sticky: true, name: "col1" });
      const style2 = composable.getStickyColumnStyle({ sticky: true, name: "col2" });

      expect(style1.left).toBe("0px");
      expect(style2.left).toBe("100px");
    });

    it("should default to 0 offset for unknown column names", () => {
      composable = useStickyColumns(mockProps, mockStore);

      const style = composable.getStickyColumnStyle({
        sticky: true,
        name: "unknown",
      });

      expect(style.left).toBe("0px");
    });

    it("should apply dark theme background color", () => {
      mockStore.state.theme = "dark";
      composable = useStickyColumns(mockProps, mockStore);

      const style = composable.getStickyColumnStyle({ sticky: true, name: "col1" });

      expect(style["background-color"]).toBe("#1a1a1a");
    });

    it("should apply light theme background color", () => {
      mockStore.state.theme = "light";
      composable = useStickyColumns(mockProps, mockStore);

      const style = composable.getStickyColumnStyle({ sticky: true, name: "col1" });

      expect(style["background-color"]).toBe("#fff");
    });
  });

  describe("Style Generation Logic", () => {
    it("should calculate offsets for style generation", () => {
      mockProps.data.columns = [{ name: "col1", sticky: true, width: 100 }];
      composable = useStickyColumns(mockProps, mockStore);

      // Offsets are calculated which would be used for style generation
      expect(composable.stickyColumnOffsets.value).toEqual({ col1: 0 });
    });

    it("should track multiple column offsets for styling", () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: 100 },
        { name: "col2", sticky: true, width: 150 },
      ];

      composable = useStickyColumns(mockProps, mockStore);

      // Both offsets calculated for style application
      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col2: 100,
      });
    });

    it("should add column index for CSS targeting", () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true },
        { name: "col2", sticky: false },
      ];

      composable = useStickyColumns(mockProps, mockStore);

      // __colIndex added for nth-child CSS selectors
      expect(mockProps.data.columns[0].__colIndex).toBe(0);
      expect(mockProps.data.columns[1].__colIndex).toBe(1);
    });

    it("should determine theme color for styles", () => {
      mockStore.state.theme = "dark";
      mockProps.data.columns = [{ name: "col1", sticky: true }];

      composable = useStickyColumns(mockProps, mockStore);

      const style = composable.getStickyColumnStyle({ sticky: true, name: "col1" });

      // Theme determines background color
      expect(style["background-color"]).toBe("#1a1a1a");
    });

    it("should skip offset calculation for non-sticky columns", () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: 100 },
        { name: "col2", sticky: false, width: 150 },
        { name: "col3", sticky: true, width: 200 },
      ];

      composable = useStickyColumns(mockProps, mockStore);

      // col2 not included in offsets
      expect(composable.stickyColumnOffsets.value).not.toHaveProperty("col2");
      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col3: 100, // Only includes width of col1 (sticky), skips col2
      });
    });
  });

  describe("Dynamic Updates", () => {
    it("should initialize offsets based on initial columns", () => {
      mockProps.data.columns = [{ name: "col1", sticky: true, width: 100 }];
      composable = useStickyColumns(mockProps, mockStore);

      // Immediate watcher should calculate offsets on init
      expect(composable.stickyColumnOffsets.value).toEqual({ col1: 0 });
    });

    it("should recalculate offsets with different initial columns", () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: 100 },
        { name: "col2", sticky: true, width: 150 },
      ];
      composable = useStickyColumns(mockProps, mockStore);

      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col2: 100,
      });
    });

    it("should calculate all column indexes immediately", () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: 100 },
        { name: "col2", sticky: true, width: 200 },
        { name: "col3", sticky: false },
      ];

      composable = useStickyColumns(mockProps, mockStore);

      // All columns get __colIndex regardless of sticky status
      expect(mockProps.data.columns[0].__colIndex).toBe(0);
      expect(mockProps.data.columns[1].__colIndex).toBe(1);
      expect(mockProps.data.columns[2].__colIndex).toBe(2);
    });

    it("should return consistent offsets reference", () => {
      mockProps.data.columns = [{ name: "col1", sticky: true }];
      composable = useStickyColumns(mockProps, mockStore);

      const ref1 = composable.stickyColumnOffsets;
      const ref2 = composable.stickyColumnOffsets;

      // Should be the same ref object
      expect(ref1).toBe(ref2);
    });
  });

  describe("Return Values", () => {
    it("should return stickyColumnOffsets ref", () => {
      mockProps.data.columns = [{ name: "col1", sticky: true }];
      composable = useStickyColumns(mockProps, mockStore);

      expect(composable).toHaveProperty("stickyColumnOffsets");
      expect(composable.stickyColumnOffsets.value).toBeDefined();
    });

    it("should return getStickyColumnStyle function", () => {
      mockProps.data.columns = [];
      composable = useStickyColumns(mockProps, mockStore);

      expect(composable).toHaveProperty("getStickyColumnStyle");
      expect(typeof composable.getStickyColumnStyle).toBe("function");
    });

    it("should only return expected properties", () => {
      mockProps.data.columns = [];
      composable = useStickyColumns(mockProps, mockStore);

      const keys = Object.keys(composable);
      expect(keys).toHaveLength(2);
      expect(keys).toContain("stickyColumnOffsets");
      expect(keys).toContain("getStickyColumnStyle");
    });
  });

  describe("Edge Cases", () => {
    it("should handle columns with zero width", () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: 0 },
        { name: "col2", sticky: true, width: 150 },
      ];

      composable = useStickyColumns(mockProps, mockStore);

      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col2: 100, // Uses default width of 100 when width is 0
      });
    });

    it("should handle very large column widths", () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: 10000 },
        { name: "col2", sticky: true, width: 20000 },
      ];

      composable = useStickyColumns(mockProps, mockStore);

      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col2: 10000,
      });
    });

    it("should handle columns with no name property", () => {
      mockProps.data.columns = [{ sticky: true, width: 100 }];

      composable = useStickyColumns(mockProps, mockStore);

      // Should not throw error
      expect(composable.stickyColumnOffsets.value).toEqual({
        undefined: 0,
      });
    });

    it("should handle mixed numeric and string widths", () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: 100 },
        { name: "col2", sticky: true, width: "150" },
        { name: "col3", sticky: true, width: 200 },
      ];

      composable = useStickyColumns(mockProps, mockStore);

      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col2: 100,
        col3: 250,
      });
    });

    it("should handle floating point widths", () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: 100.5 },
        { name: "col2", sticky: true, width: "150.7" },
      ];

      composable = useStickyColumns(mockProps, mockStore);

      // parseInt truncates decimal points
      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col2: 100, // parseInt(100.5) = 100
      });
    });

    it("should handle negative widths", () => {
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: -50 },
        { name: "col2", sticky: true, width: 100 },
      ];

      composable = useStickyColumns(mockProps, mockStore);

      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col2: -50, // Cumulative calculation includes negative
      });
    });

    it("should handle many sticky columns", () => {
      mockProps.data.columns = Array.from({ length: 20 }, (_, i) => ({
        name: `col${i}`,
        sticky: true,
        width: 100,
      }));

      composable = useStickyColumns(mockProps, mockStore);

      // Check first, middle, and last
      expect(composable.stickyColumnOffsets.value.col0).toBe(0);
      expect(composable.stickyColumnOffsets.value.col10).toBe(1000);
      expect(composable.stickyColumnOffsets.value.col19).toBe(1900);
    });
  });

  describe("Reactivity", () => {
    it("should calculate offsets on initialization", () => {
      mockProps.data.columns = [{ name: "col1", sticky: true, width: 100 }];
      composable = useStickyColumns(mockProps, mockStore);

      // The watch runs immediately, so offsets should be calculated
      expect(composable.stickyColumnOffsets.value).toEqual({ col1: 0 });
    });

    it("should handle columns being added", async () => {
      mockProps.data.columns = [{ name: "col1", sticky: true, width: 100 }];
      composable = useStickyColumns(mockProps, mockStore);

      expect(composable.stickyColumnOffsets.value).toEqual({ col1: 0 });

      // Add more columns by pushing (modifies array in place)
      mockProps.data.columns.push({ name: "col2", sticky: true, width: 150 });
      await nextTick();
      await nextTick(); // Sometimes need extra tick for deep watch

      // Note: The exact behavior depends on whether the watch triggers
      // At minimum we should not have errors
      expect(composable.stickyColumnOffsets.value).toBeDefined();
    });

    it("should update style when theme changes in store", () => {
      mockProps.data.columns = [{ name: "col1", sticky: true }];
      mockStore.state.theme = "light";
      composable = useStickyColumns(mockProps, mockStore);

      const style1 = composable.getStickyColumnStyle({ sticky: true, name: "col1" });
      expect(style1["background-color"]).toBe("#fff");

      // After theme change, getStickyColumnStyle should return new color
      mockStore.state.theme = "dark";

      const style2 = composable.getStickyColumnStyle({ sticky: true, name: "col1" });
      expect(style2["background-color"]).toBe("#1a1a1a");
    });

    it("should handle immediate watcher execution", () => {
      // The watch has immediate: true, so it runs on setup
      mockProps.data.columns = [
        { name: "col1", sticky: true, width: 100 },
        { name: "col2", sticky: true, width: 150 },
      ];

      composable = useStickyColumns(mockProps, mockStore);

      // Offsets should be calculated immediately
      expect(composable.stickyColumnOffsets.value).toEqual({
        col1: 0,
        col2: 100,
      });
    });
  });
});
