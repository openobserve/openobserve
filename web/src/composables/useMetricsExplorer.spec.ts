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

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockNotify } = vi.hoisted(() => ({
  mockNotify: vi.fn(),
}));

vi.mock("quasar", () => ({
  useQuasar: vi.fn(() => ({ notify: mockNotify })),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      selectedOrganization: { identifier: "test-org" },
      zoConfig: {
        timestamp_column: "_timestamp",
        query_values_default_num: 10,
      },
    },
  })),
}));

const { mockFieldValues } = vi.hoisted(() => ({
  mockFieldValues: vi.fn(),
}));

vi.mock("@/services/stream", () => ({
  default: { fieldValues: mockFieldValues },
}));

import useMetricsExplorer from "./useMetricsExplorer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Always get a fresh instance with reset state. */
function getInstance() {
  const inst = useMetricsExplorer();
  inst.resetDashboardPanelData();
  return inst;
}

// ---------------------------------------------------------------------------

describe("useMetricsExplorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset shared singleton state
    useMetricsExplorer().resetDashboardPanelData();
  });

  // -------------------------------------------------------------------------
  // Return value structure
  // -------------------------------------------------------------------------
  describe("return value structure", () => {
    it("exposes all expected properties and functions", () => {
      const inst = getInstance();

      expect(inst).toHaveProperty("dashboardPanelData");
      expect(inst).toHaveProperty("resetDashboardPanelData");
      expect(inst).toHaveProperty("addXAxisItem");
      expect(inst).toHaveProperty("addYAxisItem");
      expect(inst).toHaveProperty("addZAxisItem");
      expect(inst).toHaveProperty("addLatitude");
      expect(inst).toHaveProperty("addLongitude");
      expect(inst).toHaveProperty("addWeight");
      expect(inst).toHaveProperty("removeXAxisItem");
      expect(inst).toHaveProperty("removeYAxisItem");
      expect(inst).toHaveProperty("removeZAxisItem");
      expect(inst).toHaveProperty("removeFilterItem");
      expect(inst).toHaveProperty("removeLatitude");
      expect(inst).toHaveProperty("removeLongitude");
      expect(inst).toHaveProperty("removeWeight");
      expect(inst).toHaveProperty("addFilteredItem");
      expect(inst).toHaveProperty("loadFilterItem");
      expect(inst).toHaveProperty("removeXYFilters");
      expect(inst).toHaveProperty("updateXYFieldsForCustomQueryMode");
      expect(inst).toHaveProperty("updateXYFieldsOnCustomQueryChange");
      expect(inst).toHaveProperty("isAddXAxisNotAllowed");
      expect(inst).toHaveProperty("isAddYAxisNotAllowed");
      expect(inst).toHaveProperty("isAddZAxisNotAllowed");
      expect(inst).toHaveProperty("promqlMode");
      expect(inst).toHaveProperty("addQuery");
      expect(inst).toHaveProperty("removeQuery");
      expect(inst).toHaveProperty("resetAggregationFunction");
      expect(inst).toHaveProperty("cleanupDraggingFields");
    });
  });

  // -------------------------------------------------------------------------
  // resetDashboardPanelData — initial / reset state
  // -------------------------------------------------------------------------
  describe("resetDashboardPanelData", () => {
    it("resets data.type to bar", () => {
      const { dashboardPanelData, resetDashboardPanelData } = getInstance();
      dashboardPanelData.data.type = "pie";
      resetDashboardPanelData();
      expect(dashboardPanelData.data.type).toBe("bar");
    });

    it("resets data.queryType to sql", () => {
      const { dashboardPanelData, resetDashboardPanelData } = getInstance();
      dashboardPanelData.data.queryType = "promql";
      resetDashboardPanelData();
      expect(dashboardPanelData.data.queryType).toBe("sql");
    });

    it("resets queries array to one default query", () => {
      const { dashboardPanelData, resetDashboardPanelData, addQuery } =
        getInstance();
      addQuery();
      expect(dashboardPanelData.data.queries.length).toBe(2);
      resetDashboardPanelData();
      expect(dashboardPanelData.data.queries.length).toBe(1);
    });

    it("resets config.show_legends to true", () => {
      const { dashboardPanelData, resetDashboardPanelData } = getInstance();
      dashboardPanelData.data.config.show_legends = false;
      resetDashboardPanelData();
      expect(dashboardPanelData.data.config.show_legends).toBe(true);
    });

    it("resets layout.splitter to 20", () => {
      const { dashboardPanelData, resetDashboardPanelData } = getInstance();
      dashboardPanelData.layout.splitter = 80;
      resetDashboardPanelData();
      expect(dashboardPanelData.layout.splitter).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // promqlMode computed
  // -------------------------------------------------------------------------
  describe("promqlMode", () => {
    it("returns false when queryType is sql", () => {
      const { promqlMode } = getInstance();
      expect(promqlMode.value).toBe(false);
    });

    it("returns true when queryType is promql", () => {
      const { dashboardPanelData, promqlMode } = getInstance();
      dashboardPanelData.data.queryType = "promql";
      expect(promqlMode.value).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // addQuery / removeQuery
  // -------------------------------------------------------------------------
  describe("addQuery / removeQuery", () => {
    it("addQuery appends a new query entry", () => {
      const { addQuery, dashboardPanelData } = getInstance();
      const before = dashboardPanelData.data.queries.length;
      addQuery();
      expect(dashboardPanelData.data.queries.length).toBe(before + 1);
    });

    it("new SQL query has customQuery=false", () => {
      const { addQuery, dashboardPanelData } = getInstance();
      dashboardPanelData.data.queryType = "sql";
      addQuery();
      const last = dashboardPanelData.data.queries.at(-1);
      expect(last?.customQuery).toBe(false);
    });

    it("new PromQL query has customQuery=true", () => {
      const { addQuery, dashboardPanelData } = getInstance();
      dashboardPanelData.data.queryType = "promql";
      addQuery();
      const last = dashboardPanelData.data.queries.at(-1);
      expect(last?.customQuery).toBe(true);
    });

    it("removeQuery removes the entry at the given index", () => {
      const { addQuery, removeQuery, dashboardPanelData } = getInstance();
      addQuery();
      const before = dashboardPanelData.data.queries.length;
      removeQuery(1);
      expect(dashboardPanelData.data.queries.length).toBe(before - 1);
    });

    it("removeQuery does nothing for out-of-bounds index", () => {
      const { removeQuery, dashboardPanelData } = getInstance();
      const before = dashboardPanelData.data.queries.length;
      expect(() => removeQuery(99)).not.toThrow();
      // Array length unchanged
      expect(dashboardPanelData.data.queries.length).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // X-axis operations
  // -------------------------------------------------------------------------
  describe("addXAxisItem / removeXAxisItem", () => {
    it("adds field to x axis", () => {
      const { addXAxisItem, dashboardPanelData } = getInstance();
      addXAxisItem({ name: "timestamp" });
      expect(
        dashboardPanelData.data.queries[0].fields.x.some(
          (f: any) => f.column === "timestamp",
        ),
      ).toBe(true);
    });

    it("does not add duplicate field to x axis", () => {
      const { addXAxisItem, dashboardPanelData } = getInstance();
      addXAxisItem({ name: "timestamp" });
      addXAxisItem({ name: "timestamp" });
      const count = dashboardPanelData.data.queries[0].fields.x.filter(
        (f: any) => f.column === "timestamp",
      ).length;
      expect(count).toBe(1);
    });

    it("assigns histogram aggregation for _timestamp column", () => {
      const { addXAxisItem, dashboardPanelData } = getInstance();
      addXAxisItem({ name: "_timestamp" });
      const field = dashboardPanelData.data.queries[0].fields.x.find(
        (f: any) => f.column === "_timestamp",
      );
      expect(field?.aggregationFunction).toBe("histogram");
    });

    it("assigns null aggregation for non-timestamp x field", () => {
      const { addXAxisItem, dashboardPanelData } = getInstance();
      addXAxisItem({ name: "service_name" });
      const field = dashboardPanelData.data.queries[0].fields.x.find(
        (f: any) => f.column === "service_name",
      );
      expect(field?.aggregationFunction).toBeNull();
    });

    it("removeXAxisItem removes field by name", () => {
      const { addXAxisItem, removeXAxisItem, dashboardPanelData } =
        getInstance();
      addXAxisItem({ name: "service_name" });
      removeXAxisItem("service_name");
      expect(
        dashboardPanelData.data.queries[0].fields.x.find(
          (f: any) => f.column === "service_name",
        ),
      ).toBeUndefined();
    });

    it("removeXAxisItem does nothing when field not present", () => {
      const { removeXAxisItem, dashboardPanelData } = getInstance();
      const before = dashboardPanelData.data.queries[0].fields.x.length;
      expect(() => removeXAxisItem("nonexistent")).not.toThrow();
      expect(dashboardPanelData.data.queries[0].fields.x.length).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // Y-axis operations
  // -------------------------------------------------------------------------
  describe("addYAxisItem / removeYAxisItem", () => {
    it("adds field to y axis with count aggregation by default", () => {
      const { addYAxisItem, dashboardPanelData } = getInstance();
      addYAxisItem({ name: "latency" });
      const field = dashboardPanelData.data.queries[0].fields.y.find(
        (f: any) => f.column === "latency",
      );
      expect(field?.aggregationFunction).toBe("count");
    });

    it("does not add duplicate field to y axis", () => {
      const { addYAxisItem, dashboardPanelData } = getInstance();
      addYAxisItem({ name: "latency" });
      addYAxisItem({ name: "latency" });
      const count = dashboardPanelData.data.queries[0].fields.y.filter(
        (f: any) => f.column === "latency",
      ).length;
      expect(count).toBe(1);
    });

    it("assigns null aggregation for heatmap chart type", () => {
      const { addYAxisItem, dashboardPanelData } = getInstance();
      dashboardPanelData.data.type = "heatmap";
      addYAxisItem({ name: "count" });
      const field = dashboardPanelData.data.queries[0].fields.y.find(
        (f: any) => f.column === "count",
      );
      expect(field?.aggregationFunction).toBeNull();
    });

    it("removeYAxisItem removes field by name", () => {
      const { addYAxisItem, removeYAxisItem, dashboardPanelData } =
        getInstance();
      addYAxisItem({ name: "latency" });
      removeYAxisItem("latency");
      expect(
        dashboardPanelData.data.queries[0].fields.y.find(
          (f: any) => f.column === "latency",
        ),
      ).toBeUndefined();
    });

    it("assigns a color value when adding y axis item", () => {
      const { addYAxisItem, dashboardPanelData } = getInstance();
      addYAxisItem({ name: "metric" });
      const field = dashboardPanelData.data.queries[0].fields.y.find(
        (f: any) => f.column === "metric",
      );
      expect(field?.color).toBeDefined();
      expect(typeof field?.color).toBe("string");
    });
  });

  // -------------------------------------------------------------------------
  // Z-axis operations
  // -------------------------------------------------------------------------
  describe("addZAxisItem / removeZAxisItem", () => {
    it("adds field to z axis", () => {
      const { addZAxisItem, dashboardPanelData } = getInstance();
      addZAxisItem({ name: "weight" });
      expect(
        dashboardPanelData.data.queries[0].fields.z.find(
          (f: any) => f.column === "weight",
        ),
      ).toBeDefined();
    });

    it("removeZAxisItem removes field by name", () => {
      const { addZAxisItem, removeZAxisItem, dashboardPanelData } =
        getInstance();
      addZAxisItem({ name: "weight" });
      removeZAxisItem("weight");
      expect(
        dashboardPanelData.data.queries[0].fields.z.find(
          (f: any) => f.column === "weight",
        ),
      ).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Latitude / Longitude / Weight
  // -------------------------------------------------------------------------
  describe("addLatitude / addLongitude / addWeight", () => {
    it("addLatitude sets latitude field", () => {
      const { addLatitude, dashboardPanelData } = getInstance();
      addLatitude({ name: "lat" });
      expect(dashboardPanelData.data.queries[0].fields.latitude).not.toBeNull();
      expect(dashboardPanelData.data.queries[0].fields.latitude?.column).toBe(
        "lat",
      );
    });

    it("addLongitude sets longitude field", () => {
      const { addLongitude, dashboardPanelData } = getInstance();
      addLongitude({ name: "lng" });
      expect(
        dashboardPanelData.data.queries[0].fields.longitude?.column,
      ).toBe("lng");
    });

    it("addWeight sets weight field with count aggregation", () => {
      const { addWeight, dashboardPanelData } = getInstance();
      addWeight({ name: "w" });
      expect(dashboardPanelData.data.queries[0].fields.weight?.column).toBe(
        "w",
      );
      expect(
        dashboardPanelData.data.queries[0].fields.weight?.aggregationFunction,
      ).toBe("count");
    });

    it("removeLatitude sets latitude to null", () => {
      const { addLatitude, removeLatitude, dashboardPanelData } = getInstance();
      addLatitude({ name: "lat" });
      removeLatitude();
      expect(dashboardPanelData.data.queries[0].fields.latitude).toBeNull();
    });

    it("removeLongitude sets longitude to null", () => {
      const { addLongitude, removeLongitude, dashboardPanelData } =
        getInstance();
      addLongitude({ name: "lng" });
      removeLongitude();
      expect(dashboardPanelData.data.queries[0].fields.longitude).toBeNull();
    });

    it("removeWeight sets weight to null", () => {
      const { addWeight, removeWeight, dashboardPanelData } = getInstance();
      addWeight({ name: "w" });
      removeWeight();
      expect(dashboardPanelData.data.queries[0].fields.weight).toBeNull();
    });

    it("addLatitude does not overwrite existing latitude", () => {
      const { addLatitude, dashboardPanelData } = getInstance();
      addLatitude({ name: "lat1" });
      addLatitude({ name: "lat2" });
      expect(dashboardPanelData.data.queries[0].fields.latitude?.column).toBe(
        "lat1",
      );
    });
  });

  // -------------------------------------------------------------------------
  // isAddXAxisNotAllowed / isAddYAxisNotAllowed / isAddZAxisNotAllowed
  // -------------------------------------------------------------------------
  describe("axis restriction computeds", () => {
    it("isAddXAxisNotAllowed is false for default bar chart with no x fields", () => {
      const { isAddXAxisNotAllowed } = getInstance();
      expect(isAddXAxisNotAllowed.value).toBe(false);
    });

    it("isAddXAxisNotAllowed is true for pie chart with one x field", () => {
      const { addXAxisItem, isAddXAxisNotAllowed, dashboardPanelData } =
        getInstance();
      dashboardPanelData.data.type = "pie";
      addXAxisItem({ name: "slice" });
      expect(isAddXAxisNotAllowed.value).toBe(true);
    });

    it("isAddXAxisNotAllowed is true for metric type always", () => {
      const { isAddXAxisNotAllowed, dashboardPanelData } = getInstance();
      dashboardPanelData.data.type = "metric";
      expect(isAddXAxisNotAllowed.value).toBe(true);
    });

    it("isAddXAxisNotAllowed is false for table type always", () => {
      const { isAddXAxisNotAllowed, dashboardPanelData } = getInstance();
      dashboardPanelData.data.type = "table";
      expect(isAddXAxisNotAllowed.value).toBe(false);
    });

    it("isAddYAxisNotAllowed is false for bar chart with no y fields", () => {
      const { isAddYAxisNotAllowed } = getInstance();
      expect(isAddYAxisNotAllowed.value).toBe(false);
    });

    it("isAddYAxisNotAllowed is true for pie chart with one y field", () => {
      const { addYAxisItem, isAddYAxisNotAllowed, dashboardPanelData } =
        getInstance();
      dashboardPanelData.data.type = "pie";
      addYAxisItem({ name: "value" });
      expect(isAddYAxisNotAllowed.value).toBe(true);
    });

    it("isAddZAxisNotAllowed is true for heatmap with one z field", () => {
      const { addZAxisItem, isAddZAxisNotAllowed, dashboardPanelData } =
        getInstance();
      dashboardPanelData.data.type = "heatmap";
      addZAxisItem({ name: "heat" });
      expect(isAddZAxisNotAllowed.value).toBe(true);
    });

    it("isAddZAxisNotAllowed is false for non-heatmap types", () => {
      const { isAddZAxisNotAllowed, dashboardPanelData } = getInstance();
      dashboardPanelData.data.type = "bar";
      expect(isAddZAxisNotAllowed.value).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // updateArrayAlias
  // -------------------------------------------------------------------------
  describe("updateArrayAlias", () => {
    it("updates x axis alias to x_axis_1 for non-custom query", () => {
      const { addXAxisItem, updateArrayAlias, dashboardPanelData } =
        getInstance();
      dashboardPanelData.data.queries[0].customQuery = false;
      addXAxisItem({ name: "myField" });
      updateArrayAlias();
      const field = dashboardPanelData.data.queries[0].fields.x[0];
      expect(field.alias).toBe("x_axis_1");
    });

    it("updates y axis alias to y_axis_1 for non-custom query", () => {
      const { addYAxisItem, updateArrayAlias, dashboardPanelData } =
        getInstance();
      dashboardPanelData.data.queries[0].customQuery = false;
      addYAxisItem({ name: "metric" });
      updateArrayAlias();
      const field = dashboardPanelData.data.queries[0].fields.y[0];
      expect(field.alias).toBe("y_axis_1");
    });
  });

  // -------------------------------------------------------------------------
  // removeFilterItem
  // -------------------------------------------------------------------------
  describe("addFilteredItem / removeFilterItem", () => {
    it("addFilteredItem adds filter entry and calls StreamService.fieldValues", () => {
      mockFieldValues.mockResolvedValue({
        data: { hits: [{ values: [{ zo_sql_key: "val1" }] }] },
      });

      const { addFilteredItem, dashboardPanelData } = getInstance();
      dashboardPanelData.meta.dateTime = {
        start_time: new Date("2024-01-01"),
        end_time: new Date("2024-01-02"),
      };

      addFilteredItem("level");

      const filterEntry = dashboardPanelData.data.queries[0].fields.filter.find(
        (f: any) => f.column === "level",
      );
      expect(filterEntry).toBeDefined();
      expect(filterEntry?.type).toBe("list");
    });

    it("removeFilterItem removes the filter entry", () => {
      mockFieldValues.mockResolvedValue({ data: { hits: [] } });

      const { addFilteredItem, removeFilterItem, dashboardPanelData } =
        getInstance();
      dashboardPanelData.meta.dateTime = {
        start_time: new Date("2024-01-01"),
        end_time: new Date("2024-01-02"),
      };

      addFilteredItem("host");
      removeFilterItem("host");

      const filterEntry = dashboardPanelData.data.queries[0].fields.filter.find(
        (f: any) => f.column === "host",
      );
      expect(filterEntry).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // cleanupDraggingFields
  // -------------------------------------------------------------------------
  describe("cleanupDraggingFields", () => {
    it("resets all drag-and-drop meta fields", () => {
      const { cleanupDraggingFields, dashboardPanelData } = getInstance();
      dashboardPanelData.meta.dragAndDrop.dragging = true;
      dashboardPanelData.meta.dragAndDrop.dragElement = "someElement";
      dashboardPanelData.meta.dragAndDrop.currentDragArea = "x";

      cleanupDraggingFields();

      expect(dashboardPanelData.meta.dragAndDrop.dragging).toBe(false);
      expect(dashboardPanelData.meta.dragAndDrop.dragElement).toBeNull();
      expect(dashboardPanelData.meta.dragAndDrop.currentDragArea).toBeNull();
      expect(dashboardPanelData.meta.dragAndDrop.dragSource).toBeNull();
      expect(dashboardPanelData.meta.dragAndDrop.dragSourceIndex).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // removeXYFilters
  // -------------------------------------------------------------------------
  describe("removeXYFilters", () => {
    it("clears x, y, z and filter arrays in non-custom SQL mode", () => {
      const {
        addXAxisItem,
        addYAxisItem,
        removeXYFilters,
        dashboardPanelData,
      } = getInstance();

      dashboardPanelData.data.queryType = "sql";
      dashboardPanelData.data.queries[0].customQuery = false;

      addXAxisItem({ name: "field1" });
      addYAxisItem({ name: "metric" });

      removeXYFilters();

      expect(dashboardPanelData.data.queries[0].fields.x.length).toBe(0);
      expect(dashboardPanelData.data.queries[0].fields.y.length).toBe(0);
    });

    it("does not clear fields when customQuery is true and not promql mode", () => {
      const {
        addXAxisItem,
        removeXYFilters,
        dashboardPanelData,
      } = getInstance();

      dashboardPanelData.data.queryType = "sql";
      dashboardPanelData.data.queries[0].customQuery = true;

      addXAxisItem({ name: "field1" });
      removeXYFilters();

      // Should NOT have been cleared
      expect(dashboardPanelData.data.queries[0].fields.x.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // resetAggregationFunction
  // -------------------------------------------------------------------------
  describe("resetAggregationFunction", () => {
    it("sets y aggregation to null for heatmap type", () => {
      const { addYAxisItem, resetAggregationFunction, dashboardPanelData } =
        getInstance();

      addYAxisItem({ name: "value" });
      dashboardPanelData.data.type = "heatmap";
      resetAggregationFunction();

      expect(
        dashboardPanelData.data.queries[0].fields.y[0].aggregationFunction,
      ).toBeNull();
    });

    it("restores y aggregation to count for non-heatmap types", () => {
      const { addYAxisItem, resetAggregationFunction, dashboardPanelData } =
        getInstance();

      addYAxisItem({ name: "value" });
      // manually set to null
      dashboardPanelData.data.queries[0].fields.y[0].aggregationFunction = null;
      dashboardPanelData.data.type = "bar";
      resetAggregationFunction();

      expect(
        dashboardPanelData.data.queries[0].fields.y[0].aggregationFunction,
      ).toBe("count");
    });

    it("clears geomap x/y/z/filter fields", () => {
      const { addXAxisItem, resetAggregationFunction, dashboardPanelData } =
        getInstance();

      addXAxisItem({ name: "lat" });
      dashboardPanelData.data.type = "geomap";
      resetAggregationFunction();

      expect(dashboardPanelData.data.queries[0].fields.x.length).toBe(0);
      expect(dashboardPanelData.data.queries[0].fields.y.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // generateLabelFromName (tested indirectly via addXAxisItem label)
  // -------------------------------------------------------------------------
  describe("generateLabelFromName (via addXAxisItem)", () => {
    it("converts snake_case to Title Case", () => {
      const { addXAxisItem, dashboardPanelData } = getInstance();
      dashboardPanelData.data.queries[0].customQuery = false;
      addXAxisItem({ name: "service_name" });
      const field = dashboardPanelData.data.queries[0].fields.x.find(
        (f: any) => f.column === "service_name",
      );
      expect(field?.label).toBe("Service Name");
    });

    it("converts kebab-case to Title Case", () => {
      const { addXAxisItem, dashboardPanelData } = getInstance();
      dashboardPanelData.data.queries[0].customQuery = false;
      addXAxisItem({ name: "http-method" });
      const field = dashboardPanelData.data.queries[0].fields.x.find(
        (f: any) => f.column === "http-method",
      );
      expect(field?.label).toBe("Http Method");
    });
  });
});
