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
import { useAlertInsights } from "./useAlertInsights";

// state is a module-level reactive singleton; clearAllFilters() resets it
// between tests to guarantee isolation.

describe("useAlertInsights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { clearAllFilters } = useAlertInsights();
    clearAllFilters();
  });

  describe("initial state", () => {
    it("starts with an empty rangeFilters map", () => {
      const { rangeFilters } = useAlertInsights();
      expect(rangeFilters.value.size).toBe(0);
    });

    it("starts with showFailedOnly as false", () => {
      const { showFailedOnly } = useAlertInsights();
      expect(showFailedOnly.value).toBe(false);
    });

    it("starts with showSilencedOnly as false", () => {
      const { showSilencedOnly } = useAlertInsights();
      expect(showSilencedOnly.value).toBe(false);
    });

    it("starts with selectedAlertName as null", () => {
      const { selectedAlertName } = useAlertInsights();
      expect(selectedAlertName.value).toBeNull();
    });

    it("starts with selectedStatus as null", () => {
      const { selectedStatus } = useAlertInsights();
      expect(selectedStatus.value).toBeNull();
    });
  });

  describe("addRangeFilter", () => {
    it("adds a filter keyed by panelId", () => {
      const { addRangeFilter, rangeFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p1", panelTitle: "Some Panel", start: 100, end: 200 });
      expect(rangeFilters.value.size).toBe(1);
      expect(rangeFilters.value.get("p1")).toEqual({
        panelId: "p1",
        panelTitle: "Some Panel",
        start: 100,
        end: 200,
      });
    });

    it("overwrites an existing filter with the same panelId", () => {
      const { addRangeFilter, rangeFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p1", panelTitle: "Panel A", start: 10, end: 20 });
      addRangeFilter({ panelId: "p1", panelTitle: "Panel A", start: 50, end: 60 });
      expect(rangeFilters.value.size).toBe(1);
      expect(rangeFilters.value.get("p1")?.start).toBe(50);
    });

    it("supports multiple distinct filters", () => {
      const { addRangeFilter, rangeFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p1", panelTitle: "A", start: 1, end: 2 });
      addRangeFilter({ panelId: "p2", panelTitle: "B", start: 3, end: 4 });
      expect(rangeFilters.value.size).toBe(2);
    });
  });

  describe("removeRangeFilter", () => {
    it("removes the filter with the given panelId", () => {
      const { addRangeFilter, removeRangeFilter, rangeFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p1", panelTitle: "A", start: 1, end: 2 });
      removeRangeFilter("p1");
      expect(rangeFilters.value.size).toBe(0);
    });

    it("does nothing when panelId does not exist", () => {
      const { addRangeFilter, removeRangeFilter, rangeFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p1", panelTitle: "A", start: 1, end: 2 });
      removeRangeFilter("unknown");
      expect(rangeFilters.value.size).toBe(1);
    });

    it("only removes the targeted filter when multiple are present", () => {
      const { addRangeFilter, removeRangeFilter, rangeFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p1", panelTitle: "A", start: 1, end: 2 });
      addRangeFilter({ panelId: "p2", panelTitle: "B", start: 3, end: 4 });
      removeRangeFilter("p1");
      expect(rangeFilters.value.has("p1")).toBe(false);
      expect(rangeFilters.value.has("p2")).toBe(true);
    });
  });

  describe("clearAllFilters", () => {
    it("empties the rangeFilters map", () => {
      const { addRangeFilter, clearAllFilters, rangeFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p1", panelTitle: "A", start: 1, end: 2 });
      clearAllFilters();
      expect(rangeFilters.value.size).toBe(0);
    });

    it("resets showFailedOnly to false", () => {
      const { showFailedOnly, clearAllFilters } = useAlertInsights();
      showFailedOnly.value = true;
      clearAllFilters();
      expect(showFailedOnly.value).toBe(false);
    });

    it("resets showSilencedOnly to false", () => {
      const { showSilencedOnly, clearAllFilters } = useAlertInsights();
      showSilencedOnly.value = true;
      clearAllFilters();
      expect(showSilencedOnly.value).toBe(false);
    });

    it("resets selectedAlertName to null", () => {
      const { selectedAlertName, clearAllFilters } = useAlertInsights();
      selectedAlertName.value = "my-alert";
      clearAllFilters();
      expect(selectedAlertName.value).toBeNull();
    });

    it("resets selectedStatus to null", () => {
      const { selectedStatus, clearAllFilters } = useAlertInsights();
      selectedStatus.value = "active";
      clearAllFilters();
      expect(selectedStatus.value).toBeNull();
    });
  });

  describe("computed setters", () => {
    it("showFailedOnly setter updates the shared state", () => {
      const { showFailedOnly } = useAlertInsights();
      showFailedOnly.value = true;
      expect(showFailedOnly.value).toBe(true);
      showFailedOnly.value = false;
      expect(showFailedOnly.value).toBe(false);
    });

    it("showSilencedOnly setter updates the shared state", () => {
      const { showSilencedOnly } = useAlertInsights();
      showSilencedOnly.value = true;
      expect(showSilencedOnly.value).toBe(true);
    });

    it("selectedAlertName setter updates the shared state", () => {
      const { selectedAlertName } = useAlertInsights();
      selectedAlertName.value = "alert-x";
      expect(selectedAlertName.value).toBe("alert-x");
    });

    it("selectedStatus setter updates the shared state", () => {
      const { selectedStatus } = useAlertInsights();
      selectedStatus.value = "firing";
      expect(selectedStatus.value).toBe("firing");
    });

    it("state change from one composable instance is visible from another", () => {
      const instance1 = useAlertInsights();
      const instance2 = useAlertInsights();
      instance1.showFailedOnly.value = true;
      expect(instance2.showFailedOnly.value).toBe(true);
    });
  });

  describe("getBaseFilters", () => {
    it("returns an empty array when no filters are set", () => {
      const { getBaseFilters } = useAlertInsights();
      expect(getBaseFilters()).toEqual([]);
    });

    it("builds timestamp filter for Alert Volume Over Time with start and end", () => {
      const { addRangeFilter, getBaseFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p1", panelTitle: "Alert Volume Over Time", start: 1000, end: 2000 });
      const filters = getBaseFilters();
      expect(filters).toContain("_timestamp >= 1000 AND _timestamp <= 2000");
    });

    it("does not add timestamp filter for Alert Volume Over Time when start or end is null", () => {
      const { addRangeFilter, getBaseFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p1", panelTitle: "Alert Volume Over Time", start: null, end: 2000 });
      expect(getBaseFilters()).toHaveLength(0);
    });

    it("builds frequency subquery filter for Alert Frequency (Dedup Candidates) when start is set", () => {
      const { addRangeFilter, getBaseFilters } = useAlertInsights();
      addRangeFilter({
        panelId: "p2",
        panelTitle: "Alert Frequency (Dedup Candidates)",
        start: 5,
        end: null,
      });
      const filters = getBaseFilters();
      expect(filters).toHaveLength(1);
      expect(filters[0]).toContain("HAVING COUNT(*) >= 5");
    });

    it("does not add frequency filter when start is null", () => {
      const { addRangeFilter, getBaseFilters } = useAlertInsights();
      addRangeFilter({
        panelId: "p2",
        panelTitle: "Alert Frequency (Dedup Candidates)",
        start: null,
        end: null,
      });
      expect(getBaseFilters()).toHaveLength(0);
    });

    it("builds metric_value filter with both start and end for a generic panel", () => {
      const { addRangeFilter, getBaseFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p3", panelTitle: "Generic Panel", start: 10, end: 50 });
      const filters = getBaseFilters();
      expect(filters).toContain("metric_value >= 10 AND metric_value <= 50");
    });

    it("builds metric_value >= filter when only start is set for a generic panel", () => {
      const { addRangeFilter, getBaseFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p3", panelTitle: "Generic Panel", start: 10, end: null });
      const filters = getBaseFilters();
      expect(filters).toContain("metric_value >= 10");
      expect(filters.some((f) => f.includes("<="))).toBe(false);
    });

    it("builds metric_value <= filter when only end is set for a generic panel", () => {
      const { addRangeFilter, getBaseFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p3", panelTitle: "Generic Panel", start: null, end: 50 });
      const filters = getBaseFilters();
      expect(filters).toContain("metric_value <= 50");
      expect(filters.some((f) => f.includes(">="))).toBe(false);
    });

    it("does not add metric_value filter when both start and end are null for generic panel", () => {
      const { addRangeFilter, getBaseFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p3", panelTitle: "Generic Panel", start: null, end: null });
      expect(getBaseFilters()).toHaveLength(0);
    });

    it("adds status = 'failed' when showFailedOnly is true", () => {
      const { showFailedOnly, getBaseFilters } = useAlertInsights();
      showFailedOnly.value = true;
      expect(getBaseFilters()).toContain("status = 'failed'");
    });

    it("adds is_silenced = true when showSilencedOnly is true", () => {
      const { showSilencedOnly, getBaseFilters } = useAlertInsights();
      showSilencedOnly.value = true;
      expect(getBaseFilters()).toContain("is_silenced = true");
    });

    it("adds alert_name filter when selectedAlertName is set", () => {
      const { selectedAlertName, getBaseFilters } = useAlertInsights();
      selectedAlertName.value = "cpu-alert";
      expect(getBaseFilters()).toContain("alert_name = 'cpu-alert'");
    });

    it("adds status filter when selectedStatus is set", () => {
      const { selectedStatus, getBaseFilters } = useAlertInsights();
      selectedStatus.value = "resolved";
      expect(getBaseFilters()).toContain("status = 'resolved'");
    });

    it("combines multiple filter types in a single call", () => {
      const { addRangeFilter, showFailedOnly, selectedAlertName, getBaseFilters } = useAlertInsights();
      addRangeFilter({ panelId: "p1", panelTitle: "Alert Volume Over Time", start: 1000, end: 2000 });
      showFailedOnly.value = true;
      selectedAlertName.value = "mem-alert";
      const filters = getBaseFilters();
      expect(filters).toHaveLength(3);
      expect(filters).toContain("_timestamp >= 1000 AND _timestamp <= 2000");
      expect(filters).toContain("status = 'failed'");
      expect(filters).toContain("alert_name = 'mem-alert'");
    });

    it("does not include showFailedOnly filter when it is false", () => {
      const { showFailedOnly, getBaseFilters } = useAlertInsights();
      showFailedOnly.value = false;
      const filters = getBaseFilters();
      expect(filters.some((f) => f.includes("failed"))).toBe(false);
    });
  });
});
