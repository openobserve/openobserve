// Copyright 2026 OpenObserve Inc.
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
import { isOverlayEligible } from "./index";

describe("isOverlayEligible", () => {
  const validOldOptions = {
    series: [{ name: "A", data: [[1, 2]], type: "line" }],
  };

  describe("eligible chart types", () => {
    const eligibleTypes = [
      "line",
      "area",
      "area-stacked",
      "bar",
      "stacked",
      "h-bar",
      "h-stacked",
      "scatter",
    ];

    eligibleTypes.forEach((type) => {
      it(`returns true for ${type} chart type`, () => {
        const panelSchema = { type, queries: [{}] };
        expect(isOverlayEligible(panelSchema, validOldOptions)).toBe(true);
      });
    });
  });

  describe("ineligible chart types", () => {
    const ineligibleTypes = [
      "pie",
      "donut",
      "metric",
      "gauge",
      "heatmap",
      "geomap",
      "maps",
      "table",
      "sankey",
      "custom_chart",
    ];

    ineligibleTypes.forEach((type) => {
      it(`returns false for ${type} chart type`, () => {
        const panelSchema = { type, queries: [{}] };
        expect(isOverlayEligible(panelSchema, validOldOptions)).toBe(false);
      });
    });
  });

  describe("old options validation", () => {
    it("returns false when oldOptions is null", () => {
      const panelSchema = { type: "line", queries: [{}] };
      expect(isOverlayEligible(panelSchema, null)).toBe(false);
    });

    it("returns false when oldOptions is undefined", () => {
      const panelSchema = { type: "line", queries: [{}] };
      expect(isOverlayEligible(panelSchema, undefined)).toBe(false);
    });

    it("returns false when oldOptions has empty series", () => {
      const panelSchema = { type: "line", queries: [{}] };
      expect(isOverlayEligible(panelSchema, { series: [] })).toBe(false);
    });

    it("returns false when oldOptions has no series property", () => {
      const panelSchema = { type: "line", queries: [{}] };
      expect(isOverlayEligible(panelSchema, {})).toBe(false);
    });
  });

  describe("chart type change detection", () => {
    it("returns false when chart type has changed", () => {
      const panelSchema = { type: "bar", queries: [{}] };
      const oldOptions = {
        series: [{ name: "A", data: [[1, 2]] }],
        _chartType: "line",
      };
      expect(isOverlayEligible(panelSchema, oldOptions)).toBe(false);
    });

    it("returns true when chart type matches", () => {
      const panelSchema = { type: "line", queries: [{}] };
      const oldOptions = {
        series: [{ name: "A", data: [[1, 2]] }],
        _chartType: "line",
      };
      expect(isOverlayEligible(panelSchema, oldOptions)).toBe(true);
    });

    it("returns true when _chartType is not set (no prior metadata)", () => {
      const panelSchema = { type: "line", queries: [{}] };
      expect(isOverlayEligible(panelSchema, validOldOptions)).toBe(true);
    });
  });

  describe("query count change detection", () => {
    it("returns false when query count has changed", () => {
      const panelSchema = { type: "line", queries: [{}, {}] };
      const oldOptions = {
        series: [{ name: "A", data: [[1, 2]] }],
        _queryCount: 1,
      };
      expect(isOverlayEligible(panelSchema, oldOptions)).toBe(false);
    });

    it("returns true when query count matches", () => {
      const panelSchema = { type: "line", queries: [{}] };
      const oldOptions = {
        series: [{ name: "A", data: [[1, 2]] }],
        _queryCount: 1,
      };
      expect(isOverlayEligible(panelSchema, oldOptions)).toBe(true);
    });

    it("returns true when _queryCount is undefined (no prior metadata)", () => {
      const panelSchema = { type: "line", queries: [{}] };
      expect(isOverlayEligible(panelSchema, validOldOptions)).toBe(true);
    });

    it("returns true when _queryCount is 0 and queries is empty", () => {
      const panelSchema = { type: "line", queries: [] };
      const oldOptions = {
        series: [{ name: "A", data: [[1, 2]] }],
        _queryCount: 0,
      };
      expect(isOverlayEligible(panelSchema, oldOptions)).toBe(true);
    });

    it("returns false when _queryCount is 0 but queries has entries", () => {
      const panelSchema = { type: "line", queries: [{}] };
      const oldOptions = {
        series: [{ name: "A", data: [[1, 2]] }],
        _queryCount: 0,
      };
      expect(isOverlayEligible(panelSchema, oldOptions)).toBe(false);
    });
  });

  describe("combined guard conditions", () => {
    it("returns false when both chart type and query count changed", () => {
      const panelSchema = { type: "bar", queries: [{}, {}] };
      const oldOptions = {
        series: [{ name: "A", data: [[1, 2]] }],
        _chartType: "line",
        _queryCount: 1,
      };
      expect(isOverlayEligible(panelSchema, oldOptions)).toBe(false);
    });

    it("returns true when _chartType is empty string (falsy, guard skipped)", () => {
      const panelSchema = { type: "line", queries: [{}] };
      const oldOptions = {
        series: [{ name: "A", data: [[1, 2]] }],
        _chartType: "",
      };
      // "" is falsy → `oldOptions._chartType &&` short-circuits → guard skipped → true
      expect(isOverlayEligible(panelSchema, oldOptions)).toBe(true);
    });

    it("returns true for eligible type with series and no prior metadata at all", () => {
      const panelSchema = { type: "h-stacked", queries: [{}, {}] };
      const oldOptions = {
        series: [{ name: "A", data: [[1, 2]] }],
        // No _chartType, no _queryCount
      };
      expect(isOverlayEligible(panelSchema, oldOptions)).toBe(true);
    });
  });
});
