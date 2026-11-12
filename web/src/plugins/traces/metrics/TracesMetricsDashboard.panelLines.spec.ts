// Copyright 2026 OpenObserve Inc.
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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { installFakeIntersectionObserver } from "@/test/unit/helpers/intersectionObserverFake";

const ctl = vi.hoisted(() => ({ loaders: [] as any[] }));

// The charts component, panel container and panel renderer are real; GridStack, the data loader, the canvas and the heatmap are stood in for.
vi.mock("gridstack", () => ({
  GridStack: {
    init: vi.fn(() => ({
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
      removeAll: vi.fn(),
      makeWidget: vi.fn(),
      batchUpdate: vi.fn(),
      getGridItems: vi.fn().mockReturnValue([]),
      float: vi.fn(),
      setAnimation: vi.fn(),
      setStatic: vi.fn(),
      load: vi.fn(),
      getRow: vi.fn().mockReturnValue(60),
      getCellHeight: vi.fn().mockReturnValue(17),
      cellHeight: vi.fn(),
      engine: { nodes: [] },
    })),
  },
}));
vi.mock("gridstack/dist/gridstack.min.css", () => ({}));

vi.mock("@/composables/dashboard/usePanelDataLoader", async () => {
  const { ref: vueRef } = await import("vue");
  return {
    usePanelDataLoader: vi.fn(() => {
      const loader = {
        data: vueRef<any[]>([]),
        loading: vueRef(true),
        errorDetail: vueRef({ message: "", code: "" }),
        metadata: vueRef({ queries: [] }),
        resultMetaData: vueRef([]),
        annotations: vueRef([]),
        lastTriggeredAt: vueRef(null),
        isCachedDataDifferWithCurrentTimeRange: vueRef(false),
        searchRequestTraceIds: vueRef([]),
        loadingProgressPercentage: vueRef(0),
        isPartialData: vueRef(false),
        isFirstLoadSettled: vueRef(false),
      };
      ctl.loaders.push(loader);
      return loader;
    }),
  };
});

vi.mock("@/composables/dashboard/useAnnotationsData", () => ({
  useAnnotationsData: vi.fn(() => ({
    isAddAnnotationMode: { value: false },
    isAddAnnotationDialogVisible: { value: false },
    annotationToAddEdit: { value: null },
    editAnnotation: vi.fn(),
    toggleAddAnnotationMode: vi.fn(),
    handleAddAnnotation: vi.fn(),
    closeAddAnnotation: vi.fn(),
    disableAddAnnotationMode: vi.fn(),
    fetchAllPanels: vi.fn(),
    panelsList: { value: [] },
  })),
}));

vi.mock("@/utils/dashboard/convertPanelData", () => ({
  convertPanelData: vi.fn().mockResolvedValue({
    chartType: "line",
    options: { series: [{ data: [[1, 1]] }] },
    extras: { isTimeSeries: true },
  }),
}));

vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  __esModule: true,
  default: {
    name: "ChartRenderer",
    emits: ["painted"],
    template: '<div data-test="chart-renderer"></div>',
  },
}));

vi.mock("./TracesLatencyHeatmap.vue", () => ({
  __esModule: true,
  default: {
    name: "TracesLatencyHeatmap",
    template: '<div data-test="traces-latency-heatmap"></div>',
  },
}));

const mockSearchObj = reactive({
  loading: false,
  data: {
    editorValue: "",
    datetime: { startTime: 1_000_000, endTime: 2_000_000 },
    stream: {
      selectedStream: { value: "default" },
      selectedStreamFields: [],
      userDefinedSchema: [],
    },
  },
  meta: { showHistogram: true, metricsRangeFilters: new Map(), searchMode: "traces" },
});

vi.mock("@/composables/useTraces", () => ({
  default: () => ({ searchObj: mockSearchObj, tracesParser: { value: null } }),
}));

vi.mock("@/composables/useParser", () => ({
  default: vi.fn(() => ({ sqlParser: vi.fn().mockResolvedValue({}) })),
}));

import TracesMetricsDashboard from "./TracesMetricsDashboard.vue";

const SERIES = [{ resultType: "matrix", result: [{ metric: {}, values: [[1, "4"]] }] }];

describe("TracesMetricsDashboard RED panel lines", () => {
  let io: ReturnType<typeof installFakeIntersectionObserver> | null = null;

  afterEach(() => {
    io?.restore();
    io = null;
    ctl.loaders = [];
  });

  it("gives Rate and Errors each the dashboard panel line on cold load and refetch, with no strip line", async () => {
    io = installFakeIntersectionObserver();
    const wrapper = mount(TracesMetricsDashboard, {
      props: { streamName: "my_traces_stream", show: true },
      attachTo: document.body,
      global: { plugins: [store, router, i18n], stubs: { teleport: true } },
    });
    await vi.waitFor(
      () => expect(wrapper.find('[data-test^="dashboard-panel-placeholder-"]').exists()).toBe(true),
      { timeout: 15000 },
    );
    await flushPromises();
    wrapper.findAll(".grid-stack-item").forEach((item) => io!.setVisible(item.element, true));
    await vi.waitFor(() => expect(ctl.loaders).toHaveLength(2), { timeout: 15000 });
    await flushPromises();

    const panelLines = () =>
      wrapper
        .findAllComponents({ name: "PanelSchemaRenderer" })
        .map((panel) => panel.findComponent({ name: "LoadingProgress" }));
    expect(panelLines()).toHaveLength(2);
    expect(wrapper.find('[data-test="traces-metrics-progress"]').exists()).toBe(false);
    panelLines().forEach((line) => expect(line.props("loading")).toBe(true));

    for (const loader of ctl.loaders) {
      loader.data.value = SERIES;
      loader.loading.value = false;
      loader.isFirstLoadSettled.value = true;
    }
    await flushPromises();
    panelLines().forEach((line) => expect(line.props("loading")).toBe(false));

    ctl.loaders[0].loading.value = true;
    ctl.loaders[1].loading.value = true;
    await flushPromises();
    panelLines().forEach((line) => expect(line.props("loading")).toBe(true));
    expect(wrapper.find('[data-test="traces-metrics-progress"]').exists()).toBe(false);
    wrapper.unmount();
  }, 30000);
});
