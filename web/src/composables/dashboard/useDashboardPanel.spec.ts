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

    panel.removeQuery(1);
    expect(panel.dashboardPanelData.data.queries).toHaveLength(1);
  });

  it("resets panel data and adds default timestamp field", () => {
    const panel = useDashboardPanelData("dashboard-panel-test-2");
    panel.resetDashboardPanelDataAndAddTimeField();

    expect(addXAxisItemMock).toHaveBeenCalledWith({ name: "_ts" });
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

    expect(panel.selectedStreamFieldsBasedOnUserDefinedSchema.value).toEqual([
      { name: "field_1" },
    ]);
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
    expect(panel.dashboardPanelData.meta.promql.availableLabels).toEqual([
      "pod",
      "region",
    ]);
    expect(panel.dashboardPanelData.meta.promql.labelValuesMap.get("pod")).toEqual([
      "pod-a",
      "pod-b",
    ]);
    expect(panel.dashboardPanelData.meta.promql.loadingLabels).toBe(false);
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
