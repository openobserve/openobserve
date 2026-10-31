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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, shallowMount } from "@vue/test-utils";
import { nextTick, reactive, ref, type Ref } from "vue";
import i18n from "@/locales";

interface EditorState {
  isLoading: Ref<boolean> | null;
  chartData: Ref<object> | null;
}

interface VisualizeApi {
  onUserRun: (range: typeof RANGE) => void;
}

const panel = vi.hoisted(() => ({ current: null as ReturnType<typeof makePanel> | null }));
const editor = vi.hoisted((): EditorState => ({ isLoading: null, chartData: null }));

const makePanel = () =>
  reactive({
    data: {
      type: "line",
      queryType: "promql",
      config: {},
      queries: [
        { query: "sum(up)", customQuery: true, fields: { stream: "up", stream_type: "metrics" } },
      ],
    },
    layout: {
      splitter: 20,
      showFieldList: true,
      showQueryBar: true,
      querySplitter: 50,
      currentQueryIndex: 0,
      isConfigPanelOpen: false,
    },
    meta: {
      dateTime: { start_time: new Date(1000), end_time: new Date(2000) },
      stream: { customQueryFields: [], vrlFunctionFieldList: [] },
      streamFields: { groupedFields: [] },
    },
  });

vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuex")>()),
  useStore: () => ({
    state: {
      timezone: "UTC",
      theme: "light",
      selectedOrganization: { identifier: "org1" },
      organizationData: { isDataIngested: true },
      zoConfig: {
        query_history_enabled: true,
        timestamp_column: "_timestamp",
        default_functions: [],
        auto_query_enabled: false,
      },
      savedViewDialog: { show: false },
    },
    commit: vi.fn(),
    dispatch: vi.fn().mockResolvedValue({}),
    getters: {},
  }),
}));

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: panel.current,
    resetDashboardPanelData: vi.fn(),
    validatePanel: vi.fn(),
    makeAutoSQLQuery: vi.fn(async () => undefined),
    regenerateOtherBuilderQueries: vi.fn(),
    resetAggregationFunction: vi.fn(),
    updateGroupedFields: vi.fn(),
  }),
}));

vi.mock("@/components/dashboards/PanelEditor/composables/usePanelEditor", () => ({
  usePanelEditor: vi.fn(() => {
    editor.isLoading = ref(false);
    editor.chartData = ref({});
    return {
      chartData: editor.chartData,
      errorData: reactive({ errors: [] }),
      metaData: ref(null),
      seriesData: ref([]),
      lastTriggeredAt: ref(null),
      showLegendsDialog: ref(false),
      shouldRefreshWithoutCache: ref(false),
      maxQueryRangeWarning: ref(""),
      panelDiagnostics: ref(null),
      seriesLimit: ref(null),
      noticeProps: ref({}),
      handlePanelDiagnosticsUpdate: vi.fn(),
      handleSeriesLimitUpdate: vi.fn(),
      limitNumberOfSeriesWarningMessage: ref(""),
      errorMessage: ref(""),
      isPartialData: ref(false),
      isPanelLoading: ref(false),
      isCachedDataDifferWithCurrentTimeRange: ref(false),
      searchRequestTraceIds: ref([]),
      panelSchemaRendererRef: ref(null),
      splitterModel: ref(50),
      isOutDated: ref(false),
      isLoading: editor.isLoading,
      currentPanelData: ref({}),
      initChartData: vi.fn(),
      runQuery: vi.fn(() => {
        if (editor.isLoading) editor.isLoading.value = true;
      }),
      handleChartApiError: vi.fn(),
      handleLastTriggeredAtUpdate: vi.fn(),
      handleLimitNumberOfSeriesWarningMessage: vi.fn(),
      handleIsPartialDataUpdate: vi.fn(),
      handleLoadingStateChange: vi.fn(),
      handleIsCachedDataDifferWithCurrentTimeRangeUpdate: vi.fn(),
      handleResultMetadataUpdate: vi.fn(),
      metaDataValue: vi.fn(),
      seriesDataUpdate: vi.fn(),
      collapseFieldList: vi.fn(),
      layoutSplitterUpdated: vi.fn(),
      updateVrlFunctionFieldList: vi.fn(),
      onDataZoom: vi.fn().mockReturnValue({ start: new Date(), end: new Date() }),
      cancelRunningQuery: vi.fn(),
      resetErrors: vi.fn(),
      updateDateTime: vi.fn(),
    };
  }),
}));

const historyApi = vi.hoisted(() => ({
  record: vi.fn(),
  list: vi.fn(),
  star: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/services/query_history", () => ({ default: historyApi }));

vi.mock("@/utils/streamPersist", () => ({ restoreMetricsStream: vi.fn(() => "") }));

import MetricsVisualize from "./MetricsVisualize.vue";

enableAutoUnmount(afterEach);

const RANGE = { valueType: "relative", relativeTimePeriod: "1h", startTime: null, endTime: null };

const mountVisualize = () =>
  shallowMount(MetricsVisualize, {
    props: { selectedDateTime: { startTime: 1000, endTime: 2000 } },
    global: {
      plugins: [i18n],
      stubs: {
        PanelEditor: false,
        OSplitter: {
          name: "OSplitter",
          template:
            '<div><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
        },
        PanelSchemaRenderer: {
          name: "PanelSchemaRenderer",
          emits: ["error"],
          template: "<div />",
        },
      },
    },
  });

const settle = async (wrapper: ReturnType<typeof mountVisualize>, error: object) => {
  wrapper.findComponent({ name: "PanelSchemaRenderer" }).vm.$emit("error", error);
  if (editor.isLoading) editor.isLoading.value = false;
  await flushPromises();
  await nextTick();
};

const run = async (wrapper: ReturnType<typeof mountVisualize>) => {
  (wrapper.vm as unknown as VisualizeApi).onUserRun(RANGE);
  await flushPromises();
};

describe("Metrics history status from the real PanelEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    panel.current = makePanel();
    historyApi.record.mockResolvedValue({ data: {} });
  });

  it("renders the real PanelEditor around the renderer", async () => {
    const wrapper = mountVisualize();
    await flushPromises();
    expect(wrapper.findComponent({ name: "PanelSchemaRenderer" }).exists()).toBe(true);
  });

  it("records a renderer query error as failed with its message", async () => {
    const wrapper = mountVisualize();
    await flushPromises();
    if (panel.current) panel.current.data.queries[0].query = "sum(up{";
    await run(wrapper);
    await settle(wrapper, { message: "parse error: unclosed left brace", code: 400 });

    expect(historyApi.record).toHaveBeenCalledTimes(1);
    expect(historyApi.record.mock.calls[0][1].context.time).toMatchObject({
      start_time: 1000,
      end_time: 2000,
    });
    expect(historyApi.record.mock.calls[0][1]).toMatchObject({
      source: "metrics",
      query: "sum(up{",
      status: "error",
      context: { error: "parse error: unclosed left brace" },
    });
  });

  it("records ok once the renderer clears its error, and nothing for a cancel", async () => {
    const wrapper = mountVisualize();
    await flushPromises();
    await run(wrapper);
    await settle(wrapper, { message: "query cancelled", code: 20009 });
    expect(historyApi.record).not.toHaveBeenCalled();

    await run(wrapper);
    await settle(wrapper, { message: "", code: "" });
    expect(historyApi.record).toHaveBeenCalledTimes(1);
    expect(historyApi.record.mock.calls[0][1]).toMatchObject({ status: "ok" });
    expect(historyApi.record.mock.calls[0][1].context.error).toBeUndefined();
  });

  it("records a timeout as ok with a warning", async () => {
    const wrapper = mountVisualize();
    await flushPromises();
    await run(wrapper);
    await settle(wrapper, { message: "search timed out", code: 20010 });
    expect(historyApi.record.mock.calls[0][1]).toMatchObject({
      status: "ok",
      context: { warning: "search timed out" },
    });
  });
});
