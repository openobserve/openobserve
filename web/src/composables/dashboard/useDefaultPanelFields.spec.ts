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

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockUpdateGroupedFields, mockMakeAutoSQLQuery, state } = vi.hoisted(
  () => ({
    mockUpdateGroupedFields: vi.fn(),
    mockMakeAutoSQLQuery: vi.fn(),
    state: { panel: null as any },
  }),
);

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: state.panel,
    updateGroupedFields: mockUpdateGroupedFields,
    makeAutoSQLQuery: mockMakeAutoSQLQuery,
    // Mirror the real chart-type axis rules: metric/gauge disallow an x-axis.
    isAddXAxisNotAllowed: {
      get value() {
        const t = state.panel?.data?.type;
        const xlen =
          state.panel?.data?.queries?.[0]?.fields?.x?.length ?? 0;
        if (t === "metric") return xlen >= 0; // metric: x never allowed
        if (t === "gauge" || t === "pie" || t === "donut") return xlen >= 1;
        if (t === "table") return false;
        return xlen >= 1; // bar/line/area/etc.
      },
    },
    isAddYAxisNotAllowed: {
      get value() {
        const ylen =
          state.panel?.data?.queries?.[0]?.fields?.y?.length ?? 0;
        const t = state.panel?.data?.type;
        if (["pie", "donut", "gauge", "metric"].includes(t)) return ylen >= 1;
        return false;
      },
    },
  }),
}));

import useDefaultPanelFields from "./useDefaultPanelFields";

function setPanel({
  type = "bar",
  queryType = "sql",
  stream = "s1",
  streamType = "logs",
  query = "",
  customQuery = true,
  groupedFields = [] as any[],
} = {}) {
  state.panel = {
    data: {
      type,
      queryType,
      queries: [
        {
          customQuery,
          query,
          fields: {
            stream,
            stream_type: streamType,
            x: [],
            y: [],
            breakdown: [],
            filter: {},
          },
        },
      ],
    },
    layout: { currentQueryIndex: 0 },
    meta: { streamFields: { groupedFields } },
  };
}

const currentQuery = () => state.panel.data.queries[0];

describe("useDefaultPanelFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PromQL", () => {
    it("seeds `${stream}{}` and sets builder mode, without touching x/y", async () => {
      setPanel({ queryType: "promql", stream: "mystream", customQuery: true });
      const { applyDefaultPanelFields } = useDefaultPanelFields("metrics");
      await applyDefaultPanelFields();

      expect(currentQuery().query).toBe("mystream{}");
      expect(currentQuery().customQuery).toBe(false);
      expect(currentQuery().fields.x).toEqual([]);
      expect(mockUpdateGroupedFields).not.toHaveBeenCalled();
      expect(mockMakeAutoSQLQuery).not.toHaveBeenCalled();
    });

    it("leaves the query empty when no stream is selected", async () => {
      setPanel({ queryType: "promql", stream: "" });
      const { applyDefaultPanelFields } = useDefaultPanelFields("metrics");
      await applyDefaultPanelFields();

      expect(currentQuery().query).toBe("");
      expect(currentQuery().customQuery).toBe(false);
    });
  });

  describe("SQL", () => {
    it("logs stream: seeds histogram + count, resets breakdown/filter, regenerates", async () => {
      setPanel({
        queryType: "sql",
        stream: "logs1",
        streamType: "logs",
        groupedFields: [{ name: "logs1", schema: [{ name: "_timestamp" }] }],
      });
      const { applyDefaultPanelFields } = useDefaultPanelFields("dashboard");
      await applyDefaultPanelFields();

      expect(mockUpdateGroupedFields).toHaveBeenCalledTimes(1);
      expect(currentQuery().fields.x[0].functionName).toBe("histogram");
      expect(currentQuery().fields.y[0].functionName).toBe("count");
      expect(currentQuery().fields.breakdown).toEqual([]);
      expect(currentQuery().fields.filter).toMatchObject({
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
      });
      expect(currentQuery().customQuery).toBe(false);
      expect(mockMakeAutoSQLQuery).toHaveBeenCalledTimes(1);
    });

    it("metrics stream with a value column: seeds avg(value)", async () => {
      setPanel({
        queryType: "sql",
        stream: "m1",
        streamType: "metrics",
        groupedFields: [{ name: "m1", schema: [{ name: "value" }] }],
      });
      const { applyDefaultPanelFields } = useDefaultPanelFields("metrics");
      await applyDefaultPanelFields();

      expect(currentQuery().fields.y[0].functionName).toBe("avg");
    });

    it("metric chart: seeds y but NOT x (x-axis not allowed for metric)", async () => {
      setPanel({
        type: "metric",
        queryType: "sql",
        stream: "logs1",
        streamType: "logs",
        groupedFields: [{ name: "logs1", schema: [{ name: "_timestamp" }] }],
      });
      const { applyDefaultPanelFields } = useDefaultPanelFields("dashboard");
      await applyDefaultPanelFields();

      expect(currentQuery().fields.x).toEqual([]);
      expect(currentQuery().fields.y[0].functionName).toBe("count");
    });

    it("gauge chart: seeds x and y (gauge allows one x when empty)", async () => {
      setPanel({
        type: "gauge",
        queryType: "sql",
        stream: "logs1",
        streamType: "logs",
        groupedFields: [{ name: "logs1", schema: [{ name: "_timestamp" }] }],
      });
      const { applyDefaultPanelFields } = useDefaultPanelFields("dashboard");
      await applyDefaultPanelFields();

      expect(currentQuery().fields.x[0].functionName).toBe("histogram");
      expect(currentQuery().fields.y[0].functionName).toBe("count");
    });

    it("no stream: seeds x/y but skips schema load and query regeneration", async () => {
      setPanel({ queryType: "sql", stream: "", streamType: "logs" });
      const { applyDefaultPanelFields } = useDefaultPanelFields("dashboard");
      await applyDefaultPanelFields();

      expect(mockUpdateGroupedFields).not.toHaveBeenCalled();
      expect(mockMakeAutoSQLQuery).not.toHaveBeenCalled();
      expect(currentQuery().fields.x[0].functionName).toBe("histogram");
      expect(currentQuery().fields.y[0].functionName).toBe("count");
    });

    it("does not reject when updateGroupedFields throws, and falls back to count", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      // empty groupedFields = no schema for the current stream (failed/stale load)
      setPanel({
        queryType: "sql",
        stream: "m1",
        streamType: "metrics",
        groupedFields: [],
      });
      mockUpdateGroupedFields.mockRejectedValueOnce(new Error("network"));
      const { applyDefaultPanelFields } = useDefaultPanelFields("dashboard");

      await expect(applyDefaultPanelFields()).resolves.toBeUndefined();
      expect(currentQuery().fields.y[0].functionName).toBe("count");
      expect(mockMakeAutoSQLQuery).toHaveBeenCalledTimes(1);
      errSpy.mockRestore();
    });
  });

  describe("guards", () => {
    it("is a no-op for non-cartesian / custom chart types", async () => {
      setPanel({ type: "custom_chart", customQuery: true });
      const { applyDefaultPanelFields } = useDefaultPanelFields("dashboard");
      await applyDefaultPanelFields();

      expect(currentQuery().customQuery).toBe(true); // returned before any mutation
      expect(mockMakeAutoSQLQuery).not.toHaveBeenCalled();
    });

    it("is a no-op for heatmap (measure lives on Z; Y disallows aggregation)", async () => {
      setPanel({ type: "heatmap", customQuery: true });
      const { applyDefaultPanelFields } = useDefaultPanelFields("dashboard");
      await applyDefaultPanelFields();

      expect(currentQuery().customQuery).toBe(true); // returned before any mutation
      expect(currentQuery().fields.x).toEqual([]);
      expect(currentQuery().fields.y).toEqual([]);
      expect(mockMakeAutoSQLQuery).not.toHaveBeenCalled();
    });

    it("returns early (no throw) when the current query is missing", async () => {
      setPanel();
      state.panel.data.queries = [];
      const { applyDefaultPanelFields } = useDefaultPanelFields("dashboard");

      await expect(applyDefaultPanelFields()).resolves.toBeUndefined();
    });
  });
});
