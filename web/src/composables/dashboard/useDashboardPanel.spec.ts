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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { nextTick } from "vue";
import useDashboardPanelData from "./useDashboardPanel";

const addXAxisItemMock = vi.fn();
const resetAggregationFunctionMock = vi.fn();
const getStreamMock = vi.fn();
const getPromSeriesMock = vi.fn();

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: "org-1" },
      zoConfig: {
        timestamp_column: "_ts",
        user_defined_schemas_enabled: true,
      },
    },
  }),
}));

vi.mock("../useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
  }),
}));

vi.mock("../useStreams", () => ({
  default: () => ({
    getStreams: vi.fn(),
    getStream: (...args: any[]) => getStreamMock(...args),
  }),
}));

vi.mock("./useValuesWebSocket", () => ({
  default: () => ({
    fetchFieldValues: vi.fn(),
  }),
}));

vi.mock("@/composables/dashboard/usePanelFields", () => ({
  usePanelFields: () => ({
    promqlMode: false,
    isAddXAxisNotAllowed: false,
    isAddBreakdownNotAllowed: false,
    isAddYAxisNotAllowed: false,
    isAddZAxisNotAllowed: false,
    generateLabelFromName: vi.fn(),
    updateArrayAlias: vi.fn(),
    addXAxisItem: (...args: any[]) => addXAxisItemMock(...args),
    addYAxisItem: vi.fn(),
    addZAxisItem: vi.fn(),
    addBreakDownAxisItem: vi.fn(),
    addLatitude: vi.fn(),
    addLongitude: vi.fn(),
    addWeight: vi.fn(),
    addMapName: vi.fn(),
    addMapValue: vi.fn(),
    addSource: vi.fn(),
    addTarget: vi.fn(),
    addValue: vi.fn(),
    removeXAxisItemByIndex: vi.fn(),
    removeYAxisItemByIndex: vi.fn(),
    removeZAxisItemByIndex: vi.fn(),
    removeBreakdownItemByIndex: vi.fn(),
    removeFilterItem: vi.fn(),
    removeLatitude: vi.fn(),
    removeLongitude: vi.fn(),
    removeWeight: vi.fn(),
    removeMapName: vi.fn(),
    removeMapValue: vi.fn(),
    removeSource: vi.fn(),
    removeTarget: vi.fn(),
    removeValue: vi.fn(),
    resetFields: vi.fn(),
    removeXYFilters: vi.fn(),
    setFieldsBasedOnChartTypeValidation: vi.fn(),
  }),
}));

vi.mock("@/composables/dashboard/usePanelAggregation", () => ({
  usePanelAggregation: () => ({
    resetAggregationFunction: (...args: any[]) => resetAggregationFunctionMock(...args),
  }),
}));

vi.mock("../useLogs/logsUtils", () => ({
  default: () => ({
    checkTimestampAlias: vi.fn(),
  }),
}));

vi.mock("@/services/metrics", () => ({
  default: {
    get_promql_series: (...args: any[]) => getPromSeriesMock(...args),
  },
}));

describe("useDashboardPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getStreamMock.mockResolvedValue({
      name: "main_stream",
      schema: [{ name: "kubernetes_namespace_name" }],
      settings: {},
    });

    getPromSeriesMock.mockResolvedValue({
      data: {
        data: [
          { __name__: "cpu_usage", pod: "pod-a", region: "us" },
          { __name__: "cpu_usage", pod: "pod-b", region: "eu" },
        ],
      },
    });
  });

  it("adds and removes query entries", () => {
    const panel = useDashboardPanelData("dashboard-panel-test-1");

    panel.dashboardPanelData.data.queries[0].fields.stream = "stream-a";
    panel.dashboardPanelData.data.queries[0].fields.stream_type = "logs";

    panel.addQuery();
    expect(panel.dashboardPanelData.data.queries).toHaveLength(2);
    expect(panel.dashboardPanelData.data.queries[1].fields.stream).toBe("stream-a");
    // New query is seeded synchronously with default builder fields so the tab
    // is ready the moment it activates (no async race with stream selection).
    expect(panel.dashboardPanelData.data.queries[1].fields.y).toHaveLength(1);
    expect(panel.dashboardPanelData.data.queries[1].fields.y[0].functionName).toBe("count");

    panel.removeQuery(1);
    expect(panel.dashboardPanelData.data.queries).toHaveLength(1);
  });

  it("resets panel data and seeds default histogram x + count y fields", () => {
    const panel = useDashboardPanelData("dashboard-panel-test-2");
    panel.resetDashboardPanelDataAndAddTimeField();

    const fields = panel.dashboardPanelData.data.queries[0].fields;
    expect(fields.x).toHaveLength(1);
    expect(fields.x[0].functionName).toBe("histogram");
    expect(fields.y).toHaveLength(1);
    expect(fields.y[0].functionName).toBe("count");
  });

  it("turns off VRL toggle when query type changes to promql", async () => {
    const panel = useDashboardPanelData("dashboard-panel-test-3");
    panel.dashboardPanelData.layout.vrlFunctionToggle = true;

    panel.dashboardPanelData.data.queryType = "promql";
    await nextTick();

    expect(panel.dashboardPanelData.layout.vrlFunctionToggle).toBe(false);
  });

  it("uses user defined schema when enabled", () => {
    const panel = useDashboardPanelData("dashboard-panel-test-4");

    panel.dashboardPanelData.meta.stream.userDefinedSchema = [{ name: "field_1" }];
    panel.dashboardPanelData.meta.stream.selectedStreamFields = [{ name: "fallback" }];
    panel.dashboardPanelData.meta.stream.useUserDefinedSchemas = "user_defined_schema";

    expect(panel.selectedStreamFieldsBasedOnUserDefinedSchema.value).toEqual([{ name: "field_1" }]);
  });

  it("updates grouped fields for SQL mode with joins", async () => {
    const panel = useDashboardPanelData("dashboard-panel-test-5");

    panel.dashboardPanelData.data.queryType = "sql";
    panel.dashboardPanelData.data.queries[0].fields.stream = "main_stream";
    panel.dashboardPanelData.data.queries[0].joins = [
      { stream: "joined_stream", streamAlias: "j1" },
    ];

    getStreamMock
      .mockResolvedValueOnce({ name: "main_stream", schema: [], settings: {} })
      .mockResolvedValueOnce({ name: "joined_stream", schema: [], settings: {} });

    await panel.updateGroupedFields();

    expect(getStreamMock).toHaveBeenCalledWith("main_stream", "logs", true);
    expect(getStreamMock).toHaveBeenCalledWith("joined_stream", "logs", true);
    expect(panel.dashboardPanelData.meta.streamFields.groupedFields).toEqual([
      { name: "main_stream", schema: [], settings: {}, stream_alias: undefined },
      { name: "joined_stream", schema: [], settings: {}, stream_alias: "j1" },
    ]);
  });

  it("fetches and normalizes PromQL labels", async () => {
    const panel = useDashboardPanelData("dashboard-panel-test-6");

    await panel.fetchPromQLLabels("cpu_usage");

    expect(getPromSeriesMock).toHaveBeenCalledTimes(1);
    expect(panel.dashboardPanelData.meta.promql.availableLabels).toEqual(["pod", "region"]);
    expect(panel.dashboardPanelData.meta.promql.labelValuesMap.get("pod")).toEqual([
      "pod-a",
      "pod-b",
    ]);
    expect(panel.dashboardPanelData.meta.promql.loadingLabels).toBe(false);
  });

  it("queries PromQL labels using the panel's selected time range", async () => {
    const panel = useDashboardPanelData("dashboard-panel-test-range");

    // Selected range whose data is older than the previous hardcoded 24h window.
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-01-08T00:00:00.000Z");
    panel.dashboardPanelData.meta.dateTime = {
      start_time: start,
      end_time: end,
    };

    await panel.fetchPromQLLabels("cpu_usage");

    expect(getPromSeriesMock).toHaveBeenCalledTimes(1);
    expect(getPromSeriesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: '{__name__="cpu_usage"}',
        // Selected range is forwarded as microseconds, not the hardcoded 24h.
        start_time: start.getTime() * 1000,
        end_time: end.getTime() * 1000,
      }),
    );
  });

  it("falls back to the last 24h when no valid time range is set", async () => {
    const panel = useDashboardPanelData("dashboard-panel-test-fallback");
    panel.dashboardPanelData.meta.dateTime = {
      start_time: "Invalid Date",
      end_time: "Invalid Date",
    };

    await panel.fetchPromQLLabels("cpu_usage");

    const args = getPromSeriesMock.mock.calls[0][0];
    // 24 hours expressed in microseconds.
    expect(args.end_time - args.start_time).toBe(24 * 60 * 60 * 1000000);
  });

  it("clears PromQL labels on fetch failure", async () => {
    const panel = useDashboardPanelData("dashboard-panel-test-7");
    getPromSeriesMock.mockRejectedValueOnce(new Error("network"));

    await panel.fetchPromQLLabels("cpu_usage");

    expect(panel.dashboardPanelData.meta.promql.availableLabels).toEqual([]);
    expect(panel.dashboardPanelData.meta.promql.labelValuesMap.size).toBe(0);
    expect(panel.dashboardPanelData.meta.promql.loadingLabels).toBe(false);
  });
});
